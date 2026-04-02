'use strict';

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function normalizeConfig(raw = {}) {
  const thresholds = raw.thresholds || {};
  const refreshPolicy = raw.refreshPolicy || {};
  const capitalRegimePenalties = raw.capitalRegimePenalties || {};
  const crowding = raw.crowding || {};
  const liquidation = raw.liquidation || {};

  return {
    enabled: !!raw.enabled,
    preferSharedSnapshot: raw.preferSharedSnapshot !== false,
    skipWhenBudgetExceeded: raw.skipWhenBudgetExceeded !== false,
    allowNoTradeOnExtremeCrowding: !!raw.allowNoTradeOnExtremeCrowding,
    thresholds: {
      oiStrongIncrease: Number(thresholds.oiStrongIncrease ?? 0.05),
      oiStrongDecrease: Number(thresholds.oiStrongDecrease ?? -0.05),
      fundingExtreme: Number(thresholds.fundingExtreme ?? 0.0009),
      fundingElevated: Number(thresholds.fundingElevated ?? 0.00045),
      liquidationImbalanceStrong: Number(thresholds.liquidationImbalanceStrong ?? 1.8),
      minimumConfidence: Number(thresholds.minimumConfidence ?? 0.35),
      maxSoftPenalty: Number(thresholds.maxSoftPenalty ?? 0.45),
    },
    weights: {
      oiDynamics: Number(((raw.weights || {}).oiDynamics) ?? 0.34),
      fundingState: Number(((raw.weights || {}).fundingState) ?? 0.32),
      liquidationContext: Number(((raw.weights || {}).liquidationContext) ?? 0.2),
      crowding: Number(((raw.weights || {}).crowding) ?? 0.14),
    },
    crowding: {
      oiZscoreSpike: Number(crowding.oiZscoreSpike ?? 2.4),
      fundingAbsSpike: Number(crowding.fundingAbsSpike ?? 0.0012),
      liquidationClusterUsd: Number(crowding.liquidationClusterUsd ?? 2500000),
      penaltyOnExtreme: Number(crowding.penaltyOnExtreme ?? 0.26),
      penaltyOnElevated: Number(crowding.penaltyOnElevated ?? 0.12),
    },
    liquidation: {
      useIfAvailable: liquidation.useIfAvailable !== false,
      dominanceSupportWeight: Number(liquidation.dominanceSupportWeight ?? 0.22),
      dominanceRiskPenalty: Number(liquidation.dominanceRiskPenalty ?? 0.2),
    },
    refreshPolicy: {
      minCyclesBetweenRefresh: Number(refreshPolicy.minCyclesBetweenRefresh ?? 3),
      forceRefreshEveryCycles: Number(refreshPolicy.forceRefreshEveryCycles ?? 0),
      allowCachedReuse: refreshPolicy.allowCachedReuse !== false,
      cacheKey: refreshPolicy.cacheKey || 'derivatives_context_engine',
    },
    capitalRegimePenalties: {
      NORMAL: Number(capitalRegimePenalties.NORMAL ?? 0),
      CAUTION: Number(capitalRegimePenalties.CAUTION ?? 0.04),
      DEFENSIVE: Number(capitalRegimePenalties.DEFENSIVE ?? 0.1),
      CAPITAL_PRESERVATION: Number(capitalRegimePenalties.CAPITAL_PRESERVATION ?? 0.16),
      HALT_NEW_ENTRIES: Number(capitalRegimePenalties.HALT_NEW_ENTRIES ?? 0.26),
    },
  };
}

function resolveDerivativesSnapshot(input, config) {
  const sharedSnapshot = input.sharedSnapshot || {};
  if (config.preferSharedSnapshot && sharedSnapshot.derivatives && typeof sharedSnapshot.derivatives === 'object') {
    return { snapshot: sharedSnapshot.derivatives, source: 'shared_snapshot' };
  }
  if (input.derivativesSnapshot && typeof input.derivativesSnapshot === 'object') {
    return { snapshot: input.derivativesSnapshot, source: 'input_override' };
  }
  return { snapshot: null, source: 'missing' };
}

function detectRefreshMode(input, config, derivativesSnapshot) {
  const context = input.context || {};
  const featureStoreContext = input.featureStoreContext || {};
  const cached = featureStoreContext[config.refreshPolicy.cacheKey] || null;
  const cycleIndex = Number(context.cycleIndex || 0);
  const budgetState = input.budgetState || 'normal';

  if (config.skipWhenBudgetExceeded && budgetState === 'exceeded') {
    if (config.refreshPolicy.allowCachedReuse && cached) return { mode: 'cached_mode', cached, canUseCache: true };
    return { mode: 'degraded_mode', cached: null, canUseCache: false };
  }

  if (!derivativesSnapshot || typeof derivativesSnapshot !== 'object') {
    if (config.refreshPolicy.allowCachedReuse && cached) return { mode: 'cached_mode', cached, canUseCache: true };
    return { mode: 'degraded_mode', cached: null, canUseCache: false };
  }

  if (config.refreshPolicy.forceRefreshEveryCycles > 0 && cycleIndex > 0 && cycleIndex % config.refreshPolicy.forceRefreshEveryCycles === 0) {
    return { mode: 'full_mode', cached, canUseCache: false };
  }

  if (!cached) return { mode: 'full_mode', cached: null, canUseCache: false };

  const previousCycle = Number(cached.cycleIndex || 0);
  const delta = Math.max(0, cycleIndex - previousCycle);
  if (delta < config.refreshPolicy.minCyclesBetweenRefresh && config.refreshPolicy.allowCachedReuse) {
    return { mode: 'cached_mode', cached, canUseCache: true };
  }

  return { mode: 'full_mode', cached, canUseCache: false };
}

function readNumber(value, fallback = null) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function evaluateDerivativesContext(input = {}, rawConfig = {}) {
  const config = normalizeConfig(rawConfig);
  const context = input.context || {};
  const direction = ((input.primarySignal || {}).direction) || 'none';
  const capitalRegime = context.capitalRegime || 'NORMAL';
  const { snapshot, source } = resolveDerivativesSnapshot(input, config);
  const refresh = detectRefreshMode(input, config, snapshot);

  if (!config.enabled) {
    return {
      layerName: 'derivativesContextLayer',
      direction: direction === 'long' || direction === 'short' ? direction : 'none',
      score: 0,
      confidence: 0,
      softPenalty: 0,
      vetoCandidates: [],
      dataQualityState: 'fallback',
      reasonCodes: ['derivatives_layer_disabled'],
      explanation: {
        mode: 'disabled',
      },
    };
  }

  const derivatives = refresh.canUseCache && refresh.cached && refresh.cached.snapshot
    ? refresh.cached.snapshot
    : snapshot;

  if (!derivatives || typeof derivatives !== 'object') {
    return {
      layerName: 'derivativesContextLayer',
      direction: direction === 'long' || direction === 'short' ? direction : 'none',
      score: 0.5,
      confidence: 0.25,
      softPenalty: clamp01(Math.min(config.thresholds.maxSoftPenalty, 0.08 + (config.capitalRegimePenalties[capitalRegime] || 0))),
      vetoCandidates: [],
      dataQualityState: 'degraded',
      reasonCodes: ['derivatives_data_missing'],
      explanation: {
        mode: refresh.mode,
        source,
        dataState: 'missing',
      },
    };
  }

  const oiCurrent = readNumber((derivatives.openInterest || {}).current, null);
  const oiPrevious = readNumber((derivatives.openInterest || {}).previous, null);
  const oiZscore = readNumber((derivatives.openInterest || {}).zscore, 0);
  const fundingRate = readNumber((derivatives.funding || {}).rate, null);
  const liquidationsLong = readNumber(((derivatives.liquidation || {}).longUsd), 0) || 0;
  const liquidationsShort = readNumber(((derivatives.liquidation || {}).shortUsd), 0) || 0;
  const liquidationTotal = liquidationsLong + liquidationsShort;

  let score = 0.5;
  let confidence = 0.45;
  let softPenalty = 0;
  const vetoCandidates = [];
  const reasonCodes = [];

  const oiDelta = (Number.isFinite(oiCurrent) && Number.isFinite(oiPrevious) && oiPrevious !== 0)
    ? ((oiCurrent - oiPrevious) / Math.abs(oiPrevious))
    : null;

  if (Number.isFinite(oiDelta)) {
    if (direction === 'long' && oiDelta >= config.thresholds.oiStrongIncrease) {
      score += config.weights.oiDynamics * 0.25;
      reasonCodes.push('oi_increase_supports_long');
    } else if (direction === 'short' && oiDelta >= config.thresholds.oiStrongIncrease) {
      score += config.weights.oiDynamics * 0.08;
      reasonCodes.push('oi_increase_supports_momentum_short');
    } else if (oiDelta <= config.thresholds.oiStrongDecrease) {
      softPenalty += config.weights.oiDynamics * 0.35;
      reasonCodes.push('oi_decay_reduces_conviction');
    } else {
      reasonCodes.push('oi_neutral');
    }
    confidence += config.weights.oiDynamics * 0.5;
  } else {
    softPenalty += 0.05;
    reasonCodes.push('oi_data_incomplete');
  }

  if (Number.isFinite(fundingRate)) {
    const fundingAbs = Math.abs(fundingRate);
    if (direction === 'long' && fundingRate >= config.thresholds.fundingElevated) {
      softPenalty += config.weights.fundingState * (fundingRate >= config.thresholds.fundingExtreme ? 0.55 : 0.32);
      reasonCodes.push(fundingRate >= config.thresholds.fundingExtreme ? 'funding_long_extreme_overcrowded' : 'funding_long_elevated');
    } else if (direction === 'short' && fundingRate <= -config.thresholds.fundingElevated) {
      softPenalty += config.weights.fundingState * (fundingAbs >= config.thresholds.fundingExtreme ? 0.55 : 0.32);
      reasonCodes.push(fundingAbs >= config.thresholds.fundingExtreme ? 'funding_short_extreme_overcrowded' : 'funding_short_elevated');
    } else if (direction === 'short' && fundingRate >= config.thresholds.fundingElevated) {
      score += config.weights.fundingState * 0.28;
      reasonCodes.push('positive_funding_supports_short');
    } else if (direction === 'long' && fundingRate <= -config.thresholds.fundingElevated) {
      score += config.weights.fundingState * 0.28;
      reasonCodes.push('negative_funding_supports_long');
    } else {
      reasonCodes.push('funding_neutral');
    }
    confidence += config.weights.fundingState * 0.55;
  } else {
    softPenalty += 0.04;
    reasonCodes.push('funding_data_missing');
  }

  if (config.liquidation.useIfAvailable && liquidationTotal > 0) {
    const dominance = Math.max(liquidationsLong, liquidationsShort) / Math.max(1, Math.min(liquidationsLong, liquidationsShort));
    const dominantSide = liquidationsLong >= liquidationsShort ? 'long' : 'short';
    if (dominance >= config.thresholds.liquidationImbalanceStrong) {
      if (direction === 'long' && dominantSide === 'short') {
        score += config.liquidation.dominanceSupportWeight;
        reasonCodes.push('short_liquidations_support_long');
      } else if (direction === 'short' && dominantSide === 'long') {
        score += config.liquidation.dominanceSupportWeight;
        reasonCodes.push('long_liquidations_support_short');
      } else {
        softPenalty += config.liquidation.dominanceRiskPenalty;
        reasonCodes.push('liquidation_imbalance_against_direction');
      }
    } else {
      reasonCodes.push('liquidation_context_neutral');
    }
    confidence += config.weights.liquidationContext * 0.45;
  } else {
    reasonCodes.push('liquidation_data_unavailable');
  }

  const crowdingSignals = [];
  if (Number.isFinite(oiZscore) && oiZscore >= config.crowding.oiZscoreSpike) crowdingSignals.push('oi_spike');
  if (Number.isFinite(fundingRate) && Math.abs(fundingRate) >= config.crowding.fundingAbsSpike) crowdingSignals.push('funding_spike');
  if (liquidationTotal >= config.crowding.liquidationClusterUsd) crowdingSignals.push('liquidation_cluster');

  if (crowdingSignals.length >= 2) {
    softPenalty += config.crowding.penaltyOnExtreme;
    reasonCodes.push('crowding_extreme');
    if (config.allowNoTradeOnExtremeCrowding) {
      vetoCandidates.push({ type: 'no_trade_regime', reason: 'derivatives_crowding_extreme' });
    }
  } else if (crowdingSignals.length === 1) {
    softPenalty += config.crowding.penaltyOnElevated;
    reasonCodes.push('crowding_elevated');
  } else {
    reasonCodes.push('crowding_normal');
  }

  softPenalty += config.capitalRegimePenalties[capitalRegime] || 0;
  if ((config.capitalRegimePenalties[capitalRegime] || 0) > 0) reasonCodes.push('capital_regime_protective_penalty_applied');

  score = clamp01(score);
  confidence = clamp01(confidence);
  softPenalty = clamp01(Math.min(config.thresholds.maxSoftPenalty, softPenalty));

  const dataQualityState = refresh.mode === 'degraded_mode'
    ? 'degraded'
    : (refresh.mode === 'cached_mode' ? 'cached' : 'full');

  return {
    layerName: 'derivativesContextLayer',
    direction: direction === 'long' || direction === 'short' ? direction : 'none',
    score,
    confidence: Math.max(confidence, config.thresholds.minimumConfidence),
    softPenalty,
    vetoCandidates,
    dataQualityState,
    reasonCodes,
    explanation: {
      mode: refresh.mode,
      source,
      reusedCache: refresh.mode === 'cached_mode',
      capitalRegime,
      crowdingSignals,
      inputs: {
        openInterest: { current: oiCurrent, previous: oiPrevious, delta: oiDelta, zscore: oiZscore },
        funding: { rate: fundingRate },
        liquidation: { longUsd: liquidationsLong, shortUsd: liquidationsShort, totalUsd: liquidationTotal },
      },
      // Русский комментарий: слой деривативов не исполняет сделки, а только модифицирует оценку входа.
      ownership: 'context_only_no_execution',
    },
    cacheWrite: refresh.mode === 'full_mode'
      ? {
        cycleIndex: Number(context.cycleIndex || 0),
        snapshot: derivatives,
      }
      : null,
  };
}

module.exports = {
  normalizeDerivativesContextConfig: normalizeConfig,
  evaluateDerivativesContext,
};
