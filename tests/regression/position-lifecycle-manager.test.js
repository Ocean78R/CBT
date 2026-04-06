const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluatePositionLifecycle,
  normalizeLifecycleRules,
  LIFECYCLE_STATES,
} = require('../../dist/runtime/lifecycle/positionLifecycleManager');

function baseInput(overrides = {}) {
  return {
    context: {
      cycleId: 'cycle-38-1',
      ticker: 'BTC-USDT',
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
      ownershipToken: 'token-38a',
    },
    ...overrides,
  };
}

function baseConfig(overrides = {}) {
  return normalizeLifecycleRules({
    enabled: true,
    partialClose: { enabled: true, triggerProfitPercent: 1.5, closeShare: 0.4 },
    breakeven: { enabled: true, triggerProfitPercent: 2, offsetPercent: 0 },
    trailing: { enabled: true, triggerProfitPercent: 3, distancePercent: 1, requireBreakevenBeforeTrailing: true },
    ...overrides,
  });
}

test('contract: partial close branch формирует partialCloseIntent и переводит state', () => {
  const result = evaluatePositionLifecycle(baseInput(), baseConfig());

  assert.equal(result.partialCloseIntent.shouldClosePartially, true);
  assert.equal(result.partialCloseIntent.closeShare, 0.4);
  assert.equal(result.lifecycleState.partialCloseDone, true);
  assert.equal(result.lifecycleState.stage, LIFECYCLE_STATES.TRAILING_ACTIVE);
  assert.ok(result.lifecycleReasonCodes.includes('partial_close_triggered'));
});

test('contract: breakeven branch формирует breakevenIntent и targetStopPrice', () => {
  const result = evaluatePositionLifecycle(baseInput({
    profitability: { unrealizedPnl: 1.2, unrealizedPnlPercent: 2.3 },
    positionState: { ...baseInput().positionState, markPrice: 102.3, percentage: 2.3 },
  }), baseConfig({ trailing: { enabled: false } }));

  assert.equal(result.breakevenIntent.shouldMove, true);
  assert.equal(result.breakevenIntent.targetStopPrice, 100);
  assert.equal(result.lifecycleState.breakevenMoved, true);
  assert.equal(result.lifecycleState.stage, LIFECYCLE_STATES.BREAKEVEN_MOVED);
});

test('contract: trailing branch формирует trailingIntent для остатка позиции', () => {
  const result = evaluatePositionLifecycle(baseInput({
    lifecycleState: {
      stage: LIFECYCLE_STATES.BREAKEVEN_MOVED,
      partialCloseDone: true,
      breakevenMoved: true,
      trailingActive: false,
    },
    profitability: { unrealizedPnl: 1.5, unrealizedPnlPercent: 3.5 },
    positionState: { ...baseInput().positionState, markPrice: 110, percentage: 3.5 },
  }), baseConfig({ partialClose: { enabled: false }, breakeven: { enabled: false } }));

  assert.equal(result.trailingIntent.shouldTrail, true);
  assert.equal(result.lifecycleState.trailingActive, true);
  assert.equal(result.lifecycleState.stage, LIFECYCLE_STATES.TRAILING_ACTIVE);
  assert.equal(Number(result.trailingIntent.trailingStopPrice.toFixed(2)), 108.9);
});

test('contract: fallback branch оставляет legacy поведение при выключенном lifecycle', () => {
  const result = evaluatePositionLifecycle(baseInput(), normalizeLifecycleRules({ enabled: false }));

  assert.equal(result.lifecycleActionIntent.action, 'fallback_legacy_close_logic');
  assert.equal(result.lifecycleStateTransition.changed, false);
  assert.ok(result.lifecycleReasonCodes.includes('lifecycle_disabled_fallback'));
});

test('contract: lifecycle layer не владеет execution и server TP/SL', () => {
  const result = evaluatePositionLifecycle(baseInput(), baseConfig());

  assert.equal(result.contract.output.executionOwner, false);
  assert.equal(result.contract.output.serverTpSlOwner, false);
  assert.equal(result.lifecycleActionIntent.ownership.isExecutionOwner, false);
  assert.equal(result.lifecycleActionIntent.ownership.ownsServerTpSl, false);
  assert.equal(result.lifecycleActionIntent.ownership.sendsOrdersDirectly, false);
  assert.equal(result.contract.input.recalculatesMarketData, false);
  assert.equal(result.contract.input.recalculatesSignalStack, false);
  assert.equal(result.contract.output.directExchangeActions, false);
  assert.equal(result.managerRouting.executionLifecycleManager.owner, 'execution_lifecycle_manager');
  assert.equal(result.managerRouting.serverTakeProfitManager.owner, 'server_take_profit_manager');
  assert.equal(result.managerRouting.serverStopLossManager.owner, 'server_stop_loss_manager');
  assert.equal(result.managerRouting.reconciliationCleanupPath.owner, 'execution_reconciliation_cleanup');
});

test('contract: mismatch position включает restricted lifecycle mode и блокирует leverage-sensitive actions', () => {
  const result = evaluatePositionLifecycle(baseInput({
    context: {
      ...baseInput().context,
      positionCapabilityState: 'LEVERAGE_MISMATCH_POSITION',
    },
  }), baseConfig({
    partialClose: { enabled: true, triggerProfitPercent: 1.5, closeShare: 0.3 },
    breakeven: { enabled: true, triggerProfitPercent: 2, offsetPercent: 0 },
    trailing: { enabled: true, triggerProfitPercent: 3, distancePercent: 1 },
  }));

  assert.equal(result.positionCapabilityState, 'LEVERAGE_MISMATCH_POSITION');
  assert.equal(result.restrictedLifecycleMode, true);
  assert.ok(result.allowedActions.includes('reduce_only_profit_close'));
  assert.ok(result.allowedActions.includes('protective_close'));
  assert.ok(result.allowedActions.includes('partial_close'));
  assert.ok(result.blockedActions.includes('averaging'));
  assert.ok(result.blockedActions.includes('move_to_breakeven'));
  assert.ok(result.blockedActions.includes('activate_trailing'));
  assert.equal(result.partialCloseIntent.shouldClosePartially, true);
  assert.equal(result.breakevenIntent.shouldMove, false);
  assert.equal(result.trailingIntent.shouldTrail, false);
  assert.equal(result.lifecycleActionBlocked, true);
  assert.ok(result.lifecycleReasonCodes.includes('breakeven_blocked_by_capability_contract'));
});

test('contract: legacy restricted position не становится normal по инициативе lifecycle', () => {
  const input = baseInput({
    context: {
      ...baseInput().context,
      positionCapabilityState: 'LEGACY_RESTRICTED_POSITION',
    },
    positionState: {
      ...baseInput().positionState,
      positionCapabilityState: 'NORMAL_POSITION',
      percentage: 2.5,
      markPrice: 103,
    },
    profitability: { unrealizedPnl: 1.1, unrealizedPnlPercent: 2.5 },
  });
  const result = evaluatePositionLifecycle(input, baseConfig());

  assert.equal(result.positionCapabilityState, 'LEGACY_RESTRICTED_POSITION');
  assert.equal(result.restrictedLifecycleMode, true);
  assert.notEqual(result.positionCapabilityState, 'NORMAL_POSITION');
  assert.ok(result.lifecycleReasonCodes.includes('restricted_lifecycle_mode_enabled'));
});

test('contract: safe close path остаётся доступен для restricted позиции', () => {
  const result = evaluatePositionLifecycle(baseInput({
    context: {
      ...baseInput().context,
      positionCapabilityState: 'LEVERAGE_MISMATCH_POSITION',
    },
    profitability: { unrealizedPnl: 3.2, unrealizedPnlPercent: 3.2 },
  }), baseConfig());

  assert.ok(result.allowedActions.includes('reduce_only_profit_close'));
  assert.ok(result.allowedActions.includes('protective_close'));
  assert.ok(result.allowedActions.includes('cleanup_protective_orders'));
  assert.equal(result.lifecycleActionIntent.ownership.isExecutionOwner, false);
  assert.equal(result.lifecycleActionIntent.ownership.ownsServerTpSl, false);
  assert.equal(result.contract.output.serverTpSlOwner, false);
});
