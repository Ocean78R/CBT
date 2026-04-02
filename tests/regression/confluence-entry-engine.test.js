const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateConfluenceEntry,
  normalizeConfluenceEntryConfig,
  toConfluenceEntryEvent,
} = require('../../dist/runtime/engines/confluenceEntryEngine');

test('confluenceEntryEngine: блокирует вход при no-trade режиме от regime-router', () => {
  const config = normalizeConfluenceEntryConfig({ enabled: true, mode: 'confluence' });
  const result = evaluateConfluenceEntry({
    context: {
      cycleId: 'c-1',
      ticker: 'BTC-USDT',
      exchange: 'bingx',
      marketRegime: 'no_trade_flat',
      capitalRegime: 'NORMAL',
      balanceState: { capitalRegime: 'NORMAL' },
      forecastRegimeShiftRisk: 'LOW',
    },
    regimeRouterDecision: {
      layerName: 'marketRegimeRouter',
      marketRegime: 'no_trade_flat',
      allowedSetups: [],
      selectedPredictType: 'none',
      score: 0.2,
      confidence: 0.75,
    },
    primarySignal: {
      direction: 'long',
      score: 0.8,
      confidence: 0.7,
    },
  }, config);

  assert.equal(result.enabled, true);
  assert.equal(result.decision.entryAllowed, false);
  assert.equal(result.decision.finalDecision, 'NO_ENTRY');
  assert.ok((result.decision.reasonCodes || []).some((x) => String(x).includes('hard_veto')));
});

test('confluenceEntryEngine: блокирует вход при capital prohibition независимо от сигнала', () => {
  const config = normalizeConfluenceEntryConfig({ enabled: true, mode: 'confluence' });
  const result = evaluateConfluenceEntry({
    context: {
      cycleId: 'c-2',
      ticker: 'ETH-USDT',
      exchange: 'bingx',
      marketRegime: 'trend',
      capitalRegime: 'HALT_NEW_ENTRIES',
      balanceState: { capitalRegime: 'HALT_NEW_ENTRIES' },
      forecastRegimeShiftRisk: 'HIGH',
      forecastSignals: ['projected_margin_spike'],
    },
    regimeRouterDecision: {
      layerName: 'marketRegimeRouter',
      marketRegime: 'trend',
      allowedSetups: ['byBarsPercents'],
      selectedPredictType: 'byBarsPercents',
      score: 0.72,
      confidence: 0.7,
    },
    primarySignal: {
      direction: 'short',
      score: 0.9,
      confidence: 0.8,
    },
  }, config);

  assert.equal(result.enabled, true);
  assert.equal(result.decision.entryAllowed, false);
  assert.equal(result.decision.veto.type, 'capital_prohibition');
  assert.equal(result.decision.finalDecision, 'NO_ENTRY');
});

test('confluenceEntryEngine: формирует FULL_ENTRY при валидных слоях и подтверждениях', () => {
  const config = normalizeConfluenceEntryConfig({
    enabled: true,
    mode: 'confluence',
    blockWeights: {
      entryPermission: 0.24,
      marketContext: 0.2,
      primarySignal: 0.28,
      confirmation: 0.2,
      marketLevel: 0.08,
    },
    marketLevel: {
      enabled: true,
      lookbackBars: 24,
      rangeLookbackBars: 16,
      swingWindow: 1,
      minSwingPoints: 2,
    },
    thresholds: { fullEntryScore: 0.58, weakEntryScore: 0.44, minConfidence: 0.3 },
  });

  const result = evaluateConfluenceEntry({
    context: {
      cycleId: 'c-3',
      ticker: 'SOL-USDT',
      exchange: 'bingx',
      marketRegime: 'trend',
      capitalRegime: 'NORMAL',
      balanceState: { capitalRegime: 'NORMAL' },
      forecastRegimeShiftRisk: 'LOW',
      setupType: 'byBarsPercents',
    },
    sharedSnapshot: {
      candles: [
        { timestamp: 1, open: 100, high: 102, low: 98, close: 101 },
        { timestamp: 2, open: 101, high: 104, low: 99, close: 103 },
        { timestamp: 3, open: 103, high: 105, low: 100, close: 101 },
        { timestamp: 4, open: 101, high: 103, low: 97, close: 99 },
        { timestamp: 5, open: 99, high: 101, low: 95, close: 100 },
        { timestamp: 6, open: 100, high: 106, low: 99, close: 105 },
        { timestamp: 7, open: 105, high: 108, low: 103, close: 107 },
        { timestamp: 8, open: 107, high: 109, low: 104, close: 105 },
        { timestamp: 9, open: 105, high: 106, low: 100, close: 101 },
        { timestamp: 10, open: 101, high: 103, low: 98, close: 102 },
        { timestamp: 11, open: 102, high: 107, low: 101, close: 106 },
        { timestamp: 12, open: 106, high: 110, low: 105, close: 109 },
      ],
    },
    regimeRouterDecision: {
      layerName: 'marketRegimeRouter',
      marketRegime: 'trend',
      allowedSetups: ['byBarsPercents', 'byBars3Bars'],
      selectedPredictType: 'byBarsPercents',
      score: 0.84,
      confidence: 0.78,
    },
    primarySignal: {
      layerName: 'primarySignalLayer',
      direction: 'long',
      score: 0.86,
      confidence: 0.77,
      setupType: 'byBarsPercents',
    },
    confirmationSignals: [
      { name: 'volume_confirmation', approved: true },
      { name: 'volatility_confirmation', approved: true },
    ],
    htfBiasDecision: {
      layerName: 'higherTimeframeBiasEngine',
      htfBias: 'long',
      mode: 'full_mode',
    },
  }, config);

  assert.equal(result.enabled, true);
  assert.equal(result.decision.entryAllowed, true);
  assert.equal(result.decision.finalDecision, 'FULL_ENTRY');
  assert.equal(result.layers.marketLevelLayer.layerName, 'marketLevelLayer');
  assert.ok(result.decisionContext.metadata.marketLevels);

  const event = toConfluenceEntryEvent({ context: { cycleId: 'c-3', ticker: 'SOL-USDT', exchange: 'bingx' }, result });
  assert.equal(event.eventType, 'confluence_entry_decision');
  assert.equal(event.finalDecision, 'FULL_ENTRY');
  assert.ok(event.payload && event.payload.layerScores && event.payload.layerScores.finalEntryDecisionLayer);
});
