'use strict';

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeHigherTimeframeBiasConfig(config = {}) {
  const penalties = config.alignmentPenalties || {};
  const trendWeights = config.trendWeights || {};
  const rangeWeights = config.rangeWeights || {};
  const confidence = config.confidence || {};
  const slowerRefresh = config.slowerRefresh || {};

  return {
    enabled: !!config.enabled,
    higherTimeframe: String(config.higherTimeframe || '4h'),
    lookbackBars: Number(config.lookbackBars || 120),
    swingWindow: Number(config.swingWindow || 2),
    minimumStructurePoints: Number(config.minimumStructurePoints || 4),
    breakOfStructureThresholdPercent: Number(config.breakOfStructureThresholdPercent || 0.12),
    shiftConfirmationBars: Number(config.shiftConfirmationBars || 2),
    trendWeights: {
      hhhl: Number(trendWeights.hhhl || 0.45),
      lhll: Number(trendWeights.lhll || 0.45),
      bos: Number(trendWeights.bos || 0.35),
      choch: Number(trendWeights.choch || 0.25),
    },
    rangeWeights: {
      premiumZoneUpper: Number(rangeWeights.premiumZoneUpper || 0.7),
      discountZoneLower: Number(rangeWeights.discountZoneLower || 0.3),
      neutralBandLow: Number(rangeWeights.neutralBandLow || 0.4),
      neutralBandHigh: Number(rangeWeights.neutralBandHigh || 0.6),
    },
    confidence: {
      min: Number(confidence.min || 0.2),
      max: Number(confidence.max || 0.95),
      degradeOnLimitedData: Number(confidence.degradeOnLimitedData || 0.65),
      degradeOnCachedData: Number(confidence.degradeOnCachedData || 0.8),
    },
    alignmentPenalties: {
      counterTrendSoftPenalty: Number(penalties.counterTrendSoftPenalty || 0.22),
      weakAlignmentPenalty: Number(penalties.weakAlignmentPenalty || 0.1),
      strongAlignmentBoost: Number(penalties.strongAlignmentBoost || 0.08),
    },
    slowerRefresh: {
      enabled: slowerRefresh.enabled !== false,
      minBarsBetweenRefresh: Number(slowerRefresh.minBarsBetweenRefresh || 1),
      forceRefreshEveryCycles: Number(slowerRefresh.forceRefreshEveryCycles || 0),
      useFeatureStoreCache: slowerRefresh.useFeatureStoreCache !== false,
    },
  };
}

function extractClose(candle) {
  if (candle && Number.isFinite(Number(candle.close))) return Number(candle.close);
  if (Array.isArray(candle) && Number.isFinite(Number(candle[4]))) return Number(candle[4]);
  return NaN;
}

function extractHigh(candle) {
  if (candle && Number.isFinite(Number(candle.high))) return Number(candle.high);
  if (Array.isArray(candle) && Number.isFinite(Number(candle[2]))) return Number(candle[2]);
  return NaN;
}

function extractLow(candle) {
  if (candle && Number.isFinite(Number(candle.low))) return Number(candle.low);
  if (Array.isArray(candle) && Number.isFinite(Number(candle[3]))) return Number(candle[3]);
  return NaN;
}

function extractTimestamp(candle) {
  if (candle && Number.isFinite(Number(candle.timestamp))) return Number(candle.timestamp);
  if (Array.isArray(candle) && Number.isFinite(Number(candle[0]))) return Number(candle[0]);
  return null;
}

function detectPivots(candles, swingWindow) {
  const highs = [];
  const lows = [];
  const window = Math.max(1, swingWindow);
  for (let i = window; i < candles.length - window; i += 1) {
    const c = candles[i];
    const ch = extractHigh(c);
    const cl = extractLow(c);
    if (!Number.isFinite(ch) || !Number.isFinite(cl)) continue;

    let isHigh = true;
    let isLow = true;
    for (let j = i - window; j <= i + window; j += 1) {
      if (j === i) continue;
      const h = extractHigh(candles[j]);
      const l = extractLow(candles[j]);
      if (Number.isFinite(h) && h >= ch) isHigh = false;
      if (Number.isFinite(l) && l <= cl) isLow = false;
      if (!isHigh && !isLow) break;
    }

    if (isHigh) highs.push({ index: i, value: ch, timestamp: extractTimestamp(c) });
    if (isLow) lows.push({ index: i, value: cl, timestamp: extractTimestamp(c) });
  }
  return { highs, lows };
}

function classifySwingProgression(values, bullishLabel, bearishLabel) {
  if (values.length < 2) return 'insufficient';
  let rising = 0;
  let falling = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] > values[i - 1]) rising += 1;
    if (values[i] < values[i - 1]) falling += 1;
  }
  if (rising > 0 && falling === 0) return bullishLabel;
  if (falling > 0 && rising === 0) return bearishLabel;
  return 'mixed';
}

function calculateRangePosition(latestClose, highs, lows) {
  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  if (!Number.isFinite(maxHigh) || !Number.isFinite(minLow) || maxHigh <= minLow) {
    return { position: null, zone: 'unknown', rangeHigh: maxHigh, rangeLow: minLow };
  }
  const position = (latestClose - minLow) / (maxHigh - minLow);
  return {
    position: clamp(position, 0, 1),
    zone: 'computed',
    rangeHigh: maxHigh,
    rangeLow: minLow,
  };
}

function buildDefaultDecision(reasonCode, dataQualityState) {
  return {
    layerName: 'higherTimeframeBiasEngine',
    direction: 'neutral',
    score: 0,
    confidence: 0,
    softPenalty: 0,
    vetoCandidates: [],
    dataQualityState,
    reasonCodes: [reasonCode],
    explanation: 'Слой HTF-bias вернул нейтральный контекст из-за ограниченных входных данных.',
    htfBias: 'neutral',
    marketStructureState: 'unknown',
    structureConfidence: 0,
    trendAlignmentScore: 0,
    mode: dataQualityState === 'cached' ? 'cached_mode' : 'degraded_mode',
    telemetry: {
      structureSignals: {
        hhhlState: 'insufficient',
        lhllState: 'insufficient',
        breakOfStructure: 'unknown',
        changeOfCharacter: 'unknown',
        htfTrendDirection: 'unknown',
        priceLocationWithinRange: 'unknown',
      },
      dependencies: {
        requiresMarketRegimeRouterOutput: true,
        requiresCapitalRegimeContext: true,
        fallbackPolicy: 'neutral_context_without_veto',
      },
    },
  };
}

function evaluateHigherTimeframeBias(input = {}, rawConfig = {}) {
  const config = normalizeHigherTimeframeBiasConfig(rawConfig);
  const context = input.context || {};
  const sharedSnapshot = input.sharedSnapshot || {};
  const htfCandles = Array.isArray(sharedSnapshot.htfCandles) ? sharedSnapshot.htfCandles : [];
  const localDirection = input.localDirection || context.localDirection || 'neutral';

  if (!config.enabled) {
    const disabled = buildDefaultDecision('feature_disabled', 'degraded');
    disabled.explanation = 'Слой HTF-bias отключён конфигом и не влияет на вход.';
    return { ...disabled, mode: 'degraded_mode' };
  }

  if (htfCandles.length < config.minimumStructurePoints) {
    return buildDefaultDecision('not_enough_htf_candles', 'degraded');
  }

  const pivots = detectPivots(htfCandles.slice(-config.lookbackBars), config.swingWindow);
  const recentHighs = pivots.highs.slice(-4).map((x) => x.value);
  const recentLows = pivots.lows.slice(-4).map((x) => x.value);

  if (recentHighs.length < 2 || recentLows.length < 2) {
    return buildDefaultDecision('not_enough_structure_pivots', 'degraded');
  }

  const hhhlState = classifySwingProgression(recentHighs, 'hh', 'lh');
  const lhllState = classifySwingProgression(recentLows, 'hl', 'll');

  const latestClose = extractClose(htfCandles[htfCandles.length - 1]);
  const previousClose = extractClose(htfCandles[htfCandles.length - 2]);
  const recentHigh = recentHighs[recentHighs.length - 1];
  const previousHigh = recentHighs[recentHighs.length - 2];
  const recentLow = recentLows[recentLows.length - 1];
  const previousLow = recentLows[recentLows.length - 2];

  const bosUp = Number.isFinite(latestClose) && Number.isFinite(previousHigh)
    ? latestClose > previousHigh * (1 + (config.breakOfStructureThresholdPercent / 100))
    : false;
  const bosDown = Number.isFinite(latestClose) && Number.isFinite(previousLow)
    ? latestClose < previousLow * (1 - (config.breakOfStructureThresholdPercent / 100))
    : false;
  const changeOfCharacter = (hhhlState === 'lh' && lhllState === 'll' && bosDown)
    || (hhhlState === 'hh' && lhllState === 'hl' && bosUp)
    ? 'confirmed'
    : 'none';

  let htfTrendDirection = 'sideways';
  if (hhhlState === 'hh' && lhllState === 'hl') htfTrendDirection = 'bullish';
  if (hhhlState === 'lh' && lhllState === 'll') htfTrendDirection = 'bearish';

  const rangeMeta = calculateRangePosition(
    latestClose,
    htfCandles.map(extractHigh).filter((x) => Number.isFinite(x)).slice(-config.lookbackBars),
    htfCandles.map(extractLow).filter((x) => Number.isFinite(x)).slice(-config.lookbackBars),
  );

  let priceLocationWithinRange = 'middle';
  if (Number.isFinite(rangeMeta.position) && rangeMeta.position >= config.rangeWeights.premiumZoneUpper) priceLocationWithinRange = 'premium';
  if (Number.isFinite(rangeMeta.position) && rangeMeta.position <= config.rangeWeights.discountZoneLower) priceLocationWithinRange = 'discount';

  let trendScore = 0;
  if (hhhlState === 'hh' && lhllState === 'hl') trendScore += config.trendWeights.hhhl;
  if (hhhlState === 'lh' && lhllState === 'll') trendScore -= config.trendWeights.lhll;
  if (bosUp) trendScore += config.trendWeights.bos;
  if (bosDown) trendScore -= config.trendWeights.bos;
  if (changeOfCharacter === 'confirmed' && bosUp) trendScore += config.trendWeights.choch;
  if (changeOfCharacter === 'confirmed' && bosDown) trendScore -= config.trendWeights.choch;

  if (priceLocationWithinRange === 'discount' && trendScore > 0) trendScore += 0.1;
  if (priceLocationWithinRange === 'premium' && trendScore < 0) trendScore -= 0.1;

  const trendAlignmentScore = clamp(trendScore, -1, 1);
  let htfBias = 'neutral';
  if (trendAlignmentScore >= 0.25) htfBias = 'bullish';
  if (trendAlignmentScore <= -0.25) htfBias = 'bearish';

  let marketStructureState = 'range';
  if (bosUp || bosDown) marketStructureState = 'break_of_structure';
  if (changeOfCharacter === 'confirmed') marketStructureState = 'shift_of_structure';
  if (htfTrendDirection === 'bullish' || htfTrendDirection === 'bearish') marketStructureState = 'trend_structure';

  const structureDepth = (recentHighs.length + recentLows.length) / 8;
  let structureConfidence = clamp(0.35 + Math.abs(trendAlignmentScore) * 0.5 + structureDepth * 0.15, config.confidence.min, config.confidence.max);

  const localDirNormalized = String(localDirection).toLowerCase();
  const isLocalLong = localDirNormalized === 'long' || localDirNormalized === 'buy' || localDirNormalized === 'bullish';
  const isLocalShort = localDirNormalized === 'short' || localDirNormalized === 'sell' || localDirNormalized === 'bearish';

  let softPenalty = 0;
  let score = Math.abs(trendAlignmentScore);
  const reasonCodes = ['htf_context_evaluated'];

  if ((isLocalLong && htfBias === 'bearish') || (isLocalShort && htfBias === 'bullish')) {
    softPenalty = config.alignmentPenalties.counterTrendSoftPenalty;
    reasonCodes.push('counter_trend_against_htf_bias');
  } else if (htfBias === 'neutral') {
    softPenalty = config.alignmentPenalties.weakAlignmentPenalty;
    reasonCodes.push('neutral_htf_bias_penalty');
  } else if ((isLocalLong && htfBias === 'bullish') || (isLocalShort && htfBias === 'bearish')) {
    score = clamp(score + config.alignmentPenalties.strongAlignmentBoost, 0, 1);
    reasonCodes.push('aligned_with_htf_bias');
  }

  if (!Number.isFinite(previousClose)) {
    structureConfidence *= config.confidence.degradeOnLimitedData;
    reasonCodes.push('limited_reference_close_data');
  }

  return {
    layerName: 'higherTimeframeBiasEngine',
    direction: htfBias,
    score: clamp(score, 0, 1),
    confidence: clamp(structureConfidence, 0, 1),
    softPenalty: clamp(softPenalty, 0, 1),
    vetoCandidates: [],
    dataQualityState: 'full',
    reasonCodes,
    explanation: 'Слой HTF-bias добавляет старший структурный контекст до финального решения входа и не может единолично разрешить сделку.',
    htfBias,
    marketStructureState,
    structureConfidence: clamp(structureConfidence, 0, 1),
    trendAlignmentScore,
    mode: 'full_mode',
    telemetry: {
      structureSignals: {
        hhhlState,
        lhllState,
        breakOfStructure: bosUp ? 'bullish_bos' : (bosDown ? 'bearish_bos' : 'none'),
        changeOfCharacter,
        htfTrendDirection,
        priceLocationWithinRange,
        rangePosition: Number.isFinite(rangeMeta.position) ? Number(rangeMeta.position.toFixed(4)) : null,
        rangeHigh: Number.isFinite(rangeMeta.rangeHigh) ? rangeMeta.rangeHigh : null,
        rangeLow: Number.isFinite(rangeMeta.rangeLow) ? rangeMeta.rangeLow : null,
        latestClose: Number.isFinite(latestClose) ? latestClose : null,
      },
      dependencies: {
        requiresMarketRegimeRouterOutput: true,
        requiresCapitalRegimeContext: true,
        fallbackPolicy: 'neutral_context_without_veto',
      },
      sharedSnapshotUsage: {
        usedInput: ['sharedSnapshot.htfCandles', 'sharedSnapshot.latestPrice'],
        calculatedLocally: ['pivots', 'structureProgression', 'trendAlignmentScore'],
        reusableOutput: ['htfBias', 'marketStructureState', 'structureConfidence', 'trendAlignmentScore'],
      },
    },
  };
}

function computeHtfCacheKey(input = {}, config = {}) {
  const context = input.context || {};
  const ticker = context.ticker || input.ticker || 'unknown';
  const exchange = context.exchange || input.exchange || 'unknown';
  const timeframe = config.higherTimeframe || '4h';
  return `htf_bias::${exchange}::${ticker}::${timeframe}`;
}

function evaluateHigherTimeframeBiasWithCache(input = {}, rawConfig = {}, runtime = {}) {
  const config = normalizeHigherTimeframeBiasConfig(rawConfig);
  const featureStore = runtime.featureStore;
  const cycleId = runtime.cycleId || (input.context ? input.context.cycleId : '') || '';
  const cycleNumber = Number(runtime.cycleNumber || 0);
  const latestBarTs = Number(runtime.latestHtfBarTimestamp || 0);

  if (!config.enabled) {
    const disabled = evaluateHigherTimeframeBias(input, config);
    return { ...disabled, mode: 'degraded_mode' };
  }

  const key = computeHtfCacheKey(input, config);
  const cacheMap = featureStore && featureStore.slowerRefreshContextCache instanceof Map
    ? featureStore.slowerRefreshContextCache
    : null;

  const cached = cacheMap ? cacheMap.get(key) : null;
  const mustRefreshByCycle = config.slowerRefresh.forceRefreshEveryCycles > 0
    && cycleNumber > 0
    && cached
    && Number.isFinite(cached.cycleNumber)
    && (cycleNumber - cached.cycleNumber) >= config.slowerRefresh.forceRefreshEveryCycles;
  const barNotChanged = cached && latestBarTs > 0 && Number(cached.latestBarTs || 0) === latestBarTs;

  if (config.slowerRefresh.enabled && cached && barNotChanged && !mustRefreshByCycle) {
    const cachedDecision = {
      ...cached.decision,
      dataQualityState: 'cached',
      confidence: clamp((cached.decision.confidence || 0) * config.confidence.degradeOnCachedData, 0, 1),
      structureConfidence: clamp((cached.decision.structureConfidence || 0) * config.confidence.degradeOnCachedData, 0, 1),
      reasonCodes: [...new Set([...(cached.decision.reasonCodes || []), 'cached_htf_structure_reuse'])],
      mode: 'cached_mode',
    };
    return cachedDecision;
  }

  const decision = evaluateHigherTimeframeBias(input, config);
  if (cacheMap && config.slowerRefresh.useFeatureStoreCache) {
    cacheMap.set(key, {
      decision,
      latestBarTs,
      cycleNumber,
      cycleId,
      updatedAt: Date.now(),
    });
  }

  return decision;
}

function applyHtfBiasToEntryDecision(input = {}, biasDecision = {}, rawConfig = {}) {
  const config = normalizeHigherTimeframeBiasConfig(rawConfig);
  const entryDecision = input.entryDecision || {};
  const next = {
    ...entryDecision,
    penalties: Array.isArray(entryDecision.penalties) ? [...entryDecision.penalties] : [],
    metadata: entryDecision.metadata ? { ...entryDecision.metadata } : {},
  };

  next.metadata.higherTimeframeBias = {
    htfBias: biasDecision.htfBias || 'neutral',
    marketStructureState: biasDecision.marketStructureState || 'unknown',
    structureConfidence: Number.isFinite(biasDecision.structureConfidence) ? biasDecision.structureConfidence : 0,
    trendAlignmentScore: Number.isFinite(biasDecision.trendAlignmentScore) ? biasDecision.trendAlignmentScore : 0,
    dataQualityState: biasDecision.dataQualityState || 'degraded',
    reasonCodes: Array.isArray(biasDecision.reasonCodes) ? biasDecision.reasonCodes : [],
  };

  if (!config.enabled) {
    return next;
  }

  if (Number.isFinite(biasDecision.softPenalty) && biasDecision.softPenalty > 0) {
    next.penalties.push({
      type: 'htf_bias_penalty',
      value: biasDecision.softPenalty,
      reason: (biasDecision.reasonCodes || []).join(','),
    });
    next.score = clamp(Number(next.score || 0) - biasDecision.softPenalty, 0, 1);
  }

  if (Number.isFinite(biasDecision.score) && biasDecision.score > 0 && (biasDecision.reasonCodes || []).includes('aligned_with_htf_bias')) {
    next.score = clamp(Number(next.score || 0) + config.alignmentPenalties.strongAlignmentBoost, 0, 1);
  }

  return next;
}

function toHigherTimeframeBiasEvent(input = {}) {
  const context = input.context || {};
  const decision = input.decision || {};

  return {
    eventType: 'higher_timeframe_bias_decision',
    cycleId: context.cycleId || '',
    ticker: context.ticker || 'n/a',
    exchange: context.exchange || 'n/a',
    mode: context.mode || 'live',
    module: 'higherTimeframeBiasEngine',
    layer: 'signal.htfStructure',
    marketRegime: context.marketRegime || 'unknown',
    capitalRegime: context.capitalRegime || 'NORMAL',
    forecastRegimeShiftRisk: context.forecastRegimeShiftRisk || null,
    setupType: context.setupType || 'unknown_setup',
    score: Number.isFinite(decision.score) ? decision.score : 0,
    confidence: Number.isFinite(decision.confidence) ? decision.confidence : 0,
    vetoReason: null,
    sizingDecision: context.sizingDecision || 'not_evaluated',
    executionAction: 'context_only',
    fallbackAction: decision.mode === 'degraded_mode' ? 'legacy_entry_flow' : 'none',
    finalDecision: decision.htfBias || 'neutral',
    payload: {
      layerName: decision.layerName || 'higherTimeframeBiasEngine',
      htfBias: decision.htfBias || 'neutral',
      marketStructureState: decision.marketStructureState || 'unknown',
      structureConfidence: Number.isFinite(decision.structureConfidence) ? decision.structureConfidence : 0,
      trendAlignmentScore: Number.isFinite(decision.trendAlignmentScore) ? decision.trendAlignmentScore : 0,
      dataQualityState: decision.dataQualityState || 'degraded',
      reasonCodes: Array.isArray(decision.reasonCodes) ? decision.reasonCodes : [],
      telemetry: decision.telemetry || {},
    },
  };
}

module.exports = {
  normalizeHigherTimeframeBiasConfig,
  evaluateHigherTimeframeBias,
  evaluateHigherTimeframeBiasWithCache,
  applyHtfBiasToEntryDecision,
  toHigherTimeframeBiasEvent,
};
