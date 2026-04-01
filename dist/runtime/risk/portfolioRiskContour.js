'use strict';

const {
  CAPITAL_REGIMES,
  evaluateCapitalRegime,
  buildCapitalRegimeDownstreamContext,
  normalizeCapitalRegimeEngineConfig,
  getMaxRegime,
} = require('./capitalRegimeEngine');

function normalizePortfolioRiskContourConfig(config = {}) {
  const cooldown = config.cooldownAfterBadStreak || {};
  const thresholds = config.capitalRegimeThresholds || {};
  const capitalRegimeEngine = config.capitalRegimeEngine || {};

  return {
    enabled: !!config.enabled,
    dailyLossLimitPercent: Number(config.dailyLossLimitPercent || 0),
    maxNewEntriesPerDay: Number(config.maxNewEntriesPerDay || 0),
    maxOpenPositions: Number(config.maxOpenPositions || 0),
    maxUsedMarginPercent: Number(config.maxUsedMarginPercent || 0),
    cooldownAfterBadStreak: {
      enabled: !!cooldown.enabled,
      consecutiveBadCycles: Number(cooldown.consecutiveBadCycles || 0),
      consecutiveLosingClosures: Number(cooldown.consecutiveLosingClosures || 0),
      pauseMinutes: Number(cooldown.pauseMinutes || 0),
    },
    capitalRegimeThresholds: {
      cautionDailyLossPercent: Number(thresholds.cautionDailyLossPercent || 0),
      defensiveDailyLossPercent: Number(thresholds.defensiveDailyLossPercent || 0),
      capitalPreservationDailyLossPercent: Number(thresholds.capitalPreservationDailyLossPercent || 0),
      haltDailyLossPercent: Number(thresholds.haltDailyLossPercent || 0),
      cautionMarginUsagePercent: Number(thresholds.cautionMarginUsagePercent || 0),
      defensiveMarginUsagePercent: Number(thresholds.defensiveMarginUsagePercent || 0),
      capitalPreservationMarginUsagePercent: Number(thresholds.capitalPreservationMarginUsagePercent || 0),
      haltMarginUsagePercent: Number(thresholds.haltMarginUsagePercent || 0),
    },
    capitalRegimeEngine: normalizeCapitalRegimeEngineConfig({
      enabled: capitalRegimeEngine.enabled,
      escalationOnly: capitalRegimeEngine.escalationOnly,
      thresholds: {
        cautionDailyLossPercent: Number(thresholds.cautionDailyLossPercent || 0),
        defensiveDailyLossPercent: Number(thresholds.defensiveDailyLossPercent || 0),
        capitalPreservationDailyLossPercent: Number(thresholds.capitalPreservationDailyLossPercent || 0),
        haltDailyLossPercent: Number(thresholds.haltDailyLossPercent || 0),
        cautionMarginUsagePercent: Number(thresholds.cautionMarginUsagePercent || 0),
        defensiveMarginUsagePercent: Number(thresholds.defensiveMarginUsagePercent || 0),
        capitalPreservationMarginUsagePercent: Number(thresholds.capitalPreservationMarginUsagePercent || 0),
        haltMarginUsagePercent: Number(thresholds.haltMarginUsagePercent || 0),
        cautionBalanceDrawdownPercent: Number(capitalRegimeEngine.cautionBalanceDrawdownPercent || 0),
        defensiveBalanceDrawdownPercent: Number(capitalRegimeEngine.defensiveBalanceDrawdownPercent || 0),
        capitalPreservationBalanceDrawdownPercent: Number(capitalRegimeEngine.capitalPreservationBalanceDrawdownPercent || 0),
        haltBalanceDrawdownPercent: Number(capitalRegimeEngine.haltBalanceDrawdownPercent || 0),
      },
    }),
  };
}

function evaluatePortfolioRiskContour(input = {}, rawConfig = {}) {
  const config = normalizePortfolioRiskContourConfig(rawConfig);
  const context = input.context || {};
  const stats = input.stats || {};
  const nowMs = Number(context.timestampMs || Date.now());

  if (!config.enabled) {
    return {
      enabled: false,
      allowNewEntries: true,
      balanceState: { capitalRegime: CAPITAL_REGIMES.NORMAL, reasons: ['feature_disabled'] },
      hardVeto: null,
      limits: {},
      telemetry: {},
    };
  }

  const dayPnlPercent = Math.abs(Math.min(0, Number(stats.dayPnlPercent || 0)));
  const newEntriesToday = Number(stats.newEntriesToday || 0);
  const openPositionsCount = Number(stats.openPositionsCount || 0);
  const usedMarginPercent = Math.max(0, Number(stats.usedMarginPercent || 0));
  const badCyclesStreak = Number(stats.badCyclesStreak || 0);
  const losingClosuresStreak = Number(stats.losingClosuresStreak || 0);
  const cooldownUntilMs = Number(stats.cooldownUntilMs || 0);

  const regimeDecision = evaluateCapitalRegime({
    context,
    stats,
  }, config.capitalRegimeEngine);
  let capitalRegime = regimeDecision.capitalRegime;
  const reasons = Array.isArray(regimeDecision.reasons) ? [...regimeDecision.reasons] : [];

  const limitsBreached = [];
  if (config.dailyLossLimitPercent > 0 && dayPnlPercent >= config.dailyLossLimitPercent) {
    limitsBreached.push('daily_loss_limit');
  }
  if (config.maxNewEntriesPerDay > 0 && newEntriesToday >= config.maxNewEntriesPerDay) {
    limitsBreached.push('new_entries_limit');
  }
  if (config.maxOpenPositions > 0 && openPositionsCount >= config.maxOpenPositions) {
    limitsBreached.push('open_positions_limit');
  }
  if (config.maxUsedMarginPercent > 0 && usedMarginPercent >= config.maxUsedMarginPercent) {
    limitsBreached.push('used_margin_limit');
  }

  let nextCooldownUntilMs = cooldownUntilMs;
  const cooldown = config.cooldownAfterBadStreak;
  const pauseTriggeredByCycles = cooldown.enabled
    && cooldown.consecutiveBadCycles > 0
    && badCyclesStreak >= cooldown.consecutiveBadCycles;
  const pauseTriggeredByClosures = cooldown.enabled
    && cooldown.consecutiveLosingClosures > 0
    && losingClosuresStreak >= cooldown.consecutiveLosingClosures;

  if ((pauseTriggeredByCycles || pauseTriggeredByClosures) && cooldown.pauseMinutes > 0) {
    nextCooldownUntilMs = Math.max(nextCooldownUntilMs, nowMs + (cooldown.pauseMinutes * 60 * 1000));
    limitsBreached.push('cooldown_after_bad_streak');
  }

  const cooldownActive = nextCooldownUntilMs > nowMs;
  if (cooldownActive) {
    reasons.push('cooldown_active');
    capitalRegime = getMaxRegime(capitalRegime, CAPITAL_REGIMES.CAPITAL_PRESERVATION);
  }

  let hardVeto = null;
  if (limitsBreached.length > 0 || capitalRegime === CAPITAL_REGIMES.HALT_NEW_ENTRIES) {
    hardVeto = {
      type: 'capital_prohibition',
      reason: limitsBreached[0] || 'capital_regime_halt',
      reasons: limitsBreached.length > 0 ? limitsBreached : ['capital_regime_halt'],
      layer: 'risk.portfolioContour',
    };
  }

  return {
    enabled: true,
    allowNewEntries: !hardVeto,
    balanceState: {
      capitalRegime,
      reasons,
      previousCapitalRegime: context.previousCapitalRegime || CAPITAL_REGIMES.NORMAL,
      regimeChanged: (context.previousCapitalRegime || CAPITAL_REGIMES.NORMAL) !== capitalRegime,
      forecastRegimeShiftRisk: context.forecastRegimeShiftRisk || null,
    },
    hardVeto,
    limits: {
      dayPnlPercent,
      newEntriesToday,
      openPositionsCount,
      usedMarginPercent,
      cooldownUntilMs: nextCooldownUntilMs,
      cooldownActive,
      badCyclesStreak,
      losingClosuresStreak,
    },
      telemetry: {
        limitsBreached,
      regimeByLoss: regimeDecision.telemetry.regimeByLoss,
      regimeByMargin: regimeDecision.telemetry.regimeByMargin,
      regimeByDrawdown: regimeDecision.telemetry.regimeByDrawdown,
      // Русский комментарий: отдельная передача capitalRegime в downstream-слои без обхода risk-gates.
      downstreamContext: buildCapitalRegimeDownstreamContext({
        cycleId: context.cycleId,
        ticker: context.ticker,
        exchange: context.exchange,
        marketRegime: context.marketRegime,
        capitalRegime,
        forecastRegimeShiftRisk: context.forecastRegimeShiftRisk,
        forecastSignals: context.forecastSignals,
      }),
      routerOrder: [
        'risk_contour',
        'portfolio_forecast_engine',
        'entry_permission_layer',
        'market_regime_router',
        'dynamic_asset_selection',
        'dynamic_position_sizing',
      ],
    },
  };
}

function toPortfolioRiskContourEvent(input = {}) {
  const decision = input.decision || {};
  const context = input.context || {};

  return {
    eventType: 'portfolio_risk_contour_decision',
    cycleId: context.cycleId || '',
    ticker: context.ticker || 'PORTFOLIO',
    exchange: context.exchange || '',
    module: 'portfolioRiskContour',
    layer: 'risk.portfolioContour',
    marketRegime: context.marketRegime || 'unknown',
    capitalRegime: decision.balanceState && decision.balanceState.capitalRegime ? decision.balanceState.capitalRegime : 'NORMAL',
    forecastRegimeShiftRisk: decision.balanceState ? (decision.balanceState.forecastRegimeShiftRisk || null) : null,
    setupType: context.setupType || 'portfolio',
    score: Number.isFinite(context.score) ? context.score : 0,
    confidence: Number.isFinite(context.confidence) ? context.confidence : 0,
    vetoReason: decision.hardVeto ? decision.hardVeto.reason : null,
    sizingDecision: context.sizingDecision || 'not_evaluated',
    executionAction: decision.allowNewEntries ? 'allow_new_entries' : 'block_new_entries',
    fallbackAction: decision.enabled ? 'none' : 'legacy_entry_flow',
    finalDecision: decision.allowNewEntries ? 'allow' : 'block',
    payload: {
      balanceState: decision.balanceState || null,
      limits: decision.limits || null,
      telemetry: decision.telemetry || null,
      hardVeto: decision.hardVeto || null,
    },
  };
}

module.exports = {
  CAPITAL_REGIMES,
  normalizePortfolioRiskContourConfig,
  evaluatePortfolioRiskContour,
  toPortfolioRiskContourEvent,
};
