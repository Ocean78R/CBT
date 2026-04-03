'use strict';

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function pickLatestCandles(sharedSnapshot = {}) {
  if (Array.isArray(sharedSnapshot.candles) && sharedSnapshot.candles.length > 0) return sharedSnapshot.candles;
  if (Array.isArray(sharedSnapshot.ohlcv) && sharedSnapshot.ohlcv.length > 0) {
    return sharedSnapshot.ohlcv.map((row) => ({
      open: toFiniteNumber(row[1]),
      high: toFiniteNumber(row[2]),
      low: toFiniteNumber(row[3]),
      close: toFiniteNumber(row[4]),
      volume: toFiniteNumber(row[5]),
      timestamp: toFiniteNumber(row[0]),
    }));
  }
  return [];
}

function normalizeSpreadInput(sharedSnapshot = {}, context = {}) {
  const orderBook = sharedSnapshot.orderBook || {};
  const bestBid = toFiniteNumber(sharedSnapshot.bestBid ?? orderBook.bestBid ?? context.bestBid, NaN);
  const bestAsk = toFiniteNumber(sharedSnapshot.bestAsk ?? orderBook.bestAsk ?? context.bestAsk, NaN);
  const explicitSpreadPercent = toFiniteNumber(sharedSnapshot.spreadPercent ?? context.spreadPercent, NaN);

  if (Number.isFinite(explicitSpreadPercent) && explicitSpreadPercent > 0) {
    return {
      spreadPercent: explicitSpreadPercent,
      source: 'shared_spread_percent',
    };
  }

  if (Number.isFinite(bestBid) && Number.isFinite(bestAsk) && bestBid > 0 && bestAsk >= bestBid) {
    const mid = (bestBid + bestAsk) / 2;
    const spreadPercent = mid > 0 ? ((bestAsk - bestBid) / mid) * 100 : NaN;
    return {
      spreadPercent,
      source: 'best_bid_ask',
    };
  }

  return {
    spreadPercent: NaN,
    source: 'missing',
  };
}

function toRange(candle = {}) {
  const high = toFiniteNumber(candle.high, NaN);
  const low = toFiniteNumber(candle.low, NaN);
  if (!Number.isFinite(high) || !Number.isFinite(low) || high < low) return NaN;
  return Math.max(0, high - low);
}

function toBody(candle = {}) {
  const open = toFiniteNumber(candle.open, NaN);
  const close = toFiniteNumber(candle.close, NaN);
  if (!Number.isFinite(open) || !Number.isFinite(close)) return NaN;
  return Math.abs(close - open);
}

function average(values = []) {
  const clean = values.filter((x) => Number.isFinite(x));
  if (clean.length === 0) return NaN;
  return clean.reduce((acc, x) => acc + x, 0) / clean.length;
}

function percentile(values = [], p = 0.5) {
  const clean = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (clean.length === 0) return NaN;
  const idx = Math.max(0, Math.min(clean.length - 1, Math.floor((clean.length - 1) * p)));
  return clean[idx];
}

function computeAtr(candles = [], period = 14) {
  if (!Array.isArray(candles) || candles.length < 2) return [];
  const trueRanges = [];
  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i] || {};
    const prev = candles[i - 1] || {};
    const high = toFiniteNumber(current.high, NaN);
    const low = toFiniteNumber(current.low, NaN);
    const prevClose = toFiniteNumber(prev.close, NaN);
    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(prevClose)) continue;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );
    trueRanges.push(tr);
  }
  if (trueRanges.length < period) return [];

  const atr = [];
  for (let i = period - 1; i < trueRanges.length; i += 1) {
    const window = trueRanges.slice(i - period + 1, i + 1);
    atr.push(average(window));
  }
  return atr;
}

function normalizeConfig(raw = {}) {
  const weights = raw.weights || {};
  const thresholds = raw.thresholds || {};
  const degradedMode = raw.degradedMode || {};
  const capitalRegimeAdjustments = raw.capitalRegimeAdjustments || {};

  return {
    enabled: !!raw.enabled,
    highPriority: raw.highPriority !== false,
    minCandles: Number(raw.minCandles ?? 24),
    atrPeriod: Number(raw.atrPeriod ?? 14),
    spreadLookback: Number(raw.spreadLookback ?? 20),
    eventWindow: Number(raw.eventWindow ?? 6),
    weights: {
      atrSpike: Number(weights.atrSpike ?? 0.28),
      spreadWidening: Number(weights.spreadWidening ?? 0.22),
      oversizedCandles: Number(weights.oversizedCandles ?? 0.18),
      chaoticRangeExpansion: Number(weights.chaoticRangeExpansion ?? 0.16),
      eventMovement: Number(weights.eventMovement ?? 0.16),
    },
    thresholds: {
      atrSpikeRatio: Number(thresholds.atrSpikeRatio ?? 1.85),
      spreadSpikeRatio: Number(thresholds.spreadSpikeRatio ?? 2.4),
      spreadAbsPercent: Number(thresholds.spreadAbsPercent ?? 0.2),
      oversizedCandleBodyToAtr: Number(thresholds.oversizedCandleBodyToAtr ?? 1.75),
      oversizedCandleRangeToAtr: Number(thresholds.oversizedCandleRangeToAtr ?? 2.3),
      chaosRangeP95ToMedian: Number(thresholds.chaosRangeP95ToMedian ?? 2.8),
      eventMoveNetToAtr: Number(thresholds.eventMoveNetToAtr ?? 2.2),
      eventMoveWhipsawRatio: Number(thresholds.eventMoveWhipsawRatio ?? 1.4),
      softRiskScore: Number(thresholds.softRiskScore ?? 0.45),
      hardRiskScore: Number(thresholds.hardRiskScore ?? 0.7),
    },
    degradedMode: {
      softPenalty: Number(degradedMode.softPenalty ?? 0.18),
      minRiskScore: Number(degradedMode.minRiskScore ?? 0.35),
      failSafeOnInsufficientData: !!degradedMode.failSafeOnInsufficientData,
    },
    capitalRegimeAdjustments: {
      CAUTION: Number(capitalRegimeAdjustments.CAUTION ?? 1.05),
      DEFENSIVE: Number(capitalRegimeAdjustments.DEFENSIVE ?? 1.15),
      CAPITAL_PRESERVATION: Number(capitalRegimeAdjustments.CAPITAL_PRESERVATION ?? 1.25),
      HALT_NEW_ENTRIES: Number(capitalRegimeAdjustments.HALT_NEW_ENTRIES ?? 1.35),
      NORMAL: Number(capitalRegimeAdjustments.NORMAL ?? 1),
    },
  };
}

function evaluateEventRiskVeto(input = {}, rawConfig = {}) {
  const config = normalizeConfig(rawConfig);
  const context = input.context || {};
  const sharedSnapshot = input.sharedSnapshot || {};
  const reasonCodes = [];
  const vetoCandidates = [];

  if (!config.enabled) {
    return {
      layerName: 'eventRiskVetoEngine',
      direction: 'long_short',
      score: 0,
      confidence: 0,
      softPenalty: 0,
      vetoCandidates: [],
      dataQualityState: 'fallback',
      reasonCodes: ['event_risk_disabled'],
      shockRiskScore: 0,
      eventRiskState: 'disabled',
      shockVetoTriggered: false,
      explanation: {
        mode: 'disabled',
        capitalRegime: context.capitalRegime || 'NORMAL',
      },
    };
  }

  const candles = pickLatestCandles(sharedSnapshot);
  const capitalRegime = context.capitalRegime || 'NORMAL';
  const capitalMultiplier = Number(config.capitalRegimeAdjustments[capitalRegime] || config.capitalRegimeAdjustments.NORMAL || 1);

  if (!Array.isArray(candles) || candles.length < Math.max(6, config.minCandles)) {
    const degradedRiskScore = clamp01(Math.max(config.degradedMode.minRiskScore, 0.2) * capitalMultiplier);
    reasonCodes.push('insufficient_candles_for_event_risk');

    if (config.degradedMode.failSafeOnInsufficientData) {
      vetoCandidates.push({
        type: 'hard_veto',
        reason: 'event_risk_insufficient_data_fail_safe',
        provider: 'eventRiskVetoEngine',
      });
      reasonCodes.push('event_risk_fail_safe_hard_veto');
    }

    return {
      layerName: 'eventRiskVetoEngine',
      direction: 'long_short',
      score: clamp01(1 - degradedRiskScore),
      confidence: 0.25,
      softPenalty: clamp01(config.degradedMode.softPenalty),
      vetoCandidates,
      dataQualityState: 'degraded',
      reasonCodes,
      shockRiskScore: degradedRiskScore,
      eventRiskState: 'insufficient_data',
      shockVetoTriggered: vetoCandidates.length > 0,
      explanation: {
        mode: 'degraded',
        capitalRegime,
        capitalMultiplier,
        candlesAvailable: Array.isArray(candles) ? candles.length : 0,
        minCandlesRequired: Math.max(6, config.minCandles),
        featureModes: {
          atrSpike: 'missing',
          spreadWidening: 'missing',
          oversizedCandles: 'missing',
          chaoticRangeExpansion: 'missing',
          eventMovement: 'missing',
        },
      },
    };
  }

  const atrSeries = computeAtr(candles, Math.max(3, config.atrPeriod));
  const latestAtr = atrSeries.length > 0 ? atrSeries[atrSeries.length - 1] : NaN;
  const atrBaseline = atrSeries.length > 1 ? average(atrSeries.slice(0, -1)) : NaN;
  const atrRatio = Number.isFinite(latestAtr) && Number.isFinite(atrBaseline) && atrBaseline > 0
    ? latestAtr / atrBaseline
    : NaN;

  const spreadContext = normalizeSpreadInput(sharedSnapshot, context);
  const spreadHistory = Array.isArray(sharedSnapshot.spreadHistoryPercent)
    ? sharedSnapshot.spreadHistoryPercent.map((x) => toFiniteNumber(x, NaN)).filter((x) => Number.isFinite(x) && x >= 0)
    : [];
  const spreadBaseline = spreadHistory.length > 0
    ? average(spreadHistory.slice(-Math.max(3, config.spreadLookback)))
    : NaN;
  const spreadRatio = Number.isFinite(spreadContext.spreadPercent) && Number.isFinite(spreadBaseline) && spreadBaseline > 0
    ? spreadContext.spreadPercent / spreadBaseline
    : NaN;

  const recent = candles.slice(-Math.max(3, config.eventWindow));
  const ranges = candles.map((c) => toRange(c)).filter((x) => Number.isFinite(x));
  const bodies = candles.map((c) => toBody(c)).filter((x) => Number.isFinite(x));
  const latestCandle = candles[candles.length - 1] || {};
  const latestRange = toRange(latestCandle);
  const latestBody = toBody(latestCandle);

  const rangeMedian = percentile(ranges, 0.5);
  const rangeP95 = percentile(ranges, 0.95);
  const chaosRatio = Number.isFinite(rangeMedian) && rangeMedian > 0 && Number.isFinite(rangeP95)
    ? rangeP95 / rangeMedian
    : NaN;

  const recentNetMove = (() => {
    if (recent.length < 2) return NaN;
    const firstOpen = toFiniteNumber(recent[0].open, NaN);
    const lastClose = toFiniteNumber(recent[recent.length - 1].close, NaN);
    if (!Number.isFinite(firstOpen) || !Number.isFinite(lastClose)) return NaN;
    return Math.abs(lastClose - firstOpen);
  })();
  const recentPathMove = recent.reduce((acc, candle) => acc + toFiniteNumber(toRange(candle), 0), 0);
  const eventMoveNetToAtr = Number.isFinite(recentNetMove) && Number.isFinite(latestAtr) && latestAtr > 0
    ? recentNetMove / latestAtr
    : NaN;
  const eventMoveWhipsawRatio = Number.isFinite(recentNetMove) && recentNetMove > 0
    ? recentPathMove / recentNetMove
    : NaN;

  const atrRisk = Number.isFinite(atrRatio) ? clamp01(atrRatio / Math.max(config.thresholds.atrSpikeRatio, 1e-6)) : 0;
  const spreadRisk = Number.isFinite(spreadContext.spreadPercent)
    ? clamp01(Math.max(
      Number.isFinite(spreadRatio) ? spreadRatio / Math.max(config.thresholds.spreadSpikeRatio, 1e-6) : 0,
      spreadContext.spreadPercent / Math.max(config.thresholds.spreadAbsPercent, 1e-6),
    ))
    : 0;
  const oversizedRisk = Number.isFinite(latestAtr) && latestAtr > 0
    ? clamp01(Math.max(
      (latestBody || 0) / (latestAtr * Math.max(config.thresholds.oversizedCandleBodyToAtr, 1e-6)),
      (latestRange || 0) / (latestAtr * Math.max(config.thresholds.oversizedCandleRangeToAtr, 1e-6)),
    ))
    : 0;
  const chaosRisk = Number.isFinite(chaosRatio)
    ? clamp01(chaosRatio / Math.max(config.thresholds.chaosRangeP95ToMedian, 1e-6))
    : 0;
  const eventMovementRisk = clamp01(Math.max(
    Number.isFinite(eventMoveNetToAtr) ? eventMoveNetToAtr / Math.max(config.thresholds.eventMoveNetToAtr, 1e-6) : 0,
    Number.isFinite(eventMoveWhipsawRatio) ? eventMoveWhipsawRatio / Math.max(config.thresholds.eventMoveWhipsawRatio, 1e-6) : 0,
  ));

  const weightedRiskBase = clamp01(
    (atrRisk * config.weights.atrSpike)
    + (spreadRisk * config.weights.spreadWidening)
    + (oversizedRisk * config.weights.oversizedCandles)
    + (chaosRisk * config.weights.chaoticRangeExpansion)
    + (eventMovementRisk * config.weights.eventMovement),
  );

  const shockRiskScore = clamp01(weightedRiskBase * capitalMultiplier);
  let eventRiskState = 'normal';
  let softPenalty = 0;

  if (shockRiskScore >= config.thresholds.hardRiskScore) {
    eventRiskState = 'critical_shock';
    vetoCandidates.push({
      type: 'hard_veto',
      reason: 'event_shock_risk_hard_veto',
      provider: 'eventRiskVetoEngine',
      shockRiskScore,
    });
    reasonCodes.push('event_risk_hard_veto');
  } else if (shockRiskScore >= config.thresholds.softRiskScore) {
    eventRiskState = 'elevated_shock';
    softPenalty = clamp01((shockRiskScore - config.thresholds.softRiskScore) + 0.1);
    reasonCodes.push('event_risk_soft_penalty');
  } else {
    reasonCodes.push('event_risk_normal');
  }

  if (atrRisk >= 1) reasonCodes.push('abnormal_atr_spike');
  if (spreadRisk >= 1) reasonCodes.push('abnormal_spread_widening');
  if (oversizedRisk >= 1) reasonCodes.push('oversized_candle_detected');
  if (chaosRisk >= 1) reasonCodes.push('chaotic_range_expansion');
  if (eventMovementRisk >= 1) reasonCodes.push('event_like_movement_pattern');

  const missingSignals = [];
  if (!Number.isFinite(atrRatio)) missingSignals.push('atr');
  if (!Number.isFinite(spreadContext.spreadPercent)) missingSignals.push('spread');
  if (!Number.isFinite(chaosRatio)) missingSignals.push('chaos');
  if (!Number.isFinite(eventMoveNetToAtr) && !Number.isFinite(eventMoveWhipsawRatio)) missingSignals.push('event_pattern');

  const dataQualityState = missingSignals.length > 0 ? 'degraded' : 'full';
  if (dataQualityState === 'degraded') {
    reasonCodes.push('event_risk_partial_data');
    // Русский комментарий: при частично отсутствующих данных слой не выдаёт ложный safe-state и добавляет защитный штраф.
    softPenalty = clamp01(Math.max(softPenalty, config.degradedMode.softPenalty * 0.5));
  }

  return {
    layerName: 'eventRiskVetoEngine',
    direction: 'long_short',
    score: clamp01(1 - shockRiskScore),
    confidence: dataQualityState === 'full' ? 0.82 : 0.56,
    softPenalty,
    vetoCandidates,
    dataQualityState,
    reasonCodes,
    shockRiskScore,
    eventRiskState,
    shockVetoTriggered: vetoCandidates.length > 0,
    explanation: {
      mode: dataQualityState === 'full' ? 'full_mode' : 'degraded_mode',
      capitalRegime,
      capitalMultiplier,
      atr: {
        latestAtr: Number.isFinite(latestAtr) ? latestAtr : null,
        baselineAtr: Number.isFinite(atrBaseline) ? atrBaseline : null,
        ratio: Number.isFinite(atrRatio) ? atrRatio : null,
        risk: atrRisk,
      },
      spread: {
        source: spreadContext.source,
        currentPercent: Number.isFinite(spreadContext.spreadPercent) ? spreadContext.spreadPercent : null,
        baselinePercent: Number.isFinite(spreadBaseline) ? spreadBaseline : null,
        ratio: Number.isFinite(spreadRatio) ? spreadRatio : null,
        risk: spreadRisk,
      },
      oversizedCandles: {
        latestBody: Number.isFinite(latestBody) ? latestBody : null,
        latestRange: Number.isFinite(latestRange) ? latestRange : null,
        latestAtr: Number.isFinite(latestAtr) ? latestAtr : null,
        risk: oversizedRisk,
      },
      chaoticRangeExpansion: {
        rangeMedian: Number.isFinite(rangeMedian) ? rangeMedian : null,
        rangeP95: Number.isFinite(rangeP95) ? rangeP95 : null,
        ratio: Number.isFinite(chaosRatio) ? chaosRatio : null,
        risk: chaosRisk,
      },
      eventMovement: {
        recentNetMove: Number.isFinite(recentNetMove) ? recentNetMove : null,
        recentPathMove: Number.isFinite(recentPathMove) ? recentPathMove : null,
        netToAtr: Number.isFinite(eventMoveNetToAtr) ? eventMoveNetToAtr : null,
        whipsawRatio: Number.isFinite(eventMoveWhipsawRatio) ? eventMoveWhipsawRatio : null,
        risk: eventMovementRisk,
      },
      featureModes: {
        atrSpike: Number.isFinite(atrRatio) ? 'full' : 'missing',
        spreadWidening: Number.isFinite(spreadContext.spreadPercent) ? 'full' : 'missing',
        oversizedCandles: Number.isFinite(latestBody) && Number.isFinite(latestRange) ? 'full' : 'missing',
        chaoticRangeExpansion: Number.isFinite(chaosRatio) ? 'full' : 'missing',
        eventMovement: Number.isFinite(eventMoveNetToAtr) || Number.isFinite(eventMoveWhipsawRatio) ? 'full' : 'missing',
      },
      missingSignals,
      thresholds: config.thresholds,
      weights: config.weights,
    },
  };
}

module.exports = {
  normalizeEventRiskVetoConfig: normalizeConfig,
  evaluateEventRiskVeto,
};
