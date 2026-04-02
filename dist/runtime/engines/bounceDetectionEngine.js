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

function normalizeDirection(side) {
  if (side === 'long') return 'long';
  if (side === 'short') return 'short';
  return 'none';
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sum = values.reduce((acc, item) => acc + (Number.isFinite(item) ? Number(item) : 0), 0);
  return sum / values.length;
}

// Русский комментарий: единый формат результата bounce-слоя, совместимый с decision-contract confluence.
function createBounceLayerResult(payload = {}) {
  return {
    layerName: 'bounceDetectionEngine',
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

function normalizeBounceConfig(raw = {}) {
  const thresholds = raw.thresholds || {};
  const weights = raw.weights || {};
  const microstructure = raw.microstructure || {};
  const setups = raw.setupTypes || {};
  return {
    enabled: !!raw.enabled,
    allowedRegimes: Array.isArray(raw.allowedRegimes) && raw.allowedRegimes.length > 0
      ? raw.allowedRegimes
      : ['trend', 'range', 'pullback'],
    noTradeRegimes: Array.isArray(raw.noTradeRegimes) ? raw.noTradeRegimes : ['no_trade_flat'],
    lookbackBars: Number(raw.lookbackBars ?? 80),
    swingWindow: Number(raw.swingWindow ?? 2),
    zoneProximityPercent: Number(raw.zoneProximityPercent ?? 0.25),
    falseBreakoutTolerancePercent: Number(raw.falseBreakoutTolerancePercent ?? 0.18),
    momentumLookbackBars: Number(raw.momentumLookbackBars ?? 6),
    minCandlesForAnalysis: Number(raw.minCandlesForAnalysis ?? 24),
    thresholds: {
      scoreForSetupTag: Number(thresholds.scoreForSetupTag ?? 0.56),
      strongScore: Number(thresholds.strongScore ?? 0.72),
      minConfidence: Number(thresholds.minConfidence ?? 0.3),
      minimumDataCoverage: Number(thresholds.minimumDataCoverage ?? 0.45),
      microstructureActivationScore: Number(thresholds.microstructureActivationScore ?? 0.58),
    },
    setupTypes: {
      zone_rejection: setups.zone_rejection !== false,
      liquidity_grab_reversal: setups.liquidity_grab_reversal !== false,
      momentum_exhaustion: setups.momentum_exhaustion !== false,
      divergence_rebound: setups.divergence_rebound !== false,
      volume_absorption_bounce: setups.volume_absorption_bounce !== false,
      microstructure_snapback: setups.microstructure_snapback !== false,
    },
    weights: {
      proximity: Number(weights.proximity ?? 0.18),
      swingContext: Number(weights.swingContext ?? 0.12),
      falseBreakout: Number(weights.falseBreakout ?? 0.14),
      momentumSlowdown: Number(weights.momentumSlowdown ?? 0.12),
      exhaustionOscillators: Number(weights.exhaustionOscillators ?? 0.14),
      divergence: Number(weights.divergence ?? 0.1),
      volumeAbsorption: Number(weights.volumeAbsorption ?? 0.14),
      microstructure: Number(weights.microstructure ?? 0.06),
    },
    microstructure: {
      enabled: microstructure.enabled !== false,
      requireStrongCandidate: microstructure.requireStrongCandidate !== false,
      skipWhenBudgetExceeded: microstructure.skipWhenBudgetExceeded !== false,
      maxSpreadPercent: Number(microstructure.maxSpreadPercent ?? 0.12),
      minImbalance: Number(microstructure.minImbalance ?? 0.08),
    },
    capitalRegimePenalties: typeof raw.capitalRegimePenalties === 'object' && raw.capitalRegimePenalties
      ? raw.capitalRegimePenalties
      : {
        CAUTION: 0.05,
        DEFENSIVE: 0.12,
        CAPITAL_PRESERVATION: 0.2,
        HALT_NEW_ENTRIES: 0.35,
      },
  };
}

function computeRsi(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i += 1) {
    const prev = closes[i - 1];
    const current = closes[i];
    if (!Number.isFinite(prev) || !Number.isFinite(current)) continue;
    const delta = current - prev;
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }
  if (gains === 0 && losses === 0) return 50;
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function extractCandles(input = {}, config = {}) {
  const shared = input.sharedSnapshot || {};
  const candlesRaw = Array.isArray(shared.candles)
    ? shared.candles
    : (Array.isArray(input.candles) ? input.candles : []);
  if (candlesRaw.length === 0) return [];
  const lookback = Math.max(config.minCandlesForAnalysis || 24, config.lookbackBars || 80);
  return candlesRaw.slice(-lookback);
}

function findSwingPoints(candles, swingWindow) {
  const highs = [];
  const lows = [];
  for (let i = swingWindow; i < candles.length - swingWindow; i += 1) {
    const current = candles[i];
    let isSwingHigh = true;
    let isSwingLow = true;
    for (let w = 1; w <= swingWindow; w += 1) {
      if (current.high <= candles[i - w].high || current.high <= candles[i + w].high) isSwingHigh = false;
      if (current.low >= candles[i - w].low || current.low >= candles[i + w].low) isSwingLow = false;
    }
    if (isSwingHigh) highs.push({ index: i, price: current.high });
    if (isSwingLow) lows.push({ index: i, price: current.low });
  }
  return { highs, lows };
}

function evaluateBounceDetection(input = {}, rawConfig = {}) {
  const config = normalizeBounceConfig(rawConfig);
  const context = input.context || {};
  const marketRegime = context.marketRegime || 'unknown';
  const capitalRegime = context.capitalRegime || 'NORMAL';
  const reasonCodes = [];
  const setupTypes = [];
  const featureScores = {};
  let dataQualityState = 'full';
  let direction = normalizeDirection(((input.primarySignal || {}).direction) || ((input.primarySignal || {}).side));

  if (!config.enabled) {
    return createBounceLayerResult({
      direction: 'none',
      dataQualityState: 'fallback',
      reasonCodes: ['bounce_engine_disabled'],
      explanation: { fallbackPolicy: 'layer_disabled' },
    });
  }

  if (config.noTradeRegimes.includes(marketRegime)) {
    return createBounceLayerResult({
      direction: 'none',
      score: 0,
      confidence: 0.8,
      softPenalty: 0.2,
      dataQualityState: 'full',
      reasonCodes: ['no_trade_regime_for_bounce'],
      vetoCandidates: [{ type: 'no_trade_regime', reason: 'bounce_not_allowed_in_regime' }],
      explanation: {
        marketRegime,
        capitalRegime,
        ownership: 'market_regime_router',
      },
    });
  }

  if (!config.allowedRegimes.includes(marketRegime)) {
    return createBounceLayerResult({
      direction: direction === 'none' ? 'none' : direction,
      score: 0,
      confidence: 0.3,
      softPenalty: 0.08,
      dataQualityState: 'degraded',
      reasonCodes: ['regime_not_in_bounce_allowlist'],
      explanation: { marketRegime, allowedRegimes: config.allowedRegimes },
    });
  }

  const candles = extractCandles(input, config);
  if (candles.length < config.minCandlesForAnalysis) {
    return createBounceLayerResult({
      direction: direction === 'none' ? 'none' : direction,
      score: 0,
      confidence: 0.2,
      softPenalty: 0.16,
      dataQualityState: 'degraded',
      reasonCodes: ['insufficient_candles_for_bounce'],
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
  const prev = candles[candles.length - 2] || latest;
  const swing = findSwingPoints(candles, Math.max(1, config.swingWindow));
  const localSupport = swing.lows.length > 0 ? swing.lows[swing.lows.length - 1].price : Math.min(...lows);
  const localResistance = swing.highs.length > 0 ? swing.highs[swing.highs.length - 1].price : Math.max(...highs);

  if (direction === 'none') {
    direction = latest.close <= prev.close ? 'long' : 'short';
    reasonCodes.push('direction_inferred_from_price_action');
  }

  const price = toNumber(latest.close, 0);
  const zoneDistancePercent = direction === 'long'
    ? ((price - localSupport) / Math.max(Math.abs(price), 1)) * 100
    : ((localResistance - price) / Math.max(Math.abs(price), 1)) * 100;
  const proximityScore = clamp01(1 - (Math.abs(zoneDistancePercent) / Math.max(config.zoneProximityPercent, 0.01)));
  featureScores.proximity = proximityScore;
  if (proximityScore > 0.55 && config.setupTypes.zone_rejection) setupTypes.push('zone_rejection');

  const swingContextScore = direction === 'long'
    ? clamp01((swing.lows.length >= 2 && swing.lows[swing.lows.length - 1].price >= swing.lows[swing.lows.length - 2].price) ? 0.9 : 0.35)
    : clamp01((swing.highs.length >= 2 && swing.highs[swing.highs.length - 1].price <= swing.highs[swing.highs.length - 2].price) ? 0.9 : 0.35);
  featureScores.swingContext = swingContextScore;

  const breakoutDistance = direction === 'long'
    ? ((localSupport - toNumber(latest.low, price)) / Math.max(Math.abs(price), 1)) * 100
    : ((toNumber(latest.high, price) - localResistance) / Math.max(Math.abs(price), 1)) * 100;
  const hasFastRecovery = direction === 'long'
    ? toNumber(latest.close, price) > toNumber(latest.open, price) && toNumber(prev.close, price) < toNumber(prev.open, price)
    : toNumber(latest.close, price) < toNumber(latest.open, price) && toNumber(prev.close, price) > toNumber(prev.open, price);
  const falseBreakoutScore = clamp01((breakoutDistance <= config.falseBreakoutTolerancePercent ? 0.55 : 0.1) + (hasFastRecovery ? 0.35 : 0));
  featureScores.falseBreakout = falseBreakoutScore;
  if (falseBreakoutScore > 0.58 && config.setupTypes.liquidity_grab_reversal) setupTypes.push('liquidity_grab_reversal');

  const momentumRecent = closes.slice(-config.momentumLookbackBars);
  const momentumPrev = closes.slice(-(config.momentumLookbackBars * 2), -config.momentumLookbackBars);
  const slopeRecent = momentumRecent.length >= 2 ? (momentumRecent[momentumRecent.length - 1] - momentumRecent[0]) / momentumRecent.length : 0;
  const slopePrev = momentumPrev.length >= 2 ? (momentumPrev[momentumPrev.length - 1] - momentumPrev[0]) / momentumPrev.length : 0;
  const momentumSlowdownScore = clamp01(1 - (Math.abs(slopeRecent) / Math.max(Math.abs(slopePrev), 0.0001)));
  featureScores.momentumSlowdown = momentumSlowdownScore;
  if (momentumSlowdownScore > 0.62 && config.setupTypes.momentum_exhaustion) setupTypes.push('momentum_exhaustion');

  const rsi = computeRsi(closes, 14);
  const mfiProxy = volumes.length > 10 ? clamp01((average(volumes.slice(-3)) / Math.max(average(volumes.slice(-10, -3)), 1)) - 0.6) : 0.4;
  const stochRsiProxy = rsi == null ? 0.4 : clamp01(direction === 'long' ? (30 - rsi) / 30 : (rsi - 70) / 30);
  const exhaustionScore = clamp01((((rsi == null ? 0.35 : (direction === 'long' ? (35 - rsi) / 35 : (rsi - 65) / 35))) + mfiProxy + stochRsiProxy) / 3);
  featureScores.exhaustionOscillators = exhaustionScore;

  const priceChange = closes.length >= 6 ? closes[closes.length - 1] - closes[closes.length - 6] : 0;
  const oscChange = rsi == null ? 0 : rsi - computeRsi(closes.slice(0, closes.length - 3), 14);
  const divergenceScore = clamp01((direction === 'long')
    ? (priceChange < 0 && oscChange > 0 ? 0.9 : 0.2)
    : (priceChange > 0 && oscChange < 0 ? 0.9 : 0.2));
  featureScores.divergence = divergenceScore;
  if (divergenceScore > 0.62 && config.setupTypes.divergence_rebound) setupTypes.push('divergence_rebound');

  const volumeSpike = volumes.length > 0 ? average(volumes.slice(-2)) / Math.max(average(volumes.slice(-12, -2)), 1) : 1;
  const body = Math.abs(toNumber(latest.close, 0) - toNumber(latest.open, 0));
  const range = Math.max(toNumber(latest.high, 0) - toNumber(latest.low, 0), 0.000001);
  const absorptionHint = clamp01(1 - (body / range));
  const volumeAbsorptionScore = clamp01(((volumeSpike > 1.2 ? 0.55 : 0.25) + absorptionHint) / 1.5);
  featureScores.volumeAbsorption = volumeAbsorptionScore;
  if (volumeAbsorptionScore > 0.6 && config.setupTypes.volume_absorption_bounce) setupTypes.push('volume_absorption_bounce');

  let microstructureMode = 'skipped';
  let microstructureScore = 0.35;
  const ob = (input.sharedSnapshot || {}).orderBook || {};
  const budgetState = input.budgetState || 'normal';
  const cheapGateScore = clamp01((proximityScore + falseBreakoutScore + momentumSlowdownScore) / 3);
  const canRunMicro = config.microstructure.enabled
    && (!config.microstructure.requireStrongCandidate || cheapGateScore >= config.thresholds.microstructureActivationScore)
    && (!config.microstructure.skipWhenBudgetExceeded || budgetState !== 'exceeded');

  if (canRunMicro && ob && Number.isFinite(ob.bidVolume) && Number.isFinite(ob.askVolume)) {
    const imbalance = (ob.bidVolume - ob.askVolume) / Math.max(ob.bidVolume + ob.askVolume, 1);
    const spreadPercent = Number.isFinite(ob.spreadPercent)
      ? ob.spreadPercent
      : ((toNumber(ob.bestAsk, price) - toNumber(ob.bestBid, price)) / Math.max(price, 1)) * 100;
    microstructureScore = clamp01(
      ((direction === 'long' ? imbalance : -imbalance) > config.microstructure.minImbalance ? 0.7 : 0.25)
      + (spreadPercent <= config.microstructure.maxSpreadPercent ? 0.2 : 0)
    );
    microstructureMode = 'full';
  } else if (config.microstructure.enabled && budgetState === 'exceeded') {
    microstructureMode = 'degraded_budget';
    dataQualityState = 'degraded';
    reasonCodes.push('microstructure_skipped_by_budget');
  } else if (config.microstructure.enabled) {
    microstructureMode = 'degraded_missing_data';
    dataQualityState = 'degraded';
    reasonCodes.push('microstructure_missing_or_gate_not_passed');
  }
  featureScores.microstructure = microstructureScore;
  if (microstructureScore > 0.62 && config.setupTypes.microstructure_snapback) setupTypes.push('microstructure_snapback');

  const score = clamp01(
    (featureScores.proximity * config.weights.proximity)
    + (featureScores.swingContext * config.weights.swingContext)
    + (featureScores.falseBreakout * config.weights.falseBreakout)
    + (featureScores.momentumSlowdown * config.weights.momentumSlowdown)
    + (featureScores.exhaustionOscillators * config.weights.exhaustionOscillators)
    + (featureScores.divergence * config.weights.divergence)
    + (featureScores.volumeAbsorption * config.weights.volumeAbsorption)
    + (featureScores.microstructure * config.weights.microstructure)
  );
  const dataCoverage = [
    featureScores.proximity,
    featureScores.swingContext,
    featureScores.falseBreakout,
    featureScores.momentumSlowdown,
    featureScores.exhaustionOscillators,
    featureScores.divergence,
    featureScores.volumeAbsorption,
    featureScores.microstructure,
  ].filter((x) => Number.isFinite(x) && x > 0).length / 8;

  let confidence = clamp01((score * 0.7) + (dataCoverage * 0.3));
  let softPenalty = 0;
  if (dataCoverage < config.thresholds.minimumDataCoverage) {
    softPenalty = clamp01(softPenalty + 0.12);
    confidence = clamp01(confidence * 0.78);
    dataQualityState = 'degraded';
    reasonCodes.push('bounce_data_coverage_low');
  }

  const capitalPenalty = clamp01(toNumber(config.capitalRegimePenalties[capitalRegime], 0));
  if (capitalPenalty > 0) {
    softPenalty = clamp01(softPenalty + capitalPenalty);
    reasonCodes.push(`capital_regime_penalty_${String(capitalRegime).toLowerCase()}`);
  }

  if (score >= config.thresholds.scoreForSetupTag) {
    reasonCodes.push('bounce_candidate_detected');
  } else {
    reasonCodes.push('bounce_candidate_weak');
  }
  if (confidence < config.thresholds.minConfidence) reasonCodes.push('bounce_confidence_below_threshold');

  return createBounceLayerResult({
    direction,
    score,
    confidence,
    softPenalty,
    dataQualityState,
    reasonCodes,
    explanation: {
      marketRegime,
      capitalRegime,
      setupTypes: Array.from(new Set(setupTypes)),
      featureScores,
      microstructureMode,
      dataCoverage,
      dependencies: {
        marketRegimeRouter: 'required',
        capitalRegime: 'required',
        sharedSnapshot: 'required',
      },
      runtimePosition: 'after_market_context_before_final_entry_decision',
      fallbackPolicy: 'degraded_result_without_crash',
    },
  });
}

module.exports = {
  normalizeBounceDetectionConfig: normalizeBounceConfig,
  evaluateBounceDetection,
};
