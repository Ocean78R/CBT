const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CAPITAL_REGIMES,
  evaluateCapitalRegime,
} = require('../../dist/runtime/risk/capitalRegimeEngine');

const config = {
  enabled: true,
  escalationOnly: true,
  thresholds: {
    cautionDailyLossPercent: 2,
    defensiveDailyLossPercent: 4,
    capitalPreservationDailyLossPercent: 6,
    haltDailyLossPercent: 8,
    cautionMarginUsagePercent: 40,
    defensiveMarginUsagePercent: 55,
    capitalPreservationMarginUsagePercent: 70,
    haltMarginUsagePercent: 85,
    cautionBalanceDrawdownPercent: 6,
    defensiveBalanceDrawdownPercent: 10,
    capitalPreservationBalanceDrawdownPercent: 14,
    haltBalanceDrawdownPercent: 18,
  },
};

test('capitalRegimeEngine переключает режим в DEFENSIVE по drawdown даже при мягком loss', () => {
  const decision = evaluateCapitalRegime({
    context: { previousCapitalRegime: CAPITAL_REGIMES.NORMAL },
    stats: { dayPnlPercent: -1.5, usedMarginPercent: 20, balanceDrawdownPercent: 11 },
  }, config);

  assert.equal(decision.capitalRegime, CAPITAL_REGIMES.DEFENSIVE);
  assert.equal(decision.telemetry.regimeByDrawdown, CAPITAL_REGIMES.DEFENSIVE);
  assert.equal(decision.regimeChanged, true);
});

test('capitalRegimeEngine с escalationOnly не ослабляет ранее ужесточённый режим', () => {
  const decision = evaluateCapitalRegime({
    context: { previousCapitalRegime: CAPITAL_REGIMES.CAPITAL_PRESERVATION },
    stats: { dayPnlPercent: -0.2, usedMarginPercent: 5, balanceDrawdownPercent: 1 },
  }, config);

  assert.equal(decision.capitalRegime, CAPITAL_REGIMES.CAPITAL_PRESERVATION);
});
