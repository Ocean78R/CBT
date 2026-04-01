const test = require('node:test');
const assert = require('node:assert/strict');

const { createProviders } = require('../../dist/runtime/providers');

test('performanceDiagnostics: дедуплицирует in-flight read-only запросы и считает метрики', async () => {
  let calls = 0;
  const connector = {
    getTickerInfo: async (ticker) => {
      calls += 1;
      return { ticker, price: 101 };
    },
    getMarkPrice: async () => 100,
    getKLine: async () => [],
    getSymbolsByLeverage: async () => [],
    getMaxLeverageForTicker: async () => 20,
    getLeverage: async () => 10,
    getMarginMode: async () => 'cross',
    getBalance: async () => ({ free: 1000 }),
    getFuturesActivePositions: async () => [],
    getFuturesPositionsForTicker: async () => [],
    updateTickerLeverage: async () => true,
    setMarginMode: async () => true,
  };
  const utils = { positionIsActive: () => true };
  const providers = createProviders(connector, utils, {
    performanceDiagnostics: {
      enabled: true,
      readOnlyCache: { enabled: true, ttlMs: 1000, methods: ['getTickerInfo'] },
      metrics: { enabled: true, slowCallMs: 1 },
    },
  });

  const [a, b] = await Promise.all([
    providers.marketDataProvider.getTickerInfo('BTC-USDT'),
    providers.marketDataProvider.getTickerInfo('BTC-USDT'),
  ]);

  assert.equal(a.ticker, 'BTC-USDT');
  assert.equal(b.ticker, 'BTC-USDT');
  assert.equal(calls, 1);

  await providers.marketDataProvider.getTickerInfo('BTC-USDT');
  const diagnostics = providers.getPerformanceDiagnostics();
  assert.equal(diagnostics.metrics.cacheHits >= 1, true);
  assert.equal(diagnostics.metrics.inFlightHits >= 1, true);
  assert.equal(diagnostics.metrics.byMethod.getTickerInfo.calls >= 2, true);
});

test('performanceDiagnostics: отдельные TTL для markPrice/kline и hot-state snapshot', async () => {
  let markCalls = 0;
  let klineCalls = 0;
  const connector = {
    getTickerInfo: async (ticker) => ({ ticker }),
    getMarkPrice: async () => {
      markCalls += 1;
      return 200 + markCalls;
    },
    getKLine: async (ticker, interval) => {
      klineCalls += 1;
      return [{ ticker, interval, close: 100 + klineCalls }];
    },
    getSymbolsByLeverage: async () => [],
    getMaxLeverageForTicker: async () => 20,
    getLeverage: async () => 10,
    getMarginMode: async () => 'cross',
    getBalance: async () => ({ free: 1000 }),
    getFuturesActivePositions: async () => [],
    getFuturesPositionsForTicker: async () => [],
    updateTickerLeverage: async () => true,
    setMarginMode: async () => true,
  };

  const providers = createProviders(connector, { positionIsActive: () => true }, {
    performanceDiagnostics: {
      enabled: true,
      readOnlyCache: {
        enabled: true,
        methods: ['getMarkPrice', 'getKLine'],
        markPriceTtlMs: 100,
        klineTtlMs: 100,
      },
      hotState: { enabled: true, maxTickers: 10, staleReuseGraceMs: 30 },
    },
  });

  const p1 = await providers.marketDataProvider.getMarkPrice('ETH-USDT');
  const p2 = await providers.marketDataProvider.getMarkPrice('ETH-USDT');
  assert.equal(p1, p2);
  assert.equal(markCalls, 1);

  const c1 = await providers.marketDataProvider.getKLine('ETH-USDT', '1m');
  const c2 = await providers.marketDataProvider.getKLine('ETH-USDT', '1m');
  assert.deepEqual(c1, c2);
  assert.equal(klineCalls, 1);

  const hot = providers.getHotStateSnapshot();
  assert.equal(hot.tickers['ETH-USDT'].markPrice !== null, true);
  assert.equal(!!hot.tickers['ETH-USDT'].klineByInterval['1m'], true);
});

test('performanceDiagnostics: execution-critical методы не кешируются и инвалидация работает безопасно', async () => {
  let leverageUpdates = 0;
  let markCalls = 0;
  const connector = {
    getTickerInfo: async (ticker) => ({ ticker }),
    getMarkPrice: async () => {
      markCalls += 1;
      return 300 + markCalls;
    },
    getKLine: async () => [],
    getSymbolsByLeverage: async () => [],
    getMaxLeverageForTicker: async () => 20,
    getLeverage: async () => 10,
    getMarginMode: async () => 'cross',
    getBalance: async () => ({ free: 1000 }),
    getFuturesActivePositions: async () => [],
    getFuturesPositionsForTicker: async () => [],
    updateTickerLeverage: async () => {
      leverageUpdates += 1;
      return true;
    },
    setMarginMode: async () => true,
  };

  const providers = createProviders(connector, { positionIsActive: () => true }, {
    performanceDiagnostics: {
      enabled: true,
      readOnlyCache: { enabled: true, methods: ['getMarkPrice'], markPriceTtlMs: 1000 },
      invalidation: { onExecutionTickers: true },
    },
  });

  await providers.marketDataProvider.getMarkPrice('BTC-USDT');
  await providers.exchangeCapabilitiesProvider.updateTickerLeverage('BTC-USDT', 15);
  await providers.exchangeCapabilitiesProvider.updateTickerLeverage('BTC-USDT', 15);
  assert.equal(leverageUpdates, 2);

  providers.cacheControl.onExecutionActivity(['BTC-USDT']);
  await providers.marketDataProvider.getMarkPrice('BTC-USDT');
  assert.equal(markCalls, 2);
});
