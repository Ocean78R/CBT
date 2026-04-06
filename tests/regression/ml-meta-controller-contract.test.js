const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMlMetaController,
  ALLOWED_META_CONTROLLER_PARAMETERS,
  FORBIDDEN_META_CONTROLLER_PARAMETERS,
  ALLOWED_META_CONTROLLER_BOUNDS,
} = require('../../dist/runtime/ml/mlMetaController');

function createValidInput(overrides = {}) {
  return {
    context: { cycleId: 'cycle-39-1', ticker: 'BTC-USDT' },
    decisionContext: {
      cycleId: 'cycle-39-1',
      ticker: 'BTC-USDT',
      mode: 'live',
      capitalRegime: 'NORMAL',
    },
    sharedRuntimeBlockOutputs: {
      confluence: { score: 0.71, confidence: 0.66, dataQualityState: 'ok' },
      eventRisk: { score: 0.12, confidence: 0.7, dataQualityState: 'ok' },
    },
    finalEntryDecisionOutput: {
      decisionMode: 'weak_entry',
      approved: true,
      vetoSummary: { blocked: false },
    },
    dynamicPositionSizingOutput: {
      mode: 'dynamic_base_formula',
      sizeMultiplier: 0.42,
    },
    mlPhase1Output: {
      mlScore: 0.63,
      mlConfidence: 0.59,
      mlDecisionEffect: 'logged_only',
    },
    balanceState: {
      capitalRegime: 'NORMAL',
      unloadMode: false,
    },
    capitalRegime: 'NORMAL',
    forecastState: {
      restrictionHints: [],
      confidence: 0.51,
    },
    runtimeDataQualityState: 'ok',
    modelState: {
      available: true,
      version: 'meta-0.1',
    },
    metaSuggestions: {
      entryThresholdModifier: 0.02,
      sizingAggressivenessModifier: -0.1,
    },
    ...overrides,
  };
}

test('mlMetaController: корректный входной контракт и выходной контракт', () => {
  const controller = createMlMetaController({
    enableMlMetaController: true,
    metaControllerMode: 'bounded_modifier',
    metaControllerBudget: 9,
  });
  const output = controller.evaluate(createValidInput());

  assert.equal(output.metaControllerFallbackState, 'none');
  assert.equal(typeof output.metaAdjustmentSet, 'object');
  assert.equal(typeof output.allowedAdjustmentBounds, 'object');
  assert.ok(Array.isArray(output.appliedAdjustmentReasons));
  assert.ok(Array.isArray(output.blockedAdjustmentReasons));
  assert.equal(output.metaControllerDataQualityState, 'ok');
  assert.equal(output.telemetry.auditTrail.mode, 'bounded_modifier');
  assert.equal(output.telemetry.auditTrail.metaControllerBudget, 9);
});

test('mlMetaController: allowed vs forbidden parameters фиксируются явно', () => {
  const controller = createMlMetaController({ enabled: true });
  const output = controller.evaluate(createValidInput({
    metaSuggestions: {
      entryThresholdModifier: 0.01,
      directHardRiskOverride: 1,
      directExecutionOwnership: true,
    },
  }));

  assert.equal(output.metaControllerFallbackState, 'none');
  assert.ok(ALLOWED_META_CONTROLLER_PARAMETERS.includes('entryThresholdModifier'));
  assert.ok(FORBIDDEN_META_CONTROLLER_PARAMETERS.includes('directHardRiskOverride'));
  assert.ok(output.blockedAdjustmentReasons.includes('forbidden_parameter_blocked:directHardRiskOverride'));
  assert.ok(output.blockedAdjustmentReasons.includes('forbidden_parameter_blocked:directExecutionOwnership'));
});

test('mlMetaController: bounds enforcement для allowed adjustments', () => {
  const controller = createMlMetaController({ enabled: true });
  const output = controller.evaluate(createValidInput({
    metaSuggestions: {
      entryThresholdModifier: 0.5,
      weakEntryBoundaryModifier: -0.8,
      shortlistRankingModifier: 1,
      sizingAggressivenessModifier: -1,
      regimePreferenceWeights: {
        trend: 1,
        meanReversion: -1,
        breakoutRejection: 0.15,
        noTradeFlat: -0.15,
      },
    },
  }));

  assert.equal(output.metaAdjustmentSet.entryThresholdModifier, ALLOWED_META_CONTROLLER_BOUNDS.entryThresholdModifier.max);
  assert.equal(output.metaAdjustmentSet.weakEntryBoundaryModifier, ALLOWED_META_CONTROLLER_BOUNDS.weakEntryBoundaryModifier.min);
  assert.equal(output.metaAdjustmentSet.shortlistRankingModifier, ALLOWED_META_CONTROLLER_BOUNDS.shortlistRankingModifier.max);
  assert.equal(output.metaAdjustmentSet.sizingAggressivenessModifier, ALLOWED_META_CONTROLLER_BOUNDS.sizingAggressivenessModifier.min);
  assert.equal(output.metaAdjustmentSet.regimePreferenceWeights.trend, ALLOWED_META_CONTROLLER_BOUNDS.regimePreferenceWeights.trend.max);
  assert.equal(output.metaAdjustmentSet.regimePreferenceWeights.meanReversion, ALLOWED_META_CONTROLLER_BOUNDS.regimePreferenceWeights.meanReversion.min);
});

test('mlMetaController: safe fallback срабатывает при disabled', () => {
  const controller = createMlMetaController({ enabled: false });
  const output = controller.evaluate(createValidInput());

  assert.equal(output.metaControllerFallbackState, 'disabled');
  assert.equal(output.metaAdjustmentSet.entryThresholdModifier, 0);
});

test('mlMetaController: safe fallback срабатывает при недоступной модели', () => {
  const controller = createMlMetaController({ enableMlMetaController: true, allowMetaFallbackWithoutModel: false });
  const output = controller.evaluate(createValidInput({ modelState: { available: false } }));

  assert.equal(output.metaControllerFallbackState, 'model_unavailable_blocking');
  assert.equal(output.metaAdjustmentSet.sizingAggressivenessModifier, 0);
});

test('mlMetaController: safe fallback срабатывает при недостаточном качестве входа/контракта', () => {
  const controller = createMlMetaController({ enabled: true, minInputQualityState: 'cached' });
  const output = controller.evaluate(createValidInput({
    runtimeDataQualityState: 'missing',
    finalEntryDecisionOutput: null,
  }));

  assert.equal(output.metaControllerFallbackState, 'input_quality_insufficient');
  assert.ok(output.blockedAdjustmentReasons.includes('missing_final_entry_output'));
  assert.ok(output.blockedAdjustmentReasons.includes('insufficient_input_quality:missing'));
});

test('mlMetaController: отсутствие ownership takeover закреплено в контракте', () => {
  const controller = createMlMetaController({ enabled: true });
  const output = controller.evaluate(createValidInput({
    metaSuggestions: {
      entryThresholdModifier: 0.02,
      directExecutionOwnership: true,
      directLifecycleOwnership: true,
    },
  }));

  assert.equal(output.ownershipGuards.ownershipPathChanged, false);
  assert.equal(output.ownershipGuards.canBecomeDecisionOwner, false);
  assert.equal(output.ownershipGuards.isExecutionOwner, false);
  assert.equal(output.ownershipGuards.isLifecycleOwner, false);
  assert.equal(output.telemetry.featureComputation.recomputedHeavyFeatures, false);
  assert.equal(output.telemetry.featureComputation.recomputedMarketData, false);
});

test('mlMetaController: config branch allowedMetaAdjustments и boundsByAdjustmentType применяются', () => {
  const controller = createMlMetaController({
    enableMlMetaController: true,
    allowedMetaAdjustments: ['entryThresholdModifier'],
    boundsByAdjustmentType: {
      entryThresholdModifier: { min: -0.01, max: 0.01 },
    },
  });

  const output = controller.evaluate(createValidInput({
    metaSuggestions: {
      entryThresholdModifier: 0.08,
      sizingAggressivenessModifier: 0.1,
    },
  }));

  assert.equal(output.allowedParameters.length, 1);
  assert.equal(output.allowedParameters[0], 'entryThresholdModifier');
  assert.equal(output.metaAdjustmentSet.entryThresholdModifier, 0.01);
  assert.equal(output.metaAdjustmentSet.sizingAggressivenessModifier, 0);
});
