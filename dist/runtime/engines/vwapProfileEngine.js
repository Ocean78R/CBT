'use strict';

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function normalizeDirection(side) {
  if (side === 'long') return 'long';
  if (side === 'short') return 'short';
  return 'none';
}

function createLayerResult(payload = {}) {
  return {
    layerName: 'volumeContextLayer',
    direction: payload.direction || 'none',
    score: clamp01(Number(payload.score ?? 0)),
    confidence: clamp01(Number(payload.confidence ?? 0)),
    softPenalty: clamp01(Number(payload.softPenalty ?? 0)),
    vetoCandidates: Array.isArray(payload.vetoCandidates) ? payload.vetoCandidates : [],
    dataQualityState: payload.dataQualityState || 'degraded',
    reasonCodes: Array.isArray(payload.reasonCodes) ? payload.reasonCodes : [],
    explanation: payload.explanation || {},
  };
}

function normalizeConfig(raw = {}) {
  const anchoredVwap = raw.anchoredVwap || {};
  const valueArea = raw.valueArea || {};
  const volumeProfile = raw.volumeProfile || {};
  const lazyEvaluation = raw.lazyEvaluation || {};
  const refreshPolicy = raw.refreshPolicy || {};
  const scoring = raw.scoring || {};

  return {
    enabled: !!raw.enabled,
    preferSharedFeatures: raw.preferSharedFeatures !== false,
    degradeOnMissingVolume: raw.degradeOnMissingVolume !== false,
    vwapWindowBars: Number(raw.vwapWindowBars ?? 80),
    anchoredVwap: {
      enabled: anchoredVwap.enabled !== false,
      lookbackBars: Number(anchoredVwap.lookbackBars ?? 120),
      swingWindow: Number(anchoredVwap.swingWindow ?? 3),
      fallbackToSessionAnchor: anchoredVwap.fallbackToSessionAnchor !== false,
    },
    valueArea: {
      enabled: valueArea.enabled !== false,
      valueAreaPercent: Number(valueArea.valueAreaPercent ?? 0.7),
    },
    volumeProfile: {
      enabled: volumeProfile.enabled !== false,
      bins: Number(volumeProfile.bins ?? 24),
      hvnPercentile: Number(volumeProfile.hvnPercentile ?? 0.82),
      lvnPercentile: Number(volumeProfile.lvnPercentile ?? 0.18),
    },
    lazyEvaluation: {
      enabled: lazyEvaluation.enabled !== false,
      requireShortlistCandidate: lazyEvaluation.requireShortlistCandidate !== false,
      requirePrimaryDirection: lazyEvaluation.requirePrimaryDirection !== false,
      minPrimaryScore: Number(lazyEvaluation.minPrimaryScore ?? 0.4),
      skipWhenBudgetExceeded: lazyEvaluation.skipWhenBudgetExceeded !== false,
    },
    refreshPolicy: {
      minBarsBetweenFullRecalc: Number(refreshPolicy.minBarsBetweenFullRecalc ?? 3),
      allowCachedReuse: refreshPolicy.allowCachedReuse !== false,
      forceFullRecalcEveryCycles: Number(refreshPolicy.forceFullRecalcEveryCycles ?? 0),
    },
    scoring: {
      vwapAlignmentWeight: Number(scoring.vwapAlignmentWeight ?? 0.32),
      anchoredVwapAlignmentWeight: Number(scoring.anchoredVwapAlignmentWeight ?? 0.22),
      valueAreaWeight: Number(scoring.valueAreaWeight ?? 0.24),
      hvnLvnReactionWeight: Number(scoring.hvnLvnReactionWeight ?? 0.22),
      distancePenaltyFactor: Number(scoring.distancePenaltyFactor ?? 1.15),
      degradedPenalty: Number(scoring.degradedPenalty ?? 0.12),
    },
  };
}

function resolveVolume(candle) {
  if (!candle || typeof candle !== 'object') return { volume: 0, synthetic: true };
  if (Number.isFinite(candle.volume) && candle.volume > 0) return { volume: Number(candle.volume), synthetic: false };
  const syntheticVolume = Math.max(Number(candle.high || 0) - Number(candle.low || 0), 0);
  return { volume: syntheticVolume, synthetic: true };
}

function typicalPrice(candle) {
  const high = Number(candle.high ?? candle.close ?? 0);
  const low = Number(candle.low ?? candle.close ?? 0);
  const close = Number(candle.close ?? 0);
  return (high + low + close) / 3;
}

function computeVwap(candles) {
  let pv = 0;
  let vv = 0;
  let syntheticCount = 0;
  candles.forEach((candle) => {
    const { volume, synthetic } = resolveVolume(candle);
    if (synthetic) syntheticCount += 1;
    pv += typicalPrice(candle) * volume;
    vv += volume;
  });
  return {
    vwap: vv > 0 ? pv / vv : 0,
    volumeSum: vv,
    syntheticShare: candles.length > 0 ? syntheticCount / candles.length : 1,
  };
}

function detectAnchorIndex(candles, direction, config) {
  const lookback = Math.max(2, Math.min(candles.length, config.anchoredVwap.lookbackBars));
  const start = candles.length - lookback;
  let bestIndex = start;

  if (direction === 'short') {
    let maxHigh = -Infinity;
    for (let i = start; i < candles.length; i += 1) {
      const high = Number(candles[i].high ?? candles[i].close ?? 0);
      if (high >= maxHigh) {
        maxHigh = high;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  if (direction === 'long') {
    let minLow = Infinity;
    for (let i = start; i < candles.length; i += 1) {
      const low = Number(candles[i].low ?? candles[i].close ?? 0);
      if (low <= minLow) {
        minLow = low;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  return config.anchoredVwap.fallbackToSessionAnchor ? start : candles.length - 1;
}

function computeVolumeProfile(candles, bins) {
  const highs = candles.map((x) => Number(x.high ?? x.close ?? 0));
  const lows = candles.map((x) => Number(x.low ?? x.close ?? 0));
  const minPrice = Math.min(...lows);
  const maxPrice = Math.max(...highs);
  const range = Math.max(maxPrice - minPrice, 1e-9);
  const bucketSize = range / bins;
  const buckets = Array.from({ length: bins }, (_, idx) => ({
    idx,
    lower: minPrice + idx * bucketSize,
    upper: minPrice + (idx + 1) * bucketSize,
    volume: 0,
  }));

  candles.forEach((candle) => {
    const close = Number(candle.close ?? 0);
    const { volume } = resolveVolume(candle);
    const bucketIdx = Math.max(0, Math.min(bins - 1, Math.floor((close - minPrice) / bucketSize)));
    buckets[bucketIdx].volume += volume;
  });

  const sortedByVolume = [...buckets].sort((a, b) => b.volume - a.volume);
  const totalVolume = buckets.reduce((acc, item) => acc + item.volume, 0);

  return {
    buckets,
    sortedByVolume,
    totalVolume,
    minPrice,
    maxPrice,
  };
}

function evaluateVwapProfileLayer(input = {}, rawConfig = {}) {
  const config = normalizeConfig(rawConfig);
  const context = input.context || {};
  const sharedSnapshot = input.sharedSnapshot || {};
  const featureStoreContext = input.featureStoreContext || {};
  const primarySignal = input.primarySignal || {};
  const direction = normalizeDirection(primarySignal.direction || primarySignal.side);
  const primaryScore = Number(primarySignal.score ?? 0);
  const cycleIndex = Number(context.cycleIndex ?? 0);

  if (!config.enabled) {
    return createLayerResult({
      direction,
      dataQualityState: 'fallback',
      reasonCodes: ['volume_context_disabled'],
      explanation: { mode: 'fallback', refreshMode: 'disabled' },
    });
  }

  if (config.lazyEvaluation.enabled) {
    if (config.lazyEvaluation.requireShortlistCandidate && input.shortlistCandidate === false) {
      return createLayerResult({
        direction,
        dataQualityState: 'cached',
        reasonCodes: ['lazy_skip_not_shortlist_candidate'],
        explanation: { mode: 'lazy_skip', refreshMode: 'lazy_skip' },
      });
    }
    if (config.lazyEvaluation.requirePrimaryDirection && direction === 'none') {
      return createLayerResult({
        direction,
        dataQualityState: 'cached',
        reasonCodes: ['lazy_skip_direction_none'],
        explanation: { mode: 'lazy_skip', refreshMode: 'lazy_skip' },
      });
    }
    if (primaryScore < config.lazyEvaluation.minPrimaryScore) {
      return createLayerResult({
        direction,
        dataQualityState: 'cached',
        reasonCodes: ['lazy_skip_low_primary_score'],
        explanation: { mode: 'lazy_skip', refreshMode: 'lazy_skip', primaryScore },
      });
    }
    if (config.lazyEvaluation.skipWhenBudgetExceeded && input.budgetState === 'exhausted') {
      return createLayerResult({
        direction,
        dataQualityState: 'degraded',
        reasonCodes: ['lazy_skip_budget_exhausted'],
        softPenalty: config.scoring.degradedPenalty,
        explanation: { mode: 'degraded', refreshMode: 'budget_skip' },
      });
    }
  }

  const candlesRaw = Array.isArray(sharedSnapshot.candles) ? sharedSnapshot.candles : [];
  const candles = candlesRaw.filter((c) => c && Number.isFinite(Number(c.close)));
  if (candles.length < 10) {
    return createLayerResult({
      direction,
      dataQualityState: 'degraded',
      softPenalty: config.scoring.degradedPenalty,
      reasonCodes: ['volume_context_insufficient_candles'],
      explanation: { mode: 'degraded', refreshMode: 'degraded', candlesCount: candles.length },
    });
  }

  const tickerKey = `${context.exchange || 'unknown'}:${context.ticker || 'unknown'}`;
  const cacheBucket = featureStoreContext.vwapProfileCache || {};
  const cacheEntry = cacheBucket[tickerKey] || null;
  const needForceRefresh = config.refreshPolicy.forceFullRecalcEveryCycles > 0
    && cycleIndex > 0
    && cycleIndex % config.refreshPolicy.forceFullRecalcEveryCycles === 0;
  const canUseCache = config.refreshPolicy.allowCachedReuse
    && cacheEntry
    && !needForceRefresh
    && Number.isFinite(cacheEntry.lastBarIndex)
    && (candles.length - cacheEntry.lastBarIndex) < config.refreshPolicy.minBarsBetweenFullRecalc;

  if (canUseCache) {
    return createLayerResult({
      ...cacheEntry.layerResult,
      reasonCodes: [...(cacheEntry.layerResult.reasonCodes || []), 'volume_context_cached_reuse'],
      explanation: {
        ...(cacheEntry.layerResult.explanation || {}),
        refreshMode: 'cached_mode',
      },
    });
  }

  const windowBars = Math.max(12, Math.min(candles.length, config.vwapWindowBars));
  const recentCandles = candles.slice(-windowBars);
  const baseVwap = computeVwap(recentCandles);
  const lastClose = Number(recentCandles[recentCandles.length - 1].close);
  const distanceToVwap = baseVwap.vwap > 0 ? (lastClose - baseVwap.vwap) / baseVwap.vwap : 0;

  const anchorIndex = detectAnchorIndex(candles, direction, config);
  const anchoredSlice = candles.slice(anchorIndex);
  const anchoredVwapData = computeVwap(anchoredSlice);
  const distanceToAnchoredVwap = anchoredVwapData.vwap > 0
    ? (lastClose - anchoredVwapData.vwap) / anchoredVwapData.vwap
    : 0;

  const profile = computeVolumeProfile(recentCandles, Math.max(8, config.volumeProfile.bins));
  const sortedByVolume = profile.sortedByVolume;
  const hvnIndex = Math.max(0, Math.min(sortedByVolume.length - 1, Math.floor(sortedByVolume.length * (1 - config.volumeProfile.hvnPercentile))));
  const lvnIndex = Math.max(0, Math.min(sortedByVolume.length - 1, Math.floor(sortedByVolume.length * (1 - config.volumeProfile.lvnPercentile))));
  const hvnBucket = sortedByVolume[hvnIndex] || sortedByVolume[0];
  const lvnBucket = sortedByVolume[sortedByVolume.length - 1 - lvnIndex] || sortedByVolume[sortedByVolume.length - 1];

  const sortedByPrice = [...profile.buckets].sort((a, b) => a.lower - b.lower);
  const poc = sortedByVolume[0] || sortedByPrice[Math.floor(sortedByPrice.length / 2)];
  const valueAreaTarget = profile.totalVolume * clamp01(config.valueArea.valueAreaPercent);
  let valueAreaVolume = poc.volume;
  let left = poc.idx - 1;
  let right = poc.idx + 1;
  let vaLow = poc.lower;
  let vaHigh = poc.upper;
  while (valueAreaVolume < valueAreaTarget && (left >= 0 || right < sortedByPrice.length)) {
    const leftBucket = left >= 0 ? sortedByPrice[left] : null;
    const rightBucket = right < sortedByPrice.length ? sortedByPrice[right] : null;
    const pickLeft = (leftBucket && (!rightBucket || leftBucket.volume >= rightBucket.volume));
    const bucket = pickLeft ? leftBucket : rightBucket;
    if (!bucket) break;
    valueAreaVolume += bucket.volume;
    vaLow = Math.min(vaLow, bucket.lower);
    vaHigh = Math.max(vaHigh, bucket.upper);
    if (pickLeft) left -= 1;
    else right += 1;
  }

  const inValueArea = lastClose >= vaLow && lastClose <= vaHigh;
  const nearHvn = lastClose >= hvnBucket.lower && lastClose <= hvnBucket.upper;
  const nearLvn = lastClose >= lvnBucket.lower && lastClose <= lvnBucket.upper;

  const reasonCodes = [];
  let directionalScore = 0.45;
  if (direction === 'long') {
    if (distanceToVwap >= 0) directionalScore += config.scoring.vwapAlignmentWeight;
    else reasonCodes.push('price_below_vwap_against_long');
    if (distanceToAnchoredVwap >= 0) directionalScore += config.scoring.anchoredVwapAlignmentWeight;
    else reasonCodes.push('price_below_anchored_vwap_against_long');
  } else if (direction === 'short') {
    if (distanceToVwap <= 0) directionalScore += config.scoring.vwapAlignmentWeight;
    else reasonCodes.push('price_above_vwap_against_short');
    if (distanceToAnchoredVwap <= 0) directionalScore += config.scoring.anchoredVwapAlignmentWeight;
    else reasonCodes.push('price_above_anchored_vwap_against_short');
  }

  if (inValueArea) directionalScore += config.scoring.valueAreaWeight;
  else reasonCodes.push('price_outside_value_area');

  if (nearHvn) {
    directionalScore += config.scoring.hvnLvnReactionWeight * 0.5;
    reasonCodes.push('price_at_hvn');
  }
  if (nearLvn) {
    directionalScore += config.scoring.hvnLvnReactionWeight;
    reasonCodes.push('price_at_lvn');
  }

  const absoluteDistancePenalty = Math.min(Math.abs(distanceToAnchoredVwap) * config.scoring.distancePenaltyFactor, 0.25);
  let confidence = clamp01(0.55 + (inValueArea ? 0.12 : 0) + (nearHvn ? 0.05 : 0) + (nearLvn ? 0.07 : 0) - absoluteDistancePenalty);
  let score = clamp01(directionalScore - absoluteDistancePenalty);
  let softPenalty = 0;
  let dataQualityState = 'full';

  if (config.degradeOnMissingVolume && baseVwap.syntheticShare > 0.5) {
    softPenalty = clamp01(softPenalty + config.scoring.degradedPenalty);
    confidence = clamp01(confidence - 0.14);
    dataQualityState = 'degraded';
    reasonCodes.push('synthetic_volume_majority');
  }
  if (reasonCodes.length === 0) reasonCodes.push('volume_context_aligned');

  const layerResult = createLayerResult({
    direction,
    score,
    confidence,
    softPenalty,
    dataQualityState,
    reasonCodes,
    explanation: {
      refreshMode: 'full_mode',
      vwap: baseVwap.vwap,
      anchoredVwap: anchoredVwapData.vwap,
      anchorIndex,
      valueAreaLow: vaLow,
      valueAreaHigh: vaHigh,
      hvn: { low: hvnBucket.lower, high: hvnBucket.upper },
      lvn: { low: lvnBucket.lower, high: lvnBucket.upper },
      pricePosition: {
        lastClose,
        distanceToVwap,
        distanceToAnchoredVwap,
        inValueArea,
        nearHvn,
        nearLvn,
      },
      inputs: {
        sharedSnapshot: ['candles'],
        derived: ['vwap', 'anchoredVwap', 'valueArea', 'hvn', 'lvn'],
      },
    },
  });

  if (featureStoreContext && typeof featureStoreContext === 'object') {
    featureStoreContext.vwapProfileCache = featureStoreContext.vwapProfileCache || {};
    featureStoreContext.vwapProfileCache[tickerKey] = {
      lastBarIndex: candles.length,
      layerResult,
    };
  }

  return layerResult;
}

module.exports = {
  normalizeVwapProfileConfig: normalizeConfig,
  evaluateVwapProfileLayer,
};
