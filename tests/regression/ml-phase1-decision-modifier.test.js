const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMlPhase1DecisionModifier,
  toMlPhase1DecisionEvent,
} = require('../../dist/runtime/ml/mlPhase1DecisionModifier');
const {
  evaluateDynamicPositionSizing,
} = require('../../dist/runtime/sizing/dynamicPositionSizing');

function createBaseRuleDecision(overrides = {}) {
  return {
    decisionMode: 'full_entry',
    vetoSummary: {
      blocked: false,
      finalVeto: null,
    },
    ...overrides,
  };
}

function createMlOutput(overrides = {}) {
  return {
    mlScore: 0.72,
    mlConfidence: 0.71,
    ...overrides,
  };
}

test('mlPhase1DecisionModifier: advisory_only только логирует и не меняет решение', () => {
  const modifier = createMlPhase1DecisionModifier({ mode: 'advisory_only' });
  const output = modifier.evaluate({
    baseRuleDecision: createBaseRuleDecision(),
    mlInferenceOutput: createMlOutput({ mlScore: 0.2, mlConfidence: 0.2 }),
    capitalRegime: 'NORMAL',
  });

  assert.equal(output.baseRuleDecision, 'full_entry');
  assert.equal(output.effectiveDecisionMode, 'full_entry');
  assert.equal(output.mlDecisionEffect, 'logged_only');
});

test('mlPhase1DecisionModifier: confirm_only подтверждает approved entry, но не может разрешить запрещённый', () => {
  const modifier = createMlPhase1DecisionModifier({
    mode: 'confirm_only',
    thresholds: { confirmMinScore: 0.6, confirmMinConfidence: 0.5 },
  });

  const confirmed = modifier.evaluate({
    baseRuleDecision: createBaseRuleDecision({ decisionMode: 'weak_entry' }),
    mlInferenceOutput: createMlOutput({ mlScore: 0.62, mlConfidence: 0.55 }),
    capitalRegime: 'NORMAL',
  });
  assert.equal(confirmed.effectiveDecisionMode, 'weak_entry');
  assert.equal(confirmed.mlDecisionEffect, 'confirmed_rule_approved_entry');

  const cannotPromote = modifier.evaluate({
    baseRuleDecision: createBaseRuleDecision({ decisionMode: 'no_entry', vetoSummary: { blocked: true, finalVeto: { type: 'hard_veto' } } }),
    mlInferenceOutput: createMlOutput({ mlScore: 0.99, mlConfidence: 0.99 }),
    capitalRegime: 'NORMAL',
  });
  assert.equal(cannotPromote.effectiveDecisionMode, 'no_entry');
  assert.ok(cannotPromote.reasonCodes.includes('ml_cannot_override_rule_rejection'));
});

test('mlPhase1DecisionModifier: veto_mode может запретить уже разрешённый weak/full entry', () => {
  const modifier = createMlPhase1DecisionModifier({
    mode: 'veto_mode',
    thresholds: { vetoWeakEntryMaxScore: 0.45, vetoWeakEntryMaxConfidence: 0.4 },
  });

  const output = modifier.evaluate({
    baseRuleDecision: createBaseRuleDecision({ decisionMode: 'weak_entry' }),
    mlInferenceOutput: createMlOutput({ mlScore: 0.42, mlConfidence: 0.39 }),
    capitalRegime: 'NORMAL',
  });

  assert.equal(output.effectiveDecisionMode, 'no_entry');
  assert.equal(output.mlDecisionEffect, 'vetoed_weak_entry');
  assert.equal(output.ownership.isFinalVetoOwnerForNewEntries, false);
});

test('mlPhase1DecisionModifier + dynamicPositionSizing: confidence_sizing влияет только на aggressiveness sizing hook', () => {
  const modifier = createMlPhase1DecisionModifier({
    mode: 'confidence_sizing',
    thresholds: { sizingMinMultiplier: 0.75, sizingMaxMultiplier: 1 },
  });

  const mlDecision = modifier.evaluate({
    baseRuleDecision: createBaseRuleDecision({ decisionMode: 'full_entry' }),
    mlInferenceOutput: createMlOutput({ mlScore: 0.8, mlConfidence: 0.4 }),
    capitalRegime: 'NORMAL',
  });
  assert.equal(mlDecision.effectiveDecisionMode, 'full_entry');

  const sizing = evaluateDynamicPositionSizing({
    approvedEntryResult: {
      decisionMode: 'full_entry',
      entryScore: 0.74,
      confidence: 0.7,
      vetoSummary: { blocked: false },
    },
    decisionMode: 'full_entry',
    balanceState: { capitalRegime: 'NORMAL' },
    capitalRegime: 'NORMAL',
    tickerRisk: { riskScore: 0.35 },
    runtimeGuards: { allowNewEntries: true, hardRiskBlocked: false, unloadMode: false },
    mlPhase1Decision: mlDecision,
  }, {
    enabled: true,
    mlCompatibilityHooks: {
      phase1ConfidenceModifierHookEnabled: true,
    },
  });

  assert.ok(sizing.sizingReasonCodes.includes('ml_phase1_confidence_sizing_modifier'));
  assert.equal(sizing.explanation.ownership.isFinalDecisionOwner, false);
});

test('mlPhase1DecisionModifier: ML не может override capital prohibition', () => {
  const modifier = createMlPhase1DecisionModifier({ mode: 'veto_mode' });
  const output = modifier.evaluate({
    baseRuleDecision: createBaseRuleDecision({ decisionMode: 'full_entry' }),
    mlInferenceOutput: createMlOutput({ mlScore: 0.99, mlConfidence: 0.99 }),
    capitalRegime: 'PROHIBIT_NEW_ENTRIES',
    balanceState: { capitalRegime: 'PROHIBIT_NEW_ENTRIES' },
  });

  assert.equal(output.effectiveDecisionMode, 'no_entry');
  assert.equal(output.mlBlockedByCapitalRegime, true);
});

test('mlPhase1DecisionModifier: ML не может override forecast prohibition и не становится final veto owner', () => {
  const modifier = createMlPhase1DecisionModifier({ mode: 'confirm_only' });
  const output = modifier.evaluate({
    baseRuleDecision: createBaseRuleDecision({
      decisionMode: 'no_entry',
      vetoSummary: {
        blocked: true,
        finalVeto: { type: 'forecast_restriction_veto' },
      },
    }),
    mlInferenceOutput: createMlOutput({ mlScore: 0.99, mlConfidence: 0.99 }),
    portfolioForecast: {
      restrictionHints: ['restrict_new_entries_hard_candidate'],
    },
  });

  assert.equal(output.effectiveDecisionMode, 'no_entry');
  assert.equal(output.mlBlockedByForecastRestriction, true);
  assert.equal(output.ownership.isFinalVetoOwnerForNewEntries, false);
  assert.equal(output.ownership.baselineDecisionOwner, 'finalEntryDecisionEngine');
});

test('mlPhase1DecisionModifier: structured logging содержит обязательные ML поля', () => {
  const logs = [];
  const modifier = createMlPhase1DecisionModifier({
    mode: 'confirm_only',
    thresholds: { confirmMinScore: 0.7, confirmMinConfidence: 0.7 },
  }, {
    log: (line) => logs.push(String(line)),
  });

  const output = modifier.evaluate({
    context: { cycleId: 'c-ml-log-1', ticker: 'BTC-USDT' },
    baseRuleDecision: createBaseRuleDecision({ decisionMode: 'weak_entry' }),
    mlInferenceOutput: createMlOutput({ mlScore: 0.65, mlConfidence: 0.66 }),
    capitalRegime: 'REDUCE_RISK',
    fallbackWithoutModelState: 'disabled',
  });

  assert.equal(output.mlDecisionEffect, 'blocked_not_confirmed');
  assert.equal(logs.length > 0, true);
  const line = logs[0];
  assert.match(line, /baseRuleDecision=weak_entry/);
  assert.match(line, /mode=confirm_only/);
  assert.match(line, /mlScore=0\.6500/);
  assert.match(line, /mlConfidence=0\.6600/);
  assert.match(line, /mlDecisionEffect=blocked_not_confirmed/);
  assert.match(line, /capitalRegimeImpact=no_block/);
  assert.match(line, /forecastImpact=no_block/);
  assert.match(line, /fallbackWithoutModelState=disabled/);
  assert.match(line, /confidenceSizingHookApplied=false/);
});

test('mlPhase1DecisionModifier: structured event не забирает ownership и не инициирует heavy feature recompute', () => {
  const modifier = createMlPhase1DecisionModifier({ mode: 'confidence_sizing' });
  const decision = modifier.evaluate({
    baseRuleDecision: createBaseRuleDecision({ decisionMode: 'full_entry' }),
    mlInferenceOutput: createMlOutput({ mlScore: 0.82, mlConfidence: 0.77, mlFallbackState: 'none' }),
    fallbackWithoutModelState: 'enabled',
  });
  const event = toMlPhase1DecisionEvent({
    context: { cycleId: 'c-ml-event-1', ticker: 'ETH-USDT', mode: 'live' },
    decision,
    mlInferenceOutput: {
      mlFallbackState: 'none',
      mlReasonCodes: ['ml_phase1_inference_layer'],
      metadata: {
        ownership: {
          recalculatesHeavyFeatures: false,
        },
      },
    },
  });

  const decisionPayload = event.payload.telemetry.downstreamContext.mlPhase1Decision;
  assert.equal(event.eventType, 'ml_phase1_decision');
  assert.equal(event.finalDecision, 'full_entry');
  assert.equal(decisionPayload.confidenceSizingHookApplied, true);
  assert.equal(decisionPayload.ownership.isFinalVetoOwnerForNewEntries, false);
  assert.equal(decisionPayload.ownership.isSizingOwner, false);
  assert.equal(decisionPayload.featureComputation.recomputedHeavyFeatures, false);
});
