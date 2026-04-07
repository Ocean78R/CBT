const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  createExecutionOwnerPath,
  createExecutionJournal,
  createOrderQueue,
  createRetryPolicy,
  createReconciliationEngine,
} = require('../../clean_slate_v2/src/execution_core');

test('queue ordering: действия исполняются в порядке FIFO', async () => {
  const queue = createOrderQueue();
  const order = [];

  queue.enqueue({ actionId: 'a1', actionKey: 'a1', type: 'entry_open', payload: {} });
  queue.enqueue({ actionId: 'a2', actionKey: 'a2', type: 'entry_open', payload: {} });

  await queue.processNext(async (item) => {
    order.push(item.actionId);
    return { finalState: 'done' };
  });

  await queue.processNext(async (item) => {
    order.push(item.actionId);
    return { finalState: 'done' };
  });

  assert.deepEqual(order, ['a1', 'a2']);
});

test('retry behavior: retry выполняется только для retryable ошибок и ограничен maxAttempts', async () => {
  let callCount = 0;
  const journal = createExecutionJournal();
  const execution = createExecutionOwnerPath({
    journal,
    retryPolicy: createRetryPolicy({ maxAttempts: 3 }),
    exchangeAdapter: {
      submitEntry: async () => {
        callCount += 1;
        if (callCount < 3) {
          const error = new Error('timeout');
          error.code = 'network_timeout';
          throw error;
        }
        return { orderId: 'E-1', status: 'filled' };
      },
      submitClose: async () => ({ orderId: 'C-1', status: 'filled' }),
    },
  });

  execution.entryOwner.submitApprovedEntry({
    cycleId: 'c1',
    approvedEntry: { ticker: 'BTCUSDT', direction: 'long' },
    sizingResult: { size: 0.1 },
  });

  const run = await execution.runQueueOnce();
  assert.equal(run.result.finalState, 'filled');
  assert.equal(callCount, 3);

  const retries = journal.list().filter((r) => r.event === 'retry');
  assert.equal(retries.length, 2);
});

test('dedup: дублирующее действие блокируется и журналируется', async () => {
  const journal = createExecutionJournal();
  const execution = createExecutionOwnerPath({
    journal,
    exchangeAdapter: {
      submitEntry: async () => ({ orderId: 'E-2', status: 'filled' }),
      submitClose: async () => ({ orderId: 'C-2', status: 'filled' }),
    },
  });

  execution.entryOwner.submitApprovedEntry({
    cycleId: 'c2',
    approvedEntry: { ticker: 'ETHUSDT', direction: 'short' },
    sizingResult: { size: 0.2 },
  });

  await execution.runQueueOnce();

  execution.queue.enqueue({
    actionId: 'manual-duplicate',
    actionKey: 'entry:c2:ETHUSDT:short',
    cycleId: 'c2',
    type: 'entry_open',
    asset: 'ETHUSDT',
    payload: {},
  });

  const blocked = await execution.runQueueOnce();
  assert.equal(blocked.result.finalState, 'blocked');

  const blockedEvents = journal.list().filter((r) => r.event === 'blocked_action_reason');
  assert.equal(blockedEvents.length >= 1, true);
});

test('reconciliation correctness: восстанавливаются только позиции clean_slate_v2', () => {
  const reconciliation = createReconciliationEngine();
  const result = reconciliation.reconcile({
    exchangeSnapshot: {
      positions: [
        { positionId: 'p1', ownerTag: 'clean_slate_v2' },
        { positionId: 'legacy-1', ownerTag: 'legacy_runtime' },
      ],
      orders: [
        { orderId: 'o1', ownerTag: 'clean_slate_v2', linkedPositionId: null },
      ],
    },
    localState: {
      positions: [],
    },
  });

  assert.deepEqual(result.recoveredPositions.map((p) => p.positionId), ['p1']);
  assert.equal(result.blockedLegacyTailCount, 1);
  assert.equal(result.orphanOrders.length, 1);
});

test('entry and close owner-path correctness: approved entry/sizing и close request идут через новый execution слой', async () => {
  const submitted = [];
  const execution = createExecutionOwnerPath({
    exchangeAdapter: {
      submitEntry: async (payload) => {
        submitted.push({ type: 'entry', payload });
        return { orderId: 'E-3', status: 'filled' };
      },
      submitClose: async (payload) => {
        submitted.push({ type: 'close', payload });
        return { orderId: 'C-3', status: 'filled' };
      },
    },
  });

  execution.entryOwner.submitApprovedEntry({
    cycleId: 'c3',
    approvedEntry: { ticker: 'SOLUSDT', direction: 'long' },
    sizingResult: { size: 1.5 },
  });

  execution.closeOwner.submitCloseRequest({
    cycleId: 'c3',
    position: { positionId: 'pos-1', ticker: 'SOLUSDT' },
    reasonCode: 'early_invalidation',
  });

  await execution.runQueueOnce();
  await execution.runQueueOnce();

  assert.equal(submitted.length, 2);
  assert.deepEqual(submitted.map((x) => x.type), ['entry', 'close']);
});

test('no runtime dependency on legacy ownership path: execution core не содержит legacy entry/position chain', () => {
  const source = fs.readFileSync('clean_slate_v2/src/execution_core/executionOwnerPath.js', 'utf8');
  assert.equal(source.includes('openNewPositionLegacy'), false);
  assert.equal(source.includes('processExistingPositionLegacy'), false);
});
