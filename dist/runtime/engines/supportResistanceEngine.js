'use strict';

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function normalizeSupportResistanceConfig(raw = {}) {
  const scoring = raw.scoring || {};
  const detection = raw.detection || {};

  return {
    enabled: !!raw.enabled,
    priceSource: raw.priceSource === 'close' ? 'close' : 'wick',
    lookbackBars: Number(raw.lookbackBars || 120),
    rangeLookbackBars: Number(raw.rangeLookbackBars || 40),
    swingWindow: Number(raw.swingWindow || 2),
    minSwingPoints: Number(raw.minSwingPoints || 3),
    zoneWidthPercent: Number(raw.zoneWidthPercent || 0.2),
    proximityThresholdPercent: Number(raw.proximityThresholdPercent || 0.35),
    breakoutTolerancePercent: Number(raw.breakoutTolerancePercent || 0.16),
    retestWindowBars: Number(raw.retestWindowBars || 6),
    falseBreakoutWindowBars: Number(raw.falseBreakoutWindowBars || 3),
    minBreakoutBodyPercent: Number(raw.minBreakoutBodyPercent || 0.12),
    scoring: {
      proximityScore: Number(scoring.proximityScore || 0.33),
      retestScore: Number(scoring.retestScore || 0.24),
      falseBreakoutScore: Number(scoring.falseBreakoutScore || 0.24),
      breakoutContextScore: Number(scoring.breakoutContextScore || 0.19),
      rangePenalty: Number(scoring.rangePenalty || 0.12),
      degradedPenalty: Number(scoring.degradedPenalty || 0.08),
    },
    detection: {
      requireBreakoutForRetest: detection.requireBreakoutForRetest !== false,
    },
  };
}

function extractNumeric(candle, key, fallbackIndex) {
  if (candle && Number.isFinite(Number(candle[key]))) return Number(candle[key]);
  if (Array.isArray(candle) && Number.isFinite(Number(candle[fallbackIndex]))) return Number(candle[fallbackIndex]);
  return NaN;
}

function extractOpen(candle) {
  return extractNumeric(candle, 'open', 1);
}

function extractHigh(candle) {
  return extractNumeric(candle, 'high', 2);
}

function extractLow(candle) {
  return extractNumeric(candle, 'low', 3);
}

function extractClose(candle) {
  return extractNumeric(candle, 'close', 4);
}

function extractTimestamp(candle) {
  return extractNumeric(candle, 'timestamp', 0);
}

function makeDefaultDecision(reasonCode, dataQualityState, explanation = {}) {
  return {
    layerName: 'supportResistanceEngine',
    direction: 'none',
    score: 0,
    confidence: 0,
    softPenalty: 0,
    vetoCandidates: [],
    dataQualityState,
    reasonCodes: [reasonCode],
    explanation,
  };
}

function detectSwings(candles, swingWindow) {
  const highs = [];
  const lows = [];
  const window = Math.max(1, swingWindow);

  for (let i = window; i < candles.length - window; i += 1) {
    const centerHigh = extractHigh(candles[i]);
    const centerLow = extractLow(candles[i]);
    if (!Number.isFinite(centerHigh) || !Number.isFinite(centerLow)) continue;

    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = i - window; j <= i + window; j += 1) {
      if (j === i) continue;
      const h = extractHigh(candles[j]);
      const l = extractLow(candles[j]);
      if (Number.isFinite(h) && h >= centerHigh) isSwingHigh = false;
      if (Number.isFinite(l) && l <= centerLow) isSwingLow = false;
      if (!isSwingHigh && !isSwingLow) break;
    }

    if (isSwingHigh) highs.push({ index: i, price: centerHigh, timestamp: extractTimestamp(candles[i]) });
    if (isSwingLow) lows.push({ index: i, price: centerLow, timestamp: extractTimestamp(candles[i]) });
  }

  return { highs, lows };
}

function buildZone(levelPrice, zoneWidthPercent, side) {
  const half = Math.abs(levelPrice) * (zoneWidthPercent / 100);
  return {
    side,
    level: levelPrice,
    lower: levelPrice - half,
    upper: levelPrice + half,
    width: half * 2,
  };
}

function calcDistanceToZone(price, zone) {
  if (!Number.isFinite(price) || !zone) return Number.POSITIVE_INFINITY;
  if (price >= zone.lower && price <= zone.upper) return 0;
  if (price < zone.lower) return zone.lower - price;
  return price - zone.upper;
}

function selectNearestZone(price, zones = []) {
  let nearest = null;
  let minDistance = Number.POSITIVE_INFINITY;

  zones.forEach((zone) => {
    const distance = calcDistanceToZone(price, zone);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = zone;
    }
  });

  return { zone: nearest, distance: minDistance };
}

function detectBreakoutContext(candles, rangeHigh, rangeLow, config) {
  const last = candles[candles.length - 1] || {};
  const previous = candles[candles.length - 2] || {};

  const lastOpen = extractOpen(last);
  const lastClose = extractClose(last);
  const prevClose = extractClose(previous);

  if (!Number.isFinite(lastOpen) || !Number.isFinite(lastClose)) {
    return {
      state: 'unknown',
      direction: 'none',
      confirmed: false,
      reason: 'invalid_last_candle',
    };
  }

  const bodyPercent = Math.abs((lastClose - lastOpen) / Math.max(Math.abs(lastOpen), 1e-9)) * 100;
  const tolerance = config.breakoutTolerancePercent / 100;
  const brokeUp = Number.isFinite(rangeHigh) && lastClose > rangeHigh * (1 + tolerance);
  const brokeDown = Number.isFinite(rangeLow) && lastClose < rangeLow * (1 - tolerance);

  if (brokeUp && bodyPercent >= config.minBreakoutBodyPercent) {
    return {
      state: 'breakout_up',
      direction: 'long',
      confirmed: Number.isFinite(prevClose) ? prevClose <= rangeHigh * (1 + tolerance) : true,
      reason: 'price_closed_above_range_high',
    };
  }

  if (brokeDown && bodyPercent >= config.minBreakoutBodyPercent) {
    return {
      state: 'breakout_down',
      direction: 'short',
      confirmed: Number.isFinite(prevClose) ? prevClose >= rangeLow * (1 - tolerance) : true,
      reason: 'price_closed_below_range_low',
    };
  }

  return {
    state: 'inside_range',
    direction: 'none',
    confirmed: false,
    reason: 'no_breakout',
  };
}

function detectRetest(candles, breakoutContext, supportZone, resistanceZone, config) {
  if (!breakoutContext || !breakoutContext.state.startsWith('breakout_')) {
    return { detected: false, direction: 'none', reason: 'breakout_not_present' };
  }

  const scanBars = candles.slice(Math.max(0, candles.length - config.retestWindowBars));
  if (scanBars.length === 0) return { detected: false, direction: 'none', reason: 'no_bars_for_retest' };

  const targetZone = breakoutContext.direction === 'long' ? resistanceZone : supportZone;
  if (!targetZone) return { detected: false, direction: 'none', reason: 'target_zone_missing' };

  const touched = scanBars.some((candle) => {
    const high = extractHigh(candle);
    const low = extractLow(candle);
    return Number.isFinite(high) && Number.isFinite(low) && high >= targetZone.lower && low <= targetZone.upper;
  });

  return {
    detected: touched,
    direction: breakoutContext.direction,
    reason: touched ? 'zone_retest_detected' : 'zone_retest_not_detected',
  };
}

function detectFalseBreakout(candles, breakoutContext, rangeHigh, rangeLow, config) {
  if (!breakoutContext || !breakoutContext.state.startsWith('breakout_')) {
    return { detected: false, direction: 'none', reason: 'breakout_not_present' };
  }

  const scanBars = candles.slice(Math.max(0, candles.length - config.falseBreakoutWindowBars));
  if (scanBars.length === 0) return { detected: false, direction: 'none', reason: 'no_bars_for_false_breakout' };

  const tolerance = config.breakoutTolerancePercent / 100;

  if (breakoutContext.direction === 'long') {
    const reverted = scanBars.some((c) => {
      const close = extractClose(c);
      return Number.isFinite(close) && close < rangeHigh * (1 + tolerance * 0.25);
    });
    return {
      detected: reverted,
      direction: 'short',
      reason: reverted ? 'liquidity_grab_above_resistance' : 'breakout_hold_above_resistance',
    };
  }

  const reverted = scanBars.some((c) => {
    const close = extractClose(c);
    return Number.isFinite(close) && close > rangeLow * (1 - tolerance * 0.25);
  });

  return {
    detected: reverted,
    direction: 'long',
    reason: reverted ? 'liquidity_grab_below_support' : 'breakout_hold_below_support',
  };
}

function calculateZoneStrength(zone, swings, rangeMeta, latestPrice, config) {
  if (!zone) return 0;
  const touches = swings.filter((s) => Math.abs((s.price - zone.level) / Math.max(Math.abs(zone.level), 1e-9)) * 100 <= config.zoneWidthPercent * 1.35).length;
  const normalizedTouches = clamp01(touches / Math.max(config.minSwingPoints, 1));

  const rangeCoverage = Number.isFinite(rangeMeta.rangeHigh) && Number.isFinite(rangeMeta.rangeLow) && rangeMeta.rangeHigh > rangeMeta.rangeLow
    ? clamp01((zone.width / (rangeMeta.rangeHigh - rangeMeta.rangeLow)) * 5)
    : 0;

  const distancePercent = Math.abs((latestPrice - zone.level) / Math.max(Math.abs(zone.level), 1e-9)) * 100;
  const proximityBoost = clamp01(1 - (distancePercent / Math.max(config.proximityThresholdPercent, 1e-9)));

  return clamp01(normalizedTouches * 0.55 + rangeCoverage * 0.15 + proximityBoost * 0.3);
}

function evaluateSupportResistance(input = {}, rawConfig = {}) {
  const config = normalizeSupportResistanceConfig(rawConfig);
  if (!config.enabled) {
    return makeDefaultDecision('feature_disabled', 'fallback', {
      fallbackPolicy: 'legacy_entry_flow',
      mode: 'disabled',
    });
  }

  const context = input.context || {};
  const sharedSnapshot = input.sharedSnapshot || {};
  const candlesRaw = Array.isArray(sharedSnapshot.candles) ? sharedSnapshot.candles : [];
  const candles = candlesRaw.slice(-Math.max(config.lookbackBars, config.rangeLookbackBars + 5));

  if (candles.length < Math.max(config.minSwingPoints * 2, config.swingWindow * 2 + 5)) {
    return makeDefaultDecision('not_enough_candles', 'degraded', {
      candles: candles.length,
      required: Math.max(config.minSwingPoints * 2, config.swingWindow * 2 + 5),
      fallbackPolicy: 'continue_without_zones',
    });
  }

  const swings = detectSwings(candles, config.swingWindow);
  const recentSwingHighs = swings.highs.slice(-config.minSwingPoints - 2);
  const recentSwingLows = swings.lows.slice(-config.minSwingPoints - 2);
  if (recentSwingHighs.length < config.minSwingPoints || recentSwingLows.length < config.minSwingPoints) {
    return makeDefaultDecision('not_enough_swings', 'degraded', {
      swingHighs: recentSwingHighs.length,
      swingLows: recentSwingLows.length,
      fallbackPolicy: 'continue_without_zones',
    });
  }

  const lastCandle = candles[candles.length - 1];
  const latestClose = extractClose(lastCandle);
  if (!Number.isFinite(latestClose)) {
    return makeDefaultDecision('invalid_latest_close', 'degraded', {
      fallbackPolicy: 'continue_without_zones',
    });
  }

  const supportLevel = recentSwingLows[recentSwingLows.length - 1].price;
  const resistanceLevel = recentSwingHighs[recentSwingHighs.length - 1].price;
  const supportZone = buildZone(supportLevel, config.zoneWidthPercent, 'support');
  const resistanceZone = buildZone(resistanceLevel, config.zoneWidthPercent, 'resistance');

  const rangeCandles = candles.slice(-config.rangeLookbackBars);
  const rangeHigh = Math.max(...rangeCandles.map((c) => extractHigh(c)).filter((x) => Number.isFinite(x)));
  const rangeLow = Math.min(...rangeCandles.map((c) => extractLow(c)).filter((x) => Number.isFinite(x)));
  const rangeMeta = {
    rangeHigh,
    rangeLow,
    widthPercent: Number.isFinite(rangeHigh) && Number.isFinite(rangeLow) && rangeLow > 0
      ? ((rangeHigh - rangeLow) / rangeLow) * 100
      : null,
  };

  const nearest = selectNearestZone(latestClose, [supportZone, resistanceZone]);
  const distancePercentToNearest = nearest.zone
    ? (nearest.distance / Math.max(Math.abs(latestClose), 1e-9)) * 100
    : Number.POSITIVE_INFINITY;

  const breakoutContext = detectBreakoutContext(candles, rangeHigh, rangeLow, config);
  const retest = detectRetest(candles, breakoutContext, supportZone, resistanceZone, config);
  const falseBreakout = detectFalseBreakout(candles, breakoutContext, rangeHigh, rangeLow, config);

  const supportStrength = calculateZoneStrength(supportZone, recentSwingLows, rangeMeta, latestClose, config);
  const resistanceStrength = calculateZoneStrength(resistanceZone, recentSwingHighs, rangeMeta, latestClose, config);

  let direction = 'none';
  if (nearest.zone && nearest.zone.side === 'support') direction = 'long';
  if (nearest.zone && nearest.zone.side === 'resistance') direction = 'short';

  if (falseBreakout.detected) direction = falseBreakout.direction;
  else if (retest.detected) direction = retest.direction;
  else if (breakoutContext.confirmed && breakoutContext.direction !== 'none') direction = breakoutContext.direction;

  const proximityScore = clamp01(1 - (distancePercentToNearest / Math.max(config.proximityThresholdPercent, 1e-9)));
  const retestScore = retest.detected ? 1 : 0;
  const falseBreakoutScore = falseBreakout.detected ? 1 : 0;
  const breakoutContextScore = breakoutContext.confirmed ? 1 : (breakoutContext.state === 'inside_range' ? 0.25 : 0.4);

  const rawScore = (
    proximityScore * config.scoring.proximityScore
    + retestScore * config.scoring.retestScore
    + falseBreakoutScore * config.scoring.falseBreakoutScore
    + breakoutContextScore * config.scoring.breakoutContextScore
  );

  const zoneStrength = clamp01((supportStrength + resistanceStrength) / 2);
  const score = clamp01(rawScore * (0.65 + zoneStrength * 0.35));

  let softPenalty = 0;
  const reasonCodes = ['zones_context_evaluated'];

  if (breakoutContext.state === 'inside_range' && Number.isFinite(rangeMeta.widthPercent) && rangeMeta.widthPercent < config.proximityThresholdPercent * 2.6) {
    softPenalty = clamp01(softPenalty + config.scoring.rangePenalty);
    reasonCodes.push('tight_range_penalty');
  }

  if (!nearest.zone || !Number.isFinite(distancePercentToNearest)) {
    softPenalty = clamp01(softPenalty + config.scoring.degradedPenalty);
    reasonCodes.push('nearest_zone_missing');
  } else {
    reasonCodes.push(`nearest_zone_${nearest.zone.side}`);
  }

  if (retest.detected) reasonCodes.push('retest_detected');
  if (falseBreakout.detected) reasonCodes.push('false_breakout_detected');
  if (breakoutContext.state !== 'inside_range') reasonCodes.push(`breakout_context_${breakoutContext.state}`);

  const confidence = clamp01(0.35 + zoneStrength * 0.45 + (breakoutContext.confirmed ? 0.15 : 0) + (retest.detected ? 0.05 : 0));

  return {
    layerName: 'supportResistanceEngine',
    direction,
    score,
    confidence,
    softPenalty,
    vetoCandidates: [],
    dataQualityState: 'full',
    reasonCodes,
    explanation: {
      // Русский комментарий: слой зон отвечает только за ценовую геометрию и не учитывает объёмный контекст.
      moduleScope: 'price_geometry_only',
      marketRegime: context.marketRegime || 'unknown',
      capitalRegime: context.capitalRegime || 'NORMAL',
      detectedSwings: {
        highs: recentSwingHighs,
        lows: recentSwingLows,
      },
      zones: {
        support: { ...supportZone, strength: supportStrength },
        resistance: { ...resistanceZone, strength: resistanceStrength },
        nearest: nearest.zone,
        distancePercentToNearest,
      },
      range: rangeMeta,
      breakoutContext,
      retest,
      falseBreakout,
      executionMode: 'full_mode',
      dependencies: {
        requiredInputs: ['sharedSnapshot.candles', 'context.marketRegime', 'context.capitalRegime'],
        fallbackPolicy: 'continue_without_zones',
      },
      reusableFeatures: {
        rangeHigh,
        rangeLow,
        supportStrength,
        resistanceStrength,
      },
    },
  };
}

module.exports = {
  evaluateSupportResistance,
  normalizeSupportResistanceConfig,
};
