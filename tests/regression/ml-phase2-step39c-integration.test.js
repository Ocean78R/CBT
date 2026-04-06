const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRuntimeConfig } = require('../../dist/runtime/config/runtimeConfigValidator');
const { createMlMetaController } = require('../../dist/runtime/ml/mlMetaController');
const { toFinalEntryDecisionEvent } = require('../../dist/runtime/engines/finalEntryDecisionEngine');
const { toDynamicPositionSizingEvent } = require('../../dist/runtime/sizing/dynamicPositionSizing');

function createUtilsConfig() {
  return {
    getCoreConfig: (globalConfig) => globalConfig || {},
    getExchangeConfig: (exchangeConfig) => exchangeConfig || {},
    merge: (base, extra) => ({ ...(base || {}), ...(extra || {}) }),
  };
}

function createMetaInput(overrides = {}) {
  return {
    context: { cycleId: 'c-39c-meta', ticker: 'ADA-USDT', exchange: 'binance' },
    decisionContext: { cycleId: 'c-39c-meta', ticker: 'ADA-USDT', mode: 'live', capitalRegime: 'NORMAL' },
    sharedRuntimeBlockOutputs: { finalEntry: { score: 0.62, confidence: 0.66 } },
    finalEntryDecisionOutput: { decisionMode: 'weak_entry', approved: true, vetoSummary: { blocked: false } },
    dynamicPositionSizingOutput: { sizeMultiplier: 0.4, mode: 'dynamic_base_formula' },
    mlPhase1Output: { mlConfidence: 0.58, mlScore: 0.6 },
    balanceState: { capitalRegime: 'NORMAL', unloadMode: false },
    forecastState: { restrictionHints: [] },
    runtimeDataQualityState: 'ok',
    modelState: { available: true },
    metaSuggestions: { entryThresholdModifier: 0.02 },
    ...overrides,
  };
}

test('step39C config: ветви mlMetaController нормализуются в runtime config', () => {
  const config = buildRuntimeConfig(createUtilsConfig(), {
    mlMetaController: {
      enableMlMetaController: true,
      metaControllerMode: 'manual_policy_fallback',
      allowedMetaAdjustments: ['entryThresholdModifier'],
      boundsByAdjustmentType: {
        entryThresholdModifier: { min: -0.02, max: 0.02 },
      },
      allowMetaFallbackWithoutModel: false,
      metaControllerBudget: 11,
      exchangeAgnosticMode: true,
      capabilityMatrixHandling: 'downstream_only',
    },
  }, {});

  assert.equal(config.mlMetaController.enableMlMetaController, true);
  assert.equal(config.mlMetaController.metaControllerMode, 'manual_policy_fallback');
  assert.deepEqual(config.mlMetaController.allowedMetaAdjustments, ['entryThresholdModifier']);
  assert.equal(config.mlMetaController.boundsByAdjustmentType.entryThresholdModifier.max, 0.02);
  assert.equal(config.mlMetaController.allowMetaFallbackWithoutModel, false);
  assert.equal(config.mlMetaController.metaControllerBudget, 11);
  assert.equal(config.mlMetaController.exchangeAgnosticMode, true);
  assert.equal(config.mlMetaController.capabilityMatrixHandling, 'downstream_only');
});

test('step39C contract: meta-controller не пересчитывает heavy/market data и остаётся bounded', () => {
  const controller = createMlMetaController({
    enableMlMetaController: true,
    allowedMetaAdjustments: ['entryThresholdModifier'],
    boundsByAdjustmentType: { entryThresholdModifier: { min: -0.01, max: 0.01 } },
  });
  const output = controller.evaluate(createMetaInput({
    metaSuggestions: { entryThresholdModifier: 0.4 },
  }));

  assert.equal(output.metaAdjustmentSet.entryThresholdModifier, 0.01);
  assert.equal(output.telemetry.featureComputation.recomputedMarketData, false);
  assert.equal(output.telemetry.featureComputation.recomputedHeavyFeatures, false);
  assert.equal(output.ownershipGuards.canBecomeDecisionOwner, false);
});

test('step39C audit trail: final/sizing events включают meta-runtime payload без отдельной schema', () => {
  const finalEvent = toFinalEntryDecisionEvent({
    context: { cycleId: 'c-39c-audit', ticker: 'BTC-USDT', exchange: 'okx', marketRegime: 'trend', capitalRegime: 'NORMAL' },
    decision: {
      decisionMode: 'weak_entry',
      entryScore: 0.66,
      explanation: {
        reasonCodes: ['metaAdjustmentApplied'],
        metaRuntimeInfluence: {
          metaFallbackState: 'none',
          reasonCodes: ['metaAdjustmentApplied'],
          events: [{ reasonCode: 'metaAdjustmentApplied', affectedLayer: 'finalEntryDecisionEngine.thresholds' }],
        },
      },
      capitalRegimeImpact: { capitalRegime: 'NORMAL' },
    },
  });

  const sizingEvent = toDynamicPositionSizingEvent({
    context: { cycleId: 'c-39c-audit', ticker: 'BTC-USDT', exchange: 'okx', mode: 'live' },
    decision: {
      sizeMultiplier: 0.42,
      leverageCap: 4,
      contractVersion: 'dynamic_position_sizing.v1',
      explanation: {
        runtimeMode: 'live',
        approvedEntryDecisionMode: 'weak_entry',
        structured: {
          baseSizingResult: { initial: 0.42 },
          metaRuntimeInfluence: {
            reasonCodes: ['metaAdjustmentApplied'],
            events: [{ reasonCode: 'metaAdjustmentApplied', affectedLayer: 'dynamicPositionSizing' }],
          },
        },
      },
    },
  });

  assert.ok(finalEvent.payload.telemetry.downstreamContext.finalEntryDecision.metaRuntimeInfluence);
  assert.ok(sizingEvent.metaRuntimeInfluence);
});
