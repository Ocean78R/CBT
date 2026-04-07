const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { OWNER_PATH_CONTRACT } = require('../../clean_slate_v1/src/contracts/ownerPathContracts');
const { evaluateFlatStartContract } = require('../../clean_slate_v1/src/bootstrap/flatStartGuard');
const { CleanRuntimeOrchestrator } = require('../../clean_slate_v1/src/runtime/cleanRuntimeOrchestrator');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

test('clean-slate contract: в новом owner-path запрещены прямые legacy вызовы', () => {
  const entryOwnerSource = read('clean_slate_v1/src/owners/entryOwner.js');
  const positionOwnerSource = read('clean_slate_v1/src/owners/positionOwner.js');
  const orchestratorSource = read('clean_slate_v1/src/runtime/cleanRuntimeOrchestrator.js');

  for (const forbidden of OWNER_PATH_CONTRACT.forbiddenLegacyOwners) {
    assert.equal(entryOwnerSource.includes(forbidden), false, `entryOwner содержит forbidden legacy owner: ${forbidden}`);
    assert.equal(positionOwnerSource.includes(forbidden), false, `positionOwner содержит forbidden legacy owner: ${forbidden}`);
    assert.equal(orchestratorSource.includes(forbidden), false, `orchestrator содержит forbidden legacy owner: ${forbidden}`);
  }
});

test('clean-slate contract: flat-start violation переключает runtime в safe_mode', async () => {
  const orchestrator = new CleanRuntimeOrchestrator({
    entryOwner: { openNewPosition: async () => ({ opened: true }) },
    positionOwner: { processExistingPosition: async () => ({ action: 'hold' }) },
    stateGateway: {
      readFlatStartState: async () => ({
        hasOpenPositions: true,
        hasOrphanOrders: false,
        hasLegacyProtectiveState: false,
        hasLegacyRestrictedState: false,
      }),
    },
  });

  const boot = await orchestrator.boot();
  assert.equal(boot.ready, false);
  assert.equal(boot.runtimeMode, 'safe_mode');
  assert.deepEqual(boot.diagnostics, ['open_positions_detected']);
});

test('clean-slate contract: flat-start pass разрешает trading_enabled', () => {
  const decision = evaluateFlatStartContract({
    hasOpenPositions: false,
    hasOrphanOrders: false,
    hasLegacyProtectiveState: false,
    hasLegacyRestrictedState: false,
  });

  assert.equal(decision.passed, true);
  assert.equal(decision.runtimeMode, 'trading_enabled');
  assert.deepEqual(decision.diagnostics, []);
});
