const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createCacheTiers,
  createRequestScheduler,
  createPerformanceGuardrails,
  createStructuredLogger,
  validateLogRecord,
  createRuntimeServices,
} = require('../../clean_slate_v2/src/runtime_base');

test('cache reuse: heavy вычисление не повторяется в рамках одного цикла', () => {
  const cache = createCacheTiers();
  let heavyCount = 0;

  const first = cache.getOrCompute({
    cycleId: 'cycle-a',
    key: 'feature_stack',
    computeHeavy: () => {
      heavyCount += 1;
      return { feature: 'A' };
    },
    mode: 'full',
  });

  const second = cache.getOrCompute({
    cycleId: 'cycle-a',
    key: 'feature_stack',
    computeHeavy: () => {
      heavyCount += 1;
      return { feature: 'B' };
    },
    mode: 'full',
  });

  assert.equal(first.source, 'heavy_compute');
  assert.equal(second.source, 'cycle_cache');
  assert.equal(heavyCount, 1);
  assert.deepEqual(first.value, second.value);
});

test('scheduler behavior: лимиты, cooldown и dedup применяются детерминированно', () => {
  let now = 1_000;
  const scheduler = createRequestScheduler({
    maxRequestsPerCycle: 2,
    maxRequestsPerWindow: 3,
    windowMs: 1000,
    assetCooldownMs: 200,
    now: () => now,
  });

  const a1 = scheduler.tryAcquire({ cycleId: 'c1', asset: 'BTCUSDT', requestKey: 'book' });
  assert.equal(a1.allowed, true);

  const a2 = scheduler.tryAcquire({ cycleId: 'c1', asset: 'BTCUSDT', requestKey: 'book' });
  assert.equal(a2.allowed, false);
  assert.equal(a2.reason, 'duplicate_request_in_cycle');

  now += 300;
  const a3 = scheduler.tryAcquire({ cycleId: 'c1', asset: 'BTCUSDT', requestKey: 'trades' });
  assert.equal(a3.allowed, true);

  now += 300;
  const a4 = scheduler.tryAcquire({ cycleId: 'c1', asset: 'ETHUSDT', requestKey: 'ticker' });
  assert.equal(a4.allowed, false);
  assert.equal(a4.reason, 'cycle_budget_exceeded');
});

test('degraded fallback: при деградации используется cache/fallback без heavy compute', () => {
  const services = createRuntimeServices({
    performance: {
      maxHeavyOpsPerCycle: 1,
      cycleBudgetMs: 10,
      maxSingleOpMs: 1,
    },
  });

  let heavyCount = 0;

  const first = services.computeWithGuardrails({
    cycleId: 'c2',
    key: 'htf',
    computeHeavy: () => {
      heavyCount += 1;
      return { regime: 'trend' };
    },
    fallbackValue: { regime: 'safe_neutral' },
    estimatedCostMs: 5,
  });

  services.performance.recordHeavyRun({ cycleId: 'c2', elapsedMs: 5 });
  services.performance.recordHeavyRun({ cycleId: 'c2', elapsedMs: 6 });

  const second = services.computeWithGuardrails({
    cycleId: 'c2',
    key: 'htf_next',
    computeHeavy: () => {
      heavyCount += 1;
      return { regime: 'impulse' };
    },
    fallbackValue: { regime: 'safe_neutral' },
    estimatedCostMs: 5,
  });

  assert.equal(first.source, 'heavy_compute');
  assert.notEqual(second.source, 'heavy_compute');
  assert.equal(heavyCount, 1);
});

test('logging consistency: structured logger пишет валидный и стабильный формат', () => {
  const written = [];
  const logger = createStructuredLogger({
    writer: (record) => written.push(record),
    now: () => '2026-04-07T00:00:00.000Z',
  });

  const result = logger.log({
    level: 'warn',
    event: 'performance_fallback_mode',
    cycleId: 'c3',
    mode: 'paper',
    asset: 'BTCUSDT',
    reasonCodes: ['cycle_budget_limit'],
    details: { key: 'htf', fallbackMode: 'cached' },
  });

  assert.equal(result.accepted, true);
  assert.equal(written.length, 1);
  assert.equal(validateLogRecord(written[0]).ok, true);
  assert.deepEqual(Object.keys(written[0]), [
    'ts',
    'level',
    'event',
    'cycleId',
    'mode',
    'asset',
    'reasonCodes',
    'details',
  ]);
});

test('no repeated heavy computation: runtime services не пересчитывает блок при cache hit', () => {
  const services = createRuntimeServices();
  let heavyCount = 0;

  const one = services.computeWithGuardrails({
    cycleId: 'c4',
    key: 'capital_regime',
    computeHeavy: () => {
      heavyCount += 1;
      return { state: 'NORMAL' };
    },
    fallbackValue: { state: 'SAFE' },
    estimatedCostMs: 8,
  });

  const two = services.computeWithGuardrails({
    cycleId: 'c4',
    key: 'capital_regime',
    computeHeavy: () => {
      heavyCount += 1;
      return { state: 'STRESS' };
    },
    fallbackValue: { state: 'SAFE' },
    estimatedCostMs: 8,
  });

  assert.equal(one.source, 'heavy_compute');
  assert.equal(two.source, 'cycle_cache');
  assert.equal(heavyCount, 1);
});
