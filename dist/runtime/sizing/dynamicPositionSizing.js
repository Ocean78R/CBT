'use strict';

// Русский комментарий: dynamicPositionSizing работает только после finalEntryDecisionEngine и использует готовый upstream context.
// Модуль не пересчитывает сигналы, не владеет final decision и не инициирует execution/lifecycle side-effects.

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function normalizeConfig(raw = {}) {
  const fallback = raw.fallbackFixedSizingConfig || raw.fallback || {};
  const baseSizingRules = raw.baseSizingRules || {};
  const capitalRegimeSizingRules = raw.capitalRegimeSizingRules || {};
  const leverageCapsByRegime = raw.leverageCapsByRegime || {};
  const forecastSizingHooks = raw.forecastSizingHooks || {};
  const mlCompatibilityHooks = raw.mlCompatibilityHooks || {};
  return {
    enabled: raw.enableDynamicPositionSizing !== false && raw.enabled !== false,
    baseTargetMarginSize: Math.max(0, Number(baseSizingRules.baseTargetMarginSize ?? raw.baseTargetMarginSize ?? 100)),
    baseLeverageCap: Math.max(1, Number(baseSizingRules.baseLeverageCap ?? raw.baseLeverageCap ?? 5)),
    weakEntryBaseMultiplier: clamp(raw.weakEntrySizeMultiplier ?? raw.weakEntryBaseMultiplier ?? 0.5, 0, 1),
    riskPenaltyWeight: clamp(baseSizingRules.riskPenaltyWeight ?? raw.riskPenaltyWeight ?? 0.6, 0, 1),
    disallowFullSizeByRegime: {
      NORMAL: !!(((capitalRegimeSizingRules.NORMAL || {}).disallowFullSizeProfile)),
      CAUTION: !!(((capitalRegimeSizingRules.CAUTION || {}).disallowFullSizeProfile)),
      DEFENSIVE: ((capitalRegimeSizingRules.DEFENSIVE || {}).disallowFullSizeProfile) !== false,
      CAPITAL_PRESERVATION: ((capitalRegimeSizingRules.CAPITAL_PRESERVATION || {}).disallowFullSizeProfile) !== false,
      HALT_NEW_ENTRIES: true,
      PROHIBIT_NEW_ENTRIES: true,
    },
    capitalRegimeMultipliers: {
      NORMAL: clamp(((capitalRegimeSizingRules.NORMAL || {}).sizeMultiplier) ?? ((raw.capitalRegimeMultipliers || {}).NORMAL ?? 1), 0, 1),
      CAUTION: clamp(((capitalRegimeSizingRules.CAUTION || {}).sizeMultiplier) ?? ((raw.capitalRegimeMultipliers || {}).CAUTION ?? 0.85), 0, 1),
      DEFENSIVE: clamp(((capitalRegimeSizingRules.DEFENSIVE || {}).sizeMultiplier) ?? ((raw.capitalRegimeMultipliers || {}).DEFENSIVE ?? 0.65), 0, 1),
      CAPITAL_PRESERVATION: clamp(((capitalRegimeSizingRules.CAPITAL_PRESERVATION || {}).sizeMultiplier) ?? ((raw.capitalRegimeMultipliers || {}).CAPITAL_PRESERVATION ?? 0.45), 0, 1),
      REDUCE_RISK: clamp(((capitalRegimeSizingRules.REDUCE_RISK || {}).sizeMultiplier) ?? ((raw.capitalRegimeMultipliers || {}).REDUCE_RISK ?? 0.7), 0, 1),
      CONSERVE_CAPITAL: clamp(((capitalRegimeSizingRules.CONSERVE_CAPITAL || {}).sizeMultiplier) ?? ((raw.capitalRegimeMultipliers || {}).CONSERVE_CAPITAL ?? 0.5), 0, 1),
      HALT_NEW_ENTRIES: 0,
      PROHIBIT_NEW_ENTRIES: 0,
    },
    leverageCapsByRegime: {
      NORMAL: Math.max(1, Number((leverageCapsByRegime.NORMAL ?? (capitalRegimeSizingRules.NORMAL || {}).leverageCap ?? 5))),
      CAUTION: Math.max(1, Number((leverageCapsByRegime.CAUTION ?? (capitalRegimeSizingRules.CAUTION || {}).leverageCap ?? 4))),
      DEFENSIVE: Math.max(1, Number((leverageCapsByRegime.DEFENSIVE ?? (capitalRegimeSizingRules.DEFENSIVE || {}).leverageCap ?? 3))),
      CAPITAL_PRESERVATION: Math.max(1, Number((leverageCapsByRegime.CAPITAL_PRESERVATION ?? (capitalRegimeSizingRules.CAPITAL_PRESERVATION || {}).leverageCap ?? 2))),
      HALT_NEW_ENTRIES: 0,
      PROHIBIT_NEW_ENTRIES: 0,
    },
    dataQualityMultipliers: {
      ok: clamp((((raw.dataQualityMultipliers || {}).ok) ?? 1), 0, 1),
      cached: clamp((((raw.dataQualityMultipliers || {}).cached) ?? 0.9), 0, 1),
      degraded: clamp((((raw.dataQualityMultipliers || {}).degraded) ?? 0.75), 0, 1),
      missing: clamp((((raw.dataQualityMultipliers || {}).missing) ?? 0.6), 0, 1),
    },
    fallback: {
      baseMultiplier: clamp(fallback.baseMultiplier ?? 0.35, 0, 1),
      weakEntryMultiplier: clamp(fallback.weakEntryMultiplier ?? 0.2, 0, 1),
      leverageCap: Math.max(1, Number(fallback.leverageCap ?? 2)),
    },
    forecastSizingHooks: {
      enabled: forecastSizingHooks.enabled !== false,
      aggressionCaps: {
        standard: clamp(((forecastSizingHooks.aggressionCaps || {}).standard) ?? 1, 0, 1),
        conservative: clamp(((forecastSizingHooks.aggressionCaps || {}).conservative) ?? 0.85, 0, 1),
        defensive: clamp(((forecastSizingHooks.aggressionCaps || {}).defensive) ?? 0.7, 0, 1),
      },
      exposureReductionHints: {
        enabled: ((forecastSizingHooks.exposureReductionHints || {}).enabled) !== false,
        mildMultiplier: clamp(((forecastSizingHooks.exposureReductionHints || {}).mildMultiplier) ?? 0.9, 0, 1),
        strongMultiplier: clamp(((forecastSizingHooks.exposureReductionHints || {}).strongMultiplier) ?? 0.75, 0, 1),
      },
      conservativeMultiplierCap: clamp(forecastSizingHooks.conservativeMultiplierCap ?? 0.85, 0, 1),
    },
    mlCompatibilityHooks: {
      phase1ConfidenceModifierHookEnabled: mlCompatibilityHooks.phase1ConfidenceModifierHookEnabled !== false,
      phase2BoundedAdjustmentHookEnabled: mlCompatibilityHooks.phase2BoundedAdjustmentHookEnabled !== false,
      phase2BoundedAdjustmentLimits: {
        multiplierDeltaAbsMax: clamp(((mlCompatibilityHooks.phase2BoundedAdjustmentLimits || {}).multiplierDeltaAbsMax) ?? 0.15, 0, 1),
        leverageCapDeltaAbsMax: Math.max(0, Number(((mlCompatibilityHooks.phase2BoundedAdjustmentLimits || {}).leverageCapDeltaAbsMax) ?? 1)),
      },
    },
  };
}

function resolveSizingDataQualityState(input = {}) {
  const explicit = input.sizingDataQualityState || (input.metadata || {}).sizingDataQualityState;
  if (explicit) return String(explicit);

  const states = [
    (input.approvedEntryResult || {}).dataQualityState,
    input.dataQualityState,
    ((input.metadata || {}).quality || {}).dataState,
  ].filter(Boolean).map((item) => String(item));

  if (states.includes('missing')) return 'missing';
  if (states.includes('degraded')) return 'degraded';
  if (states.includes('cached')) return 'cached';
  return states.length ? 'ok' : 'missing';
}

function isHardRiskBlocked(input = {}) {
  const guards = input.runtimeGuards || {};
  if (guards.hardRiskBlocked === true) return true;
  if (guards.capitalProhibition === true) return true;
  if (guards.allowNewEntries === false) return true;
  if (guards.unloadMode === true) return true;

  const balanceState = input.balanceState || {};
  const capitalRegime = input.capitalRegime || balanceState.capitalRegime || 'NORMAL';
  if (balanceState.unloadMode === true) return true;
  if (capitalRegime === 'HALT_NEW_ENTRIES' || capitalRegime === 'PROHIBIT_NEW_ENTRIES') return true;

  return false;
}

function extractApprovedEntry(input = {}) {
  const approvedEntryResult = input.approvedEntryResult || {};
  const decisionMode = input.decisionMode || approvedEntryResult.decisionMode || 'no_entry';
  const entryScore = clamp(input.entryScore ?? approvedEntryResult.entryScore, 0, 1);
  const confidence = clamp(input.confidence ?? approvedEntryResult.confidence, 0, 1);

  const approved = approvedEntryResult && approvedEntryResult.vetoSummary
    ? approvedEntryResult.vetoSummary.blocked !== true && decisionMode !== 'no_entry'
    : decisionMode !== 'no_entry';

  return {
    approved,
    decisionMode,
    entryScore,
    confidence,
  };
}

function computeAggressivenessMode(multiplier, decisionMode, hardBlocked) {
  if (hardBlocked || decisionMode === 'no_entry' || multiplier <= 0) return 'disabled';
  if (decisionMode === 'weak_entry' || multiplier < 0.6) return 'conservative';
  return 'standard';
}

function resolveForecastSizingPayload(input = {}) {
  const direct = input.forecastSizing || {};
  const fromContext = (((input.decisionContext || {}).metadata || {}).portfolioForecastSizing) || {};
  const fromRuntime = (((input.balanceState || {}).forecastSizingHints) || {});
  const fromRisk = (((input.portfolioRisk || {}).outputHints || {}).sizingHints) || {};
  const fromTelemetry = (((input.forecast || {}).outputHints || {}).sizingHints) || {};
  return {
    multiplier: Number(direct.multiplier ?? fromContext.multiplier ?? fromRuntime.multiplier ?? fromRisk.multiplier ?? fromTelemetry.multiplier ?? 1),
    aggressionCap: direct.aggressionCap ?? fromContext.aggressionCap ?? fromRuntime.aggressionCap ?? null,
    reductionHint: direct.reductionHint ?? fromContext.reductionHint ?? fromRuntime.reductionHint ?? null,
    conservativeMultiplier: Number(direct.conservativeMultiplier ?? fromContext.conservativeMultiplier ?? fromRuntime.conservativeMultiplier ?? 1),
    reason: direct.reason || fromContext.reason || fromRuntime.reason || fromRisk.reason || fromTelemetry.reason || 'none',
  };
}

function evaluateDynamicPositionSizing(input = {}, rawConfig = {}, runtime = {}) {
  const config = normalizeConfig(rawConfig);
  const reasonCodes = [];
  const approvedEntry = extractApprovedEntry(input);
  const sizingDataQualityState = resolveSizingDataQualityState(input);
  const hardBlocked = isHardRiskBlocked(input);
  const capitalRegime = input.capitalRegime || ((input.balanceState || {}).capitalRegime) || 'NORMAL';
  const runtimeMode = ((input.context || {}).mode) || ((input.metadata || {}).runtimeMode) || 'unknown';
  const forecastPayload = resolveForecastSizingPayload(input);
  const structuredDetails = {
    approvedEntryDecisionMode: approvedEntry.decisionMode,
    baseSizingResult: null,
    capitalRegimeAdjustment: null,
    forecastSizingAdjustment: null,
    mlPhase1SizingAdjustment: null,
    finalSizeMultiplier: 0,
    finalLeverageCap: 0,
    sizingReasonCodes: reasonCodes,
    runtimeMode,
  };

  if (hardBlocked) {
    reasonCodes.push('hard_risk_or_capital_guard_active');
  }

  if (!approvedEntry.approved || approvedEntry.decisionMode === 'no_entry') {
    reasonCodes.push('approved_entry_required');
    return {
      enabled: config.enabled,
      mode: 'no_entry',
      sizeMultiplier: 0,
      targetMarginSize: 0,
      leverageCap: 0,
      aggressivenessMode: 'disabled',
      sizingReasonCodes: reasonCodes,
      sizingDataQualityState,
      contractVersion: 'dynamic_position_sizing.v1',
      explanation: {
        runtimeMode,
        structured: structuredDetails,
        ownership: {
          isSignalRecalculationOwner: false,
          isFinalDecisionOwner: false,
          isExecutionOwner: false,
          requiresApprovedEntry: true,
        },
      },
    };
  }

  const hasRuntimeContext = !!(input.balanceState || input.capitalRegime || input.tickerRisk);
  const fallbackMode = !config.enabled || !hasRuntimeContext;

  const baseMultiplier = approvedEntry.decisionMode === 'weak_entry'
    ? config.weakEntryBaseMultiplier
    : 1;

  if (approvedEntry.decisionMode === 'weak_entry') {
    reasonCodes.push('weak_entry_reduced_profile');
  }

  let sizeMultiplier = baseMultiplier;
  let leverageCap = config.baseLeverageCap;

  if (fallbackMode) {
    sizeMultiplier = approvedEntry.decisionMode === 'weak_entry'
      ? config.fallback.weakEntryMultiplier
      : config.fallback.baseMultiplier;
    leverageCap = config.fallback.leverageCap;
    reasonCodes.push(config.enabled ? 'runtime_context_insufficient_fixed_fallback' : 'dynamic_sizing_disabled_fixed_fallback');
  } else {
    const tickerRisk = input.tickerRisk || {};
    const riskScore = clamp(tickerRisk.riskScore ?? tickerRisk.coinRiskScore ?? 0.5, 0, 1);
    const riskMultiplier = clamp(1 - (riskScore * config.riskPenaltyWeight), 0.1, 1);
    sizeMultiplier *= riskMultiplier;
    if (riskScore >= 0.7) {
      leverageCap = Math.max(1, Math.min(leverageCap, 3));
      reasonCodes.push('high_coin_risk_reduces_size');
    }

    structuredDetails.baseSizingResult = {
      beforeCapitalRegimeMultiplier: Number(sizeMultiplier.toFixed(8)),
      leverageCap,
    };

    const capitalMultiplier = config.capitalRegimeMultipliers[capitalRegime] ?? 1;
    sizeMultiplier *= capitalMultiplier;
    if (capitalMultiplier < 1) reasonCodes.push(`capital_regime_tightening:${capitalRegime}`);
    leverageCap = Math.min(leverageCap, config.leverageCapsByRegime[capitalRegime] ?? leverageCap);
    if ((config.leverageCapsByRegime[capitalRegime] ?? leverageCap) < config.baseLeverageCap) {
      reasonCodes.push(`capital_regime_leverage_cap:${capitalRegime}`);
    }

    if (config.disallowFullSizeByRegime[capitalRegime] && approvedEntry.decisionMode === 'full_entry') {
      sizeMultiplier = Math.min(sizeMultiplier, 0.95);
      reasonCodes.push(`capital_regime_full_size_blocked:${capitalRegime}`);
    }

    structuredDetails.capitalRegimeAdjustment = {
      regime: capitalRegime,
      sizeMultiplierApplied: capitalMultiplier,
      leverageCapApplied: config.leverageCapsByRegime[capitalRegime] ?? config.baseLeverageCap,
      fullSizeProfileAllowed: !config.disallowFullSizeByRegime[capitalRegime],
    };

    const qualityMultiplier = config.dataQualityMultipliers[sizingDataQualityState] ?? config.dataQualityMultipliers.missing;
    sizeMultiplier *= qualityMultiplier;
    if (qualityMultiplier < 1) reasonCodes.push(`data_quality_penalty:${sizingDataQualityState}`);

    const scorePenalty = clamp(1 - ((1 - approvedEntry.entryScore) * 0.4), 0.6, 1);
    sizeMultiplier *= scorePenalty;

    const confidencePenalty = clamp(0.8 + (approvedEntry.confidence * 0.2), 0.8, 1);
    sizeMultiplier *= confidencePenalty;

    const forecastAggressionCap = config.forecastSizingHooks.aggressionCaps[String(forecastPayload.aggressionCap || '').toLowerCase()] ?? 1;
    const forecastConservativeCap = Math.min(config.forecastSizingHooks.conservativeMultiplierCap, clamp(forecastPayload.conservativeMultiplier, 0, 1));
    const forecastReduction = String(forecastPayload.reductionHint || '').toLowerCase() === 'strong'
      ? config.forecastSizingHooks.exposureReductionHints.strongMultiplier
      : String(forecastPayload.reductionHint || '').toLowerCase() === 'mild'
        ? config.forecastSizingHooks.exposureReductionHints.mildMultiplier
        : 1;
    const forecastMultiplier = config.forecastSizingHooks.enabled
      ? clamp(forecastPayload.multiplier, 0, 1) * forecastAggressionCap * forecastReduction
      : 1;

    const mlPhase1Sizing = input.mlPhase1Decision || input.mlPhase1Modifier || {};
    const mlSizingHook = (mlPhase1Sizing && mlPhase1Sizing.sizingHook) || {};
    sizeMultiplier *= forecastMultiplier;
    if (forecastConservativeCap < 1 && approvedEntry.decisionMode === 'weak_entry') {
      sizeMultiplier = Math.min(sizeMultiplier, forecastConservativeCap);
    }
    if (forecastMultiplier < 1 || forecastConservativeCap < 1) {
      reasonCodes.push(`forecast_sizing_tightening:${forecastPayload.reason}`);
    }

    if (
      config.mlCompatibilityHooks.phase1ConfidenceModifierHookEnabled
      && mlPhase1Sizing.mode === 'confidence_sizing'
      && mlSizingHook.enabled === true
      && Number.isFinite(Number(mlSizingHook.aggressivenessMultiplier))
    ) {
      const mlMultiplier = clamp(Number(mlSizingHook.aggressivenessMultiplier), 0.75, 1);
      sizeMultiplier *= mlMultiplier;
      reasonCodes.push('ml_phase1_confidence_sizing_modifier');
      structuredDetails.mlPhase1SizingAdjustment = {
        hookEnabled: true,
        mode: mlPhase1Sizing.mode,
        aggressivenessMultiplier: Number(mlMultiplier.toFixed(8)),
        owner: 'ml_phase1_hint_only',
      };
    }
    structuredDetails.forecastSizingAdjustment = {
      hookEnabled: config.forecastSizingHooks.enabled,
      multiplierFromForecast: Number(clamp(forecastPayload.multiplier, 0, 1).toFixed(8)),
      aggressionCapApplied: Number(forecastAggressionCap.toFixed(8)),
      exposureReductionApplied: Number(forecastReduction.toFixed(8)),
      conservativeCapApplied: Number(forecastConservativeCap.toFixed(8)),
      reason: forecastPayload.reason,
      owner: 'portfolioForecastEngine_hints_only',
    };

    if (approvedEntry.decisionMode === 'weak_entry') {
      leverageCap = Math.max(1, Math.min(leverageCap, 2));
    }

    if ((input.balanceState || {}).drawdownProtection === true) {
      sizeMultiplier *= 0.7;
      leverageCap = Math.max(1, Math.min(leverageCap, 2));
      reasonCodes.push('balance_state_drawdown_protection');
    }
  }

  if (hardBlocked) {
    sizeMultiplier = 0;
    leverageCap = 0;
  }

  sizeMultiplier = clamp(sizeMultiplier, 0, 1);

  const baseTargetMarginSize = Math.max(0, Number(input.baseTargetMarginSize ?? config.baseTargetMarginSize));
  const targetMarginSize = Number((baseTargetMarginSize * sizeMultiplier).toFixed(8));
  const aggressivenessMode = computeAggressivenessMode(sizeMultiplier, approvedEntry.decisionMode, hardBlocked);
  structuredDetails.finalSizeMultiplier = sizeMultiplier;
  structuredDetails.finalLeverageCap = leverageCap;

  if (runtime && typeof runtime.log === 'function') {
    runtime.log(`[dynamicPositionSizing] cycle=${(input.context || {}).cycleId || 'n/a'} ticker=${(input.context || {}).ticker || 'n/a'} runtime=${runtimeMode} approvedEntryDecisionMode=${approvedEntry.decisionMode} baseSizingResult=${JSON.stringify(structuredDetails.baseSizingResult || {})} capitalRegimeAdjustment=${JSON.stringify(structuredDetails.capitalRegimeAdjustment || {})} forecastSizingAdjustment=${JSON.stringify(structuredDetails.forecastSizingAdjustment || {})} mlPhase1SizingAdjustment=${JSON.stringify(structuredDetails.mlPhase1SizingAdjustment || {})} finalSizeMultiplier=${sizeMultiplier.toFixed(4)} finalLeverageCap=${leverageCap} targetMarginSize=${targetMarginSize} aggressiveness=${aggressivenessMode} capitalRegime=${capitalRegime} fallback=${fallbackMode ? 'yes' : 'no'} hardBlocked=${hardBlocked ? 'yes' : 'no'} quality=${sizingDataQualityState} reasonCodes=${reasonCodes.join('|') || 'none'}`);
  }

  return {
    enabled: config.enabled,
    mode: fallbackMode ? 'fixed_fallback' : 'dynamic_base_formula',
    sizeMultiplier,
    targetMarginSize,
    leverageCap,
    aggressivenessMode,
    sizingReasonCodes: reasonCodes,
    sizingDataQualityState,
    contractVersion: 'dynamic_position_sizing.v1',
    explanation: {
      approvedEntryDecisionMode: approvedEntry.decisionMode,
      approvedEntryScore: approvedEntry.entryScore,
      approvedEntryConfidence: approvedEntry.confidence,
      capitalRegime,
      runtimeMode,
      structured: structuredDetails,
      ownership: {
        isSignalRecalculationOwner: false,
        isFinalDecisionOwner: false,
        isExecutionOwner: false,
        requiresApprovedEntry: true,
      },
      downstreamHints: {
        mlPhase1ConfidenceModifierReady: true,
        mlPhase2BoundedModifiersReady: true,
        mlPhase1SizingConfidenceModifierHookEnabled: config.mlCompatibilityHooks.phase1ConfidenceModifierHookEnabled,
        mlPhase2SizingBoundedAdjustmentHookEnabled: config.mlCompatibilityHooks.phase2BoundedAdjustmentHookEnabled,
        mlPhase2SizingBoundedAdjustmentLimits: config.mlCompatibilityHooks.phase2BoundedAdjustmentLimits,
        executionLifecycleIntegrationReady: true,
        multiExchangeAdaptationReady: true,
      },
    },
  };
}

function toDynamicPositionSizingEvent({ context = {}, decision = {} } = {}) {
  return {
    type: 'dynamic_position_sizing',
    cycleId: context.cycleId || 'n/a',
    ticker: context.ticker || 'n/a',
    exchange: context.exchange || 'n/a',
    layer: 'dynamic_position_sizing',
    module: 'dynamicPositionSizing',
    runtimeMode: context.mode || ((decision.explanation || {}).runtimeMode) || 'unknown',
    approvedEntryDecisionMode: ((decision.explanation || {}).approvedEntryDecisionMode) || 'no_entry',
    baseSizingResult: ((decision.explanation || {}).structured || {}).baseSizingResult || null,
    capitalRegimeAdjustment: ((decision.explanation || {}).structured || {}).capitalRegimeAdjustment || null,
    forecastSizingAdjustment: ((decision.explanation || {}).structured || {}).forecastSizingAdjustment || null,
    mlPhase1SizingAdjustment: ((decision.explanation || {}).structured || {}).mlPhase1SizingAdjustment || null,
    finalSizeMultiplier: Number.isFinite(decision.sizeMultiplier) ? decision.sizeMultiplier : 0,
    finalLeverageCap: Number.isFinite(decision.leverageCap) ? decision.leverageCap : 0,
    sizingReasonCodes: Array.isArray(decision.sizingReasonCodes) ? decision.sizingReasonCodes : [],
    contractVersion: decision.contractVersion || 'dynamic_position_sizing.v1',
  };
}

module.exports = {
  evaluateDynamicPositionSizing,
  normalizeDynamicPositionSizingConfig: normalizeConfig,
  toDynamicPositionSizingEvent,
};
