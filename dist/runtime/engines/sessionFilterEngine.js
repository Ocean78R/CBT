'use strict';

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function toFiniteNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeWindow(raw = {}) {
  return {
    startHour: Math.max(0, Math.min(23, Math.floor(toFiniteNumber(raw.startHour, 0)))),
    endHour: Math.max(0, Math.min(24, Math.floor(toFiniteNumber(raw.endHour, 24)))),
    scoreBoost: toFiniteNumber(raw.scoreBoost, 0),
    softPenalty: Math.max(0, toFiniteNumber(raw.softPenalty, 0)),
    confidenceBoost: Math.max(-1, Math.min(1, toFiniteNumber(raw.confidenceBoost, 0))),
    reasonCode: raw.reasonCode || 'time_window',
  };
}

function normalizeSession(raw = {}) {
  return {
    sessionState: raw.sessionState || 'OFF_HOURS',
    startHour: Math.max(0, Math.min(23, Math.floor(toFiniteNumber(raw.startHour, 0)))),
    endHour: Math.max(0, Math.min(24, Math.floor(toFiniteNumber(raw.endHour, 24)))),
    scoreMultiplier: Math.max(0, toFiniteNumber(raw.scoreMultiplier, 1)),
    confidence: clamp01(toFiniteNumber(raw.confidence, 0.6)),
    reasonCode: raw.reasonCode || 'session_detected',
  };
}

function normalizeConfig(raw = {}) {
  const goodWindows = Array.isArray(raw.goodWindows) ? raw.goodWindows : [];
  const chaoticWindows = Array.isArray(raw.chaoticWindows) ? raw.chaoticWindows : [];
  const restrictedWindows = Array.isArray(raw.restrictedWindows) ? raw.restrictedWindows : [];
  const sessions = Array.isArray(raw.sessions) ? raw.sessions : [];
  const refreshPolicy = raw.refreshPolicy || {};
  const capitalRegimeInfluence = raw.capitalRegimeInfluence || {};

  return {
    enabled: !!raw.enabled,
    timezone: raw.timezone || 'UTC',
    noTradeOnRestrictedWindows: raw.noTradeOnRestrictedWindows !== false,
    baseScore: clamp01(toFiniteNumber(raw.baseScore, 0.6)),
    baseConfidence: clamp01(toFiniteNumber(raw.baseConfidence, 0.62)),
    degradedPenaltyOnMissingTime: clamp01(toFiniteNumber(raw.degradedPenaltyOnMissingTime, 0.08)),
    sessions: (sessions.length > 0 ? sessions : [
      { sessionState: 'ASIAN', startHour: 0, endHour: 8, scoreMultiplier: 0.92, confidence: 0.58, reasonCode: 'session_asian' },
      { sessionState: 'EUROPEAN', startHour: 7, endHour: 16, scoreMultiplier: 1.02, confidence: 0.66, reasonCode: 'session_european' },
      { sessionState: 'US', startHour: 13, endHour: 22, scoreMultiplier: 1.05, confidence: 0.7, reasonCode: 'session_us' },
      { sessionState: 'OVERLAP_EU_US', startHour: 13, endHour: 16, scoreMultiplier: 1.12, confidence: 0.78, reasonCode: 'session_overlap' },
    ]).map(normalizeSession),
    goodWindows: (goodWindows.length > 0 ? goodWindows : [
      { startHour: 12, endHour: 17, scoreBoost: 0.08, confidenceBoost: 0.06, reasonCode: 'good_window_liquidity_peak' },
    ]).map(normalizeWindow),
    chaoticWindows: (chaoticWindows.length > 0 ? chaoticWindows : [
      { startHour: 0, endHour: 2, softPenalty: 0.06, confidenceBoost: -0.08, reasonCode: 'chaotic_rollover_window' },
      { startHour: 20, endHour: 22, softPenalty: 0.05, confidenceBoost: -0.06, reasonCode: 'chaotic_us_close_transition' },
    ]).map(normalizeWindow),
    restrictedWindows: (restrictedWindows.length > 0 ? restrictedWindows : [
      { startHour: 23, endHour: 24, reasonCode: 'restricted_low_liquidity_window' },
    ]).map((item) => ({
      startHour: Math.max(0, Math.min(23, Math.floor(toFiniteNumber(item.startHour, 0)))),
      endHour: Math.max(0, Math.min(24, Math.floor(toFiniteNumber(item.endHour, 24)))),
      reasonCode: item.reasonCode || 'restricted_window',
    })),
    capitalRegimeInfluence: {
      mode: capitalRegimeInfluence.mode === 'strict' ? 'strict' : 'penalty_only',
      protectivePenaltyByRegime: typeof capitalRegimeInfluence.protectivePenaltyByRegime === 'object' && capitalRegimeInfluence.protectivePenaltyByRegime
        ? capitalRegimeInfluence.protectivePenaltyByRegime
        : {
          NORMAL: 0,
          CAUTION: 0.03,
          DEFENSIVE: 0.07,
          CAPITAL_PRESERVATION: 0.12,
          HALT_NEW_ENTRIES: 0.2,
        },
      strictNoTradeRegimes: Array.isArray(capitalRegimeInfluence.strictNoTradeRegimes)
        ? capitalRegimeInfluence.strictNoTradeRegimes
        : ['HALT_NEW_ENTRIES'],
      tightenRestrictedWindowRegimes: Array.isArray(capitalRegimeInfluence.tightenRestrictedWindowRegimes)
        ? capitalRegimeInfluence.tightenRestrictedWindowRegimes
        : ['CAPITAL_PRESERVATION', 'HALT_NEW_ENTRIES'],
    },
    refreshPolicy: {
      minCyclesBetweenRefresh: Math.max(0, Math.floor(toFiniteNumber(refreshPolicy.minCyclesBetweenRefresh, 2))),
      allowCachedReuse: refreshPolicy.allowCachedReuse !== false,
      cacheKey: refreshPolicy.cacheKey || 'session_filter_engine',
    },
  };
}

function isHourInWindow(hour, window) {
  if (!Number.isFinite(hour)) return false;
  if (!window || !Number.isFinite(window.startHour) || !Number.isFinite(window.endHour)) return false;
  if (window.startHour === window.endHour) return true;
  if (window.startHour < window.endHour) {
    return hour >= window.startHour && hour < window.endHour;
  }
  return hour >= window.startHour || hour < window.endHour;
}

function resolveHourByTimezone(timestampMs, timezone) {
  try {
    const hourFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      hour: '2-digit',
    });
    const hour = Number(hourFormatter.format(new Date(timestampMs)));
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) return { hour: null, timezoneResolved: 'UTC', degraded: true };
    return { hour, timezoneResolved: timezone, degraded: false };
  } catch (_error) {
    const hour = new Date(timestampMs).getUTCHours();
    return { hour, timezoneResolved: 'UTC', degraded: true };
  }
}

function evaluateSessionFilter(input = {}, rawConfig = {}) {
  const config = normalizeConfig(rawConfig);
  const context = input.context || {};
  const runtime = input.runtime || {};
  const featureStoreContext = input.featureStoreContext && typeof input.featureStoreContext === 'object'
    ? input.featureStoreContext
    : null;
  const cacheKey = config.refreshPolicy.cacheKey;
  const cached = featureStoreContext && featureStoreContext[cacheKey] ? featureStoreContext[cacheKey] : null;

  const cycleIndex = toFiniteNumber(context.cycleIndex, 0);
  const allowCachedReuse = config.refreshPolicy.allowCachedReuse !== false;
  const canReuseCache = !!(config.enabled && allowCachedReuse && cached && Number.isFinite(cached.cycleIndex));

  if (canReuseCache && (cycleIndex - cached.cycleIndex) < config.refreshPolicy.minCyclesBetweenRefresh) {
    return {
      ...(cached.decision || {}),
      mode: 'cached_mode',
      cacheWrite: null,
      explanation: {
        ...((cached.decision || {}).explanation || {}),
        runtimeMode: 'cached_mode',
      },
    };
  }

  if (!config.enabled) {
    return {
      layerName: 'sessionFilterLayer',
      direction: 'long_short',
      score: 0.5,
      confidence: 0,
      softPenalty: 0,
      vetoCandidates: [],
      dataQualityState: 'fallback',
      reasonCodes: ['session_filter_disabled'],
      timeContextScore: 0.5,
      sessionState: 'DISABLED',
      timeBasedEntryRestriction: false,
      mode: 'fallback_mode',
      explanation: {
        runtimeMode: 'fallback_mode',
        // Русский комментарий: при выключенном фильтре полностью сохраняется старое торговое поведение.
        ownership: 'disabled_no_impact',
      },
      cacheWrite: null,
    };
  }

  const timestampMs = Number.isFinite(Number(context.timestampMs))
    ? Number(context.timestampMs)
    : (Number.isFinite(Number(runtime.nowMs)) ? Number(runtime.nowMs) : Date.now());
  const resolved = resolveHourByTimezone(timestampMs, config.timezone);
  const hour = resolved.hour;
  const dataQualityState = resolved.degraded ? 'degraded' : 'full';

  const reasonCodes = [];
  const vetoCandidates = [];
  let score = config.baseScore;
  let confidence = config.baseConfidence;
  let softPenalty = 0;
  let sessionState = 'OFF_HOURS';
  let timeBasedEntryRestriction = false;

  if (!Number.isFinite(hour)) {
    softPenalty = clamp01(softPenalty + config.degradedPenaltyOnMissingTime);
    reasonCodes.push('time_context_missing_hour');
  } else {
    const matchedSessions = config.sessions.filter((item) => isHourInWindow(hour, item));
    if (matchedSessions.length > 0) {
      // Русский комментарий: берём сессию с максимальным confidence как primary session context.
      matchedSessions.sort((a, b) => b.confidence - a.confidence);
      const primarySession = matchedSessions[0];
      sessionState = primarySession.sessionState;
      score = clamp01(score * primarySession.scoreMultiplier);
      confidence = clamp01(Math.max(confidence, primarySession.confidence));
      reasonCodes.push(primarySession.reasonCode || 'session_detected');
    } else {
      reasonCodes.push('session_not_matched');
    }

    config.goodWindows.forEach((window) => {
      if (!isHourInWindow(hour, window)) return;
      score = clamp01(score + window.scoreBoost);
      confidence = clamp01(confidence + window.confidenceBoost);
      reasonCodes.push(window.reasonCode || 'good_time_window');
    });

    config.chaoticWindows.forEach((window) => {
      if (!isHourInWindow(hour, window)) return;
      softPenalty = clamp01(softPenalty + window.softPenalty);
      confidence = clamp01(confidence + window.confidenceBoost);
      reasonCodes.push(window.reasonCode || 'chaotic_time_window');
    });

    const inRestrictedWindow = config.restrictedWindows.find((window) => isHourInWindow(hour, window));
    if (inRestrictedWindow) {
      reasonCodes.push(inRestrictedWindow.reasonCode || 'restricted_time_window');
      if (config.noTradeOnRestrictedWindows) {
        timeBasedEntryRestriction = true;
        vetoCandidates.push({ type: 'no_trade_regime', reason: inRestrictedWindow.reasonCode || 'restricted_time_window' });
      }
    }
  }

  const capitalRegime = context.capitalRegime || 'NORMAL';
  const regimePenalty = clamp01(Number((config.capitalRegimeInfluence.protectivePenaltyByRegime || {})[capitalRegime]) || 0);
  if (regimePenalty > 0) {
    softPenalty = clamp01(softPenalty + regimePenalty);
    reasonCodes.push(`capital_regime_time_penalty:${capitalRegime}`);
  }

  if ((config.capitalRegimeInfluence.tightenRestrictedWindowRegimes || []).includes(capitalRegime) && timeBasedEntryRestriction) {
    softPenalty = clamp01(softPenalty + 0.08);
    reasonCodes.push(`capital_regime_tighten_restriction:${capitalRegime}`);
  }

  if (config.capitalRegimeInfluence.mode === 'strict' && (config.capitalRegimeInfluence.strictNoTradeRegimes || []).includes(capitalRegime)) {
    timeBasedEntryRestriction = true;
    vetoCandidates.push({ type: 'capital_prohibition', reason: `capital_regime_strict_time_filter:${capitalRegime}` });
    reasonCodes.push(`capital_regime_strict_time_filter:${capitalRegime}`);
  }

  const timeContextScore = clamp01(score - softPenalty);

  const decision = {
    layerName: 'sessionFilterLayer',
    direction: 'long_short',
    score,
    confidence,
    softPenalty,
    vetoCandidates,
    dataQualityState,
    reasonCodes,
    timeContextScore,
    sessionState,
    timeBasedEntryRestriction,
    mode: dataQualityState === 'degraded' ? 'degraded_mode' : 'full_mode',
    explanation: {
      hour,
      timezoneRequested: config.timezone,
      timezoneResolved: resolved.timezoneResolved,
      sessionState,
      timeContextScore,
      timeBasedEntryRestriction,
      capitalRegime,
      runtimeMode: dataQualityState === 'degraded' ? 'degraded_mode' : 'full_mode',
      usedSharedSnapshot: false,
      // Русский комментарий: слой является context/permission, не заменяет regime-router и не отправляет execution actions.
      layerResponsibility: 'context_permission_only',
    },
  };

  const cacheWrite = featureStoreContext
    ? {
      cycleIndex,
      decision,
      updatedAt: timestampMs,
    }
    : null;

  return {
    ...decision,
    cacheWrite,
  };
}

module.exports = {
  normalizeSessionFilterConfig: normalizeConfig,
  evaluateSessionFilter,
};
