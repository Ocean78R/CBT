const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateForcedLossExit } = require('../../dist/runtime/risk/forcedLossExit');

function buildConfig(extra = {}) {
  return {
    enabled: true,
    actionMode: 'warn',
    partialReduceShare: 0.3,
    cooldownMinutesAfterForcedExit: 30,
    maxNegativeHoldMinutes: 240,
    maxPostAveragingNegativeHoldMinutes: 120,
    maxLossPercentOnPosition: 6,
    maxAveragesPerPosition: 3,
    requireAdverseMarketConfirmation: true,
    enablePostEntryObservation: true,
    postEntryGraceMinutes: 5,
    postEntryObservationMinutes: 30,
    maxTimeUnderEntryWithoutRecovery: 12,
    earlyInvalidationLossPercent: 1.1,
    requirePersistentAdverseTrend: true,
    adverseTrendConfirmationBars: 3,
    adverseTrendSlopeThreshold: 0.05,
    actionOnEarlyInvalidation: 'force_close',
    ...extra,
  };
}

test('earlyInvalidationExit срабатывает в окне наблюдения и раньше legacy forcedLossExit', () => {
  const decision = evaluateForcedLossExit({
    context: {
      cycleId: 'c-100',
      ticker: 'BTC-USDT',
      capitalRegime: 'NORMAL',
      positionCapabilityState: 'NORMAL_POSITION',
    },
    position: {
      side: 'LONG',
      minutesSinceEntry: 16,
      entryDeviationPercent: -1.5,
      timeUnderEntryWithoutRecoveryMinutes: 14,
      adverseTrendBars: 4,
      adverseTrendSlope: 0.09,
      adverseMarketConfirmed: true,
      holdMinutesInLoss: 16,
      pnlPercent: -1.5,
      averagesCount: 0,
    },
  }, buildConfig());

  assert.equal(decision.triggered, true);
  assert.equal(decision.triggerStage, 'early_invalidation_exit');
  assert.equal(decision.actionMode, 'force_close');
  assert.equal(decision.ownershipAction.type, 'position_force_close_request');
  assert.equal(decision.conditions.legacyForcedLossEvaluated, false);
});

test('если данных тренда недостаточно, earlyInvalidation не даёт ложный trigger и fallback остаётся активным', () => {
  const decision = evaluateForcedLossExit({
    context: {
      cycleId: 'c-101',
      ticker: 'ETH-USDT',
      capitalRegime: 'NORMAL',
    },
    position: {
      side: 'LONG',
      minutesSinceEntry: 18,
      entryDeviationPercent: -1.6,
      timeUnderEntryWithoutRecoveryMinutes: 14,
      adverseMarketConfirmed: true,
      holdMinutesInLoss: 260,
      pnlPercent: -6.4,
      averagesCount: 0,
    },
  }, buildConfig());

  assert.equal(decision.earlyInvalidation.triggered, false);
  assert.equal(decision.earlyInvalidation.reasons.includes('adverse_trend_data_insufficient'), true);
  assert.equal(decision.triggerStage, 'forced_loss_exit_fallback');
  assert.equal(decision.actionMode, 'warn');
  assert.equal(decision.triggered, true);
});

test('regimeTightening для CAPITAL_PRESERVATION ужесточает ранний trigger', () => {
  const decision = evaluateForcedLossExit({
    context: {
      cycleId: 'c-102',
      ticker: 'SOL-USDT',
      capitalRegime: 'CAPITAL_PRESERVATION',
    },
    position: {
      side: 'LONG',
      minutesSinceEntry: 10,
      entryDeviationPercent: -0.9,
      timeUnderEntryWithoutRecoveryMinutes: 8,
      adverseTrendBars: 2,
      adverseTrendSlope: 0.04,
      adverseMarketConfirmed: true,
      holdMinutesInLoss: 10,
      pnlPercent: -0.9,
    },
  }, buildConfig({
    earlyInvalidationLossPercent: 1.2,
    maxTimeUnderEntryWithoutRecovery: 12,
    adverseTrendConfirmationBars: 3,
    adverseTrendSlopeThreshold: 0.05,
    regimeTightening: {
      enabled: true,
      byCapitalRegime: {
        CAPITAL_PRESERVATION: {
          earlyInvalidationLossPercent: 0.8,
          maxTimeUnderEntryWithoutRecovery: 7,
          adverseTrendConfirmationBars: 2,
          adverseTrendSlopeThreshold: 0.04,
        },
      },
    },
  }));

  assert.equal(decision.triggered, true);
  assert.equal(decision.triggerStage, 'early_invalidation_exit');
  assert.equal(decision.earlyInvalidation.diagnostics.capitalRegime, 'CAPITAL_PRESERVATION');
});
