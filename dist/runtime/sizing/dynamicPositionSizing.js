'use strict';

// Русский комментарий: dynamicPositionSizing работает только после finalEntryDecisionEngine и использует готовый upstream context.
// Модуль не пересчитывает сигналы, не владеет final decision и не инициирует execution/lifecycle side-effects.

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function normalizeConfig(raw = {}) {
  const fallback = raw.fallback || {};
  return {
    enabled: raw.enabled !== false,
    baseTargetMarginSize: Math.max(0, Number(raw.baseTargetMarginSize ?? 100)),
    baseLeverageCap: Math.max(1, Number(raw.baseLeverageCap ?? 5)),
    weakEntryBaseMultiplier: clamp(raw.weakEntryBaseMultiplier ?? 0.5, 0, 1),
    riskPenaltyWeight: clamp(raw.riskPenaltyWeight ?? 0.6, 0, 1),
    capitalRegimeMultipliers: {
      NORMAL: clamp((((raw.capitalRegimeMultipliers || {}).NORMAL) ?? 1), 0, 1),
      CAUTION: clamp((((raw.capitalRegimeMultipliers || {}).CAUTION) ?? 0.85), 0, 1),
      DEFENSIVE: clamp((((raw.capitalRegimeMultipliers || {}).DEFENSIVE) ?? 0.65), 0, 1),
      CAPITAL_PRESERVATION: clamp((((raw.capitalRegimeMultipliers || {}).CAPITAL_PRESERVATION) ?? 0.45), 0, 1),
      REDUCE_RISK: clamp((((raw.capitalRegimeMultipliers || {}).REDUCE_RISK) ?? 0.7), 0, 1),
      CONSERVE_CAPITAL: clamp((((raw.capitalRegimeMultipliers || {}).CONSERVE_CAPITAL) ?? 0.5), 0, 1),
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

function evaluateDynamicPositionSizing(input = {}, rawConfig = {}, runtime = {}) {
  const config = normalizeConfig(rawConfig);
  const reasonCodes = [];
  const approvedEntry = extractApprovedEntry(input);
  const sizingDataQualityState = resolveSizingDataQualityState(input);
  const hardBlocked = isHardRiskBlocked(input);
  const capitalRegime = input.capitalRegime || ((input.balanceState || {}).capitalRegime) || 'NORMAL';

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

    const capitalMultiplier = config.capitalRegimeMultipliers[capitalRegime] ?? 1;
    sizeMultiplier *= capitalMultiplier;
    if (capitalMultiplier < 1) reasonCodes.push(`capital_regime_tightening:${capitalRegime}`);

    const qualityMultiplier = config.dataQualityMultipliers[sizingDataQualityState] ?? config.dataQualityMultipliers.missing;
    sizeMultiplier *= qualityMultiplier;
    if (qualityMultiplier < 1) reasonCodes.push(`data_quality_penalty:${sizingDataQualityState}`);

    const scorePenalty = clamp(1 - ((1 - approvedEntry.entryScore) * 0.4), 0.6, 1);
    sizeMultiplier *= scorePenalty;

    const confidencePenalty = clamp(0.8 + (approvedEntry.confidence * 0.2), 0.8, 1);
    sizeMultiplier *= confidencePenalty;

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

  if (runtime && typeof runtime.log === 'function') {
    runtime.log(`[dynamicPositionSizing] cycle=${(input.context || {}).cycleId || 'n/a'} ticker=${(input.context || {}).ticker || 'n/a'} mode=${approvedEntry.decisionMode} sizeMultiplier=${sizeMultiplier.toFixed(4)} targetMarginSize=${targetMarginSize} leverageCap=${leverageCap} aggressiveness=${aggressivenessMode} capitalRegime=${capitalRegime} fallback=${fallbackMode ? 'yes' : 'no'} hardBlocked=${hardBlocked ? 'yes' : 'no'} quality=${sizingDataQualityState} reasonCodes=${reasonCodes.join('|') || 'none'}`);
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
      ownership: {
        isSignalRecalculationOwner: false,
        isFinalDecisionOwner: false,
        isExecutionOwner: false,
        requiresApprovedEntry: true,
      },
      downstreamHints: {
        mlPhase1ConfidenceModifierReady: true,
        mlPhase2BoundedModifiersReady: true,
        executionLifecycleIntegrationReady: true,
        multiExchangeAdaptationReady: true,
      },
    },
  };
}

module.exports = {
  evaluateDynamicPositionSizing,
  normalizeDynamicPositionSizingConfig: normalizeConfig,
};
