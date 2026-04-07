'use strict';

const { createExecutionJournal } = require('./executionJournal');
const { createRetryPolicy } = require('./retryPolicy');
const { createActionDedup } = require('./actionDedup');
const { createOrderQueue } = require('./orderQueue');
const { createEntryExecutionOwner } = require('./entryExecutionOwner');
const { createCloseExecutionOwner } = require('./closeExecutionOwner');
const { createReconciliationEngine } = require('./reconciliation');

/**
 * Русский комментарий:
 * Единый execution owner-path новой clean-slate версии.
 */
function createExecutionOwnerPath({
  exchangeAdapter,
  journal = createExecutionJournal(),
  retryPolicy = createRetryPolicy(),
  dedup = createActionDedup(),
  queue = null,
} = {}) {
  if (!exchangeAdapter) {
    throw new Error('exchange_adapter_required');
  }

  const orderQueue = queue || createOrderQueue({ journal });
  const entryOwner = createEntryExecutionOwner({ queue: orderQueue, journal });
  const closeOwner = createCloseExecutionOwner({ queue: orderQueue, journal });
  const reconciliation = createReconciliationEngine({ journal });

  async function executeAction(item) {
    const start = dedup.tryStart(item.actionKey);
    if (!start.allowed) {
      journal.record({
        event: 'blocked_action_reason',
        actionId: item.actionId,
        cycleId: item.cycleId || null,
        asset: item.asset || null,
        details: { reason: start.reason },
      });
      return { finalState: 'blocked', reason: start.reason };
    }

    let attempt = 1;
    while (attempt <= retryPolicy.maxAttempts) {
      journal.record({
        event: 'order_submit',
        actionId: item.actionId,
        cycleId: item.cycleId || null,
        asset: item.asset || null,
        details: { attempt, type: item.type },
      });

      try {
        const submitResult = item.type === 'entry_open'
          ? await exchangeAdapter.submitEntry(item.payload)
          : await exchangeAdapter.submitClose(item.payload);

        journal.record({
          event: 'fill',
          actionId: item.actionId,
          cycleId: item.cycleId || null,
          asset: item.asset || null,
          details: { attempt, submitResult },
        });

        dedup.finish(item.actionKey, { markCompleted: true });
        return { finalState: 'filled', submitResult };
      } catch (error) {
        const errorCode = error && error.code ? error.code : 'unknown_error';
        const retry = retryPolicy.shouldRetry({ attempt, errorCode });

        if (!retry.allowed) {
          dedup.finish(item.actionKey, { markCompleted: false });
          journal.record({
            event: 'blocked_action_reason',
            actionId: item.actionId,
            cycleId: item.cycleId || null,
            asset: item.asset || null,
            details: { reason: retry.reason, errorCode },
          });
          return { finalState: 'failed', reason: retry.reason, errorCode };
        }

        journal.record({
          event: 'retry',
          actionId: item.actionId,
          cycleId: item.cycleId || null,
          asset: item.asset || null,
          details: { attempt, nextAttempt: attempt + 1, errorCode },
        });
      }

      attempt += 1;
    }

    dedup.finish(item.actionKey, { markCompleted: false });
    return { finalState: 'failed', reason: 'retry_loop_exhausted' };
  }

  async function runQueueOnce() {
    return orderQueue.processNext(executeAction);
  }

  function runReconciliation({ exchangeSnapshot, localState }) {
    return reconciliation.reconcile({ exchangeSnapshot, localState });
  }

  return {
    journal,
    retryPolicy,
    dedup,
    queue: orderQueue,
    entryOwner,
    closeOwner,
    runQueueOnce,
    runReconciliation,
  };
}

module.exports = {
  createExecutionOwnerPath,
};
