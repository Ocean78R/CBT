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

function avg(values = []) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sum = values.reduce((acc, x) => acc + (Number.isFinite(x) ? x : 0), 0);
  return sum / values.length;
}

function safeLast(array) {
  if (!Array.isArray(array) || array.length === 0) return null;
  return array[array.length - 1];
}

function extractCandles(sharedSnapshot = {}) {
  return Array.isArray(sharedSnapshot.candles) ? sharedSnapshot.candles : [];
}

function calcRsi(closes = [], period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i += 1) {
    const prev = closes[i - 1];
    const cur = closes[i];
    const diff = cur - prev;
    if (diff > 0) gains += diff;
    if (diff < 0) losses += Math.abs(diff);
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function calcStochRsi(closes = [], cfg = {}) {
  const period = Number(cfg.period || 14);
  const lookback = Number(cfg.lookback || 14);
  if (closes.length < period + lookback + 2) return null;
  const rsiSeries = [];
  for (let i = period + 1; i < closes.length; i += 1) {
    const segment = closes.slice(0, i + 1);
    const rsi = calcRsi(segment, period);
    if (Number.isFinite(rsi)) rsiSeries.push(rsi);
  }
  if (rsiSeries.length < lookback) return null;
  const window = rsiSeries.slice(-lookback);
  const minRsi = Math.min(...window);
  const maxRsi = Math.max(...window);
  const current = safeLast(window);
  if (!Number.isFinite(current) || maxRsi === minRsi) return 0.5;
  return (current - minRsi) / (maxRsi - minRsi);
}

function calcMfi(candles = [], period = 14) {
  if (candles.length < period + 1) return null;
  let positive = 0;
  let negative = 0;
  for (let i = candles.length - period; i < candles.length; i += 1) {
    const prev = candles[i - 1] || {};
    const cur = candles[i] || {};
    const tpPrev = ((prev.high || 0) + (prev.low || 0) + (prev.close || 0)) / 3;
    const tpCur = ((cur.high || 0) + (cur.low || 0) + (cur.close || 0)) / 3;
    const flow = tpCur * Number(cur.volume || 0);
    if (tpCur > tpPrev) positive += flow;
    if (tpCur < tpPrev) negative += flow;
  }
  if (negative === 0) return 100;
  const ratio = positive / negative;
  return 100 - (100 / (1 + ratio));
}

function calcCci(candles = [], period = 20) {
  if (candles.length < period) return null;
  const segment = candles.slice(-period);
  const tps = segment.map((x) => ((x.high || 0) + (x.low || 0) + (x.close || 0)) / 3);
  const sma = avg(tps);
  const meanDeviation = avg(tps.map((x) => Math.abs(x - sma)));
  if (meanDeviation === 0) return 0;
  const currentTp = safeLast(tps);
  return (currentTp - sma) / (0.015 * meanDeviation);
}

function detectBasicDivergence(candles = [], direction = 'none', lookback = 8) {
  if (!Array.isArray(candles) || candles.length < lookback + 2 || direction === 'none') {
    return { value: 0, detected: false, reason: 'not_enough_data' };
  }
  const closes = candles.map((c) => Number(c.close || 0));
  const recent = closes.slice(-lookback);
  const older = closes.slice(-lookback * 2, -lookback);
  if (recent.length < lookback || older.length < lookback) {
    return { value: 0, detected: false, reason: 'not_enough_data' };
  }

  const recentSlope = safeLast(recent) - recent[0];
  const olderSlope = safeLast(older) - older[0];
  const rsiRecent = calcRsi(closes.slice(0, closes.length), Math.max(6, Math.floor(lookback / 2)));
  const rsiOlder = calcRsi(closes.slice(0, closes.length - lookback), Math.max(6, Math.floor(lookback / 2)));

  if (!Number.isFinite(rsiRecent) || !Number.isFinite(rsiOlder)) {
    return { value: 0, detected: false, reason: 'rsi_unavailable' };
  }

  if (direction === 'long') {
    const bullishDivergence = recentSlope < 0 && (rsiRecent - rsiOlder) > 3;
    return {
      value: bullishDivergence ? 1 : 0,
      detected: bullishDivergence,
      reason: bullishDivergence ? 'bullish_divergence' : 'no_bullish_divergence',
    };
  }

  const bearishDivergence = recentSlope > 0 && (rsiOlder - rsiRecent) > 3;
  return {
    value: bearishDivergence ? 1 : 0,
    detected: bearishDivergence,
    reason: bearishDivergence ? 'bearish_divergence' : 'no_bearish_divergence',
  };
}

function evaluateTechnicalConfirmations(input = {}, config = {}) {
  const sharedSnapshot = input.sharedSnapshot || {};
  const candles = extractCandles(sharedSnapshot);
  const direction = normalizeDirection(input.direction);
  const reasons = [];
  const missing = [];
  const signals = [];

  if (direction === 'none') {
    return {
      layerName: 'technicalConfirmationEngine',
      direction,
      score: 0,
      confidence: 0,
      softPenalty: 0.15,
      dataQualityState: 'degraded',
      reasonCodes: ['technical_direction_none'],
      explanation: { signals, missingData: ['direction'] },
    };
  }

  if (candles.length < Number(config.minCandles || 30)) {
    return {
      layerName: 'technicalConfirmationEngine',
      direction,
      score: 0.2,
      confidence: 0.2,
      softPenalty: 0.12,
      dataQualityState: 'degraded',
      reasonCodes: ['technical_not_enough_candles'],
      explanation: { signals, missingData: ['candles'] },
    };
  }

  const closes = candles.map((c) => Number(c.close || 0));
  const volumes = candles.map((c) => Number(c.volume || 0));
  const currentVolume = safeLast(volumes);
  const volumeAvg = avg(volumes.slice(-Number(config.volumeAveragePeriod || 20)));

  if (Number.isFinite(currentVolume) && Number.isFinite(volumeAvg) && volumeAvg > 0) {
    const ratio = currentVolume / volumeAvg;
    const spikeApproved = ratio >= Number(config.volumeSpikeThreshold || 1.6);
    const confirmationApproved = ratio >= Number(config.volumeConfirmationThreshold || 1.1);
    signals.push({
      name: 'volume_confirmation',
      approved: spikeApproved || confirmationApproved,
      ratio,
      mode: spikeApproved ? 'spike' : (confirmationApproved ? 'vs_average' : 'none'),
      weight: Number((config.weights || {}).volume || 0.2),
    });
    reasons.push(`technical_volume_ratio_${ratio.toFixed(3)}`);
  } else {
    missing.push('volume');
  }

  const rsi = calcRsi(closes, Number((config.rsi || {}).period || 14));
  if (Number.isFinite(rsi)) {
    const rsiCfg = config.rsi || {};
    const approved = direction === 'long'
      ? rsi >= Number(rsiCfg.longMin || 45) && rsi <= Number(rsiCfg.longMax || 78)
      : rsi <= Number(rsiCfg.shortMax || 55) && rsi >= Number(rsiCfg.shortMin || 22);
    signals.push({ name: 'rsi_confirmation', approved, value: rsi, weight: Number((config.weights || {}).rsi || 0.14) });
  } else {
    missing.push('rsi');
  }

  const stochRsi = calcStochRsi(closes, config.stochasticRsi || {});
  if (Number.isFinite(stochRsi)) {
    const stochCfg = config.stochasticRsi || {};
    const approved = direction === 'long'
      ? stochRsi >= Number(stochCfg.longMin || 0.2) && stochRsi <= Number(stochCfg.longMax || 0.95)
      : stochRsi <= Number(stochCfg.shortMax || 0.8) && stochRsi >= Number(stochCfg.shortMin || 0.05);
    signals.push({ name: 'stochastic_rsi_confirmation', approved, value: stochRsi, weight: Number((config.weights || {}).stochasticRsi || 0.12) });
  } else {
    missing.push('stochastic_rsi');
  }

  const mfi = calcMfi(candles, Number((config.mfi || {}).period || 14));
  if (Number.isFinite(mfi)) {
    const mfiCfg = config.mfi || {};
    const approved = direction === 'long'
      ? mfi >= Number(mfiCfg.longMin || 45) && mfi <= Number(mfiCfg.longMax || 85)
      : mfi <= Number(mfiCfg.shortMax || 55) && mfi >= Number(mfiCfg.shortMin || 15);
    signals.push({ name: 'mfi_confirmation', approved, value: mfi, weight: Number((config.weights || {}).mfi || 0.12) });
  } else {
    missing.push('mfi');
  }

  const cci = calcCci(candles, Number((config.cci || {}).period || 20));
  if (Number.isFinite(cci)) {
    const cciCfg = config.cci || {};
    const approved = direction === 'long'
      ? cci >= Number(cciCfg.longMin || -80) && cci <= Number(cciCfg.longMax || 220)
      : cci <= Number(cciCfg.shortMax || 80) && cci >= Number(cciCfg.shortMin || -220);
    signals.push({ name: 'cci_confirmation', approved, value: cci, weight: Number((config.weights || {}).cci || 0.12) });
  } else {
    missing.push('cci');
  }

  const divergence = detectBasicDivergence(candles, direction, Number((config.divergence || {}).lookback || 8));
  signals.push({
    name: 'basic_divergence',
    approved: divergence.detected,
    value: divergence.value,
    reason: divergence.reason,
    weight: Number((config.weights || {}).divergence || 0.12),
  });

  const totalWeight = signals.reduce((acc, x) => acc + Number(x.weight || 0), 0) || 1;
  const approvedWeight = signals.reduce((acc, x) => acc + (x.approved ? Number(x.weight || 0) : 0), 0);
  const rejectedWeight = Math.max(totalWeight - approvedWeight, 0);

  return {
    layerName: 'technicalConfirmationEngine',
    direction,
    score: clamp01(approvedWeight / totalWeight),
    confidence: clamp01(0.42 + (signals.length > 0 ? 0.4 * (approvedWeight / totalWeight) : 0)),
    softPenalty: clamp01(0.18 * (rejectedWeight / totalWeight)),
    dataQualityState: missing.length > 0 ? (signals.length > 0 ? 'degraded' : 'missing') : 'full',
    reasonCodes: reasons.concat(signals.map((x) => `${x.name}:${x.approved ? 'approved' : 'rejected'}`)),
    explanation: {
      mode: missing.length > 0 ? 'degraded_mode' : 'full_mode',
      signals,
      missingData: missing,
      calculated: {
        volumeCurrent: currentVolume,
        volumeAverage: volumeAvg,
        rsi,
        stochRsi,
        mfi,
        cci,
        divergence: divergence.reason,
      },
      reusableFeatures: ['rsi', 'stochRsi', 'mfi', 'cci', 'divergence'],
    },
  };
}

function evaluateMicrostructureConfirmations(input = {}, config = {}) {
  const sharedSnapshot = input.sharedSnapshot || {};
  const direction = normalizeDirection(input.direction);
  const orderBook = sharedSnapshot.orderBook || sharedSnapshot.book || null;
  const reasons = [];
  const missing = [];

  if (direction === 'none') {
    return {
      layerName: 'microstructureConfirmationEngine',
      direction,
      score: 0,
      confidence: 0,
      softPenalty: 0.1,
      dataQualityState: 'degraded',
      reasonCodes: ['micro_direction_none'],
      explanation: { mode: 'degraded_mode', missingData: ['direction'], signals: [] },
    };
  }

  if (!orderBook || !Array.isArray(orderBook.bids) || !Array.isArray(orderBook.asks) || orderBook.bids.length === 0 || orderBook.asks.length === 0) {
    return {
      layerName: 'microstructureConfirmationEngine',
      direction,
      score: 0.35,
      confidence: 0.25,
      softPenalty: Number(config.softPenaltyOnMissingData || 0.06),
      dataQualityState: 'missing',
      reasonCodes: ['micro_order_book_unavailable'],
      explanation: {
        mode: 'degraded_mode',
        missingData: ['orderBook'],
        signals: [],
      },
    };
  }

  const depth = Number(config.depthLevels || 8);
  const bids = orderBook.bids.slice(0, depth);
  const asks = orderBook.asks.slice(0, depth);
  const bestBid = Number((bids[0] || {}).price || bids[0][0] || 0);
  const bestAsk = Number((asks[0] || {}).price || asks[0][0] || 0);
  const mid = (bestBid + bestAsk) / 2;
  const spreadPct = mid > 0 ? ((bestAsk - bestBid) / mid) * 100 : null;

  const bidVol = bids.reduce((acc, x) => acc + Number(x.size || x.qty || x[1] || 0), 0);
  const askVol = asks.reduce((acc, x) => acc + Number(x.size || x.qty || x[1] || 0), 0);
  const imbalance = (bidVol + askVol) > 0 ? (bidVol - askVol) / (bidVol + askVol) : 0;

  const maxBid = bids.reduce((acc, x) => Math.max(acc, Number(x.size || x.qty || x[1] || 0)), 0);
  const maxAsk = asks.reduce((acc, x) => Math.max(acc, Number(x.size || x.qty || x[1] || 0)), 0);
  const avgBid = bidVol / Math.max(bids.length, 1);
  const avgAsk = askVol / Math.max(asks.length, 1);
  const wallBid = avgBid > 0 ? maxBid / avgBid : 0;
  const wallAsk = avgAsk > 0 ? maxAsk / avgAsk : 0;

  const signals = [];
  const imbalanceApproved = direction === 'long'
    ? imbalance >= Number((config.imbalance || {}).longMin || 0.05)
    : imbalance <= Number((config.imbalance || {}).shortMax || -0.05);
  signals.push({
    name: 'order_book_imbalance',
    approved: imbalanceApproved,
    value: imbalance,
    weight: Number((config.weights || {}).imbalance || 0.36),
  });

  const spreadApproved = Number.isFinite(spreadPct) && spreadPct <= Number((config.spread || {}).maxPercent || 0.12);
  signals.push({
    name: 'spread_quality',
    approved: spreadApproved,
    value: spreadPct,
    weight: Number((config.weights || {}).spread || 0.28),
  });

  const wallThreshold = Number((config.liquidityWall || {}).minWallRatio || 2.2);
  const pressureApproved = direction === 'long'
    ? wallBid >= wallThreshold || (imbalance > 0 && bidVol > askVol * Number((config.bookPressure || {}).longPressureRatio || 1.08))
    : wallAsk >= wallThreshold || (imbalance < 0 && askVol > bidVol * Number((config.bookPressure || {}).shortPressureRatio || 1.08));
  signals.push({
    name: 'book_pressure',
    approved: pressureApproved,
    value: direction === 'long' ? wallBid : wallAsk,
    weight: Number((config.weights || {}).bookPressure || 0.36),
  });

  reasons.push(`micro_imbalance_${imbalance.toFixed(4)}`);
  reasons.push(`micro_spread_pct_${Number.isFinite(spreadPct) ? spreadPct.toFixed(4) : 'nan'}`);

  const totalWeight = signals.reduce((acc, x) => acc + Number(x.weight || 0), 0) || 1;
  const approvedWeight = signals.reduce((acc, x) => acc + (x.approved ? Number(x.weight || 0) : 0), 0);

  return {
    layerName: 'microstructureConfirmationEngine',
    direction,
    score: clamp01(approvedWeight / totalWeight),
    confidence: clamp01(0.35 + 0.45 * (approvedWeight / totalWeight)),
    softPenalty: clamp01(0.16 * (1 - (approvedWeight / totalWeight))),
    dataQualityState: missing.length > 0 ? 'degraded' : 'full',
    reasonCodes: reasons.concat(signals.map((x) => `${x.name}:${x.approved ? 'approved' : 'rejected'}`)),
    explanation: {
      mode: 'full_mode',
      signals,
      missingData: missing,
      calculated: {
        bidVolume: bidVol,
        askVolume: askVol,
        imbalance,
        spreadPercent: spreadPct,
        wallBidRatio: wallBid,
        wallAskRatio: wallAsk,
      },
      reusableFeatures: ['orderBookImbalance', 'spreadPercent', 'wallRatios'],
    },
  };
}

function evaluateConfirmationEngine(input = {}, config = {}) {
  const enabled = !!config.enabled;
  const primaryDirection = normalizeDirection(input.direction);
  if (!enabled) {
    return {
      enabled: false,
      layerName: 'confirmationEngine',
      direction: primaryDirection,
      technical: null,
      microstructure: null,
      score: 0.35,
      confidence: 0.45,
      softPenalty: 0,
      dataQualityState: 'fallback',
      reasonCodes: ['confirmation_engine_disabled'],
      explanation: { mode: 'legacy_fallback' },
    };
  }

  const cheap = evaluateTechnicalConfirmations(input, config.technical || {});
  const expensiveAllowedByScore = cheap.score >= Number((config.costSplit || {}).minCheapScoreForMicro || 0.42);
  const expensiveAllowedByBudget = !(config.costSplit || {}).skipMicroWhenBudgetExceeded || input.budgetState !== 'exceeded';
  const expensiveAllowed = expensiveAllowedByScore && expensiveAllowedByBudget;

  let micro = {
    layerName: 'microstructureConfirmationEngine',
    direction: primaryDirection,
    score: 0.35,
    confidence: 0.25,
    softPenalty: Number(((config.microstructure || {}).softPenaltyOnMissingData) || 0.06),
    dataQualityState: expensiveAllowedByBudget ? 'missing' : 'degraded',
    reasonCodes: expensiveAllowedByBudget ? ['microstructure_skipped_by_cheap_gate'] : ['microstructure_skipped_by_budget'],
    explanation: {
      mode: expensiveAllowedByBudget ? 'cached_mode' : 'degraded_mode',
      skipReason: expensiveAllowedByBudget ? 'cheap_gate_not_passed' : 'budget_exceeded',
      signals: [],
      missingData: ['orderBook'],
    },
  };

  if (expensiveAllowed) {
    micro = evaluateMicrostructureConfirmations(input, config.microstructure || {});
  }

  const technicalWeight = Number((config.weights || {}).technical || 0.62);
  const microWeight = Number((config.weights || {}).microstructure || 0.38);
  const combinedWeight = technicalWeight + microWeight || 1;

  const score = clamp01(((cheap.score * technicalWeight) + (micro.score * microWeight)) / combinedWeight);
  const confidence = clamp01(((cheap.confidence * technicalWeight) + (micro.confidence * microWeight)) / combinedWeight);
  let softPenalty = clamp01(((cheap.softPenalty * technicalWeight) + (micro.softPenalty * microWeight)) / combinedWeight);

  const capitalRegime = (input.context || {}).capitalRegime || 'NORMAL';
  const capitalPenalty = Number(((config.capitalRegimePenalties || {})[capitalRegime]) || 0);
  softPenalty = clamp01(softPenalty + capitalPenalty);

  return {
    enabled: true,
    layerName: 'confirmationEngine',
    direction: primaryDirection,
    technical: cheap,
    microstructure: micro,
    score,
    confidence,
    softPenalty,
    dataQualityState: [cheap.dataQualityState, micro.dataQualityState].includes('full')
      ? ([cheap.dataQualityState, micro.dataQualityState].includes('degraded') ? 'degraded' : 'full')
      : 'degraded',
    reasonCodes: []
      .concat(cheap.reasonCodes || [])
      .concat(micro.reasonCodes || [])
      .concat(capitalPenalty > 0 ? [`capital_regime_penalty:${capitalRegime}`] : []),
    explanation: {
      mode: [cheap.dataQualityState, micro.dataQualityState].includes('degraded') ? 'degraded_mode' : 'full_mode',
      cheapStagePassed: expensiveAllowedByScore,
      expensiveStageExecuted: expensiveAllowed,
      budgetState: input.budgetState || 'normal',
      capitalRegime,
      capitalPenalty,
      technical: cheap.explanation || {},
      microstructure: micro.explanation || {},
    },
  };
}

module.exports = {
  evaluateConfirmationEngine,
};
