const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluatePositionLifecycle,
  normalizeLifecycleRules,
  LIFECYCLE_STATES,
} = require('../../dist/runtime/lifecycle/positionLifecycleManager');
const { evaluateForcedLossExit } = require('../../dist/runtime/risk/forcedLossExit');

function lifecycleConfig(overrides = {}) {
  return normalizeLifecycleRules({
    enabled: true,
    partialClose: { enabled: true, triggerProfitPercent: 1.5, closeShare: 0.3 },
    breakeven: { enabled: true, triggerProfitPercent: 2, offsetPercent: 0 },
    trailing: { enabled: true, triggerProfitPercent: 3, distancePercent: 1, requireBreakevenBeforeTrailing: true },
    ...overrides,
  });
}

function forcedLossConfig(overrides = {}) {
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
    ...overrides,
  };
}

function lifecycleInput(overrides = {}) {
  return {
    context: {
      cycleId: 'cycle-restart-1',
      ticker: 'BTC-USDT',
      positionCapabilityState: 'NORMAL_POSITION',
    },
    positionState: {
      symbolUnified: 'BTC-USDT',
      side: 'long',
      entryPrice: 100,
      markPrice: 104,
      contracts: 1,
      percentage: 4,
      unrealizedPnl: 2,
      isClosed: false,
      positionCapabilityState: 'NORMAL_POSITION',
    },
    lifecycleState: {
      stage: LIFECYCLE_STATES.INITIAL,
      partialCloseDone: false,
      breakevenMoved: false,
      trailingActive: false,
    },
    profitability: {
      unrealizedPnl: 2,
      unrealizedPnlPercent: 4,
    },
    ownershipMetadata: {
      ownerPath: 'execution_lifecycle_manager',
      ownershipToken: 'recovery-owner-token-1',
      source: 'reconciliation_restart_snapshot',
    },
    ...overrides,
  };
}

function forcedLossInput(overrides = {}) {
  return {
    context: {
      cycleId: 'c-restart-protective-1',
      ticker: 'BTC-USDT',
      capitalRegime: 'NORMAL',
      positionCapabilityState: 'NORMAL_POSITION',
    },
    position: {
      side: 'LONG',
      minutesSinceEntry: 20,
      entryDeviationPercent: -1.6,
      timeUnderEntryWithoutRecoveryMinutes: 14,
      adverseTrendBars: 4,
      adverseTrendSlope: 0.09,
      adverseMarketConfirmed: true,
      holdMinutesInLoss: 20,
      pnlPercent: -1.6,
      positionId: 'pos-restart-1',
    },
    ...overrides,
  };
}

test('restart/recovery: normal position восстанавливается без повторного open/close и продолжает lifecycle stage', () => {
  const beforeRestart = evaluatePositionLifecycle(lifecycleInput(), lifecycleConfig());

  const afterRestart = evaluatePositionLifecycle(lifecycleInput({
    context: {
      ...lifecycleInput().context,
      cycleId: 'cycle-restart-2',
    },
    lifecycleState: {
      ...beforeRestart.lifecycleState,
    },
    ownershipMetadata: {
      ...lifecycleInput().ownershipMetadata,
      ownershipToken: 'recovery-owner-token-1',
    },
  }), lifecycleConfig());

  assert.equal(afterRestart.lifecycleState.stage, LIFECYCLE_STATES.TRAILING_ACTIVE);
  assert.equal(afterRestart.contract.output.executionOwner, false);
  assert.equal(afterRestart.lifecycleActionIntent.ownership.sendsOrdersDirectly, false);
  assert.equal(afterRestart.contract.ownershipMetadata.ownershipToken, 'recovery-owner-token-1');
  assert.ok(afterRestart.allowedActions.includes('cleanup_protective_orders'));
});

test('restart/recovery: restricted mismatch position остаётся restricted и сохраняет safe close path', () => {
  const beforeRestart = evaluatePositionLifecycle(lifecycleInput({
    context: {
      ...lifecycleInput().context,
      positionCapabilityState: 'LEVERAGE_MISMATCH_POSITION',
    },
    positionState: {
      ...lifecycleInput().positionState,
      positionCapabilityState: 'NORMAL_POSITION',
    },
  }), lifecycleConfig());

  const afterRestart = evaluatePositionLifecycle(lifecycleInput({
    context: {
      ...lifecycleInput().context,
      cycleId: 'cycle-restart-restricted-2',
      positionCapabilityState: 'LEVERAGE_MISMATCH_POSITION',
    },
    lifecycleState: {
      ...beforeRestart.lifecycleState,
    },
    positionState: {
      ...lifecycleInput().positionState,
      positionCapabilityState: 'NORMAL_POSITION',
    },
    ownershipMetadata: {
      ...lifecycleInput().ownershipMetadata,
      ownershipToken: 'restricted-owner-token-7',
    },
  }), lifecycleConfig());

  assert.equal(afterRestart.positionCapabilityState, 'LEVERAGE_MISMATCH_POSITION');
  assert.equal(afterRestart.restrictedLifecycleMode, true);
  assert.ok(afterRestart.allowedActions.includes('reduce_only_profit_close'));
  assert.ok(afterRestart.allowedActions.includes('protective_close'));
  assert.ok(afterRestart.allowedActions.includes('cleanup_protective_orders'));
  assert.ok(afterRestart.blockedActions.includes('averaging'));
  assert.notEqual(afterRestart.positionCapabilityState, 'NORMAL_POSITION');
  assert.equal(afterRestart.contract.ownershipMetadata.ownershipToken, 'restricted-owner-token-7');
});

test('restart/recovery: protective flow во время рестарта сохраняет ownership token и dedup (без повторного close)', () => {
  const beforeRestart = evaluateForcedLossExit(forcedLossInput({
    context: {
      ...forcedLossInput().context,
      cycleId: 'c-before-restart',
      protectiveCloseSource: 'lifecycle_close',
      protectiveActionState: {
        owner: 'execution_lifecycle_manager',
        token: 'protective-restart-token-11',
        closeInitiated: true,
        status: 'initiated',
      },
    },
  }), forcedLossConfig());

  const afterRestart = evaluateForcedLossExit(forcedLossInput({
    context: {
      ...forcedLossInput().context,
      cycleId: 'c-after-restart',
      protectiveCloseSource: 'lifecycle_close',
      protectiveActionState: {
        owner: 'execution_lifecycle_manager',
        token: beforeRestart.protectiveActionToken,
        closeInitiated: true,
        status: 'initiated',
      },
    },
  }), forcedLossConfig());

  assert.equal(beforeRestart.protectiveActionToken, 'protective-restart-token-11');
  assert.equal(afterRestart.protectiveActionToken, 'protective-restart-token-11');
  assert.equal(afterRestart.protectiveActionOwner, 'execution_lifecycle_manager');
  assert.equal(afterRestart.duplicateClosePrevented, true);
  assert.equal(afterRestart.ownershipAction, null);
});

test('restart/recovery: server-side close already in progress не дублирует закрытие и сохраняет safe close ownership', () => {
  const afterRestart = evaluateForcedLossExit(forcedLossInput({
    context: {
      ...forcedLossInput().context,
      cycleId: 'c-after-restart-server-working',
      protectiveCloseSource: 'early_invalidation',
      protectiveActionState: {
        owner: 'execution_lifecycle_manager',
        token: 'srv-progress-token-44',
        closeInitiated: true,
        status: 'initiated',
      },
      serverStopLossState: {
        status: 'triggered',
        closeInitiated: true,
        closeConfirmed: false,
        runtimeOwner: 'server_stop_loss_manager',
        protectiveActionToken: 'srv-progress-token-44',
      },
    },
  }), forcedLossConfig());

  assert.equal(afterRestart.duplicateClosePrevented, true);
  assert.equal(afterRestart.ownershipAction, null);
  assert.equal(afterRestart.protectiveActionOwner, 'server_stop_loss_manager');
  assert.equal(afterRestart.protectiveActionToken, 'srv-progress-token-44');
  assert.equal(afterRestart.runtimeOwnership.serverStopLoss.closeInitiated, true);
  assert.equal(afterRestart.closeSource, 'early_invalidation');
});
