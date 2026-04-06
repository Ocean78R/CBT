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

function cloneBounds() {
  return JSON.parse(JSON.stringify(ALLOWED_ADJUSTMENT_BOUNDS));
}

function sanitizeAllowedAdjustments(rawAllowed) {
  if (!Array.isArray(rawAllowed) || rawAllowed.length === 0) return [...ALLOWED_PARAMETERS];
  return Array.from(new Set(rawAllowed.filter((key) => ALLOWED_PARAMETERS.includes(String(key)))));
}

function sanitizeBoundsByAdjustmentType(rawBounds) {
  const result = cloneBounds();
  const input = rawBounds && typeof rawBounds === 'object' ? rawBounds : {};
  Object.keys(input).forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(result, key)) return;
    if (key === 'regimePreferenceWeights') {
      const nestedInput = input.regimePreferenceWeights && typeof input.regimePreferenceWeights === 'object'
        ? input.regimePreferenceWeights
        : {};
      Object.keys(result.regimePreferenceWeights).forEach((nestedKey) => {
        const bound = nestedInput[nestedKey];
        if (!bound || typeof bound !== 'object') return;
        const min = Number(bound.min);
        const max = Number(bound.max);
        if (Number.isFinite(min)) result.regimePreferenceWeights[nestedKey].min = min;
        if (Number.isFinite(max)) result.regimePreferenceWeights[nestedKey].max = max;
      });
      return;
    }
    const bound = input[key];
    if (!bound || typeof bound !== 'object') return;
    const min = Number(bound.min);
    const max = Number(bound.max);
    if (Number.isFinite(min)) result[key].min = min;
    if (Number.isFinite(max)) result[key].max = max;
  });
  return result;
}

function normalizeConfig(raw = {}) {
  const enabled = raw.enableMlMetaController !== undefined
    ? raw.enableMlMetaController !== false
    : raw.enabled !== false;
  const rawMode = String(raw.metaControllerMode || raw.mode || 'bounded_modifier').toLowerCase();
  const metaControllerMode = ['bounded_modifier', 'manual_policy_fallback'].includes(rawMode)
    ? rawMode
    : 'bounded_modifier';
  return {
    enabled,
    enableMlMetaController: enabled,
    metaControllerMode,
    allowedMetaAdjustments: sanitizeAllowedAdjustments(raw.allowedMetaAdjustments),
    boundsByAdjustmentType: sanitizeBoundsByAdjustmentType(raw.boundsByAdjustmentType),
    allowMetaFallbackWithoutModel: raw.allowMetaFallbackWithoutModel !== false,
    metaControllerBudget: Number.isFinite(Number(raw.metaControllerBudget)) ? Number(raw.metaControllerBudget) : null,
    exchangeAgnosticMode: raw.exchangeAgnosticMode !== false,
    capabilityMatrixHandling: String(raw.capabilityMatrixHandling || 'downstream_only'),
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

function clampSuggestion(key, value, blockedReasons, allowedParameters, boundsByAdjustmentType) {
  if (!allowedParameters.includes(key)) {
    blockedReasons.push(`unknown_or_forbidden_parameter:${key}`);
    return undefined;
  }

  if (key === 'regimePreferenceWeights') {
    const inputWeights = value && typeof value === 'object' ? value : {};
    const bounds = boundsByAdjustmentType.regimePreferenceWeights || ALLOWED_ADJUSTMENT_BOUNDS.regimePreferenceWeights;
    return {
      trend: clamp(inputWeights.trend, bounds.trend.min, bounds.trend.max),
      meanReversion: clamp(inputWeights.meanReversion, bounds.meanReversion.min, bounds.meanReversion.max),
      breakoutRejection: clamp(inputWeights.breakoutRejection, bounds.breakoutRejection.min, bounds.breakoutRejection.max),
      noTradeFlat: clamp(inputWeights.noTradeFlat, bounds.noTradeFlat.min, bounds.noTradeFlat.max),
    };
  }

  const bound = boundsByAdjustmentType[key] || { min: 0, max: 0 };
  const raw = Number(value);
  if (!Number.isFinite(raw)) return 0;
  return clamp(raw, bound.min, bound.max);
}

function createFallbackOutput({
  normalizedInput,
  config,
  fallbackState,
  contractIssues = [],
  blockedReasons = [],
}) {
  return {
    metaAdjustmentSet: createNoopAdjustmentSet(),
    allowedAdjustmentBounds: config.boundsByAdjustmentType,
    appliedAdjustmentReasons: ['ml_phase2_meta_controller_fallback_noop'],
    blockedAdjustmentReasons: Array.from(new Set(blockedReasons.concat(contractIssues))),
    metaControllerDataQualityState: normalizedInput.runtimeDataQualityState,
    metaControllerFallbackState: fallbackState,
    allowedParameters: config.allowedMetaAdjustments,
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
      auditTrail: {
        sourceLayer: 'mlMetaController',
        integrationStage: 'step39c_production_like',
        mode: config.metaControllerMode,
        fallbackState,
        exchangeAgnosticMode: config.exchangeAgnosticMode,
        capabilityMatrixHandling: config.capabilityMatrixHandling,
        metaControllerBudget: config.metaControllerBudget,
      },
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
        config,
        fallbackState: 'disabled',
        contractIssues: contractState.contractIssues,
        blockedReasons,
      });
      log(`[mlMetaController] cycle=${cycleId} ticker=${ticker} fallback=disabled mode=${config.metaControllerMode} quality=${normalizedInput.runtimeDataQualityState} blocked=${output.blockedAdjustmentReasons.join('|') || 'none'}`);
      return output;
    }

    if (!modelAvailable) {
      const fallbackState = config.allowMetaFallbackWithoutModel ? 'model_unavailable' : 'model_unavailable_blocking';
      const output = createFallbackOutput({
        normalizedInput,
        config,
        fallbackState,
        contractIssues: contractState.contractIssues,
        blockedReasons,
      });
      log(`[mlMetaController] cycle=${cycleId} ticker=${ticker} fallback=${fallbackState} mode=${config.metaControllerMode} quality=${normalizedInput.runtimeDataQualityState} blocked=${output.blockedAdjustmentReasons.join('|') || 'none'}`);
      return output;
    }

    if (!contractState.valid) {
      const output = createFallbackOutput({
        normalizedInput,
        config,
        fallbackState: 'input_quality_insufficient',
        contractIssues: contractState.contractIssues,
        blockedReasons,
      });
      log(`[mlMetaController] cycle=${cycleId} ticker=${ticker} fallback=input_quality_insufficient mode=${config.metaControllerMode} quality=${normalizedInput.runtimeDataQualityState} blocked=${output.blockedAdjustmentReasons.join('|') || 'none'}`);
      return output;
    }

    const metaAdjustmentSet = createNoopAdjustmentSet();
    const appliedReasons = ['ml_phase2_meta_controller_bounded_adjustments'];

    config.allowedMetaAdjustments.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(normalizedInput.metaSuggestions, key)) return;
      log(`[mlMetaController:event] event=metaAdjustmentRequested cycle=${cycleId} ticker=${ticker} adjustment=${key} affectedLayer=bounded_modifier requested=${JSON.stringify(normalizedInput.metaSuggestions[key])}`);
      const boundedValue = clampSuggestion(
        key,
        normalizedInput.metaSuggestions[key],
        blockedReasons,
        config.allowedMetaAdjustments,
        config.boundsByAdjustmentType,
      );
      if (typeof boundedValue === 'undefined') return;
      metaAdjustmentSet[key] = boundedValue;
      appliedReasons.push(`applied:${key}`);
      log(`[mlMetaController:event] event=metaAdjustmentApplied cycle=${cycleId} ticker=${ticker} adjustment=${key} appliedBounds=${JSON.stringify(config.boundsByAdjustmentType[key] || null)} mode=${config.metaControllerMode}`);
    });

    const output = {
      metaAdjustmentSet,
      allowedAdjustmentBounds: config.boundsByAdjustmentType,
      appliedAdjustmentReasons: Array.from(new Set(appliedReasons)),
      blockedAdjustmentReasons: Array.from(new Set(blockedReasons)),
      metaControllerDataQualityState: normalizedInput.runtimeDataQualityState,
      metaControllerFallbackState: 'none',
      allowedParameters: config.allowedMetaAdjustments,
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
        auditTrail: {
          sourceLayer: 'mlMetaController',
          integrationStage: 'step39c_production_like',
          mode: config.metaControllerMode,
          fallbackState: 'none',
          exchangeAgnosticMode: config.exchangeAgnosticMode,
          capabilityMatrixHandling: config.capabilityMatrixHandling,
          metaControllerBudget: config.metaControllerBudget,
        },
      },
    };

    log(`[mlMetaController] cycle=${cycleId} ticker=${ticker} fallback=none mode=${config.metaControllerMode} quality=${normalizedInput.runtimeDataQualityState} applied=${output.appliedAdjustmentReasons.join('|')} blocked=${output.blockedAdjustmentReasons.join('|') || 'none'} exchangeAgnostic=${config.exchangeAgnosticMode ? 'yes' : 'no'} capabilityMatrix=${config.capabilityMatrixHandling}`);

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
