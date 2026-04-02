const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateVwapProfileLayer, normalizeVwapProfileConfig } = require('../../dist/runtime/engines/vwapProfileEngine');

test('vwapProfileEngine: возвращает degraded mode при недостатке свечей', () => {
  const result = evaluateVwapProfileLayer({
    context: { ticker: 'BTC-USDT', exchange: 'bingx' },
    sharedSnapshot: { candles: [{ close: 100, high: 101, low: 99, volume: 10 }] },
    primarySignal: { direction: 'long', score: 0.8 },
    shortlistCandidate: true,
  }, normalizeVwapProfileConfig({ enabled: true }));

  assert.equal(result.layerName, 'volumeContextLayer');
  assert.equal(result.dataQualityState, 'degraded');
  assert.ok((result.reasonCodes || []).includes('volume_context_insufficient_candles'));
});

test('vwapProfileEngine: использует cache при включённой policy', () => {
  const cache = {};
  const config = normalizeVwapProfileConfig({
    enabled: true,
    refreshPolicy: { minBarsBetweenFullRecalc: 5, allowCachedReuse: true },
  });
  const candles = Array.from({ length: 20 }, (_, idx) => ({
    close: 100 + idx,
    high: 101 + idx,
    low: 99 + idx,
    volume: 100 + idx,
  }));

  const first = evaluateVwapProfileLayer({
    context: { ticker: 'ETH-USDT', exchange: 'bingx', cycleIndex: 1 },
    sharedSnapshot: { candles },
    featureStoreContext: cache,
    primarySignal: { direction: 'long', score: 0.9 },
    shortlistCandidate: true,
  }, config);

  const second = evaluateVwapProfileLayer({
    context: { ticker: 'ETH-USDT', exchange: 'bingx', cycleIndex: 2 },
    sharedSnapshot: { candles: [...candles, { close: 121, high: 122, low: 120, volume: 121 }] },
    featureStoreContext: cache,
    primarySignal: { direction: 'long', score: 0.9 },
    shortlistCandidate: true,
  }, config);

  assert.equal(first.layerName, 'volumeContextLayer');
  assert.equal(second.layerName, 'volumeContextLayer');
  assert.equal(second.explanation.refreshMode, 'cached_mode');
  assert.ok((second.reasonCodes || []).includes('volume_context_cached_reuse'));
});
