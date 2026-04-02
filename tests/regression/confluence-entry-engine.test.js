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

  const event = toConfluenceEntryEvent({ context: { cycleId: 'c-3', ticker: 'SOL-USDT', exchange: 'bingx' }, result });
  assert.equal(event.eventType, 'confluence_entry_decision');
  assert.equal(event.finalDecision, 'FULL_ENTRY');
  assert.ok(event.payload && event.payload.layerScores && event.payload.layerScores.finalEntryDecisionLayer);
});
