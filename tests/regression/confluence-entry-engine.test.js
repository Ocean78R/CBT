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
      volumeContext: 0,
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
  assert.equal(result.layers.volumeContextLayer.layerName, 'volumeContextLayer');
  assert.ok(result.decisionContext.metadata.marketLevels);
  assert.ok(result.decisionContext.metadata.volumeContext);

  const event = toConfluenceEntryEvent({ context: { cycleId: 'c-3', ticker: 'SOL-USDT', exchange: 'bingx' }, result });
  assert.equal(event.eventType, 'confluence_entry_decision');
  assert.equal(event.finalDecision, 'FULL_ENTRY');
  assert.ok(event.payload && event.payload.layerScores && event.payload.layerScores.finalEntryDecisionLayer);
  assert.ok(event.payload.volumeContext);
});

test('confluenceEntryEngine: учитывает отдельный блок volumeContextLayer без замены zones', () => {
  const config = normalizeConfluenceEntryConfig({
    enabled: true,
    mode: 'confluence',
    blockWeights: {
      entryPermission: 0.22,
      marketContext: 0.2,
      primarySignal: 0.24,
      confirmation: 0.12,
      marketLevel: 0.12,
      volumeContext: 0.1,
    },
    thresholds: { fullEntryScore: 0.55, weakEntryScore: 0.42, minConfidence: 0.3 },
    volumeContext: {
      enabled: true,
      vwapWindowBars: 20,
      volumeProfile: { bins: 10 },
      lazyEvaluation: {
        enabled: true,
        requireShortlistCandidate: true,
        requirePrimaryDirection: true,
        minPrimaryScore: 0.4,
      },
      refreshPolicy: { minBarsBetweenFullRecalc: 1, allowCachedReuse: false },
    },
  });

  const candles = Array.from({ length: 30 }, (_, idx) => ({
    timestamp: idx + 1,
    open: 100 + idx * 0.3,
    high: 101 + idx * 0.4,
    low: 99 + idx * 0.25,
    close: 100 + idx * 0.35,
    volume: 1000 + idx * 15,
  }));

  const result = evaluateConfluenceEntry({
    context: {
      cycleId: 'c-4',
      cycleIndex: 4,
      ticker: 'BTC-USDT',
      exchange: 'bingx',
      marketRegime: 'trend',
      capitalRegime: 'NORMAL',
      balanceState: { capitalRegime: 'NORMAL' },
      forecastRegimeShiftRisk: 'LOW',
      setupType: 'byBarsPercents',
    },
    sharedSnapshot: { candles },
    featureStoreContext: {},
    shortlistCandidate: true,
    budgetState: 'normal',
    regimeRouterDecision: {
      layerName: 'marketRegimeRouter',
      marketRegime: 'trend',
      allowedSetups: ['byBarsPercents'],
      selectedPredictType: 'byBarsPercents',
      score: 0.81,
      confidence: 0.74,
    },
    primarySignal: {
      layerName: 'primarySignalLayer',
      direction: 'long',
      score: 0.83,
      confidence: 0.77,
      setupType: 'byBarsPercents',
    },
    confirmationSignals: [{ name: 'trend_confirmation', approved: true }],
    htfBiasDecision: {
      layerName: 'higherTimeframeBiasEngine',
      htfBias: 'long',
      mode: 'full_mode',
    },
  }, config);

  assert.equal(result.layers.volumeContextLayer.layerName, 'volumeContextLayer');
  assert.ok(Number.isFinite(result.layers.volumeContextLayer.score));
  assert.ok(result.decisionContext.metadata.volumeContext);
  assert.ok(result.decisionContext.metadata.layerScores.volumeContextLayer);
});

test('confluenceEntryEngine: bounceDetectionLayer обогащает решение, но не открывает сделку самостоятельно', () => {
  const config = normalizeConfluenceEntryConfig({
    enabled: true,
    mode: 'confluence',
    blockWeights: {
      entryPermission: 0.24,
      marketContext: 0.2,
      primarySignal: 0.22,
      confirmation: 0.14,
      marketLevel: 0.08,
      volumeContext: 0.06,
      bounceDetection: 0.06,
    },
    thresholds: { fullEntryScore: 0.56, weakEntryScore: 0.42, minConfidence: 0.25 },
    bounceDetection: {
      enabled: true,
      allowedRegimes: ['trend', 'range'],
      thresholds: { scoreForSetupTag: 0.5, minConfidence: 0.2, microstructureActivationScore: 0.4 },
    },
  });

  const candles = Array.from({ length: 40 }, (_, idx) => ({
    timestamp: idx + 1,
    open: 100 - idx * 0.25,
    high: 101 - idx * 0.2,
    low: 98 - idx * 0.28,
    close: 99 - idx * 0.22 + (idx > 30 ? (idx - 30) * 0.12 : 0),
    volume: 1200 + idx * 20,
  }));

  const result = evaluateConfluenceEntry({
    context: {
      cycleId: 'c-5',
      cycleIndex: 5,
      ticker: 'XRP-USDT',
      exchange: 'bingx',
      marketRegime: 'trend',
      capitalRegime: 'DEFENSIVE',
      balanceState: { capitalRegime: 'DEFENSIVE' },
      forecastRegimeShiftRisk: 'ELEVATED',
      setupType: 'byBarsPercents',
    },
    sharedSnapshot: {
      candles,
      orderBook: {
        bestBid: 90,
        bestAsk: 90.05,
        bidVolume: 120000,
        askVolume: 90000,
      },
    },
    budgetState: 'normal',
    regimeRouterDecision: {
      layerName: 'marketRegimeRouter',
      marketRegime: 'trend',
      allowedSetups: ['byBarsPercents'],
      selectedPredictType: 'byBarsPercents',
      score: 0.76,
      confidence: 0.73,
    },
    primarySignal: {
      layerName: 'primarySignalLayer',
      direction: 'long',
      score: 0.79,
      confidence: 0.72,
      setupType: 'byBarsPercents',
    },
    confirmationSignals: [{ name: 'trend_confirmation', approved: true }],
    htfBiasDecision: {
      layerName: 'higherTimeframeBiasEngine',
      htfBias: 'long',
      mode: 'full_mode',
    },
  }, config);

  assert.equal(result.enabled, true);
  assert.equal(result.layers.bounceDetectionLayer.layerName, 'bounceDetectionLayer');
  assert.ok(Number.isFinite(result.layers.bounceDetectionLayer.score));
  assert.ok(Array.isArray(result.layers.bounceDetectionLayer.explanation.setupTypes));
  assert.ok(result.decisionContext.metadata.bounceDetection);

  const event = toConfluenceEntryEvent({
    context: { cycleId: 'c-5', ticker: 'XRP-USDT', exchange: 'bingx' },
    result,
  });
  assert.ok(event.payload.bounceDetection);
  assert.ok(event.payload.telemetry.downstreamContext.confluenceEntry.bounceDetection);
});

test('confluenceEntryEngine: breakdownDetectionLayer добавляет bearish continuation в confluence-контракт', () => {
  const config = normalizeConfluenceEntryConfig({
    enabled: true,
    mode: 'confluence',
    blockWeights: {
      entryPermission: 0.22,
      marketContext: 0.2,
      primarySignal: 0.2,
      confirmation: 0.14,
      marketLevel: 0.08,
      volumeContext: 0.06,
      bounceDetection: 0.04,
      breakdownDetection: 0.06,
    },
    thresholds: { fullEntryScore: 0.55, weakEntryScore: 0.4, minConfidence: 0.2 },
    breakdownDetection: {
      enabled: true,
      allowedRegimes: ['trend', 'pullback'],
      thresholds: { scoreForSetupTag: 0.5, minConfidence: 0.2, microstructureActivationScore: 0.45 },
    },
  });

  const candles = Array.from({ length: 52 }, (_, idx) => {
    const base = 140 - idx * 0.52;
    return {
      timestamp: idx + 1,
      open: base + 0.24,
      high: base + 0.42,
      low: base - (idx % 4 === 0 ? 0.9 : 0.36),
      close: base - (idx > 40 ? 0.35 : 0.12),
      volume: 900 + idx * 26 + (idx > 42 ? 260 : 0),
    };
  });

  const result = evaluateConfluenceEntry({
    context: {
      cycleId: 'c-6',
      cycleIndex: 6,
      ticker: 'DOGE-USDT',
      exchange: 'bingx',
      marketRegime: 'trend',
      capitalRegime: 'CAUTION',
      balanceState: { capitalRegime: 'CAUTION' },
      forecastRegimeShiftRisk: 'LOW',
      setupType: 'byTrend',
    },
    sharedSnapshot: {
      candles,
      orderBook: {
        bestBid: 109.4,
        bestAsk: 109.47,
        bidVolume: 50000,
        askVolume: 76000,
      },
    },
    budgetState: 'normal',
    regimeRouterDecision: {
      layerName: 'marketRegimeRouter',
      marketRegime: 'trend',
      allowedSetups: ['byTrend'],
      selectedPredictType: 'byTrend',
      score: 0.77,
      confidence: 0.73,
    },
    primarySignal: {
      layerName: 'primarySignalLayer',
      direction: 'short',
      score: 0.78,
      confidence: 0.74,
      setupType: 'byTrend',
    },
    confirmationSignals: [{ name: 'trend_confirmation', approved: true }],
    htfBiasDecision: {
      layerName: 'higherTimeframeBiasEngine',
      htfBias: 'short',
      mode: 'full_mode',
    },
  }, config);

  assert.equal(result.enabled, true);
  assert.equal(result.layers.breakdownDetectionLayer.layerName, 'breakdownDetectionLayer');
  assert.equal(result.layers.breakdownDetectionLayer.direction, 'short');
  assert.ok(Number.isFinite(result.layers.breakdownDetectionLayer.score));
  assert.ok(Array.isArray(result.layers.breakdownDetectionLayer.explanation.setupTypes));
  assert.ok(result.decisionContext.metadata.breakdownDetection);

  const event = toConfluenceEntryEvent({
    context: { cycleId: 'c-6', ticker: 'DOGE-USDT', exchange: 'bingx' },
    result,
  });
  assert.ok(event.payload.breakdownDetection);
  assert.ok(event.payload.telemetry.downstreamContext.confluenceEntry.breakdownDetection);
});
