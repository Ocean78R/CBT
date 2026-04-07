const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DECISION_CONTEXT_CONTRACT_VERSION,
  createMarketSnapshot,
  createFeatureSnapshot,
  createSharedDataPlane,
  createStructuredRuntimeContext,
  assertDecisionContextIntegrity,
  assertNoAdHocContextFork,
} = require('../../clean_slate_v2/src/foundation');

test('DecisionContext integrity: корректный contractVersion и обязательные snapshots', () => {
  const dataPlane = createSharedDataPlane();
  dataPlane.setCycleSnapshots('cycle-1', {
    marketSnapshot: createMarketSnapshot({ ticker: 'BTCUSDT' }),
    featureSnapshot: createFeatureSnapshot({ ticker: 'BTCUSDT' }),
  });

  const result = createStructuredRuntimeContext({
    cycleId: 'cycle-1',
    mode: 'paper',
    asset: { ticker: 'BTCUSDT', timeframe: '5m', exchange: 'generic_exchange' },
    dataPlane,
    sharedOutputs: {
      regime: { state: 'trend' },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.decisionContext.contractVersion, DECISION_CONTEXT_CONTRACT_VERSION);
  assert.equal(assertDecisionContextIntegrity(result.decisionContext).ok, true);
});

test('snapshot reuse: heavy output вычисляется один раз и переиспользуется', () => {
  const dataPlane = createSharedDataPlane();
  let computeCount = 0;

  const first = dataPlane.getOrComputeOutput({
    cycleId: 'cycle-2',
    blockKey: 'htf_regime',
    compute: () => {
      computeCount += 1;
      return { state: 'uptrend', confidence: 0.71 };
    },
  });

  const second = dataPlane.getOrComputeOutput({
    cycleId: 'cycle-2',
    blockKey: 'htf_regime',
    compute: () => {
      computeCount += 1;
      return { state: 'downtrend', confidence: 0.2 };
    },
  });

  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(computeCount, 1);
  assert.deepEqual(first.value, second.value);
});

test('shared output propagation: DecisionContext получает общий output без пересчёта', () => {
  const dataPlane = createSharedDataPlane();
  dataPlane.setCycleSnapshots('cycle-3', {
    marketSnapshot: createMarketSnapshot({ ticker: 'ETHUSDT' }),
    featureSnapshot: createFeatureSnapshot({ ticker: 'ETHUSDT' }),
  });

  const regimeOutput = dataPlane.getOrComputeOutput({
    cycleId: 'cycle-3',
    blockKey: 'capital_regime',
    compute: () => ({ state: 'NORMAL', source: 'capitalRegimeEngine' }),
  }).value;

  const runtimeResult = createStructuredRuntimeContext({
    cycleId: 'cycle-3',
    mode: 'paper',
    asset: { ticker: 'ETHUSDT', timeframe: '5m', exchange: 'generic_exchange' },
    dataPlane,
    sharedOutputs: { regime: regimeOutput },
  });

  assert.equal(runtimeResult.ok, true);
  assert.equal(runtimeResult.decisionContext.sharedOutputs.regime, regimeOutput);
});

test('no ad-hoc context forks: альтернативный контекст для того же cycle/ticker запрещён', () => {
  const dataPlane = createSharedDataPlane();
  dataPlane.setCycleSnapshots('cycle-4', {
    marketSnapshot: createMarketSnapshot({ ticker: 'SOLUSDT' }),
    featureSnapshot: createFeatureSnapshot({ ticker: 'SOLUSDT' }),
  });

  const base = createStructuredRuntimeContext({
    cycleId: 'cycle-4',
    mode: 'paper',
    asset: { ticker: 'SOLUSDT', timeframe: '5m', exchange: 'generic_exchange' },
    dataPlane,
  }).decisionContext;

  const fork = {
    ...base,
    metadata: { forked: true },
  };

  const forkCheck = assertNoAdHocContextFork({ baseContext: base, candidateContext: fork });
  assert.equal(forkCheck.ok, false);
  assert.equal(forkCheck.reason, 'ad_hoc_context_fork_detected');
});
