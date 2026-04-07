'use strict';

/**
 * Русский комментарий:
 * Reconciliation новой версии:
 * - синхронизация позиций/ордеров;
 * - recovery только для сделок, открытых clean-slate v2.
 */
function createReconciliationEngine({ journal = null } = {}) {
  function reconcile({ exchangeSnapshot, localState }) {
    const exchangePositions = exchangeSnapshot.positions || [];
    const exchangeOrders = exchangeSnapshot.orders || [];
    const localPositions = localState.positions || [];

    const recoverablePositions = exchangePositions.filter((p) => p.ownerTag === 'clean_slate_v2');
    const orphanOrders = exchangeOrders.filter((o) => o.ownerTag === 'clean_slate_v2' && !o.linkedPositionId);

    const localIds = new Set(localPositions.map((p) => p.positionId));
    const recovered = recoverablePositions.filter((p) => !localIds.has(p.positionId));

    const result = {
      recoveredPositions: recovered,
      orphanOrders,
      syncedCount: recoverablePositions.length,
      blockedLegacyTailCount: exchangePositions.length - recoverablePositions.length,
    };

    if (journal) {
      journal.record({
        event: 'reconciliation_result',
        details: result,
      });
    }

    return result;
  }

  return {
    reconcile,
  };
}

module.exports = {
  createReconciliationEngine,
};
