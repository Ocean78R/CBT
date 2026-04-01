const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluatePortfolioRiskContour,
  toPortfolioRiskContourEvent,
  CAPITAL_REGIMES,
} = require('../../dist/runtime/risk/portfolioRiskContour');

function makeConfig(overrides = {}) {
  const base = {
    enabled: true,
    dailyLossLimitPercent: 6,
    maxNewEntriesPerDay: 8,
    maxOpenPositions: 6,
    maxUsedMarginPercent: 70,
    cooldownAfterBadStreak: {
      enabled: true,
      consecutiveBadCycles: 3,
      consecutiveLosingClosures: 2,
      pauseMinutes: 45,
    },
    capitalRegimeThresholds: {
      cautionDailyLossPercent: 2,
      defensiveDailyLossPercent: 3.5,
      capitalPreservationDailyLossPercent: 5,
      haltDailyLossPercent: 6,
      cautionMarginUsagePercent: 45,
      defensiveMarginUsagePercent: 60,
      capitalPreservationMarginUsagePercent: 70,
      haltMarginUsagePercent: 85,
    },
  };
  return {
    ...base,
    ...overrides,
    cooldownAfterBadStreak: {
      ...base.cooldownAfterBadStreak,
      ...(overrides.cooldownAfterBadStreak || {}),
    },
    capitalRegimeThresholds: {
      ...base.capitalRegimeThresholds,
      ...(overrides.capitalRegimeThresholds || {}),
    },
  };
}

test('дневной лимит убытка даёт capital_prohibition и режим HALT_NEW_ENTRIES', () => {
  const decision = evaluatePortfolioRiskContour({
    context: { previousCapitalRegime: CAPITAL_REGIMES.NORMAL },
    stats: { dayPnlPercent: -7, newEntriesToday: 1, openPositionsCount: 1, usedMarginPercent: 20 },
  }, makeConfig());

  assert.equal(decision.allowNewEntries, false);
  assert.equal(decision.balanceState.capitalRegime, CAPITAL_REGIMES.HALT_NEW_ENTRIES);
  assert.equal(decision.hardVeto.type, 'capital_prohibition');
  assert.ok(decision.telemetry.limitsBreached.includes('daily_loss_limit'));
});

test('лимит новых входов за день блокирует новые входы без падения цикла', () => {
  const decision = evaluatePortfolioRiskContour({
    context: {},
    stats: { dayPnlPercent: -1, newEntriesToday: 8, openPositionsCount: 1, usedMarginPercent: 20 },
  }, makeConfig());

  assert.equal(decision.allowNewEntries, false);
  assert.equal(decision.hardVeto.reason, 'new_entries_limit');
});

test('лимит одновременно открытых позиций блокирует только новые входы', () => {
  const decision = evaluatePortfolioRiskContour({
    context: {},
    stats: { dayPnlPercent: -1, newEntriesToday: 2, openPositionsCount: 6, usedMarginPercent: 20 },
  }, makeConfig());

  assert.equal(decision.allowNewEntries, false);
  assert.equal(decision.hardVeto.reason, 'open_positions_limit');
});

test('лимит используемой маржи переключает режим в CAPITAL_PRESERVATION и блокирует вход', () => {
  const decision = evaluatePortfolioRiskContour({
    context: { previousCapitalRegime: CAPITAL_REGIMES.CAUTION },
    stats: { dayPnlPercent: -1, newEntriesToday: 2, openPositionsCount: 3, usedMarginPercent: 75 },
  }, makeConfig());

  assert.equal(decision.balanceState.capitalRegime, CAPITAL_REGIMES.CAPITAL_PRESERVATION);
  assert.equal(decision.allowNewEntries, false);
  assert.ok(decision.telemetry.limitsBreached.includes('used_margin_limit'));
  assert.equal(decision.balanceState.regimeChanged, true);
});

test('пауза после серии плохих циклов активирует cooldown и блокирует новые входы', () => {
  const now = Date.UTC(2026, 3, 1, 12, 0, 0);
  const decision = evaluatePortfolioRiskContour({
    context: { timestampMs: now, previousCapitalRegime: CAPITAL_REGIMES.NORMAL },
    stats: {
      dayPnlPercent: -1,
      newEntriesToday: 2,
      openPositionsCount: 2,
      usedMarginPercent: 25,
      badCyclesStreak: 3,
      losingClosuresStreak: 0,
      cooldownUntilMs: 0,
    },
  }, makeConfig());

  assert.equal(decision.allowNewEntries, false);
  assert.equal(decision.limits.cooldownActive, true);
  assert.ok(decision.telemetry.limitsBreached.includes('cooldown_after_bad_streak'));
});

test('структурированное событие содержит обязательные audit-поля', () => {
  const decision = evaluatePortfolioRiskContour({
    context: { cycleId: 'c1', ticker: 'BTC-USDT', exchange: 'bingx', marketRegime: 'trend', score: 0.8, confidence: 0.7 },
    stats: { dayPnlPercent: -0.5, newEntriesToday: 1, openPositionsCount: 1, usedMarginPercent: 20 },
  }, makeConfig());

  const event = toPortfolioRiskContourEvent({ context: { cycleId: 'c1', ticker: 'BTC-USDT', exchange: 'bingx', marketRegime: 'trend', setupType: 'breakout' }, decision });

  assert.equal(event.eventType, 'portfolio_risk_contour_decision');
  assert.equal(event.cycleId, 'c1');
  assert.equal(event.ticker, 'BTC-USDT');
  assert.equal(event.exchange, 'bingx');
  assert.equal(event.module, 'portfolioRiskContour');
  assert.equal(event.layer, 'risk.portfolioContour');
  assert.ok('finalDecision' in event);
});
