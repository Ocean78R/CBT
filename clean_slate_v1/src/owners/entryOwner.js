'use strict';

/**
 * Русский комментарий:
 * Новый owner-path открытия позиции.
 * Важно: этот модуль не имеет права делегировать в legacy ownership chain.
 */
class EntryOwner {
  constructor({ finalEntryDecisionEngine, dynamicPositionSizing, executionGateway }) {
    this.finalEntryDecisionEngine = finalEntryDecisionEngine;
    this.dynamicPositionSizing = dynamicPositionSizing;
    this.executionGateway = executionGateway;
  }

  async openNewPosition(decisionContext) {
    const decision = this.finalEntryDecisionEngine.evaluate(decisionContext);
    if (!decision || !decision.approved) {
      return { opened: false, reason: 'entry_rejected_by_final_decision_engine' };
    }

    const sizing = this.dynamicPositionSizing.evaluate({
      decisionContext,
      finalDecision: decision,
    });

    if (!sizing || sizing.mode === 'no_entry') {
      return { opened: false, reason: 'entry_rejected_by_dynamic_position_sizing' };
    }

    return this.executionGateway.openPosition({
      ticker: decisionContext.ticker,
      side: decision.side,
      size: sizing.size,
      metadata: {
        ownerPath: 'clean_slate_entry_owner',
      },
    });
  }
}

module.exports = {
  EntryOwner,
};
