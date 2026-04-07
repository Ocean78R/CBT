'use strict';

/**
 * Русский комментарий:
 * Owner для исполнения нового входа после approved decision + sizing.
 */
function createEntryExecutionOwner({ queue, journal }) {
  function submitApprovedEntry({ cycleId, approvedEntry, sizingResult }) {
    const actionId = `entry:${cycleId}:${approvedEntry.ticker}:${approvedEntry.direction}`;
    const action = {
      actionId,
      actionKey: actionId,
      cycleId,
      type: 'entry_open',
      asset: approvedEntry.ticker,
      payload: {
        approvedEntry,
        sizingResult,
      },
    };

    if (journal) {
      journal.record({
        event: 'entry_request',
        actionId,
        cycleId,
        asset: approvedEntry.ticker,
        details: {
          direction: approvedEntry.direction,
          size: sizingResult.size,
        },
      });
    }

    return queue.enqueue(action);
  }

  return {
    submitApprovedEntry,
  };
}

module.exports = {
  createEntryExecutionOwner,
};
