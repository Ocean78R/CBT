'use strict';

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

const ALLOWED_ADJUSTMENT_BOUNDS = {
  entryThresholdModifier: { min: -0.05, max: 0.05 },
  weakEntryBoundaryModifier: { min: -0.05, max: 0.05 },
  fullEntryBoundaryModifier: { min: -0.05, max: 0.05 },
  shortlistRankingModifier: { min: -0.15, max: 0.15 },
  sizingAggressivenessModifier: { min: -0.15, max: 0.15 },
  regimePreferenceWeights: {
    trend: { min: -0.2, max: 0.2 },
    meanReversion: { min: -0.2, max: 0.2 },
    breakoutRejection: { min: -0.2, max: 0.2 },
    noTradeFlat: { min: -0.2, max: 0.2 },
  },
};

const ALLOWED_PARAMETERS = [
  'entryThresholdModifier',
  'weakEntryBoundaryModifier',
  'fullEntryBoundaryModifier',
  'shortlistRankingModifier',
  'sizingAggressivenessModifier',
  'regimePreferenceWeights',
];

const FORBIDDEN_PARAMETERS = [
  'directHardRiskOverride',
  'directCapitalRegimeOverride',
  'directForecastRestrictionOverride',
  'directExecutionOwnership',
  'directLifecycleOwnership',
  'directServerTpSlControl',
];

function normalizeConfig(raw = {}) {
  return {
    enabled: raw.enabled !== false,
    loggingEnabled: raw.loggingEnabled !== false,
    minInputQualityState: String(raw.minInputQualityState || 'cached'),
    strictOwnershipGuards: raw.strictOwnershipGuards !== false,
  };
}

function normalizeInput(input = {}) {
  return {
    context: input.context && typeof input.context === 'object' ? input.context : {},
    decisionContext: input.decisionContext && typeof input.decisionContext === 'object' ? input.decisionContext : null,
    sharedRuntimeBlockOutputs: input.sharedRuntimeBlockOutputs && typeof input.sharedRuntimeBlockOutputs === 'object'
      ? input.sharedRuntimeBlockOutputs
      : {},
    finalEntryDecisionOutput: input.finalEntryDecisionOutput && typeof input.finalEntryDecisionOutput === 'object'
      ? input.finalEntryDecisionOutput
      : null,
    dynamicPositionSizingOutput: input.dynamicPositionSizingOutput && typeof input.dynamicPositionSizingOutput === 'object'
      ? input.dynamicPositionSizingOutput
      : null,
    sizingBaselineMetadata: input.sizingBaselineMetadata && typeof input.sizingBaselineMetadata === 'object'
      ? input.sizingBaselineMetadata
      : null,
    mlPhase1Output: input.mlPhase1Output && typeof input.mlPhase1Output === 'object' ? input.mlPhase1Output : null,
    balanceState: input.balanceState && typeof input.balanceState === 'object' ? input.balanceState : null,
    capitalRegime: String(input.capitalRegime || ((input.balanceState || {}).capitalRegime) || 'NORMAL'),
    forecastState: input.forecastState && typeof input.forecastState === 'object' ? input.forecastState : null,
    runtimeDataQualityState: String(input.runtimeDataQualityState || input.dataQualityState || 'unknown'),
    modelState: input.modelState && typeof input.modelState === 'object' ? input.modelState : {},
    metaSuggestions: input.metaSuggestions && typeof input.metaSuggestions === 'object' ? input.metaSuggestions : {},
  };
}

function dataQualityRank(state) {
  const normalized = String(state || 'unknown');
  if (normalized === 'ok') return 3;
  if (normalized === 'cached') return 2;
  if (normalized === 'degraded') return 1;
  if (normalized === 'missing') return 0;
  return -1;
}

function resolveInputContractState(normalizedInput = {}, config = {}) {
  const contractIssues = [];

  if (!normalizedInput.decisionContext) contractIssues.push('missing_decision_context');
  if (!normalizedInput.finalEntryDecisionOutput) contractIssues.push('missing_final_entry_output');
  if (!normalizedInput.dynamicPositionSizingOutput && !normalizedInput.sizingBaselineMetadata) {
    contractIssues.push('missing_sizing_output_or_baseline');
  }
  if (!normalizedInput.balanceState && !normalizedInput.capitalRegime) {
    contractIssues.push('missing_balance_or_capital_regime');
  }

  const qualityState = normalizedInput.runtimeDataQualityState;
  const meetsQuality = dataQualityRank(qualityState) >= dataQualityRank(config.minInputQualityState);
  if (!meetsQuality) contractIssues.push(`insufficient_input_quality:${qualityState}`);

  return {
    contractIssues,
    valid: contractIssues.length === 0,
  };
}

function createNoopAdjustmentSet() {
  return {
    entryThresholdModifier: 0,
    weakEntryBoundaryModifier: 0,
    fullEntryBoundaryModifier: 0,
    shortlistRankingModifier: 0,
    sizingAggressivenessModifier: 0,
    regimePreferenceWeights: {
      trend: 0,
      meanReversion: 0,
      breakoutRejection: 0,
      noTradeFlat: 0,
    },
  };
}

function clampSuggestion(key, value, blockedReasons) {
  if (!ALLOWED_PARAMETERS.includes(key)) {
    blockedReasons.push(`unknown_or_forbidden_parameter:${key}`);
    return undefined;
  }

  if (key === 'regimePreferenceWeights') {
    const inputWeights = value && typeof value === 'object' ? value : {};
    return {
      trend: clamp(inputWeights.trend, ALLOWED_ADJUSTMENT_BOUNDS.regimePreferenceWeights.trend.min, ALLOWED_ADJUSTMENT_BOUNDS.regimePreferenceWeights.trend.max),
      meanReversion: clamp(inputWeights.meanReversion, ALLOWED_ADJUSTMENT_BOUNDS.regimePreferenceWeights.meanReversion.min, ALLOWED_ADJUSTMENT_BOUNDS.regimePreferenceWeights.meanReversion.max),
      breakoutRejection: clamp(inputWeights.breakoutRejection, ALLOWED_ADJUSTMENT_BOUNDS.regimePreferenceWeights.breakoutRejection.min, ALLOWED_ADJUSTMENT_BOUNDS.regimePreferenceWeights.breakoutRejection.max),
      noTradeFlat: clamp(inputWeights.noTradeFlat, ALLOWED_ADJUSTMENT_BOUNDS.regimePreferenceWeights.noTradeFlat.min, ALLOWED_ADJUSTMENT_BOUNDS.regimePreferenceWeights.noTradeFlat.max),
    };
  }

  const bound = ALLOWED_ADJUSTMENT_BOUNDS[key];
  const raw = Number(value);
  if (!Number.isFinite(raw)) return 0;
  return clamp(raw, bound.min, bound.max);
}

function createFallbackOutput({
  normalizedInput,
  fallbackState,
  contractIssues = [],
  blockedReasons = [],
}) {
  return {
    metaAdjustmentSet: createNoopAdjustmentSet(),
    allowedAdjustmentBounds: ALLOWED_ADJUSTMENT_BOUNDS,
    appliedAdjustmentReasons: ['ml_phase2_meta_controller_fallback_noop'],
    blockedAdjustmentReasons: Array.from(new Set(blockedReasons.concat(contractIssues))),
    metaControllerDataQualityState: normalizedInput.runtimeDataQualityState,
    metaControllerFallbackState: fallbackState,
    allowedParameters: ALLOWED_PARAMETERS,
    forbiddenParameters: FORBIDDEN_PARAMETERS,
    ownershipGuards: {
      ownershipPathChanged: false,
      canBecomeDecisionOwner: false,
      canBypassHardConstraints: false,
      isSizingOwner: false,
      isExecutionOwner: false,
      isLifecycleOwner: false,
      hardRiskAboveMetaController: true,
      capitalRegimeAboveMetaController: true,
      forecastRestrictionsAboveMetaController: true,
    },
    telemetry: {
      featureComputation: {
        recomputedMarketData: false,
        recomputedHeavyFeatures: false,
      },
      inputContractVersion: 'ml_phase2_meta_controller_input.v1',
      outputContractVersion: 'ml_phase2_meta_controller_output.v1',
    },
  };
}

function createMlMetaController(rawConfig = {}, dependencies = {}) {
  const config = normalizeConfig(rawConfig);

  function log(message) {
    if (!config.loggingEnabled) return;
    if (dependencies && typeof dependencies.log === 'function') dependencies.log(message);
  }

  function evaluate(input = {}) {
    const normalizedInput = normalizeInput(input);
    const cycleId = normalizedInput.context.cycleId || 'n/a';
    const ticker = normalizedInput.context.ticker || 'n/a';
    const modelAvailable = normalizedInput.modelState.available === true;
    const blockedReasons = [];

    FORBIDDEN_PARAMETERS.forEach((forbiddenKey) => {
      if (Object.prototype.hasOwnProperty.call(normalizedInput.metaSuggestions, forbiddenKey)) {
        blockedReasons.push(`forbidden_parameter_blocked:${forbiddenKey}`);
      }
    });

    const contractState = resolveInputContractState(normalizedInput, config);
    if (!config.enabled) {
      const output = createFallbackOutput({
        normalizedInput,
        fallbackState: 'disabled',
        contractIssues: contractState.contractIssues,
        blockedReasons,
      });
      log(`[mlMetaController] cycle=${cycleId} ticker=${ticker} fallback=disabled quality=${normalizedInput.runtimeDataQualityState} blocked=${output.blockedAdjustmentReasons.join('|') || 'none'}`);
      return output;
    }

    if (!modelAvailable) {
      const output = createFallbackOutput({
        normalizedInput,
        fallbackState: 'model_unavailable',
        contractIssues: contractState.contractIssues,
        blockedReasons,
      });
      log(`[mlMetaController] cycle=${cycleId} ticker=${ticker} fallback=model_unavailable quality=${normalizedInput.runtimeDataQualityState} blocked=${output.blockedAdjustmentReasons.join('|') || 'none'}`);
      return output;
    }

    if (!contractState.valid) {
      const output = createFallbackOutput({
        normalizedInput,
        fallbackState: 'input_quality_insufficient',
        contractIssues: contractState.contractIssues,
        blockedReasons,
      });
      log(`[mlMetaController] cycle=${cycleId} ticker=${ticker} fallback=input_quality_insufficient quality=${normalizedInput.runtimeDataQualityState} blocked=${output.blockedAdjustmentReasons.join('|') || 'none'}`);
      return output;
    }

    const metaAdjustmentSet = createNoopAdjustmentSet();
    const appliedReasons = ['ml_phase2_meta_controller_bounded_adjustments'];

    ALLOWED_PARAMETERS.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(normalizedInput.metaSuggestions, key)) return;
      const boundedValue = clampSuggestion(key, normalizedInput.metaSuggestions[key], blockedReasons);
      if (typeof boundedValue === 'undefined') return;
      metaAdjustmentSet[key] = boundedValue;
      appliedReasons.push(`applied:${key}`);
    });

    const output = {
      metaAdjustmentSet,
      allowedAdjustmentBounds: ALLOWED_ADJUSTMENT_BOUNDS,
      appliedAdjustmentReasons: Array.from(new Set(appliedReasons)),
      blockedAdjustmentReasons: Array.from(new Set(blockedReasons)),
      metaControllerDataQualityState: normalizedInput.runtimeDataQualityState,
      metaControllerFallbackState: 'none',
      allowedParameters: ALLOWED_PARAMETERS,
      forbiddenParameters: FORBIDDEN_PARAMETERS,
      ownershipGuards: {
        ownershipPathChanged: false,
        canBecomeDecisionOwner: false,
        canBypassHardConstraints: false,
        isSizingOwner: false,
        isExecutionOwner: false,
        isLifecycleOwner: false,
        hardRiskAboveMetaController: true,
        capitalRegimeAboveMetaController: true,
        forecastRestrictionsAboveMetaController: true,
      },
      telemetry: {
        featureComputation: {
          recomputedMarketData: false,
          recomputedHeavyFeatures: false,
        },
        inputContractVersion: 'ml_phase2_meta_controller_input.v1',
        outputContractVersion: 'ml_phase2_meta_controller_output.v1',
      },
    };

    log(`[mlMetaController] cycle=${cycleId} ticker=${ticker} fallback=none quality=${normalizedInput.runtimeDataQualityState} applied=${output.appliedAdjustmentReasons.join('|')} blocked=${output.blockedAdjustmentReasons.join('|') || 'none'}`);

    return output;
  }

  return {
    evaluate,
    normalizeConfig,
  };
}

module.exports = {
  createMlMetaController,
  normalizeMlMetaControllerConfig: normalizeConfig,
  ALLOWED_META_CONTROLLER_PARAMETERS: ALLOWED_PARAMETERS,
  FORBIDDEN_META_CONTROLLER_PARAMETERS: FORBIDDEN_PARAMETERS,
  ALLOWED_META_CONTROLLER_BOUNDS: ALLOWED_ADJUSTMENT_BOUNDS,
};
