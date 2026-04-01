'use strict';

const DEFAULT_ACTION_MODE = 'warn';
const ALLOWED_ACTION_MODES = new Set(['warn', 'block_averaging', 'partial_reduce', 'force_close']);

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

  return {
    maxNegativeHoldMinutes: Number((regimeAdjust.maxNegativeHoldMinutes || config.maxNegativeHoldMinutes) * holdMultiplier),
    maxPostAveragingNegativeHoldMinutes: Number((regimeAdjust.maxPostAveragingNegativeHoldMinutes || config.maxPostAveragingNegativeHoldMinutes) * holdMultiplier),
    maxLossPercentOnPosition: Number((regimeAdjust.maxLossPercentOnPosition || config.maxLossPercentOnPosition) * lossMultiplier),
    maxAveragesPerPosition: Number(regimeAdjust.maxAveragesPerPosition || config.maxAveragesPerPosition),
    stressConfirmed,
    hasStressSignal,
  };
}

function evaluateForcedLossExit(input = {}, rawConfig = {}) {
  const config = normalizeForcedLossExitConfig(rawConfig);
  const context = input.context || {};
  const position = input.position || {};

  if (!config.enabled) {
    return {
      enabled: false,
      triggered: false,
      actionMode: config.actionMode,
      shouldBlockAveraging: false,
      ownershipAction: null,
      reasons: ['feature_disabled'],
      thresholds: null,
    };
  }

  const thresholds = getEffectiveThresholds(config, context);
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

  let ownershipAction = null;
  if (triggered && config.actionMode === 'partial_reduce') {
    ownershipAction = {
      type: 'position_reduce_request',
      share: Math.max(0.05, Math.min(1, config.partialReduceShare)),
      ownerPath: 'execution_lifecycle_manager',
      cooldownMinutes: config.cooldownMinutesAfterForcedExit,
      cleanupMode: 'via_reconciliation_contour',
    };
  }
  if (triggered && config.actionMode === 'force_close') {
    ownershipAction = {
      type: 'position_force_close_request',
      ownerPath: 'execution_lifecycle_manager',
      cooldownMinutes: config.cooldownMinutesAfterForcedExit,
      cleanupMode: 'via_reconciliation_contour',
    };
  }

  return {
    enabled: true,
    triggered,
    actionMode: config.actionMode,
    shouldBlockAveraging,
    ownershipAction,
    reasons,
    thresholds,
    conditions,
  };
}

function toForcedLossExitEvent(input = {}) {
  const decision = input.decision || {};
  const context = input.context || {};

  return {
    eventType: 'forced_loss_exit_decision',
    cycleId: context.cycleId || '',
    ticker: context.ticker || '',
    exchange: context.exchange || '',
    module: 'forcedLossExit',
    layer: 'risk.positionProtection',
    marketRegime: context.marketRegime || 'unknown',
    capitalRegime: context.capitalRegime || 'unknown',
    setupType: context.setupType || 'unknown',
    score: Number.isFinite(context.score) ? context.score : 0,
    confidence: Number.isFinite(context.confidence) ? context.confidence : 0,
    vetoReason: decision.triggered ? `forced_loss_exit:${(decision.reasons || []).join(',')}` : null,
    sizingDecision: decision.shouldBlockAveraging ? 'averaging_blocked' : 'unchanged',
    executionAction: decision.ownershipAction ? decision.ownershipAction.type : 'none',
    fallbackAction: decision.actionMode === 'warn' ? 'log_only' : 'none',
    finalDecision: decision.triggered ? decision.actionMode : 'no_action',
    payload: decision,
  };
}

module.exports = {
  normalizeForcedLossExitConfig,
  evaluateForcedLossExit,
  toForcedLossExitEvent,
};
