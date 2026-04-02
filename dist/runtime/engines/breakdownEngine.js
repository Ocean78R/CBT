'use strict';

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function toNumber(value, fallback = 0) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sum = values.reduce((acc, item) => acc + (Number.isFinite(item) ? Number(item) : 0), 0);
  return sum / values.length;
}

// Русский комментарий: breakdown-слой возвращает стандартный block-result и не может открыть позицию самостоятельно.
function createBreakdownLayerResult(payload = {}) {
  return {
    layerName: 'breakdownEngine',
    direction: payload.direction || 'none',
    score: clamp01(toNumber(payload.score, 0)),
    confidence: clamp01(toNumber(payload.confidence, 0)),
    softPenalty: clamp01(toNumber(payload.softPenalty, 0)),
    vetoCandidates: Array.isArray(payload.vetoCandidates) ? payload.vetoCandidates : [],
    dataQualityState: payload.dataQualityState || 'degraded',
    reasonCodes: Array.isArray(payload.reasonCodes) ? payload.reasonCodes : [],
    explanation: payload.explanation || {},
  };
}

function normalizeBreakdownConfig(raw = {}) {
  const thresholds = raw.thresholds || {};
  const weights = raw.weights || {};
  const setupTypes = raw.setupTypes || {};
  const microstructure = raw.microstructure || {};
  return {
    enabled: !!raw.enabled,
    allowedRegimes: Array.isArray(raw.allowedRegimes) && raw.allowedRegimes.length > 0
      ? raw.allowedRegimes
      : ['trend', 'pullback', 'volatile_breakout'],
    noTradeRegimes: Array.isArray(raw.noTradeRegimes) ? raw.noTradeRegimes : ['no_trade_flat'],
    lookbackBars: Number(raw.lookbackBars ?? 96),
    minCandlesForAnalysis: Number(raw.minCandlesForAnalysis ?? 30),
    supportLookbackBars: Number(raw.supportLookbackBars ?? 28),
    supportProximityPercent: Number(raw.supportProximityPercent ?? 0.35),
    pressureLookbackBars: Number(raw.pressureLookbackBars ?? 8),
    momentumLookbackBars: Number(raw.momentumLookbackBars ?? 6),
    repeatedTestsWindowBars: Number(raw.repeatedTestsWindowBars ?? 20),
    repeatedTestsTolerancePercent: Number(raw.repeatedTestsTolerancePercent ?? 0.2),
    breakdownConfirmationBars: Number(raw.breakdownConfirmationBars ?? 2),
    reclaimTolerancePercent: Number(raw.reclaimTolerancePercent ?? 0.12),
    thresholds: {
      scoreForSetupTag: Number(thresholds.scoreForSetupTag ?? 0.58),
      strongScore: Number(thresholds.strongScore ?? 0.74),
      minConfidence: Number(thresholds.minConfidence ?? 0.34),
      minimumDataCoverage: Number(thresholds.minimumDataCoverage ?? 0.5),
      microstructureActivationScore: Number(thresholds.microstructureActivationScore ?? 0.62),
    },
    setupTypes: {
      pre_breakdown_pressure: setupTypes.pre_breakdown_pressure !== false,
      confirmed_breakdown_continuation: setupTypes.confirmed_breakdown_continuation !== false,
      weak_retest_failure: setupTypes.weak_retest_failure !== false,
      momentum_expansion_breakdown: setupTypes.momentum_expansion_breakdown !== false,
      volume_confirmed_breakdown: setupTypes.volume_confirmed_breakdown !== false,
      orderbook_ask_pressure: setupTypes.orderbook_ask_pressure !== false,
    },
    weights: {
      proximityToSupport: Number(weights.proximityToSupport ?? 0.14),
      supportPressure: Number(weights.supportPressure ?? 0.14),
      repeatedTests: Number(weights.repeatedTests ?? 0.12),
      downsideMomentumExpansion: Number(weights.downsideMomentumExpansion ?? 0.14),
      volumeSpikeOnBreakdown: Number(weights.volumeSpikeOnBreakdown ?? 0.12),
      weakReboundRetest: Number(weights.weakReboundRetest ?? 0.12),
      reclaimFailure: Number(weights.reclaimFailure ?? 0.1),
      microstructure: Number(weights.microstructure ?? 0.12),
    },
    microstructure: {
      enabled: microstructure.enabled !== false,
      requireStrongCandidate: microstructure.requireStrongCandidate !== false,
      skipWhenBudgetExceeded: microstructure.skipWhenBudgetExceeded !== false,
      minAskBidImbalance: Number(microstructure.minAskBidImbalance ?? 0.1),
      maxSpreadPercent: Number(microstructure.maxSpreadPercent ?? 0.14),
    },
    capitalRegimePenalties: typeof raw.capitalRegimePenalties === 'object' && raw.capitalRegimePenalties
      ? raw.capitalRegimePenalties
      : {
        CAUTION: 0.04,
        DEFENSIVE: 0.1,
        CAPITAL_PRESERVATION: 0.16,
        HALT_NEW_ENTRIES: 0.28,
      },
  };
}

function extractCandles(input = {}, config = {}) {
  const shared = input.sharedSnapshot || {};
  const candlesRaw = Array.isArray(shared.candles)
    ? shared.candles
    : (Array.isArray(input.candles) ? input.candles : []);
  if (candlesRaw.length === 0) return [];
  const lookback = Math.max(config.lookbackBars || 96, config.minCandlesForAnalysis || 30);
  return candlesRaw.slice(-lookback);
}

function detectSupportLevel(candles, lookbackBars) {
  const window = candles.slice(-Math.max(lookbackBars, 3));
  if (window.length === 0) return null;
  const lows = window
    .map((x) => toNumber(x.low, NaN))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (lows.length === 0) return null;
  const clusterSlice = lows.slice(0, Math.max(2, Math.ceil(lows.length * 0.25)));
  return average(clusterSlice);
}

function evaluateBreakdown(input = {}, rawConfig = {}) {
  const config = normalizeBreakdownConfig(rawConfig);
  const context = input.context || {};
  const reasonCodes = [];
  const setupTypes = [];
  const featureScores = {};
  const capitalRegime = context.capitalRegime || 'NORMAL';
  const marketRegime = context.marketRegime || 'unknown';
  let dataQualityState = 'full';
  let microstructureMode = 'not_used';

  if (!config.enabled) {
    return createBreakdownLayerResult({
      direction: 'none',
      dataQualityState: 'fallback',
      reasonCodes: ['breakdown_engine_disabled'],
      explanation: { fallbackPolicy: 'layer_disabled' },
    });
  }

  if (config.noTradeRegimes.includes(marketRegime)) {
    return createBreakdownLayerResult({
      direction: 'short',
      score: 0,
      confidence: 0.76,
      softPenalty: 0.18,
      dataQualityState: 'full',
      reasonCodes: ['no_trade_regime_for_breakdown'],
      vetoCandidates: [{ type: 'no_trade_regime', reason: 'breakdown_not_allowed_in_regime' }],
      explanation: { marketRegime, capitalRegime, ownership: 'market_regime_router' },
    });
  }

  if (!config.allowedRegimes.includes(marketRegime)) {
    return createBreakdownLayerResult({
      direction: 'short',
      score: 0,
      confidence: 0.28,
      softPenalty: 0.08,
      dataQualityState: 'degraded',
      reasonCodes: ['regime_not_in_breakdown_allowlist'],
      explanation: { marketRegime, allowedRegimes: config.allowedRegimes },
    });
  }

  const candles = extractCandles(input, config);
  if (candles.length < config.minCandlesForAnalysis) {
    return createBreakdownLayerResult({
      direction: 'short',
      score: 0,
      confidence: 0.22,
      softPenalty: 0.12,
      dataQualityState: 'degraded',
      reasonCodes: ['insufficient_candles_for_breakdown'],
      explanation: {
        candlesAvailable: candles.length,
        minCandlesForAnalysis: config.minCandlesForAnalysis,
      },
    });
  }

  const closes = candles.map((x) => toNumber(x.close, NaN)).filter(Number.isFinite);
  const highs = candles.map((x) => toNumber(x.high, NaN)).filter(Number.isFinite);
  const lows = candles.map((x) => toNumber(x.low, NaN)).filter(Number.isFinite);
  const volumes = candles.map((x) => toNumber(x.volume, NaN)).filter(Number.isFinite);
  const latest = candles[candles.length - 1];
  const support = detectSupportLevel(candles, config.supportLookbackBars);
  if (!Number.isFinite(support)) {
    return createBreakdownLayerResult({
      direction: 'short',
      score: 0,
      confidence: 0.2,
      softPenalty: 0.14,
      dataQualityState: 'degraded',
      reasonCodes: ['support_detection_failed'],
      explanation: { supportLookbackBars: config.supportLookbackBars },
    });
  }

  const price = toNumber(latest.close, support);
  const supportDistancePercent = ((price - support) / Math.max(Math.abs(price), 1)) * 100;
  const proximityToSupportScore = clamp01(1 - (Math.abs(supportDistancePercent) / Math.max(config.supportProximityPercent, 0.01)));
  featureScores.proximityToSupport = proximityToSupportScore;
  if (proximityToSupportScore >= config.thresholds.scoreForSetupTag && config.setupTypes.pre_breakdown_pressure) {
    setupTypes.push('pre_breakdown_pressure');
  }

  const pressureWindow = candles.slice(-Math.max(config.pressureLookbackBars, 3));
  const bearishBodies = pressureWindow.filter((c) => toNumber(c.close, 0) < toNumber(c.open, 0)).length;
  const avgCloseToSupport = average(pressureWindow.map((c) => Math.abs(toNumber(c.close, support) - support)));
  const supportPressureScore = clamp01((bearishBodies / Math.max(pressureWindow.length, 1)) * 0.7 + (1 - (avgCloseToSupport / Math.max(Math.abs(price) * 0.008, 0.0001))) * 0.3);
  featureScores.supportPressure = supportPressureScore;

  const repeatedWindow = candles.slice(-Math.max(config.repeatedTestsWindowBars, 6));
  const testCount = repeatedWindow.filter((c) => {
    const low = toNumber(c.low, support);
    const distPercent = Math.abs(((low - support) / Math.max(Math.abs(support), 1)) * 100);
    return distPercent <= config.repeatedTestsTolerancePercent;
  }).length;
  const repeatedTestsScore = clamp01(testCount / 4);
  featureScores.repeatedTests = repeatedTestsScore;

  const momentumRecent = closes.slice(-Math.max(config.momentumLookbackBars, 3));
  const momentumPrev = closes.slice(-(Math.max(config.momentumLookbackBars, 3) * 2), -Math.max(config.momentumLookbackBars, 3));
  const slopeRecent = momentumRecent.length >= 2 ? (momentumRecent[momentumRecent.length - 1] - momentumRecent[0]) / momentumRecent.length : 0;
  const slopePrev = momentumPrev.length >= 2 ? (momentumPrev[momentumPrev.length - 1] - momentumPrev[0]) / momentumPrev.length : 0;
  const downsideMomentumExpansionScore = clamp01((slopeRecent < slopePrev ? 0.65 : 0.2) + clamp01(Math.abs(slopeRecent) / Math.max(Math.abs(slopePrev), 0.0001)) * 0.35);
  featureScores.downsideMomentumExpansion = downsideMomentumExpansionScore;
  if (downsideMomentumExpansionScore >= config.thresholds.scoreForSetupTag && config.setupTypes.momentum_expansion_breakdown) {
    setupTypes.push('momentum_expansion_breakdown');
  }

  const avgVolRecent = average(volumes.slice(-3));
  const avgVolBase = average(volumes.slice(-12, -3));
  const volumeSpikeOnBreakdownScore = clamp01((avgVolRecent / Math.max(avgVolBase, 1)) - 0.85);
  featureScores.volumeSpikeOnBreakdown = volumeSpikeOnBreakdownScore;
  if (volumeSpikeOnBreakdownScore >= config.thresholds.scoreForSetupTag && config.setupTypes.volume_confirmed_breakdown) {
    setupTypes.push('volume_confirmed_breakdown');
  }

  const bounceWindow = candles.slice(-Math.max(config.breakdownConfirmationBars + 2, 4));
  const reboundWeakCandles = bounceWindow.filter((c) => toNumber(c.close, 0) > toNumber(c.open, 0) && (toNumber(c.high, 0) - toNumber(c.close, 0)) > (toNumber(c.close, 0) - toNumber(c.open, 0))).length;
  const weakReboundRetestScore = clamp01(0.25 + (reboundWeakCandles / Math.max(bounceWindow.length, 1)) * 0.75);
  featureScores.weakReboundRetest = weakReboundRetestScore;

  const closedBelowSupport = bounceWindow.filter((c) => toNumber(c.close, support) < support).length;
  const reclaimTolerancePrice = support * (1 + (config.reclaimTolerancePercent / 100));
  const reclaimFailures = bounceWindow.filter((c) => toNumber(c.high, support) <= reclaimTolerancePrice).length;
  const reclaimFailureScore = clamp01((closedBelowSupport / Math.max(config.breakdownConfirmationBars, 1)) * 0.55 + (reclaimFailures / Math.max(bounceWindow.length, 1)) * 0.45);
  featureScores.reclaimFailure = reclaimFailureScore;
  if (reclaimFailureScore >= config.thresholds.scoreForSetupTag && config.setupTypes.weak_retest_failure) {
    setupTypes.push('weak_retest_failure');
  }

  const orderBook = (input.sharedSnapshot || {}).orderBook || {};
  let microstructureScore = 0;
  if (!config.microstructure.enabled) {
    microstructureMode = 'disabled';
    reasonCodes.push('microstructure_disabled');
  } else if (config.microstructure.skipWhenBudgetExceeded && input.budgetState === 'exhausted') {
    dataQualityState = 'degraded';
    microstructureMode = 'degraded_budget';
    reasonCodes.push('microstructure_skipped_by_budget');
  } else {
    const candidateScore = average([
      featureScores.proximityToSupport,
      featureScores.supportPressure,
      featureScores.repeatedTests,
      featureScores.downsideMomentumExpansion,
    ]);
    if (config.microstructure.requireStrongCandidate && candidateScore < config.thresholds.microstructureActivationScore) {
      microstructureMode = 'skipped_weak_candidate';
      reasonCodes.push('microstructure_skipped_weak_candidate');
    } else if (!Number.isFinite(orderBook.bestBid) || !Number.isFinite(orderBook.bestAsk) || !Number.isFinite(orderBook.bidVolume) || !Number.isFinite(orderBook.askVolume)) {
      dataQualityState = 'degraded';
      microstructureMode = 'degraded_missing_orderbook';
      reasonCodes.push('microstructure_orderbook_missing');
    } else {
      const spreadPercent = ((orderBook.bestAsk - orderBook.bestBid) / Math.max(Math.abs(orderBook.bestBid), 1)) * 100;
      const imbalance = (orderBook.askVolume - orderBook.bidVolume) / Math.max(orderBook.askVolume + orderBook.bidVolume, 1);
      microstructureScore = clamp01((imbalance >= config.microstructure.minAskBidImbalance ? 0.65 : 0.25) + (spreadPercent <= config.microstructure.maxSpreadPercent ? 0.35 : 0.1));
      featureScores.microstructure = microstructureScore;
      microstructureMode = 'full';
      if (microstructureScore >= config.thresholds.scoreForSetupTag && config.setupTypes.orderbook_ask_pressure) {
        setupTypes.push('orderbook_ask_pressure');
      }
      reasonCodes.push('microstructure_full');
    }
  }

  const weights = config.weights;
  const weightedScore = clamp01(
    (featureScores.proximityToSupport || 0) * weights.proximityToSupport
    + (featureScores.supportPressure || 0) * weights.supportPressure
    + (featureScores.repeatedTests || 0) * weights.repeatedTests
    + (featureScores.downsideMomentumExpansion || 0) * weights.downsideMomentumExpansion
    + (featureScores.volumeSpikeOnBreakdown || 0) * weights.volumeSpikeOnBreakdown
    + (featureScores.weakReboundRetest || 0) * weights.weakReboundRetest
    + (featureScores.reclaimFailure || 0) * weights.reclaimFailure
    + (featureScores.microstructure || 0) * weights.microstructure
  );

  const dataCoverage = Object.keys(featureScores).length / 8;
  const confidenceBase = average(Object.values(featureScores));
  let confidence = clamp01((confidenceBase * 0.75) + (dataCoverage * 0.25));
  if (dataCoverage < config.thresholds.minimumDataCoverage) {
    dataQualityState = 'degraded';
    confidence = clamp01(confidence * 0.78);
    reasonCodes.push('low_data_coverage');
  }
  if (confidence < config.thresholds.minConfidence) reasonCodes.push('breakdown_confidence_below_threshold');

  const capitalPenalty = clamp01(toNumber(config.capitalRegimePenalties[capitalRegime], 0));
  const finalScore = clamp01(weightedScore - capitalPenalty);
  if (capitalPenalty > 0) reasonCodes.push(`capital_regime_penalty_${String(capitalRegime).toLowerCase()}`);

  if (finalScore >= config.thresholds.strongScore && config.setupTypes.confirmed_breakdown_continuation) {
    setupTypes.push('confirmed_breakdown_continuation');
  }
  if (setupTypes.length === 0) reasonCodes.push('no_bearish_setup_confirmed');

  return createBreakdownLayerResult({
    direction: 'short',
    score: finalScore,
    confidence,
    softPenalty: 0,
    dataQualityState,
    reasonCodes,
    explanation: {
      setupTypes,
      featureScores,
      supportLevel: support,
      supportDistancePercent,
      dataCoverage,
      rawScore: weightedScore,
      capitalRegime,
      capitalPenalty,
      marketRegime,
      microstructureMode,
      ownership: 'confluence_or_final_decision_layer',
      executionAction: 'none_signal_only',
      fallbackAction: dataQualityState === 'degraded' ? 'degraded_score_only' : 'none',
    },
  });
}

module.exports = {
  normalizeBreakdownConfig,
  evaluateBreakdown,
};

