const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateHigherTimeframeBias,
  evaluateHigherTimeframeBiasWithCache,
  applyHtfBiasToEntryDecision,
  toHigherTimeframeBiasEvent,
} = require('../../dist/runtime/engines/higherTimeframeBiasEngine');
const { createFeatureStore } = require('../../dist/runtime/shared/featureStore');
const { buildRuntimeConfig } = require('../../dist/runtime/config/runtimeConfigValidator');

function buildBullishHtfCandles() {
  return [
    { timestamp: 1, high: 102, low: 98, close: 101 },
    { timestamp: 2, high: 101, low: 97, close: 99 },
    { timestamp: 3, high: 104, low: 100, close: 103 },
    { timestamp: 4, high: 103, low: 99, close: 100 },
    { timestamp: 5, high: 106, low: 102, close: 105 },
    { timestamp: 6, high: 105, low: 101, close: 102 },
    { timestamp: 7, high: 108, low: 104, close: 107 },
    { timestamp: 8, high: 107, low: 103, close: 104 },
    { timestamp: 9, high: 110, low: 106, close: 109 },
  ];
}

test('higherTimeframeBiasEngine: возвращает bullish bias и структуру для HH/HL + BOS', () => {
  const decision = evaluateHigherTimeframeBias({
    context: { localDirection: 'long' },
    sharedSnapshot: { htfCandles: buildBullishHtfCandles(), latestPrice: 109 },
  }, {
    enabled: true,
    lookbackBars: 120,
    swingWindow: 1,
    minimumStructurePoints: 4,
    breakOfStructureThresholdPercent: 0.1,
  });

  assert.equal(decision.layerName, 'higherTimeframeBiasEngine');
  assert.equal(decision.htfBias, 'bullish');
  assert.equal(decision.marketStructureState, 'trend_structure');
  assert.equal(decision.dataQualityState, 'full');
  assert.ok(decision.trendAlignmentScore > 0);
  assert.ok(decision.structureConfidence > 0);
  assert.ok(Array.isArray(decision.reasonCodes));
});

test('higherTimeframeBiasEngine: slower-refresh переиспользует кэш и помечает cached mode', () => {
  const featureStore = createFeatureStore();
  const config = {
    enabled: true,
    swingWindow: 1,
    slowerRefresh: {
      enabled: true,
      forceRefreshEveryCycles: 5,
      useFeatureStoreCache: true,
    },
  };
  const input = {
    context: { ticker: 'BTC-USDT', exchange: 'bingx' },
    sharedSnapshot: { htfCandles: buildBullishHtfCandles(), latestPrice: 109 },
  };

  const full = evaluateHigherTimeframeBiasWithCache(input, config, {
    featureStore,
    cycleNumber: 10,
    latestHtfBarTimestamp: 9,
  });
  const cached = evaluateHigherTimeframeBiasWithCache(input, config, {
    featureStore,
    cycleNumber: 11,
    latestHtfBarTimestamp: 9,
  });

  assert.equal(full.mode, 'full_mode');
  assert.equal(cached.mode, 'cached_mode');
  assert.equal(cached.dataQualityState, 'cached');
  assert.ok(cached.reasonCodes.includes('cached_htf_structure_reuse'));
});

test('higherTimeframeBiasEngine: интеграция в final decision идёт только через soft penalty/metadata', () => {
  const next = applyHtfBiasToEntryDecision({
    entryDecision: {
      score: 0.6,
      penalties: [],
      metadata: { existing: true },
    },
  }, {
    htfBias: 'bearish',
    softPenalty: 0.2,
    trendAlignmentScore: -0.75,
    structureConfidence: 0.8,
    marketStructureState: 'trend_structure',
    dataQualityState: 'full',
    reasonCodes: ['counter_trend_against_htf_bias'],
  }, {
    enabled: true,
  });

  assert.ok(Math.abs(next.score - 0.4) < 1e-9);
  assert.equal(next.penalties.length, 1);
  assert.equal(next.penalties[0].type, 'htf_bias_penalty');
  assert.equal(next.metadata.higherTimeframeBias.htfBias, 'bearish');
});

test('higherTimeframeBiasEngine: structured event содержит поля audit trail/observability', () => {
  const event = toHigherTimeframeBiasEvent({
    context: {
      cycleId: 'c-htf-1',
      ticker: 'ETH-USDT',
      exchange: 'bingx',
      marketRegime: 'trend',
      capitalRegime: 'CAUTION',
      setupType: 'momentum',
      sizingDecision: 'pending',
    },
    decision: {
      layerName: 'higherTimeframeBiasEngine',
      htfBias: 'bullish',
      marketStructureState: 'trend_structure',
      structureConfidence: 0.7,
      trendAlignmentScore: 0.6,
      score: 0.6,
      confidence: 0.7,
      reasonCodes: ['aligned_with_htf_bias'],
      dataQualityState: 'full',
      mode: 'full_mode',
    },
  });

  assert.equal(event.eventType, 'higher_timeframe_bias_decision');
  assert.equal(event.module, 'higherTimeframeBiasEngine');
  assert.equal(event.payload.htfBias, 'bullish');
  assert.equal(event.payload.trendAlignmentScore, 0.6);
  assert.equal(event.executionAction, 'context_only');
});

test('runtimeConfigValidator: нормализует блок higherTimeframeBiasEngine', () => {
  const config = buildRuntimeConfig({
    getCoreConfig: () => ({
      enabled: true,
      higherTimeframeBiasEngine: {
        enabled: true,
        higherTimeframe: '1d',
        lookbackBars: 150,
        slowerRefresh: { enabled: true, forceRefreshEveryCycles: 2 },
      },
    }),
    getExchangeConfig: () => ({}),
    merge: (a, b) => ({ ...a, ...b }),
  }, { loopsLength: 5, intervalSeconds: 1 }, {});

  assert.equal(config.higherTimeframeBiasEngine.enabled, true);
  assert.equal(config.higherTimeframeBiasEngine.higherTimeframe, '1d');
  assert.equal(config.higherTimeframeBiasEngine.lookbackBars, 150);
  assert.equal(config.higherTimeframeBiasEngine.slowerRefresh.forceRefreshEveryCycles, 2);
});
