'use strict';

/**
 * Русский комментарий:
 * Последовательная очередь execution-действий без хаотичного параллелизма.
 */
function createOrderQueue({ journal = null } = {}) {
  const queue = [];
  const byId = new Map();
  let processing = false;

  function enqueue(action) {
    if (!action || !action.actionId) {
      throw new Error('action_with_actionId_required');
    }

    if (byId.has(action.actionId)) {
      return { accepted: false, reason: 'duplicate_action_id' };
    }

    const item = {
      ...action,
      state: 'queued',
      attempts: 0,
    };

    queue.push(item);
    byId.set(item.actionId, item);
    if (journal) {
      journal.record({
        event: 'execution_queued',
        actionId: item.actionId,
        cycleId: item.cycleId || null,
        asset: item.asset || null,
        details: { type: item.type },
      });
    }

    return { accepted: true, actionId: item.actionId };
  }

  async function processNext(processor) {
    if (processing) {
      return { processed: false, reason: 'queue_busy' };
    }

    const item = queue.shift();
    if (!item) {
      return { processed: false, reason: 'queue_empty' };
    }

    processing = true;
    item.state = 'processing';

    try {
      const result = await processor(item);
      item.state = (result && result.finalState) || 'done';
      byId.delete(item.actionId);
      return { processed: true, item, result };
    } finally {
      processing = false;
    }
  }

  function size() {
    return queue.length;
  }

  return {
    enqueue,
    processNext,
    size,
  };
}

module.exports = {
  createOrderQueue,
};
