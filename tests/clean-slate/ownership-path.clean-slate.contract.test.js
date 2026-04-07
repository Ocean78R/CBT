const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { OWNER_PATH_CONTRACT } = require('../../clean_slate_v2/src/contracts/ownerPathContracts');
const { evaluateFlatStartContract } = require('../../clean_slate_v2/src/bootstrap/flatStartGuard');
const { CleanRuntimeOrchestrator } = require('../../clean_slate_v2/src/runtime/cleanRuntimeOrchestrator');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

test('clean-slate contract: в новом owner-path запрещены прямые legacy вызовы', () => {
  const entryOwnerSource = read('clean_slate_v2/src/execution_core/entryExecutionOwner.js');
  const positionOwnerSource = read('clean_slate_v2/src/execution_core/closeExecutionOwner.js');
  const orchestratorSource = read('clean_slate_v2/src/runtime/cleanRuntimeOrchestrator.js');

  for (const forbidden of OWNER_PATH_CONTRACT.forbiddenLegacyOwners) {
    assert.equal(entryOwnerSource.includes(forbidden), false, `entryOwner содержит forbidden legacy owner: ${forbidden}`);
    assert.equal(positionOwnerSource.includes(forbidden), false, `positionOwner содержит forbidden legacy owner: ${forbidden}`);
    assert.equal(orchestratorSource.includes(forbidden), false, `orchestrator содержит forbidden legacy owner: ${forbidden}`);
  }
});

test('flat-start: clean start разрешает запуск и возвращает passed report', async () => {
  const orchestrator = new CleanRuntimeOrchestrator({
    entryOwner: { openNewPosition: async () => ({ opened: true }) },
    positionOwner: { processExistingPosition: async () => ({ action: 'hold' }) },
    stateGateway: {
      readFlatStartState: async () => ({
        openPositions: [],
        activeOrders: [],
        protectiveStateMarkers: [],
        legacyMismatchRestrictedState: [],
      }),
    },
    startupMode: 'paper',
  });

  const boot = await orchestrator.boot();
  assert.equal(boot.ready, true);
  assert.equal(boot.runtimeMode, 'trading_enabled');
  assert.equal(boot.startupReport.flatStartStatus, 'passed');
  assert.deepEqual(boot.startupReport.reasonCodes, []);
});

test('flat-start: start blocked by open positions', () => {
  const decision = evaluateFlatStartContract({
    openPositions: [{ ticker: 'BTCUSDT' }],
    activeOrders: [],
    protectiveStateMarkers: [],
    legacyMismatchRestrictedState: [],
  });

  assert.equal(decision.passed, false);
  assert.equal(decision.runtimeMode, 'safe_mode');
  assert.deepEqual(decision.blockers.map((b) => b.code), ['open_positions_detected']);
});

test('flat-start: start blocked by open orders', () => {
  const decision = evaluateFlatStartContract({
    openPositions: [],
    activeOrders: [{ orderId: 'A-1' }],
    protectiveStateMarkers: [],
    legacyMismatchRestrictedState: [],
  });

  assert.equal(decision.passed, false);
  assert.equal(decision.runtimeMode, 'safe_mode');
  assert.deepEqual(decision.blockers.map((b) => b.code), ['orphan_orders_detected']);
});

test('flat-start: start blocked by protective residue', async () => {
  const orchestrator = new CleanRuntimeOrchestrator({
    entryOwner: { openNewPosition: async () => ({ opened: true }) },
    positionOwner: { processExistingPosition: async () => ({ action: 'hold' }) },
    stateGateway: {
      readFlatStartState: async () => ({
        openPositions: [],
        activeOrders: [],
        protectiveStateMarkers: ['forced_loss_guard_active'],
        legacyMismatchRestrictedState: [],
      }),
    },
    startupMode: 'shadow',
  });

  const boot = await orchestrator.boot();
  assert.equal(boot.ready, false);
  assert.equal(boot.runtimeMode, 'safe_mode');
  assert.equal(boot.startupReport.flatStartStatus, 'failed');
  assert.deepEqual(boot.startupReport.reasonCodes, ['legacy_protective_state_detected']);
});
