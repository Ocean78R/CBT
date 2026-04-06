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

test('confluenceEntryEngine: derivativesContextLayer усиливает/ослабляет вход без права исполнения сделки', () => {
  const config = normalizeConfluenceEntryConfig({
    enabled: true,
    mode: 'confluence',
    blockWeights: {
      entryPermission: 0.22,
      marketContext: 0.2,
      primarySignal: 0.24,
      confirmation: 0.12,
      marketLevel: 0.08,
      volumeContext: 0.04,
      bounceDetection: 0.03,
      breakdownDetection: 0.03,
      derivativesContext: 0.04,
    },
    thresholds: { fullEntryScore: 0.56, weakEntryScore: 0.42, minConfidence: 0.25 },
    derivativesContext: {
      enabled: true,
      preferSharedSnapshot: true,
      refreshPolicy: { minCyclesBetweenRefresh: 2, allowCachedReuse: true },
    },
  });

  const result = evaluateConfluenceEntry({
    context: {
      cycleId: 'c-deriv-1',
      cycleIndex: 10,
      ticker: 'BTC-USDT',
      exchange: 'bingx',
      marketRegime: 'trend',
      capitalRegime: 'DEFENSIVE',
      balanceState: { capitalRegime: 'DEFENSIVE' },
      setupType: 'byBarsPercents',
    },
    featureStoreContext: {},
    sharedSnapshot: {
      candles: Array.from({ length: 40 }, (_, i) => ({
        timestamp: i + 1, open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 1000 + i * 10,
      })),
      derivatives: {
        openInterest: { current: 112000000, previous: 100000000, zscore: 2.8 },
        funding: { rate: 0.0011 },
        liquidation: { longUsd: 1800000, shortUsd: 450000 },
      },
    },
    regimeRouterDecision: {
      layerName: 'marketRegimeRouter',
      marketRegime: 'trend',
      allowedSetups: ['byBarsPercents'],
      selectedPredictType: 'byBarsPercents',
      score: 0.8,
      confidence: 0.76,
    },
    primarySignal: {
      layerName: 'primarySignalLayer',
      direction: 'long',
      score: 0.82,
      confidence: 0.74,
      setupType: 'byBarsPercents',
    },
    confirmationSignals: [{ name: 'trend_confirmation', approved: true }],
  }, config);

  assert.equal(result.layers.derivativesContextLayer.layerName, 'derivativesContextLayer');
  assert.ok(Number.isFinite(result.layers.derivativesContextLayer.softPenalty));
  assert.ok((result.layers.derivativesContextLayer.reasonCodes || []).length > 0);
  assert.ok(result.decisionContext.metadata.derivativesContext);
  assert.ok(result.decisionContext.metadata.layerScores.derivativesContextLayer);

  const event = toConfluenceEntryEvent({
    context: { cycleId: 'c-deriv-1', ticker: 'BTC-USDT', exchange: 'bingx' },
    result,
  });
  assert.ok(event.payload.derivativesContext);
  assert.ok(event.payload.telemetry.downstreamContext.confluenceEntry.derivativesContext);
});

test('confluenceEntryEngine: derivativesContextLayer возвращает degraded mode при отсутствии данных', () => {
  const config = normalizeConfluenceEntryConfig({
    enabled: true,
    mode: 'confluence',
    blockWeights: {
      entryPermission: 0.25,
      marketContext: 0.2,
      primarySignal: 0.25,
      confirmation: 0.15,
      derivativesContext: 0.15,
    },
    derivativesContext: {
      enabled: true,
      skipWhenBudgetExceeded: true,
      refreshPolicy: { allowCachedReuse: false },
    },
  });

  const result = evaluateConfluenceEntry({
    context: {
      cycleId: 'c-deriv-2',
      cycleIndex: 3,
      ticker: 'ETH-USDT',
      exchange: 'bingx',
      marketRegime: 'trend',
      capitalRegime: 'NORMAL',
      balanceState: { capitalRegime: 'NORMAL' },
      setupType: 'byBarsPercents',
    },
    budgetState: 'exceeded',
    sharedSnapshot: { candles: [] },
    regimeRouterDecision: {
      layerName: 'marketRegimeRouter',
      marketRegime: 'trend',
      allowedSetups: ['byBarsPercents'],
      selectedPredictType: 'byBarsPercents',
      score: 0.72,
      confidence: 0.7,
    },
    primarySignal: {
      layerName: 'primarySignalLayer',
      direction: 'long',
      score: 0.7,
      confidence: 0.68,
      setupType: 'byBarsPercents',
    },
  }, config);

  assert.equal(result.layers.derivativesContextLayer.dataQualityState, 'degraded');
  assert.ok((result.layers.derivativesContextLayer.reasonCodes || []).includes('derivatives_data_missing'));
  assert.ok(['FULL_ENTRY', 'WEAK_ENTRY', 'NO_ENTRY'].includes(result.decision.finalDecision));
});

test('confluenceEntryEngine: confirmationEngine разделяет technical/microstructure и не принимает final decision самостоятельно', () => {
  const config = normalizeConfluenceEntryConfig({
    enabled: true,
    mode: 'confluence',
    blockWeights: {
      entryPermission: 0.22,
      marketContext: 0.18,
      primarySignal: 0.3,
      confirmation: 0.2,
      marketLevel: 0.1,
    },
    thresholds: { fullEntryScore: 0.62, weakEntryScore: 0.46, minConfidence: 0.3 },
    confirmationEngine: {
      enabled: true,
      costSplit: {
        minCheapScoreForMicro: 0.2,
        skipMicroWhenBudgetExceeded: true,
      },
      capitalRegimePenalties: {
        DEFENSIVE: 0.05,
      },
    },
  });

  const candles = Array.from({ length: 48 }, (_, i) => ({
    timestamp: i + 1,
    open: 100 + i * 0.2,
    high: 101 + i * 0.2,
    low: 99 + i * 0.18,
    close: 100 + i * 0.23,
    volume: 900 + i * 20,
  }));

  const result = evaluateConfluenceEntry({
    context: {
      cycleId: 'c-confirm-1',
      cycleIndex: 11,
      ticker: 'BTC-USDT',
      exchange: 'bingx',
      marketRegime: 'trend',
      capitalRegime: 'DEFENSIVE',
      balanceState: { capitalRegime: 'DEFENSIVE' },
      setupType: 'byBarsPercents',
    },
    budgetState: 'normal',
    sharedSnapshot: {
      candles,
      orderBook: {
        bids: [[120, 20], [119.9, 18], [119.8, 16], [119.7, 14]],
        asks: [[120.1, 14], [120.2, 12], [120.3, 10], [120.4, 9]],
      },
    },
    regimeRouterDecision: {
      layerName: 'marketRegimeRouter',
      marketRegime: 'trend',
      allowedSetups: ['byBarsPercents'],
      selectedPredictType: 'byBarsPercents',
      score: 0.78,
      confidence: 0.71,
    },
    primarySignal: {
      layerName: 'primarySignalLayer',
      direction: 'long',
      score: 0.84,
      confidence: 0.74,
      setupType: 'byBarsPercents',
    },
  }, config);

  assert.equal(result.layers.confirmationLayer.layerName, 'confirmationLayer');
  assert.equal(result.layers.confirmationLayer.explanation.confirmationEngineEnabled, true);
  assert.ok(result.layers.confirmationLayer.explanation.technical.signals.length > 0);
  assert.ok(result.layers.confirmationLayer.explanation.microstructure.signals.length > 0);
  assert.ok(Number.isFinite(result.layers.confirmationLayer.softPenalty));
  assert.ok(result.decision.finalDecision !== 'LEGACY_FALLBACK');
});

test('confluenceEntryEngine: confirmationEngine возвращает валидный degraded/missing при отсутствии стакана', () => {
  const config = normalizeConfluenceEntryConfig({
    enabled: true,
    mode: 'confluence',
    confirmationEngine: {
      enabled: true,
      costSplit: {
        minCheapScoreForMicro: 0.2,
      },
    },
  });

  const candles = Array.from({ length: 40 }, (_, i) => ({
    timestamp: i + 1,
    open: 200 - i * 0.2,
    high: 201 - i * 0.18,
    low: 198 - i * 0.21,
    close: 199 - i * 0.19,
    volume: 1200 + (i % 5) * 15,
  }));

  const result = evaluateConfluenceEntry({
    context: {
      cycleId: 'c-confirm-2',
      cycleIndex: 12,
      ticker: 'ETH-USDT',
      exchange: 'bingx',
      marketRegime: 'trend',
      capitalRegime: 'NORMAL',
      balanceState: { capitalRegime: 'NORMAL' },
      setupType: 'byBarsPercents',
    },
    sharedSnapshot: {
      candles,
    },
    regimeRouterDecision: {
      layerName: 'marketRegimeRouter',
      marketRegime: 'trend',
      allowedSetups: ['byBarsPercents'],
      selectedPredictType: 'byBarsPercents',
      score: 0.72,
      confidence: 0.69,
    },
    primarySignal: {
      layerName: 'primarySignalLayer',
      direction: 'short',
      score: 0.79,
      confidence: 0.72,
      setupType: 'byBarsPercents',
    },
  }, config);

  assert.equal(result.layers.confirmationLayer.explanation.confirmationEngineEnabled, true);
  assert.ok(['degraded', 'missing', 'full'].includes(result.layers.confirmationLayer.dataQualityState));
  assert.ok(result.layers.confirmationLayer.explanation.microstructure.missingData);

  const event = toConfluenceEntryEvent({
    context: { cycleId: 'c-confirm-2', ticker: 'ETH-USDT', exchange: 'bingx' },
    result,
  });
  assert.ok(event.payload.confirmationContext);
  assert.ok(event.payload.telemetry.downstreamContext.confluenceEntry.confirmationContext);
});

test('confluenceEntryEngine: eventRiskLayer поднимает hard veto при shock-сценарии', () => {
  const config = normalizeConfluenceEntryConfig({
    enabled: true,
    mode: 'confluence',
    blockWeights: {
      entryPermission: 0.22,
      marketContext: 0.2,
      primarySignal: 0.22,
      confirmation: 0.14,
      marketLevel: 0.06,
      eventRisk: 0.16,
    },
    eventRisk: {
      enabled: true,
      minCandles: 18,
      thresholds: {
        hardRiskScore: 0.6,
        softRiskScore: 0.35,
      },
    },
  });

  const candles = Array.from({ length: 30 }, (_, idx) => ({
    timestamp: idx + 1,
    open: 100 + idx * 0.2,
    high: 101 + idx * 0.3,
    low: 99 + idx * 0.2,
    close: 100 + idx * 0.22,
    volume: 1000,
  }));

  // Шоковая свеча в конце ряда.
  candles[candles.length - 1] = {
    timestamp: 30,
    open: 106,
    high: 120,
    low: 95,
    close: 118,
    volume: 2200,
  };

  const result = evaluateConfluenceEntry({
    context: {
      cycleId: 'c-event-1',
      ticker: 'BTC-USDT',
      exchange: 'bingx',
      marketRegime: 'trend',
      capitalRegime: 'DEFENSIVE',
      balanceState: { capitalRegime: 'DEFENSIVE' },
      forecastRegimeShiftRisk: 'LOW',
      setupType: 'byBarsPercents',
    },
    sharedSnapshot: {
      candles,
      bestBid: 100,
      bestAsk: 103,
      spreadHistoryPercent: [0.05, 0.04, 0.06, 0.05, 0.04],
    },
    regimeRouterDecision: {
      layerName: 'marketRegimeRouter',
      marketRegime: 'trend',
      allowedSetups: ['byBarsPercents'],
      selectedPredictType: 'byBarsPercents',
      score: 0.82,
      confidence: 0.72,
    },
    primarySignal: {
      layerName: 'primarySignalLayer',
      direction: 'long',
      score: 0.88,
      confidence: 0.76,
      setupType: 'byBarsPercents',
    },
    confirmationSignals: [{ name: 'trend_confirmation', approved: true }],
  }, config);

  assert.equal(result.layers.eventRiskLayer.layerName, 'eventRiskLayer');
  assert.equal(result.layers.eventRiskLayer.explanation.shockVetoTriggered, true);
  assert.equal(result.decision.entryAllowed, false);
  assert.equal(result.decision.veto.type, 'hard_veto');
  assert.equal(result.layers.eventRiskLayer.explanation.eventRiskState, 'critical_shock');
});

test('confluenceEntryEngine: eventRiskLayer в degraded режиме не отдаёт ложный safe-state', () => {
  const config = normalizeConfluenceEntryConfig({
    enabled: true,
    mode: 'confluence',
    eventRisk: {
      enabled: true,
      minCandles: 20,
      degradedMode: {
        softPenalty: 0.21,
        minRiskScore: 0.4,
        failSafeOnInsufficientData: false,
      },
    },
  });

  const result = evaluateConfluenceEntry({
    context: {
      cycleId: 'c-event-2',
      ticker: 'ETH-USDT',
      exchange: 'bingx',
      marketRegime: 'trend',
      capitalRegime: 'NORMAL',
      balanceState: { capitalRegime: 'NORMAL' },
      setupType: 'byBarsPercents',
    },
    sharedSnapshot: {
      candles: [
        { timestamp: 1, open: 100, high: 101, low: 99, close: 100.4 },
        { timestamp: 2, open: 100.4, high: 101, low: 100, close: 100.6 },
        { timestamp: 3, open: 100.6, high: 101.2, low: 100.2, close: 100.8 },
      ],
    },
    regimeRouterDecision: {
      layerName: 'marketRegimeRouter',
      marketRegime: 'trend',
      allowedSetups: ['byBarsPercents'],
      selectedPredictType: 'byBarsPercents',
      score: 0.74,
      confidence: 0.71,
    },
    primarySignal: {
      direction: 'long',
      score: 0.78,
      confidence: 0.72,
      setupType: 'byBarsPercents',
    },
  }, config);

  assert.equal(result.layers.eventRiskLayer.dataQualityState, 'degraded');
  assert.equal(result.layers.eventRiskLayer.explanation.eventRiskState, 'insufficient_data');
  assert.ok(result.layers.eventRiskLayer.softPenalty >= 0.2);
  assert.ok(result.layers.eventRiskLayer.explanation.shockRiskScore >= 0.35);
});

test('confluenceEntryEngine: competing hypotheses bounce vs breakdown получают arbitration penalty в final layer', () => {
  const config = normalizeConfluenceEntryConfig({
    enabled: true,
    mode: 'confluence',
    blockWeights: {
      entryPermission: 0.22,
      marketContext: 0.2,
      primarySignal: 0.2,
      confirmation: 0.12,
      bounceDetection: 0.13,
      breakdownDetection: 0.13,
    },
    thresholds: { fullEntryScore: 0.58, weakEntryScore: 0.46, minConfidence: 0.2 },
    bounceDetection: { enabled: true },
    breakdownDetection: { enabled: true },
  });

  const candles = Array.from({ length: 72 }, (_, idx) => {
    const drift = idx < 40 ? (130 - idx * 0.4) : (114 + (idx - 40) * 0.32);
    return {
      timestamp: idx + 1,
      open: drift + (idx % 2 ? 0.2 : -0.1),
      high: drift + 0.8,
      low: drift - 0.9,
      close: drift + (idx % 3 === 0 ? 0.35 : -0.18),
      volume: 1200 + idx * 18,
    };
  });

  const result = evaluateConfluenceEntry({
    context: {
      cycleId: 'c-conflict-1',
      cycleIndex: 21,
      ticker: 'ADA-USDT',
      exchange: 'bingx',
      marketRegime: 'trend',
      capitalRegime: 'NORMAL',
      balanceState: { capitalRegime: 'NORMAL' },
      setupType: 'byTrend',
    },
    sharedSnapshot: { candles },
    regimeRouterDecision: {
      layerName: 'marketRegimeRouter',
      marketRegime: 'trend',
      allowedSetups: ['byTrend'],
      selectedPredictType: 'byTrend',
      score: 0.78,
      confidence: 0.7,
    },
    primarySignal: {
      layerName: 'primarySignalLayer',
      direction: 'long',
      score: 0.82,
      confidence: 0.73,
      setupType: 'byTrend',
    },
    confirmationSignals: [{ name: 'trend_confirmation', approved: true }],
  }, config);

  assert.ok(Number.isFinite(result.layers.finalEntryDecisionLayer.explanation.competingHypothesesPenalty));
  assert.ok(result.layers.finalEntryDecisionLayer.explanation.competingHypothesesPenalty >= 0);
  const hasCompetingReason = (result.layers.finalEntryDecisionLayer.reasonCodes || [])
    .some((x) => String(x).startsWith('competing_hypotheses_detected'));
  const hasResolutionMetadata = !!(result.layers.finalEntryDecisionLayer.explanation || {}).hypothesisResolution;
  assert.ok(hasCompetingReason || hasResolutionMetadata);
});

test('confluenceEntryEngine: regimeRouter (24) и HTF-bias (25) не дублируют ownership', () => {
  const config = normalizeConfluenceEntryConfig({
    enabled: true,
    mode: 'confluence',
    thresholds: { fullEntryScore: 0.6, weakEntryScore: 0.45, minConfidence: 0.2 },
  });

  const result = evaluateConfluenceEntry({
    context: {
      cycleId: 'c-regime-htf-1',
      ticker: 'BTC-USDT',
      exchange: 'bingx',
      marketRegime: 'trend',
      capitalRegime: 'NORMAL',
      balanceState: { capitalRegime: 'NORMAL' },
      setupType: 'byTrend',
    },
    regimeRouterDecision: {
      layerName: 'marketRegimeRouter',
      marketRegime: 'trend',
      allowedSetups: ['byTrend'],
      selectedPredictType: 'byTrend',
      score: 0.8,
      confidence: 0.72,
    },
    primarySignal: {
      layerName: 'primarySignalLayer',
      direction: 'long',
      score: 0.81,
      confidence: 0.72,
      setupType: 'byTrend',
    },
    htfBiasDecision: {
      layerName: 'higherTimeframeBiasEngine',
      htfBias: 'short',
      mode: 'full_mode',
    },
    confirmationSignals: [{ name: 'volume_confirmation', approved: true }],
  }, config);

  assert.equal(result.layers.marketContextLayer.explanation.regimeRouterOwnership, 'strict');
  assert.ok((result.layers.confirmationLayer.reasonCodes || []).includes('htf_bias_counter_trend'));
  assert.equal(
    (result.layers.finalEntryDecisionLayer.explanation || {}).vetoOwner,
    'finalEntryDecisionLayer',
  );
});

test('confluenceEntryEngine: derivatives (31) и confirmations (32) одновременно работают без hard veto escalation', () => {
  const config = normalizeConfluenceEntryConfig({
    enabled: true,
    mode: 'confluence',
    confirmationEngine: { enabled: true },
    derivativesContext: { enabled: true },
    blockWeights: {
      entryPermission: 0.25,
      marketContext: 0.2,
      primarySignal: 0.23,
      confirmation: 0.16,
      derivativesContext: 0.16,
    },
  });

  const candles = Array.from({ length: 44 }, (_, i) => ({
    timestamp: i + 1,
    open: 100 + i * 0.15,
    high: 100.9 + i * 0.16,
    low: 99.3 + i * 0.13,
    close: 100.2 + i * 0.14,
    volume: 950 + i * 20,
  }));

  const result = evaluateConfluenceEntry({
    context: {
      cycleId: 'c-deriv-confirm-1',
      cycleIndex: 8,
      ticker: 'ETH-USDT',
      exchange: 'bingx',
      marketRegime: 'trend',
      capitalRegime: 'CAUTION',
      balanceState: { capitalRegime: 'CAUTION' },
      setupType: 'byBarsPercents',
    },
    sharedSnapshot: {
      candles,
      derivatives: {
        openInterest: { current: 120000000, previous: 108000000, zscore: 2.4 },
        funding: { rate: 0.0012 },
        liquidation: { longUsd: 1400000, shortUsd: 400000 },
      },
      orderBook: {
        bids: [[106, 40], [105.9, 30], [105.8, 28]],
        asks: [[106.1, 60], [106.2, 50], [106.3, 45]],
      },
    },
    regimeRouterDecision: {
      layerName: 'marketRegimeRouter',
      marketRegime: 'trend',
      allowedSetups: ['byBarsPercents'],
      selectedPredictType: 'byBarsPercents',
      score: 0.78,
      confidence: 0.71,
    },
    primarySignal: {
      layerName: 'primarySignalLayer',
      direction: 'long',
      score: 0.79,
      confidence: 0.72,
      setupType: 'byBarsPercents',
    },
  }, config);

  assert.ok(Number.isFinite(result.layers.derivativesContextLayer.softPenalty));
  assert.ok(Number.isFinite(result.layers.confirmationLayer.softPenalty));
  assert.equal((result.layers.finalEntryDecisionLayer.vetoCandidates || []).length, 0);
});

test('confluenceEntryEngine: session (33) и shock veto (34) не обходят final interpreter (35)', () => {
  const config = normalizeConfluenceEntryConfig({
    enabled: true,
    mode: 'confluence',
    sessionFilter: {
      enabled: true,
      timezone: 'UTC',
      noTradeOnRestrictedWindows: true,
      restrictedWindows: [{ startHour: 23, endHour: 24, reasonCode: 'restricted_test_window' }],
    },
    eventRisk: {
      enabled: true,
      minCandles: 24,
      thresholds: { softRiskScore: 0.3, hardRiskScore: 0.4 },
    },
  });

  const candles = Array.from({ length: 36 }, (_, idx) => ({
    timestamp: idx + 1,
    open: 100 + (idx % 2 ? 1.8 : -1.2),
    high: 104 + (idx % 3),
    low: 96 - (idx % 2),
    close: 100 + (idx % 2 ? 2.1 : -1.8),
    volume: 1500 + idx * 35,
  }));

  const result = evaluateConfluenceEntry({
    nowMs: Date.UTC(2026, 0, 1, 23, 30, 0),
    context: {
      cycleId: 'c-veto-chain-1',
      cycleIndex: 14,
      ticker: 'SOL-USDT',
      exchange: 'bingx',
      marketRegime: 'trend',
      capitalRegime: 'NORMAL',
      balanceState: { capitalRegime: 'NORMAL' },
      setupType: 'byBarsPercents',
    },
    sharedSnapshot: {
      candles,
      spreadPercent: 0.8,
      spreadHistoryPercent: [0.08, 0.09, 0.1, 0.11, 0.09],
      orderBook: { bestBid: 99.2, bestAsk: 100.6 },
    },
    regimeRouterDecision: {
      layerName: 'marketRegimeRouter',
      marketRegime: 'trend',
      allowedSetups: ['byBarsPercents'],
      selectedPredictType: 'byBarsPercents',
      score: 0.76,
      confidence: 0.72,
    },
    primarySignal: {
      layerName: 'primarySignalLayer',
      direction: 'long',
      score: 0.8,
      confidence: 0.73,
      setupType: 'byBarsPercents',
    },
  }, config);

  assert.equal(result.decision.entryAllowed, false);
  assert.equal(result.layers.finalEntryDecisionLayer.explanation.vetoOwner, 'finalEntryDecisionLayer');
  assert.ok((result.layers.sessionFilterLayer.vetoCandidates || []).length > 0 || (result.layers.eventRiskLayer.vetoCandidates || []).length > 0);
  assert.ok((result.decision.reasonCodes || []).some((x) => String(x).includes('hard_veto')));
});
