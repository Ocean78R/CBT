'use strict';

const LIFECYCLE_STATES = {
  INITIAL: 'initial_position_state',
  PARTIAL_PROFIT: 'partial_profit_state',
  BREAKEVEN_MOVED: 'moved_to_breakeven_state',
  TRAILING_ACTIVE: 'trailing_active_state',
  TERMINAL: 'fully_closed_terminal_state',
};

function clamp01(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number <= 0) return 0;
  if (number >= 1) return 1;
  return number;
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeLifecycleRules(config = {}) {
  const partialClose = config.partialClose || {};
  const breakeven = config.breakeven || {};
  const trailing = config.trailing || {};

  return {
    enabled: config.enabled === true,
    partialClose: {
      enabled: partialClose.enabled !== false,
      triggerProfitPercent: asNumber(partialClose.triggerProfitPercent, 1),
      closeShare: clamp01(partialClose.closeShare, 0.5),
    },
    breakeven: {
      enabled: breakeven.enabled !== false,
      triggerProfitPercent: asNumber(breakeven.triggerProfitPercent, 1.2),
      offsetPercent: asNumber(breakeven.offsetPercent, 0),
    },
    trailing: {
      enabled: trailing.enabled !== false,
      triggerProfitPercent: asNumber(trailing.triggerProfitPercent, 1.5),
      distancePercent: asNumber(trailing.distancePercent, 0.6),
      requireBreakevenBeforeTrailing: trailing.requireBreakevenBeforeTrailing !== false,
    },
  };
}

function normalizeLifecycleState(state = {}) {
  return {
    stage: Object.values(LIFECYCLE_STATES).includes(state.stage)
      ? state.stage
      : LIFECYCLE_STATES.INITIAL,
    partialCloseDone: state.partialCloseDone === true,
    breakevenMoved: state.breakevenMoved === true,
    trailingActive: state.trailingActive === true,
    trailingStopPrice: Number.isFinite(Number(state.trailingStopPrice))
      ? Number(state.trailingStopPrice)
      : null,
  };
}

function resolveProfitability(positionState = {}, profitability = {}) {
  const unrealizedPnl = Number.isFinite(Number(profitability.unrealizedPnl))
    ? Number(profitability.unrealizedPnl)
    : asNumber(positionState.unrealizedPnl, 0);

  const unrealizedPnlPercent = Number.isFinite(Number(profitability.unrealizedPnlPercent))
    ? Number(profitability.unrealizedPnlPercent)
    : asNumber(positionState.percentage, 0);

  return {
    unrealizedPnl,
    unrealizedPnlPercent,
    isProfitable: unrealizedPnl > 0 || unrealizedPnlPercent > 0,
  };
}

function resolveBaseContracts(positionState = {}, context = {}) {
  return {
    ticker: context.ticker || positionState.symbolUnified || null,
    side: positionState.side || null,
    entryPrice: asNumber(positionState.entryPrice, NaN),
    markPrice: asNumber(positionState.markPrice, NaN),
    contracts: asNumber(positionState.contracts, 0),
    isClosed: positionState.isClosed === true || asNumber(positionState.contracts, 0) <= 0,
  };
}

function toTransition(previousState, nextState, reasonCodes) {
  return {
    from: previousState.stage,
    to: nextState.stage,
    changed: previousState.stage !== nextState.stage,
    reasonCodes,
  };
}

function createLifecycleOutput(input, normalizedRules, state, profitability) {
  return {
    lifecycleActionIntent: {
      action: 'hold',
      reason: 'no_lifecycle_action',
      priority: 'normal_profit_lifecycle',
      ownership: {
        isExecutionOwner: false,
        ownsServerTpSl: false,
        sendsOrdersDirectly: false,
      },
    },
    lifecycleStateTransition: toTransition(state, state, ['no_transition']),
    breakevenIntent: { enabled: false, shouldMove: false, targetStopPrice: null },
    partialCloseIntent: { enabled: false, shouldClosePartially: false, closeShare: 0 },
    trailingIntent: { enabled: false, shouldTrail: false, trailingStopPrice: null },
    lifecycleReasonCodes: [],
    lifecycleState: state,
    profitability,
    contract: {
      input: {
        usesExistingRuntimeContext: true,
        reusesPositionState: true,
        recalculatesMarketData: false,
        recalculatesSignalStack: false,
      },
      output: {
        intentsOnly: true,
        executionOwner: false,
        serverTpSlOwner: false,
      },
      ownershipMetadata: input.ownershipMetadata || null,
    },
  };
}

function evaluatePositionLifecycle(input = {}, config = {}, runtime = {}) {
  const logger = runtime && typeof runtime.log === 'function' ? runtime : { log: () => {} };
  const positionState = input.positionState || {};
  const context = input.context || {};
  const ownershipMetadata = input.ownershipMetadata || {};
  const state = normalizeLifecycleState(input.lifecycleState || {});
  const profitability = resolveProfitability(positionState, input.profitability || {});
  const rules = normalizeLifecycleRules(config);
  const base = resolveBaseContracts(positionState, context);
  const output = createLifecycleOutput({ ownershipMetadata }, rules, state, profitability);

  if (!rules.enabled) {
    output.lifecycleActionIntent = {
      action: 'fallback_legacy_close_logic',
      reason: 'lifecycle_disabled_fallback',
      priority: 'legacy_behavior',
      ownership: {
        isExecutionOwner: false,
        ownsServerTpSl: false,
        sendsOrdersDirectly: false,
      },
    };
    output.lifecycleReasonCodes.push('lifecycle_disabled_fallback');
    output.lifecycleStateTransition = toTransition(state, state, ['lifecycle_disabled_fallback']);
    logger.log(`[positionLifecycle] cycle=${context.cycleId || 'n/a'} ticker=${base.ticker || 'n/a'} enabled=false action=fallback_legacy_close_logic`);
    return output;
  }

  if (base.isClosed) {
    const terminalState = { ...state, stage: LIFECYCLE_STATES.TERMINAL };
    output.lifecycleState = terminalState;
    output.lifecycleActionIntent = {
      action: 'mark_terminal',
      reason: 'position_already_closed',
      priority: 'normal_profit_lifecycle',
      ownership: {
        isExecutionOwner: false,
        ownsServerTpSl: false,
        sendsOrdersDirectly: false,
      },
    };
    output.lifecycleReasonCodes.push('position_already_closed');
    output.lifecycleStateTransition = toTransition(state, terminalState, ['position_already_closed']);
    return output;
  }

  const reasonCodes = [];
  const nextState = { ...state };

  if (rules.partialClose.enabled
    && !state.partialCloseDone
    && profitability.unrealizedPnlPercent >= rules.partialClose.triggerProfitPercent) {
    output.partialCloseIntent = {
      enabled: true,
      shouldClosePartially: true,
      closeShare: rules.partialClose.closeShare,
      reasonCode: 'partial_close_triggered',
    };
    output.lifecycleActionIntent = {
      action: 'partial_close',
      reason: 'partial_close_triggered',
      priority: 'normal_profit_lifecycle',
      ownership: {
        isExecutionOwner: false,
        ownsServerTpSl: false,
        sendsOrdersDirectly: false,
      },
    };
    nextState.partialCloseDone = true;
    nextState.stage = LIFECYCLE_STATES.PARTIAL_PROFIT;
    reasonCodes.push('partial_close_triggered');
  }

  if (rules.breakeven.enabled
    && !state.breakevenMoved
    && profitability.unrealizedPnlPercent >= rules.breakeven.triggerProfitPercent
    && Number.isFinite(base.entryPrice)) {
    const directionMultiplier = String(base.side).toLowerCase() === 'short' ? -1 : 1;
    const targetStopPrice = base.entryPrice * (1 + (rules.breakeven.offsetPercent / 100) * directionMultiplier);
    output.breakevenIntent = {
      enabled: true,
      shouldMove: true,
      targetStopPrice,
      reasonCode: 'breakeven_triggered',
    };
    output.lifecycleActionIntent = {
      action: output.lifecycleActionIntent.action === 'partial_close' ? 'partial_close_and_move_breakeven' : 'move_to_breakeven',
      reason: 'breakeven_triggered',
      priority: 'normal_profit_lifecycle',
      ownership: {
        isExecutionOwner: false,
        ownsServerTpSl: false,
        sendsOrdersDirectly: false,
      },
    };
    nextState.breakevenMoved = true;
    nextState.stage = LIFECYCLE_STATES.BREAKEVEN_MOVED;
    reasonCodes.push('breakeven_triggered');
  }

  const trailingAllowed = rules.trailing.enabled
    && (!rules.trailing.requireBreakevenBeforeTrailing || nextState.breakevenMoved || state.breakevenMoved)
    && profitability.unrealizedPnlPercent >= rules.trailing.triggerProfitPercent
    && Number.isFinite(base.markPrice)
    && rules.trailing.distancePercent > 0;

  if (trailingAllowed) {
    const side = String(base.side || '').toLowerCase();
    const trailingStopPrice = side === 'short'
      ? base.markPrice * (1 + rules.trailing.distancePercent / 100)
      : base.markPrice * (1 - rules.trailing.distancePercent / 100);
    output.trailingIntent = {
      enabled: true,
      shouldTrail: true,
      trailingStopPrice,
      distancePercent: rules.trailing.distancePercent,
      reasonCode: 'trailing_triggered',
    };
    output.lifecycleActionIntent = {
      action: output.lifecycleActionIntent.action === 'hold' ? 'activate_trailing' : `${output.lifecycleActionIntent.action}_and_trailing`,
      reason: 'trailing_triggered',
      priority: 'normal_profit_lifecycle',
      ownership: {
        isExecutionOwner: false,
        ownsServerTpSl: false,
        sendsOrdersDirectly: false,
      },
    };
    nextState.trailingActive = true;
    nextState.trailingStopPrice = trailingStopPrice;
    nextState.stage = LIFECYCLE_STATES.TRAILING_ACTIVE;
    reasonCodes.push('trailing_triggered');
  }

  if (reasonCodes.length === 0) {
    reasonCodes.push('no_lifecycle_action');
  }

  output.lifecycleReasonCodes = reasonCodes;
  output.lifecycleState = nextState;
  output.lifecycleStateTransition = toTransition(state, nextState, reasonCodes);

  logger.log(
    `[positionLifecycle] cycle=${context.cycleId || 'n/a'} ticker=${base.ticker || 'n/a'} stage=${state.stage} nextStage=${nextState.stage} action=${output.lifecycleActionIntent.action} reasons=${reasonCodes.join('|')}`,
  );

  return output;
}

module.exports = {
  LIFECYCLE_STATES,
  normalizeLifecycleRules,
  evaluatePositionLifecycle,
};
