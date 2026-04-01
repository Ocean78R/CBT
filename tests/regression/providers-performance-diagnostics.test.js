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

