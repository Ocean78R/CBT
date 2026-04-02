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

test('server SL срабатывает раньше local forced action и локальный close дедуплицируется', () => {
  const decision = evaluateForcedLossExit({
    context: {
      cycleId: 'c-200',
      ticker: 'BTC-USDT',
      capitalRegime: 'NORMAL',
      serverStopLossState: {
        status: 'close_confirmed',
        closeInitiated: true,
        closeConfirmed: true,
        protectiveActionToken: 'srv-token-1',
      },
    },
    position: {
      side: 'LONG',
      minutesSinceEntry: 14,
      entryDeviationPercent: -1.7,
      timeUnderEntryWithoutRecoveryMinutes: 13,
      adverseTrendBars: 4,
      adverseTrendSlope: 0.08,
      adverseMarketConfirmed: true,
      holdMinutesInLoss: 20,
      pnlPercent: -1.7,
    },
  }, buildConfig());

  assert.equal(decision.triggered, true);
  assert.equal(decision.duplicateClosePrevented, true);
  assert.equal(decision.protectiveActionOwner, 'server_stop_loss_manager');
  assert.equal(decision.protectiveActionToken, 'srv-token-1');
  assert.equal(decision.closeSource, 'early_invalidation');
  assert.equal(decision.ownershipAction, null);
});

test('local forced close начинает закрытие, затем server-side close state корректно переводит owner', () => {
  const decision = evaluateForcedLossExit({
    context: {
      cycleId: 'c-201',
      ticker: 'ETH-USDT',
      capitalRegime: 'NORMAL',
      protectiveActionState: {
        owner: 'execution_lifecycle_manager',
        token: 'local-token-1',
        closeInitiated: true,
        status: 'initiated',
      },
      serverStopLossState: {
        status: 'triggered',
        closeInitiated: true,
        closeConfirmed: false,
      },
    },
    position: {
      side: 'LONG',
      minutesSinceEntry: 17,
      entryDeviationPercent: -1.4,
      timeUnderEntryWithoutRecoveryMinutes: 14,
      adverseTrendBars: 4,
      adverseTrendSlope: 0.09,
      adverseMarketConfirmed: true,
      holdMinutesInLoss: 19,
      pnlPercent: -1.4,
    },
  }, buildConfig());

  assert.equal(decision.duplicateClosePrevented, true);
  assert.equal(decision.protectiveActionOwner, 'server_stop_loss_manager');
  assert.equal(decision.protectiveActionToken, 'local-token-1');
  assert.equal(decision.runtimeOwnership.serverStopLoss.closeInitiated, true);
  assert.equal(decision.ownershipAction, null);
});

test('mismatch/reconciliation после protective close остаётся в lifecycle owner-path', () => {
  const decision = evaluateForcedLossExit({
    context: {
      cycleId: 'c-202',
      ticker: 'SOL-USDT',
      capitalRegime: 'NORMAL',
      protectiveCloseSource: 'lifecycle_close',
      protectiveActionState: {
        owner: 'execution_lifecycle_manager',
        token: 'recon-token-1',
        closeConfirmed: true,
        status: 'confirmed',
      },
    },
    position: {
      side: 'LONG',
      minutesSinceEntry: 9,
      entryDeviationPercent: -2.2,
      timeUnderEntryWithoutRecoveryMinutes: 15,
      adverseTrendBars: 5,
      adverseTrendSlope: 0.1,
      adverseMarketConfirmed: true,
      holdMinutesInLoss: 30,
      pnlPercent: -2.2,
    },
  }, buildConfig());

  assert.equal(decision.closeSource, 'lifecycle_close');
  assert.equal(decision.protectiveActionOwner, 'execution_lifecycle_manager');
  assert.equal(decision.protectiveActionToken, 'recon-token-1');
  assert.equal(decision.duplicateClosePrevented, true);
  assert.equal(decision.runtimeOwnership.lifecycleOwner, 'execution_lifecycle_manager');
});

test('repeated close attempt безопасно дедуплицируется по protective token', () => {
  const input = {
    context: {
      cycleId: 'c-203',
      ticker: 'XRP-USDT',
      capitalRegime: 'NORMAL',
      protectiveActionState: {
        owner: 'execution_lifecycle_manager',
        token: 'repeat-token-1',
        closeInitiated: true,
      },
    },
    position: {
      side: 'LONG',
      minutesSinceEntry: 16,
      entryDeviationPercent: -1.8,
      timeUnderEntryWithoutRecoveryMinutes: 14,
      adverseTrendBars: 4,
      adverseTrendSlope: 0.09,
      adverseMarketConfirmed: true,
      holdMinutesInLoss: 17,
      pnlPercent: -1.8,
    },
  };

  const firstDecision = evaluateForcedLossExit(input, buildConfig());
  const repeatedDecision = evaluateForcedLossExit(input, buildConfig());

  assert.equal(firstDecision.protectiveActionToken, 'repeat-token-1');
  assert.equal(repeatedDecision.protectiveActionToken, 'repeat-token-1');
  assert.equal(firstDecision.duplicateClosePrevented, true);
  assert.equal(repeatedDecision.duplicateClosePrevented, true);
  assert.equal(repeatedDecision.ownershipAction, null);
});

test('после рестарта protectiveActionToken берётся из reconciliation state и сохраняет dedup owner-path', () => {
  const decision = evaluateForcedLossExit({
    context: {
      cycleId: 'c-204-after-restart',
      ticker: 'BNB-USDT',
      capitalRegime: 'NORMAL',
      positionCapabilityState: 'LEVERAGE_MISMATCH_POSITION',
      protectiveCloseSource: 'lifecycle_close',
      protectiveActionState: {
        owner: 'execution_lifecycle_manager',
        token: 'restart-recon-token-1',
        closeInitiated: true,
        status: 'initiated',
      },
    },
    position: {
      side: 'LONG',
      minutesSinceEntry: 22,
      entryDeviationPercent: -1.9,
      timeUnderEntryWithoutRecoveryMinutes: 15,
      adverseTrendBars: 4,
      adverseTrendSlope: 0.08,
      adverseMarketConfirmed: true,
      holdMinutesInLoss: 25,
      pnlPercent: -1.9,
      positionCapabilityState: 'LEVERAGE_MISMATCH_POSITION',
    },
  }, buildConfig());

  assert.equal(decision.duplicateClosePrevented, true);
  assert.equal(decision.protectiveActionOwner, 'execution_lifecycle_manager');
  assert.equal(decision.protectiveActionToken, 'restart-recon-token-1');
  assert.equal(decision.closeSource, 'lifecycle_close');
  assert.equal(decision.runtimeOwnership.lifecycleOwner, 'execution_lifecycle_manager');
  assert.equal(decision.ownershipAction, null);
});
