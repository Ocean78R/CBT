'use strict';

/**
 * Русский комментарий:
 * Новый owner-path сопровождения позиции.
 * Приоритет adverse-flow: наблюдение -> ранняя инвалидация -> принудительная защита.
 */
class PositionOwner {
  constructor({ lifecycleEngine, forcedLossEngine, executionGateway }) {
    this.lifecycleEngine = lifecycleEngine;
    this.forcedLossEngine = forcedLossEngine;
    this.executionGateway = executionGateway;
  }

  async processExistingPosition(positionContext) {
    const lifecycleIntent = this.lifecycleEngine.evaluate(positionContext);
    const forcedLossDecision = this.forcedLossEngine.evaluate(positionContext);

    return this.applyLifecycleActions({ positionContext, lifecycleIntent, forcedLossDecision });
  }

  async applyLifecycleActions({ positionContext, lifecycleIntent, forcedLossDecision }) {
    if (forcedLossDecision && forcedLossDecision.triggered) {
      return this.executionGateway.closePosition({
        ticker: positionContext.ticker,
        reason: 'forced_loss_or_stuck_protection',
        metadata: { ownerPath: 'clean_slate_position_owner' },
      });
    }

    if (lifecycleIntent && lifecycleIntent.action === 'hold') {
      return { action: 'hold', reason: 'lifecycle_hold' };
    }

    return { action: 'no_action', reason: 'no_lifecycle_action' };
  }
}

module.exports = {
  PositionOwner,
};
