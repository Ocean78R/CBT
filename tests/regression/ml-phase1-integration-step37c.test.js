const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const { createEngines } = require('../../dist/runtime/engines');
const { buildRuntimeConfig } = require('../../dist/runtime/config/runtimeConfigValidator');

function createStrategyStub() {
  const events = [];
  return {
    config: { paperTrading: { enabled: false } },
    runtimeEngines: {
      executionEngine: {
        isPaperMode: () => false,
      },
    },
    log: () => {},
    emitStructuredEvent: (event) => {
      events.push(event);
    },
    getStructuredEvents: () => events.slice(),
    predictPriceDirectionLegacy: async () => ['long', 'ok'],
    processExistingPositionLegacy: async () => null,
    getActiveTickersLegacy: () => [],
    averagePositionLegacy: async () => ({}),
    closePositionLegacy: async () => ({}),
    openNewPositionLegacy: async () => ({}),
  };
}

function createTempModelArtifact(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbt-ml-phase1-37c-'));
  const filePath = path.join(dir, 'model.json');
  fs.writeFileSync(filePath, JSON.stringify(payload), 'utf8');
  return { dir, filePath };
}

test('runtimeConfigValidator: нормализует новые mlPhase1Integration поля', () => {
  const runtimeConfig = buildRuntimeConfig({
    getCoreConfig: (cfg) => cfg,
    merge: (a, b) => ({ ...a, ...b }),
    getExchangeConfig: (cfg) => cfg,
  }, {
    enabled: true,
    loopsLength: 1,
    intervalSeconds: 1,
    mlPhase1Integration: {
      enableMlFilter: false,
      mlMode: 'confirm_only',
      minConfidenceForEntry: 0.62,
      minConfidenceForFullSize: 0.86,
      allowFallbackWithoutModel: false,
      mlInferenceBudget: 17,
    },
  }, {});

  assert.equal(runtimeConfig.mlPhase1Integration.enableMlFilter, false);
  assert.equal(runtimeConfig.mlPhase1Integration.mlMode, 'confirm_only');
  assert.equal(runtimeConfig.mlPhase1Integration.minConfidenceForEntry, 0.62);
  assert.equal(runtimeConfig.mlPhase1Integration.minConfidenceForFullSize, 0.86);
  assert.equal(runtimeConfig.mlPhase1Integration.allowFallbackWithoutModel, false);
  assert.equal(runtimeConfig.mlPhase1Integration.mlInferenceBudget, 17);
});

test('ML integration: disable branch безопасно выключает filter без падения', () => {
  const engines = createEngines(createStrategyStub());
  const runtimeConfig = {
    mlPhase1Integration: {
      enableMlFilter: false,
      mlMode: 'confirm_only',
    },
  };

  const output = engines.signalEngine.evaluateMlInferencePhase1({
    context: { cycleId: 'c-37c-disable', ticker: 'BTC-USDT', mode: 'live' },
    sharedRuntimeBlockOutputs: {
      entryPermission: { score: 0.8, confidence: 0.75, dataQualityState: 'ok' },
    },
  }, runtimeConfig, {});

  assert.equal(output.mlFallbackState, 'safe_disabled');
  assert.ok(output.mlReasonCodes.includes('ml_filter_disabled_by_config'));
});

test('ML integration: allowFallbackWithoutModel=false включает safe disable при недоступной модели', () => {
  const engines = createEngines(createStrategyStub());
  const runtimeConfig = {
    mlPhase1Integration: {
      enableMlFilter: true,
      allowFallbackWithoutModel: false,
      mlMode: 'veto_mode',
    },
    mlInferenceLayer: {
      enabled: true,
      modelArtifactPath: '/tmp/cbt-missing-model-37c.json',
      minFeatureCount: 2,
    },
  };

  const output = engines.signalEngine.evaluateMlInferencePhase1({
    context: { cycleId: 'c-37c-fallback', ticker: 'ETH-USDT', mode: 'live' },
    sharedRuntimeBlockOutputs: {
      entryPermission: { score: 0.8, confidence: 0.75, dataQualityState: 'ok' },
      primarySignal: { score: 0.7, confidence: 0.7, dataQualityState: 'ok' },
    },
  }, runtimeConfig, {});

  assert.equal(output.mlFallbackState, 'safe_disabled');
  assert.ok(output.mlReasonCodes.includes('ml_fallback_blocked_by_config'));
});

test('ML integration: paper/live дают эквивалентное decision semantics при одинаковом входе', () => {
  const model = createTempModelArtifact({
    version: '37c-paper-live',
    bias: 0,
    minFeatures: 3,
    weights: {
      block_entryPermission_score: 1.2,
      block_marketContext_score: 1.1,
      block_primarySignal_score: 1.3,
    },
  });

  const engines = createEngines(createStrategyStub());
  const runtimeConfig = {
    mlPhase1Integration: {
      enableMlFilter: true,
      allowFallbackWithoutModel: true,
      mlMode: 'confirm_only',
      minConfidenceForEntry: 0.4,
    },
    mlInferenceLayer: {
      enabled: true,
      modelArtifactPath: model.filePath,
      minFeatureCount: 3,
    },
    mlPhase1DecisionModifier: {
      enabled: true,
      mode: 'confirm_only',
      thresholds: {
        confirmMinScore: 0.5,
        confirmMinConfidence: 0.4,
      },
    },
  };

  const baseInput = {
    baseRuleDecision: {
      decisionMode: 'weak_entry',
      vetoSummary: { blocked: false, finalVeto: null },
    },
    capitalRegime: 'NORMAL',
    balanceState: { capitalRegime: 'NORMAL', unloadMode: false },
    runtimeGuards: { hardRiskBlocked: false },
    sharedRuntimeBlockOutputs: {
      entryPermission: { score: 0.7, confidence: 0.65, dataQualityState: 'ok' },
      marketContext: { score: 0.68, confidence: 0.64, dataQualityState: 'ok' },
      primarySignal: { score: 0.72, confidence: 0.67, dataQualityState: 'ok' },
    },
    approvedRuleDecisionContext: { score: 0.69, confidence: 0.64, dataQualityState: 'ok' },
    dataQualityState: 'ok',
  };

  const liveMlOutput = engines.signalEngine.evaluateMlInferencePhase1({
    ...baseInput,
    context: { cycleId: 'c-37c-live', ticker: 'SOL-USDT', mode: 'live' },
  }, runtimeConfig, {});
  const paperMlOutput = engines.signalEngine.evaluateMlInferencePhase1({
    ...baseInput,
    context: { cycleId: 'c-37c-paper', ticker: 'SOL-USDT', mode: 'paper' },
  }, runtimeConfig, {});

  const liveDecision = engines.signalEngine.evaluateMlPhase1DecisionModifier({
    ...baseInput,
    context: { cycleId: 'c-37c-live', ticker: 'SOL-USDT', mode: 'live' },
    mlInferenceOutput: liveMlOutput,
  }, runtimeConfig);
  const paperDecision = engines.signalEngine.evaluateMlPhase1DecisionModifier({
    ...baseInput,
    context: { cycleId: 'c-37c-paper', ticker: 'SOL-USDT', mode: 'paper' },
    mlInferenceOutput: paperMlOutput,
  }, runtimeConfig);

  assert.equal(liveDecision.effectiveDecisionMode, paperDecision.effectiveDecisionMode);
  assert.equal(liveDecision.effectiveApproved, paperDecision.effectiveApproved);
  assert.equal(liveDecision.mlDecisionEffect, paperDecision.mlDecisionEffect);
});

test('ML integration: emitStructuredEvent публикует совместимый decision event для analytics/audit trail', () => {
  const strategy = createStrategyStub();
  strategy.observabilityLayer = {
    events: [],
    ingestEvent(event) {
      this.events.push(event);
    },
  };
  const engines = createEngines(strategy);

  const decision = engines.signalEngine.evaluateMlPhase1DecisionModifier({
    context: { cycleId: 'c-37c-event', ticker: 'BNB-USDT', mode: 'live' },
    baseRuleDecision: {
      decisionMode: 'weak_entry',
      vetoSummary: { blocked: false, finalVeto: null },
    },
    capitalRegime: 'NORMAL',
    mlInferenceOutput: {
      mlScore: 0.73,
      mlConfidence: 0.76,
      mlFallbackState: 'none',
      mlReasonCodes: ['ml_phase1_inference_layer'],
      metadata: {
        ownership: {
          recalculatesHeavyFeatures: false,
        },
      },
    },
  }, {
    mlPhase1Integration: {
      enableMlFilter: true,
      allowFallbackWithoutModel: true,
      mlMode: 'confidence_sizing',
      minConfidenceForEntry: 0.4,
      minConfidenceForFullSize: 0.75,
    },
    mlPhase1DecisionModifier: {
      enabled: true,
      mode: 'confidence_sizing',
    },
  });

  assert.equal(decision.confidenceSizingHookApplied, true);
  const events = strategy.getStructuredEvents();
  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.eventType, 'ml_phase1_decision');
  assert.equal(event.payload.baseRuleDecision, 'weak_entry');
  assert.equal(event.payload.mlDecisionEffect, 'sizing_hint_only');
  assert.equal(event.payload.telemetry.downstreamContext.mlPhase1Decision.featureComputation.recomputedHeavyFeatures, false);
  assert.equal(strategy.observabilityLayer.events.length, 1);
});
