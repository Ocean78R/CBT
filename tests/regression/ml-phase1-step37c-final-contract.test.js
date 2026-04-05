const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createMlInferenceLayer } = require('../../dist/runtime/ml/mlInferenceLayer');
const { createMlPhase1DecisionModifier, toMlPhase1DecisionEvent } = require('../../dist/runtime/ml/mlPhase1DecisionModifier');
const { buildRuntimeConfig } = require('../../dist/runtime/config/runtimeConfigValidator');

function createBaseRuleDecision(overrides = {}) {
  return {
    decisionMode: 'weak_entry',
    vetoSummary: { blocked: false, finalVeto: null },
    ...overrides,
  };
}

test('step37C final: no ownership takeover by ML layer/modifier', () => {
  const inference = createMlInferenceLayer({ enabled: false });
  const inferenceOutput = inference.evaluate({
    context: { cycleId: 'c-37c-own-1', ticker: 'BTC-USDT' },
    sharedRuntimeBlockOutputs: {},
  });

  assert.equal(inferenceOutput.metadata.ownership.isFinalDecisionOwner, false);
  assert.equal(inferenceOutput.metadata.ownership.isSizingOwner, false);
  assert.equal(inferenceOutput.metadata.ownership.isExecutionOwner, false);

  const modifier = createMlPhase1DecisionModifier({ mode: 'veto_mode' });
  const output = modifier.evaluate({
    context: { cycleId: 'c-37c-own-2', ticker: 'BTC-USDT' },
    baseRuleDecision: createBaseRuleDecision(),
    mlInferenceOutput: { mlScore: 0.8, mlConfidence: 0.8 },
    capitalRegime: 'NORMAL',
    balanceState: { capitalRegime: 'NORMAL', unloadMode: false },
    runtimeGuards: { hardRiskBlocked: false },
  });

  assert.equal(output.ownership.isFinalVetoOwnerForNewEntries, false);
  assert.equal(output.ownership.baselineDecisionOwner, 'finalEntryDecisionEngine');
  assert.equal(output.ownership.isSizingOwner, false);
  assert.equal(output.ownership.isExecutionOwner, false);
});

test('step37C final: future compatibility contract для шага 39 остаётся bounded/read-only', () => {
  const modifier = createMlPhase1DecisionModifier({ mode: 'confidence_sizing' });
  const decision = modifier.evaluate({
    context: { cycleId: 'c-37c-step39', ticker: 'ETH-USDT', exchange: 'bingx', mode: 'live' },
    baseRuleDecision: createBaseRuleDecision({ decisionMode: 'full_entry' }),
    mlInferenceOutput: {
      mlScore: 0.74,
      mlConfidence: 0.79,
      mlFallbackState: 'none',
      mlDataQualityState: 'ok',
      mlReasonCodes: ['ml_phase1_inference_layer'],
      metadata: {
        modelVersion: '37c-final',
        ownership: {
          isFinalDecisionOwner: false,
          isSizingOwner: false,
          isExecutionOwner: false,
        },
      },
    },
    capitalRegime: 'NORMAL',
    balanceState: { capitalRegime: 'NORMAL', unloadMode: false },
    runtimeGuards: { hardRiskBlocked: false },
  });

  const event = toMlPhase1DecisionEvent({
    context: { cycleId: 'c-37c-step39', ticker: 'ETH-USDT', exchange: 'bingx', mode: 'live' },
    decision,
    mlInferenceOutput: {
      mlScore: 0.74,
      mlConfidence: 0.79,
      mlFallbackState: 'none',
      mlDataQualityState: 'ok',
      mlReasonCodes: ['ml_phase1_inference_layer'],
      metadata: {
        modelVersion: '37c-final',
        ownership: {
          isFinalDecisionOwner: false,
          isSizingOwner: false,
          isExecutionOwner: false,
        },
      },
    },
  });

  const downstream = event.payload.telemetry.downstreamContext.mlPhase1Decision;
  assert.equal(typeof downstream.mlScore, 'number');
  assert.equal(typeof downstream.mlConfidence, 'number');
  assert.equal(typeof downstream.mlDecisionEffect, 'string');
  assert.equal(downstream.confidenceSizingHookApplied, true);
  assert.equal(downstream.sizingHook.owner, 'ml_phase1_hint_only');
  assert.equal(downstream.ownership.baselineDecisionOwner, 'finalEntryDecisionEngine');
  assert.equal(downstream.ownership.isFinalVetoOwnerForNewEntries, false);
  assert.equal(downstream.ownership.isSizingOwner, false);
  assert.equal(downstream.ownership.isExecutionOwner, false);
});

test('step37C final: rule-based decision остаётся primary (ML не поднимает no_entry)', () => {
  const modifier = createMlPhase1DecisionModifier({ mode: 'confirm_only' });
  const output = modifier.evaluate({
    context: { cycleId: 'c-37c-primary', ticker: 'SOL-USDT' },
    baseRuleDecision: createBaseRuleDecision({ decisionMode: 'no_entry' }),
    mlInferenceOutput: { mlScore: 0.99, mlConfidence: 0.99 },
    capitalRegime: 'NORMAL',
    balanceState: { capitalRegime: 'NORMAL', unloadMode: false },
    runtimeGuards: { hardRiskBlocked: false },
  });

  assert.equal(output.baseRuleDecision, 'no_entry');
  assert.equal(output.effectiveDecisionMode, 'no_entry');
  assert.equal(output.effectiveApproved, false);
  assert.equal(output.mlDecisionEffect, 'cannot_promote_rule_rejected_entry');
});

test('step37C final: ML не может override capital prohibition', () => {
  const modifier = createMlPhase1DecisionModifier({ mode: 'veto_mode' });
  const output = modifier.evaluate({
    context: { cycleId: 'c-37c-capital', ticker: 'BNB-USDT' },
    baseRuleDecision: createBaseRuleDecision({ decisionMode: 'full_entry' }),
    mlInferenceOutput: { mlScore: 0.95, mlConfidence: 0.96 },
    capitalRegime: 'HALT_NEW_ENTRIES',
    balanceState: { capitalRegime: 'HALT_NEW_ENTRIES', unloadMode: false },
    runtimeGuards: { hardRiskBlocked: false },
  });

  assert.equal(output.effectiveDecisionMode, 'no_entry');
  assert.equal(output.mlBlockedByCapitalRegime, true);
  assert.ok(output.reasonCodes.includes('ml_blocked_by_capital_regime'));
});

test('step37C final: ML не может override forecast prohibition', () => {
  const modifier = createMlPhase1DecisionModifier({ mode: 'confirm_only' });
  const output = modifier.evaluate({
    context: { cycleId: 'c-37c-forecast', ticker: 'XRP-USDT' },
    baseRuleDecision: createBaseRuleDecision({
      decisionMode: 'full_entry',
      vetoSummary: {
        blocked: true,
        finalVeto: { type: 'forecast_restriction_veto' },
      },
    }),
    portfolioForecast: {
      restrictionHints: ['restrict_new_entries_hard_candidate'],
    },
    mlInferenceOutput: { mlScore: 0.97, mlConfidence: 0.98 },
    capitalRegime: 'NORMAL',
    balanceState: { capitalRegime: 'NORMAL', unloadMode: false },
    runtimeGuards: { hardRiskBlocked: false },
  });

  assert.equal(output.effectiveDecisionMode, 'no_entry');
  assert.equal(output.mlBlockedByForecastRestriction, true);
  assert.equal(output.forecastImpact, 'blocked');
  assert.ok(output.reasonCodes.includes('ml_blocked_by_forecast_restriction'));
});

test('step37C final: docs/config/runtime согласованы по режимам и ownership-ограничениям', () => {
  const docPath = path.join(__dirname, '../../docs/user/ML_PHASE1_INTEGRATION_CONTRACT_RU.md');
  const docText = fs.readFileSync(docPath, 'utf8');

  ['advisory_only', 'confirm_only', 'veto_mode', 'confidence_sizing'].forEach((mode) => {
    assert.match(docText, new RegExp(mode));
  });
  assert.match(docText, /finalEntryDecisionEngine[\s\S]*final interpreter veto/);
  assert.match(docText, /ownership не допускается|ownership не передаётся|без передачи ownership/i);

  const runtimeConfig = buildRuntimeConfig({
    getCoreConfig: (cfg) => cfg,
    merge: (a, b) => ({ ...a, ...b }),
    getExchangeConfig: (cfg) => cfg,
  }, {
    enabled: true,
    loopsLength: 1,
    intervalSeconds: 1,
    mlPhase1Integration: {
      mlMode: 'veto_mode',
    },
  }, {});

  assert.equal(runtimeConfig.mlPhase1Integration.mlMode, 'veto_mode');

  const shippedConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../../dist/_config/config.json'), 'utf8'));
  assert.equal(typeof shippedConfig.mlPhase1Integration.mlMode, 'string');
  assert.equal(shippedConfig.mlPhase1Integration.mlMode, 'advisory_only');
});
