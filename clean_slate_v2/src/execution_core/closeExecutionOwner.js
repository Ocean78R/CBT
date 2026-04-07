'use strict';

/**
 * Русский комментарий:
 * Owner для закрытия уже открытой clean-slate позиции.
 */
function createCloseExecutionOwner({ queue, journal }) {
  function submitCloseRequest({ cycleId, position, reasonCode }) {
    const actionId = `close:${cycleId}:${position.positionId}`;
    const action = {
      actionId,
      actionKey: actionId,
      cycleId,
      type: 'position_close',
      asset: position.ticker,
      payload: {
        position,
        reasonCode,
      },
    };

    if (journal) {
      journal.record({
        event: 'close_request',
        actionId,
        cycleId,
        asset: position.ticker,
        details: { reasonCode, positionId: position.positionId },
      });
    }

    return queue.enqueue(action);
  }

  return {
    submitCloseRequest,
  };
}

module.exports = {
  createCloseExecutionOwner,
};
