'use strict';

const DEFAULT_ACTION_MODE = 'warn';
const ALLOWED_ACTION_MODES = new Set(['warn', 'block_averaging', 'partial_reduce', 'force_close']);
const ALLOWED_EARLY_INVALIDATION_ACTIONS = new Set(['partial_reduce', 'force_close']);
const PROTECTIVE_CLOSE_SOURCES = new Set(['server_sl', 'early_invalidation', 'forced_loss_exit', 'lifecycle_close']);
const PROTECTIVE_OWNER_SERVER_SL = 'server_stop_loss_manager';
const PROTECTIVE_OWNER_LIFECYCLE = 'execution_lifecycle_manager';

function normalizeForcedLossExitConfig(config = {}) {
  const regimeTightening = config.regimeTightening || {};
  const forecastInfluence = config.forecastInfluence || {};

  return {
    enabled: !!config.enabled,
    maxNegativeHoldMinutes: Number(config.maxNegativeHoldMinutes || 0),
    maxPostAveragingNegativeHoldMinutes: Number(config.maxPostAveragingNegativeHoldMinutes || 0),
    maxLossPercentOnPosition: Number(config.maxLossPercentOnPosition || 0),
    maxAveragesPerPosition: Number(config.maxAveragesPerPosition || 0),
    requireAdverseMarketConfirmation: !!config.requireAdverseMarketConfirmation,
    actionMode: ALLOWED_ACTION_MODES.has(config.actionMode) ? config.actionMode : DEFAULT_ACTION_MODE,
    partialReduceShare: Number(config.partialReduceShare || 0.25),
    cooldownMinutesAfterForcedExit: Number(config.cooldownMinutesAfterForcedExit || 0),
    // Русский комментарий: ранний слой post-entry observation живёт между server SL и legacy forced/stuck fallback.
    postEntryObservation: {
      enablePostEntryObservation: !!config.enablePostEntryObservation,
      postEntryGraceMinutes: Number(config.postEntryGraceMinutes || 0),
      postEntryObservationMinutes: Number(config.postEntryObservationMinutes || 0),
      maxTimeUnderEntryWithoutRecovery: Number(config.maxTimeUnderEntryWithoutRecovery || 0),
      earlyInvalidationLossPercent: Number(config.earlyInvalidationLossPercent || 0),
      requirePersistentAdverseTrend: config.requirePersistentAdverseTrend !== false,
      adverseTrendConfirmationBars: Number(config.adverseTrendConfirmationBars || 0),
      adverseTrendSlopeThreshold: Number(config.adverseTrendSlopeThreshold || 0),
      requireAdverseMarketConfirmation: !!config.requireAdverseMarketConfirmation,
      actionOnEarlyInvalidation: ALLOWED_EARLY_INVALIDATION_ACTIONS.has(config.actionOnEarlyInvalidation)
        ? config.actionOnEarlyInvalidation
        : 'force_close',
      // Русский комментарий: future-proof точка интеграции forecast hints без жёсткой зависимости.
      useForecastProtectiveHints: !!config.useForecastProtectiveHints,
    },
    regimeTightening: {
      enabled: !!regimeTightening.enabled,
      byCapitalRegime: typeof regimeTightening.byCapitalRegime === 'object' && regimeTightening.byCapitalRegime
        ? regimeTightening.byCapitalRegime
        : {},
    },
    forecastInfluence: {
      enabled: !!forecastInfluence.enabled,
      requireStressSignal: !!forecastInfluence.requireStressSignal,
      stressSignals: Array.isArray(forecastInfluence.stressSignals) ? forecastInfluence.stressSignals : [],
      lossMultiplierOnStress: Number(forecastInfluence.lossMultiplierOnStress || 1),
      holdMinutesMultiplierOnStress: Number(forecastInfluence.holdMinutesMultiplierOnStress || 1),
    },
  };
}

function preferTighterLimit(baseValue, overrideValue) {
  if (overrideValue <= 0) return baseValue;
  if (baseValue <= 0) return overrideValue;
  return Math.min(baseValue, overrideValue);
}

function getEffectiveThresholds(config, runtimeContext = {}) {
  const capitalRegime = runtimeContext.capitalRegime || 'NORMAL';
  const tightening = config.regimeTightening || {};
  const byRegime = tightening.byCapitalRegime || {};
  const regimeAdjust = tightening.enabled ? (byRegime[capitalRegime] || {}) : {};

  const forecastInfluence = config.forecastInfluence || {};
  const forecastSignals = Array.isArray(runtimeContext.forecastSignals) ? runtimeContext.forecastSignals : [];
  const hasStressSignal = forecastInfluence.enabled && (forecastInfluence.stressSignals || []).some((s) => forecastSignals.includes(s));
  const stressConfirmed = !forecastInfluence.enabled
    || !forecastInfluence.requireStressSignal
    || hasStressSignal;

  const lossMultiplier = hasStressSignal ? Number(forecastInfluence.lossMultiplierOnStress || 1) : 1;
  const holdMultiplier = hasStressSignal ? Number(forecastInfluence.holdMinutesMultiplierOnStress || 1) : 1;

  const baseEarly = config.postEntryObservation || {};
  const effectiveEarly = {
    ...baseEarly,
    postEntryGraceMinutes: preferTighterLimit(Number(baseEarly.postEntryGraceMinutes || 0), Number(regimeAdjust.postEntryGraceMinutes || 0)),
    postEntryObservationMinutes: preferTighterLimit(Number(baseEarly.postEntryObservationMinutes || 0), Number(regimeAdjust.postEntryObservationMinutes || 0)),
    maxTimeUnderEntryWithoutRecovery: preferTighterLimit(Number(baseEarly.maxTimeUnderEntryWithoutRecovery || 0), Number(regimeAdjust.maxTimeUnderEntryWithoutRecovery || 0)),
    earlyInvalidationLossPercent: preferTighterLimit(Number(baseEarly.earlyInvalidationLossPercent || 0), Number(regimeAdjust.earlyInvalidationLossPercent || 0)),
    adverseTrendConfirmationBars: preferTighterLimit(Number(baseEarly.adverseTrendConfirmationBars || 0), Number(regimeAdjust.adverseTrendConfirmationBars || 0)),
    adverseTrendSlopeThreshold: preferTighterLimit(Number(baseEarly.adverseTrendSlopeThreshold || 0), Number(regimeAdjust.adverseTrendSlopeThreshold || 0)),
  };

  return {
    maxNegativeHoldMinutes: Number((regimeAdjust.maxNegativeHoldMinutes || config.maxNegativeHoldMinutes) * holdMultiplier),
    maxPostAveragingNegativeHoldMinutes: Number((regimeAdjust.maxPostAveragingNegativeHoldMinutes || config.maxPostAveragingNegativeHoldMinutes) * holdMultiplier),
    maxLossPercentOnPosition: Number((regimeAdjust.maxLossPercentOnPosition || config.maxLossPercentOnPosition) * lossMultiplier),
    maxAveragesPerPosition: Number(regimeAdjust.maxAveragesPerPosition || config.maxAveragesPerPosition),
    postEntryObservation: effectiveEarly,
    stressConfirmed,
    hasStressSignal,
  };
}

function safeNumber(value, fallback = 0) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function resolveMinutesSinceEntry(position = {}) {
  if (Number.isFinite(Number(position.minutesSinceEntry))) return Number(position.minutesSinceEntry);
  const openedAt = position.openedAt || position.entryAt;
  if (!openedAt) return null;
  const parsed = new Date(openedAt).getTime();
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, (Date.now() - parsed) / 60000);
}

function resolveEntryDeviationPercent(position = {}) {
  if (Number.isFinite(Number(position.entryDeviationPercent))) return Number(position.entryDeviationPercent);
  const entryPrice = Number(position.entryPrice);
  const markPrice = Number(position.markPrice || position.currentPrice || position.lastPrice);
  const side = String(position.side || '').toUpperCase();
  if (!Number.isFinite(entryPrice) || !Number.isFinite(markPrice) || entryPrice <= 0) return null;
  const rawMovePercent = ((markPrice - entryPrice) / entryPrice) * 100;
  return side === 'SHORT' ? -rawMovePercent : rawMovePercent;
}

function evaluateAdverseTrendEvidence(position = {}, thresholds = {}, context = {}) {
  const slopeThreshold = Math.abs(Number(thresholds.adverseTrendSlopeThreshold || 0));
  const requiredBars = Math.max(0, Number(thresholds.adverseTrendConfirmationBars || 0));
  const explicitConfirmed = typeof position.adverseTrendConfirmed === 'boolean' ? position.adverseTrendConfirmed : null;
  const explicitSlope = Number(position.adverseTrendSlope);
  const explicitBars = Number(position.adverseTrendBars);
  const barsSeries = Array.isArray(position.adverseTrendSeries) ? position.adverseTrendSeries : null;

  if (explicitConfirmed !== null) {
    return {
      confirmed: explicitConfirmed,
      insufficientData: false,
      slope: Number.isFinite(explicitSlope) ? explicitSlope : null,
      bars: Number.isFinite(explicitBars) ? explicitBars : null,
      source: 'explicit_flag',
    };
  }

  if (Number.isFinite(explicitBars) || Number.isFinite(explicitSlope)) {
    const barsEnough = requiredBars <= 0 || (Number.isFinite(explicitBars) && explicitBars >= requiredBars);
    const slopeEnough = slopeThreshold <= 0 || (Number.isFinite(explicitSlope) && explicitSlope >= slopeThreshold);
    return {
      confirmed: barsEnough && slopeEnough,
      insufficientData: !Number.isFinite(explicitBars) && !Number.isFinite(explicitSlope),
      slope: Number.isFinite(explicitSlope) ? explicitSlope : null,
      bars: Number.isFinite(explicitBars) ? explicitBars : null,
      source: 'explicit_metrics',
    };
  }

  if (barsSeries && barsSeries.length >= 2) {
    const numeric = barsSeries.map((x) => Number(x)).filter((x) => Number.isFinite(x));
    if (numeric.length < 2) {
      return { confirmed: false, insufficientData: true, slope: null, bars: numeric.length, source: 'series_invalid' };
    }
    const first = numeric[0];
    const last = numeric[numeric.length - 1];
    const slope = ((last - first) / Math.max(1, numeric.length - 1));
    const barsEnough = requiredBars <= 0 || numeric.length >= requiredBars;
    const slopeEnough = slopeThreshold <= 0 || slope >= slopeThreshold;
    return {
      confirmed: barsEnough && slopeEnough,
      insufficientData: false,
      slope,
      bars: numeric.length,
      source: 'series_slope',
    };
  }

  const forecastHints = Array.isArray(context.forecastProtectiveHints) ? context.forecastProtectiveHints : [];
  const forecastConfirmed = forecastHints.includes('early_invalidation_adverse_trend_confirmed')
    || forecastHints.includes('protective_early_exit_preferred');

  return {
    confirmed: forecastConfirmed,
    insufficientData: !forecastConfirmed,
    slope: null,
    bars: null,
    source: forecastConfirmed ? 'forecast_hint' : 'insufficient',
  };
}

function toOwnershipAction(actionMode, config) {
  if (actionMode === 'partial_reduce') {
    return {
      type: 'position_reduce_request',
      share: Math.max(0.05, Math.min(1, safeNumber(config.partialReduceShare, 0.25))),
      ownerPath: PROTECTIVE_OWNER_LIFECYCLE,
      cooldownMinutes: safeNumber(config.cooldownMinutesAfterForcedExit, 0),
      cleanupMode: 'via_reconciliation_contour',
    };
  }
  if (actionMode === 'force_close') {
    return {
      type: 'position_force_close_request',
      ownerPath: PROTECTIVE_OWNER_LIFECYCLE,
      cooldownMinutes: safeNumber(config.cooldownMinutesAfterForcedExit, 0),
      cleanupMode: 'via_reconciliation_contour',
    };
  }
  return null;
}

function normalizeCloseSource(rawSource, fallbackSource) {
  if (PROTECTIVE_CLOSE_SOURCES.has(rawSource)) return rawSource;
  return fallbackSource;
}

function resolveProtectiveActionToken(input = {}) {
  const context = input.context || {};
  const position = input.position || {};
  const state = context.protectiveActionState || {};
  const serverSlState = context.serverStopLossState || {};

  if (state.token) return String(state.token);
  if (serverSlState.protectiveActionToken) return String(serverSlState.protectiveActionToken);
  if (context.protectiveActionToken) return String(context.protectiveActionToken);

  const cycleId = context.cycleId || 'n/a';
  const ticker = context.ticker || position.ticker || 'n/a';
  const positionId = position.positionId || position.id || position.externalId || position.side || 'n/a';
  return `protective-close:${ticker}:${positionId}:${cycleId}`;
}

function resolveServerStopLossCloseState(input = {}) {
  const context = input.context || {};
  const serverSlState = context.serverStopLossState || {};
  const status = String(serverSlState.status || '').toLowerCase();
  const closeInitiated = serverSlState.closeInitiated === true || ['triggered', 'initiated', 'close_initiated', 'working'].includes(status);
  const closeConfirmed = serverSlState.closeConfirmed === true || ['filled', 'close_confirmed', 'confirmed', 'closed'].includes(status);
  return {
    owner: serverSlState.runtimeOwner || PROTECTIVE_OWNER_SERVER_SL,
    closeInitiated,
    closeConfirmed,
    status: status || 'unknown',
    protectiveActionToken: serverSlState.protectiveActionToken || null,
  };
}

function applyProtectiveOwnershipGuard(decision = {}, input = {}) {
  const context = input.context || {};
  const actionType = decision && decision.ownershipAction ? decision.ownershipAction.type : null;
  const isCloseAction = actionType === 'position_force_close_request';
  const runtimeToken = resolveProtectiveActionToken(input);
  const serverCloseState = resolveServerStopLossCloseState(input);
  const runtimeState = context.protectiveActionState || {};

  const fallbackSource = decision.triggerStage === 'early_invalidation_exit' ? 'early_invalidation' : 'forced_loss_exit';
  const closeSource = normalizeCloseSource(context.protectiveCloseSource, fallbackSource);

  const localActionAlreadyOwned = runtimeState.closeInitiated === true
    || runtimeState.closeConfirmed === true
    || runtimeState.status === 'initiated'
    || runtimeState.status === 'confirmed';

  const mustDeduplicate = isCloseAction && (
    serverCloseState.closeInitiated
    || serverCloseState.closeConfirmed
    || localActionAlreadyOwned
  );

  const protectiveActionOwner = (serverCloseState.closeInitiated || serverCloseState.closeConfirmed)
    ? serverCloseState.owner
    : (runtimeState.owner || PROTECTIVE_OWNER_LIFECYCLE);

  return {
    ...decision,
    ownershipAction: mustDeduplicate ? null : decision.ownershipAction,
    protectiveActionOwner,
    protectiveActionToken: runtimeToken,
    duplicateClosePrevented: mustDeduplicate,
    closeSource,
    runtimeOwnership: {
      serverStopLoss: {
        owner: serverCloseState.owner,
        closeInitiated: serverCloseState.closeInitiated,
        closeConfirmed: serverCloseState.closeConfirmed,
        status: serverCloseState.status,
      },
      lifecycleOwner: PROTECTIVE_OWNER_LIFECYCLE,
      deduplicated: mustDeduplicate,
    },
  };
}

function evaluateEarlyInvalidation(input = {}, config = {}, thresholds = {}) {
  const context = input.context || {};
  const position = input.position || {};
  const early = thresholds.postEntryObservation || {};

  if (!early.enablePostEntryObservation) {
    return {
      enabled: false,
      triggered: false,
      reasons: ['post_entry_observation_disabled'],
      diagnostics: { regimeTighteningApplied: false },
    };
  }

  const minutesSinceEntry = resolveMinutesSinceEntry(position);
  const deviationPercent = resolveEntryDeviationPercent(position);
  const graceMinutes = safeNumber(early.postEntryGraceMinutes, 0);
  const observationMinutes = safeNumber(early.postEntryObservationMinutes, 0);
  const maxAdverseMinutes = safeNumber(early.maxTimeUnderEntryWithoutRecovery, 0);
  const adverseLossPercent = Math.abs(safeNumber(early.earlyInvalidationLossPercent, 0));
  const adverseMarketConfirmed = position.adverseMarketConfirmed !== false;

  const adverseMinutes = Number.isFinite(Number(position.timeUnderEntryWithoutRecoveryMinutes))
    ? Number(position.timeUnderEntryWithoutRecoveryMinutes)
    : Math.max(0, safeNumber(position.holdMinutesInLoss, 0));

  const inAdverseZone = Number.isFinite(deviationPercent) && deviationPercent < 0;
  const recoveredToEntry = Number.isFinite(deviationPercent) && deviationPercent >= 0;
  const inGraceWindow = Number.isFinite(minutesSinceEntry) && minutesSinceEntry < graceMinutes;
  const withinObservationWindow = Number.isFinite(minutesSinceEntry)
    && minutesSinceEntry >= graceMinutes
    && (observationMinutes <= 0 || minutesSinceEntry <= (graceMinutes + observationMinutes));

  const adverseTrend = evaluateAdverseTrendEvidence(position, early, context);
  const requireTrend = !!early.requirePersistentAdverseTrend;
  const trendGatePassed = !requireTrend || adverseTrend.confirmed;
  const marketGatePassed = !early.requireAdverseMarketConfirmation || adverseMarketConfirmed;
  const lossGatePassed = adverseLossPercent <= 0 || (Number.isFinite(deviationPercent) && deviationPercent <= -adverseLossPercent);
  const adverseHoldGatePassed = maxAdverseMinutes <= 0 || adverseMinutes >= maxAdverseMinutes;

  const scenarioBroken = inAdverseZone
    && !recoveredToEntry
    && adverseHoldGatePassed
    && lossGatePassed
    && trendGatePassed;

  const enoughData = Number.isFinite(minutesSinceEntry)
    && Number.isFinite(deviationPercent)
    && (!requireTrend || !adverseTrend.insufficientData);

  const triggered = scenarioBroken
    && marketGatePassed
    && withinObservationWindow
    && !inGraceWindow
    && enoughData;

  const reasons = [];
  if (!Number.isFinite(minutesSinceEntry)) reasons.push('missing_minutes_since_entry');
  if (!Number.isFinite(deviationPercent)) reasons.push('missing_entry_deviation');
  if (inGraceWindow) reasons.push('post_entry_grace_active');
  if (!withinObservationWindow) reasons.push('outside_observation_window');
  if (!inAdverseZone) reasons.push('price_not_in_adverse_zone');
  if (recoveredToEntry) reasons.push('recovery_to_entry_detected');
  if (!adverseHoldGatePassed) reasons.push('adverse_hold_time_not_reached');
  if (!lossGatePassed) reasons.push('early_invalidation_loss_not_reached');
  if (requireTrend && !trendGatePassed) reasons.push(adverseTrend.insufficientData ? 'adverse_trend_data_insufficient' : 'adverse_trend_not_confirmed');
  if (!marketGatePassed) reasons.push('adverse_market_not_confirmed');

  return {
    enabled: true,
    triggered,
    reasons,
    actionMode: early.actionOnEarlyInvalidation,
    diagnostics: {
      minutesSinceEntry,
      entryDeviationPercent: deviationPercent,
      timeUnderEntryWithoutRecoveryMinutes: adverseMinutes,
      adverseTrendConfirmed: adverseTrend.confirmed,
      adverseTrendInsufficientData: adverseTrend.insufficientData,
      adverseTrendBars: adverseTrend.bars,
      adverseTrendSlope: adverseTrend.slope,
      adverseTrendSource: adverseTrend.source,
      scenarioBroken,
      inGraceWindow,
      withinObservationWindow,
      marketGatePassed,
      trendGatePassed,
      lossGatePassed,
      adverseHoldGatePassed,
      forecastHintUsed: adverseTrend.source === 'forecast_hint',
      capitalRegime: context.capitalRegime || 'unknown',
      positionCapabilityState: context.positionCapabilityState || position.positionCapabilityState || 'unknown',
    },
  };
}

function evaluateForcedLossExit(input = {}, rawConfig = {}) {
  const config = normalizeForcedLossExitConfig(rawConfig);
  const context = input.context || {};
  const position = input.position || {};

  if (!config.enabled) {
    return applyProtectiveOwnershipGuard({
      enabled: false,
      triggered: false,
      actionMode: config.actionMode,
      shouldBlockAveraging: false,
      ownershipAction: null,
      reasons: ['feature_disabled'],
      thresholds: null,
      triggerStage: null,
      earlyInvalidation: { enabled: false, triggered: false, reasons: ['forced_loss_exit_disabled'] },
    }, input);
  }

  const thresholds = getEffectiveThresholds(config, context);
  const earlyInvalidation = evaluateEarlyInvalidation(input, config, thresholds);

  if (earlyInvalidation.triggered) {
    const ownershipAction = toOwnershipAction(earlyInvalidation.actionMode, config);
    const shouldBlockAveraging = ['partial_reduce', 'force_close'].includes(earlyInvalidation.actionMode);
    return applyProtectiveOwnershipGuard({
      enabled: true,
      triggered: true,
      actionMode: earlyInvalidation.actionMode,
      shouldBlockAveraging,
      ownershipAction,
      reasons: ['early_invalidation_exit', ...(earlyInvalidation.reasons || [])],
      thresholds,
      conditions: {
        earlyInvalidationTriggered: true,
        legacyForcedLossEvaluated: false,
      },
      triggerStage: 'early_invalidation_exit',
      earlyInvalidation,
    }, input);
  }

  const pnlPercent = Number(position.pnlPercent || 0);
  const holdMinutesInLoss = Number(position.holdMinutesInLoss || 0);
  const postAveragingHoldMinutesInLoss = Number(position.postAveragingHoldMinutesInLoss || 0);
  const averagesCount = Number(position.averagesCount || 0);
  const adverseMarketConfirmed = position.adverseMarketConfirmed !== false;

  const conditions = {
    lossLimitExceeded: thresholds.maxLossPercentOnPosition > 0 && pnlPercent <= -Math.abs(thresholds.maxLossPercentOnPosition),
    staleNegativeHoldExceeded: thresholds.maxNegativeHoldMinutes > 0 && holdMinutesInLoss >= thresholds.maxNegativeHoldMinutes,
    postAveragingStaleNegativeHoldExceeded: thresholds.maxPostAveragingNegativeHoldMinutes > 0
      && postAveragingHoldMinutesInLoss >= thresholds.maxPostAveragingNegativeHoldMinutes,
    averagesLimitExceeded: thresholds.maxAveragesPerPosition > 0 && averagesCount >= thresholds.maxAveragesPerPosition,
    adverseMarketConfirmed: !!adverseMarketConfirmed,
    forecastGatePassed: !!thresholds.stressConfirmed,
  };

  const negativeStateDetected = conditions.lossLimitExceeded
    || conditions.staleNegativeHoldExceeded
    || conditions.postAveragingStaleNegativeHoldExceeded
    || conditions.averagesLimitExceeded;

  const marketGatePassed = !config.requireAdverseMarketConfirmation || conditions.adverseMarketConfirmed;
  const triggered = negativeStateDetected && marketGatePassed && conditions.forecastGatePassed;

  const reasons = Object.entries(conditions)
    .filter(([key, value]) => key !== 'adverseMarketConfirmed' && key !== 'forecastGatePassed' && value)
    .map(([key]) => key);

  const shouldBlockAveraging = triggered && ['block_averaging', 'partial_reduce', 'force_close'].includes(config.actionMode);
  const ownershipAction = triggered ? toOwnershipAction(config.actionMode, config) : null;

  return applyProtectiveOwnershipGuard({
    enabled: true,
    triggered,
    actionMode: config.actionMode,
    shouldBlockAveraging,
    ownershipAction,
    reasons,
    thresholds,
    conditions: {
      ...conditions,
      earlyInvalidationTriggered: false,
      legacyForcedLossEvaluated: true,
    },
    triggerStage: triggered ? 'forced_loss_exit_fallback' : null,
    earlyInvalidation,
  }, input);
}

function toForcedLossExitEvent(input = {}) {
  const decision = input.decision || {};
  const context = input.context || {};

  return {
    eventType: 'forced_loss_exit_decision',
    cycleId: context.cycleId || '',
    ticker: context.ticker || '',
    exchange: context.exchange || '',
    mode: context.mode || 'live',
    module: 'forcedLossExit',
    layer: 'risk.positionProtection',
    marketRegime: context.marketRegime || 'unknown',
    capitalRegime: context.capitalRegime || 'unknown',
    positionCapabilityState: context.positionCapabilityState || 'unknown',
    setupType: context.setupType || 'unknown',
    score: Number.isFinite(context.score) ? context.score : 0,
    confidence: Number.isFinite(context.confidence) ? context.confidence : 0,
    vetoReason: decision.triggered ? `forced_loss_exit:${(decision.reasons || []).join(',')}` : null,
    sizingDecision: decision.shouldBlockAveraging ? 'averaging_blocked' : 'unchanged',
    executionAction: decision.ownershipAction ? decision.ownershipAction.type : 'none',
    protectiveActionOwner: decision.protectiveActionOwner || PROTECTIVE_OWNER_LIFECYCLE,
    protectiveActionToken: decision.protectiveActionToken || null,
    duplicateClosePrevented: decision.duplicateClosePrevented === true,
    closeSource: decision.closeSource || 'forced_loss_exit',
    fallbackAction: decision.actionMode === 'warn' ? 'log_only' : 'none',
    finalDecision: decision.triggered ? decision.actionMode : 'no_action',
    triggerStage: decision.triggerStage || 'none',
    earlyInvalidationReason: decision && decision.earlyInvalidation && decision.earlyInvalidation.triggered
      ? (decision.earlyInvalidation.reasons || []).join(',')
      : null,
    payload: decision,
  };
}

module.exports = {
  normalizeForcedLossExitConfig,
  evaluateForcedLossExit,
  toForcedLossExitEvent,
};
