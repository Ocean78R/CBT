const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateDynamicPositionSizing } = require('../../dist/runtime/sizing/dynamicPositionSizing');
const { createMlPhase1DecisionModifier } = require('../../dist/runtime/ml/mlPhase1DecisionModifier');
const { createMlMetaController } = require('../../dist/runtime/ml/mlMetaController');

function createSizingInput(overrides = {}) {
  return {
    context: { cycleId: 'c-safety-1', ticker: 'BTC-USDT', mode: 'live' },
    approvedEntryResult: {
      decisionMode: 'full_entry',
      entryScore: 0.78,
      confidence: 0.74,
      vetoSummary: { blocked: false },
      dataQualityState: 'ok',
    },
    decisionMode: 'full_entry',
    balanceState: { capitalRegime: 'NORMAL', drawdownProtection: false, unloadMode: false },
    capitalRegime: 'NORMAL',
    tickerRisk: { riskScore: 0.28 },
    runtimeGuards: { allowNewEntries: true, hardRiskBlocked: false, unloadMode: false },
    metadata: { sizingDataQualityState: 'ok' },
    ...overrides,
  };
}

function runSizing(overrides = {}, config = {}) {
  return evaluateDynamicPositionSizing(createSizingInput(overrides), {
    enableDynamicPositionSizing: true,
    ...config,
  });
}

test('safety: weak entry size меньше full entry и не забирает ownership решения', () => {
  const fullOutput = runSizing();
  const weakOutput = runSizing({
    approvedEntryResult: {
      decisionMode: 'weak_entry',
      entryScore: 0.62,
      confidence: 0.59,
      vetoSummary: { blocked: false },
      dataQualityState: 'ok',
    },
    decisionMode: 'weak_entry',
  });

  assert.ok(weakOutput.sizeMultiplier < fullOutput.sizeMultiplier);
  assert.ok(weakOutput.leverageCap <= fullOutput.leverageCap);
  assert.ok(weakOutput.sizingReasonCodes.includes('weak_entry_reduced_profile'));
  assert.equal(weakOutput.explanation.ownership.isFinalDecisionOwner, false);
});

test('safety: full entry в DEFENSIVE режиме зажат по bounds (size <= 0.95, leverage <= regime cap)', () => {
  const output = runSizing({
    capitalRegime: 'DEFENSIVE',
    balanceState: { capitalRegime: 'DEFENSIVE', drawdownProtection: false, unloadMode: false },
  }, {
    baseSizingRules: { baseLeverageCap: 7 },
    capitalRegimeSizingRules: {
      DEFENSIVE: { sizeMultiplier: 0.66, leverageCap: 2, disallowFullSizeProfile: true },
    },
    leverageCapsByRegime: { DEFENSIVE: 2 },
  });

  assert.ok(output.sizeMultiplier <= 0.95);
  assert.ok(output.sizeMultiplier >= 0);
  assert.equal(output.leverageCap, 2);
  assert.ok(output.sizingReasonCodes.includes('capital_regime_full_size_blocked:DEFENSIVE'));
  assert.ok(output.sizingReasonCodes.includes('capital_regime_leverage_cap:DEFENSIVE'));
});

test('safety: capital tightening режет одновременно size и leverage относительно NORMAL', () => {
  const normal = runSizing();
  const tightened = runSizing({
    capitalRegime: 'CAPITAL_PRESERVATION',
    balanceState: { capitalRegime: 'CAPITAL_PRESERVATION', drawdownProtection: false, unloadMode: false },
  }, {
    capitalRegimeSizingRules: {
      CAPITAL_PRESERVATION: { sizeMultiplier: 0.4, leverageCap: 1, disallowFullSizeProfile: true },
    },
  });

  assert.ok(tightened.sizeMultiplier < normal.sizeMultiplier);
  assert.ok(tightened.leverageCap < normal.leverageCap);
  assert.ok(tightened.sizingReasonCodes.includes('capital_regime_tightening:CAPITAL_PRESERVATION'));
  assert.ok(tightened.sizingReasonCodes.includes('capital_regime_leverage_cap:CAPITAL_PRESERVATION'));
});

test('safety: HALT_NEW_ENTRIES полностью блокирует sizing даже при ML phase1 и meta hints', () => {
  const mlPhase1 = createMlPhase1DecisionModifier({ mode: 'confidence_sizing' }).evaluate({
    baseRuleDecision: { decisionMode: 'full_entry', vetoSummary: { blocked: false, finalVeto: null } },
    mlInferenceOutput: { mlScore: 0.99, mlConfidence: 0.99 },
    capitalRegime: 'HALT_NEW_ENTRIES',
    balanceState: { capitalRegime: 'HALT_NEW_ENTRIES', unloadMode: false },
  });

  const metaOutput = createMlMetaController().evaluate({
    context: { cycleId: 'c-safety-halt', ticker: 'BTC-USDT' },
    decisionContext: { metadata: {} },
    finalEntryDecisionOutput: { decisionMode: 'full_entry' },
    dynamicPositionSizingOutput: { sizeMultiplier: 0.5 },
    balanceState: { capitalRegime: 'HALT_NEW_ENTRIES', unloadMode: false },
    capitalRegime: 'HALT_NEW_ENTRIES',
    runtimeDataQualityState: 'ok',
    modelState: { available: true },
    metaSuggestions: { sizingAggressivenessModifier: 0.15 },
  });

  const blocked = runSizing({
    capitalRegime: 'HALT_NEW_ENTRIES',
    balanceState: { capitalRegime: 'HALT_NEW_ENTRIES', drawdownProtection: false, unloadMode: false },
    mlPhase1Decision: mlPhase1,
    mlMetaControllerOutput: metaOutput,
  });

  assert.equal(blocked.sizeMultiplier, 0);
  assert.equal(blocked.leverageCap, 0);
  assert.ok(blocked.sizingReasonCodes.includes('hard_risk_or_capital_guard_active'));
});

test('safety: forecast tightening режет aggressiveness и блокирует meta boost при defensive/strong forecast', () => {
  const base = runSizing();
  const forecastTightened = runSizing({
    forecastSizing: {
      multiplier: 0.8,
      aggressionCap: 'defensive',
      reductionHint: 'strong',
      conservativeMultiplier: 0.72,
      reason: 'forecast_fragility_high',
    },
    mlMetaControllerOutput: {
      metaControllerFallbackState: 'none',
      metaAdjustmentSet: { sizingAggressivenessModifier: 0.15 },
      allowedAdjustmentBounds: { sizingAggressivenessModifier: { min: -0.15, max: 0.15 } },
    },
  });

  assert.ok(forecastTightened.sizeMultiplier < base.sizeMultiplier);
  assert.ok(forecastTightened.sizingReasonCodes.includes('forecast_sizing_tightening:forecast_fragility_high'));
  const blockedMetaEvent = forecastTightened.explanation.structured.metaRuntimeInfluence.events.find((event) => event.reasonCode === 'metaAdjustmentBlocked');
  assert.ok(blockedMetaEvent);
  assert.equal(blockedMetaEvent.blockedReason, 'blockedByForecast');
});

test('safety: ML phase1/meta-controller bounded modifiers не могут раздуть size выше hard bounds', () => {
  const mlPhase1 = createMlPhase1DecisionModifier({
    mode: 'confidence_sizing',
    thresholds: {
      sizingMinMultiplier: 0.75,
      sizingMaxMultiplier: 1,
    },
  }).evaluate({
    baseRuleDecision: { decisionMode: 'full_entry', vetoSummary: { blocked: false, finalVeto: null } },
    mlInferenceOutput: { mlScore: 0.99, mlConfidence: 1 },
    capitalRegime: 'NORMAL',
  });

  const metaOutput = createMlMetaController({
    boundsByAdjustmentType: {
      sizingAggressivenessModifier: { min: -0.15, max: 0.15 },
    },
  }).evaluate({
    context: { cycleId: 'c-safety-bounds', ticker: 'BTC-USDT' },
    decisionContext: { metadata: {} },
    finalEntryDecisionOutput: { decisionMode: 'full_entry' },
    dynamicPositionSizingOutput: { sizeMultiplier: 0.5 },
    balanceState: { capitalRegime: 'NORMAL', unloadMode: false },
    capitalRegime: 'NORMAL',
    runtimeDataQualityState: 'ok',
    modelState: { available: true },
    metaSuggestions: { sizingAggressivenessModifier: 5 },
  });

  const output = runSizing({
    mlPhase1Decision: mlPhase1,
    mlMetaControllerOutput: metaOutput,
  }, {
    mlCompatibilityHooks: {
      phase1ConfidenceModifierHookEnabled: true,
      phase2BoundedAdjustmentHookEnabled: true,
      phase2BoundedAdjustmentLimits: {
        multiplierDeltaAbsMax: 0.1,
        leverageCapDeltaAbsMax: 1,
      },
    },
  });

  assert.ok(output.sizeMultiplier <= 1);
  assert.ok(output.sizeMultiplier >= 0);
  assert.ok(output.leverageCap >= 1);
  assert.ok(output.leverageCap <= 5);
  assert.ok(output.sizingReasonCodes.includes('ml_phase1_confidence_sizing_modifier'));
  assert.ok(output.sizingReasonCodes.includes('ml_phase2_sizing_aggressiveness_modifier'));

  const appliedMetaEvent = output.explanation.structured.metaRuntimeInfluence.events.find((event) => event.reasonCode === 'metaAdjustmentApplied');
  assert.ok(appliedMetaEvent);
  assert.equal(appliedMetaEvent.appliedValue <= 0.1, true);

  assert.equal(output.explanation.ownership.isFinalDecisionOwner, false);
  assert.equal(output.explanation.ownership.isExecutionOwner, false);
});
