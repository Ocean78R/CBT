const test = require('node:test');
const assert = require('node:assert/strict');

process.env.CBT_SKIP_AUTOSTART = '1';

const bot = require('../../dist/index.js');
const { SingleStrategy, types } = bot.__testkit;
const { MockConnector } = require('./mockConnector');

const { evaluateConfluenceEntry, normalizeConfluenceEntryConfig } = require('../../dist/runtime/engines/confluenceEntryEngine');
const { evaluateFinalEntryDecision, normalizeFinalEntryDecisionConfig } = require('../../dist/runtime/engines/finalEntryDecisionEngine');
const { evaluateDynamicPositionSizing, normalizeDynamicPositionSizingConfig } = require('../../dist/runtime/sizing/dynamicPositionSizing');
const { evaluatePositionLifecycle, normalizeLifecycleRules } = require('../../dist/runtime/lifecycle/positionLifecycleManager');
const { evaluateForcedLossExit, toForcedLossExitEvent } = require('../../dist/runtime/risk/forcedLossExit');
const { createPaperTradingExecutor } = require('../../dist/runtime/execution/paperTrading');
const { createObservabilityLayer } = require('../../dist/runtime/observability/reportingLayer');

function makeConfig() {
  return {
    minBalance: 100,
    singleSetts: {
      used: true,
      marginSize: 10,
      futuresLeverage: 25,
      closePositionPnl: 1,
      tickers: {
        definedAssets: ['BTC', 'ETH', 'SOL'],
        randomCount: 0,
        excludedAssets: [],
        dynamicAssetSelection: { enabled: true, shortlistSize: 2 },
      },
      predict: {
        predictType: types.PredictType.byBarsPercents,
        dangerPercentsWeek1: 99,
        dangerPercentsDay1: 99,
        dangerPercentsHour4: 99,
      },
      averageTiers: [
        { maxMarginRate: 1.5, allowLossesRate: 0.5, minPurePercents: 1, marginSizeToAvg: 1 },
      ],
    },
    logger: { runtime: { enabled: false } },
  };
}

function toComponent(layer, step) {
  const normalizedScore = Number(layer.score || 0);
  const normalizedConfidence = Number(layer.confidence || 0);
  return {
    score: Math.max(0.72, normalizedScore),
    confidence: Math.max(0.65, normalizedConfidence),
    dataQualityState: layer.dataQualityState || 'full',
    sourceMeta: {
      block: layer.layerName || 'unknown_layer',
      step,
      source: 'e2e_paper_shadow_test',
      recalculated: false,
    },
    reasonCodes: Array.isArray(layer.reasonCodes) ? layer.reasonCodes : [],
  };
}

test('paper/shadow e2e: universe->shortlist->steps24-36->lifecycle/protective->close без реальных ордеров', async () => {
  const connector = new MockConnector(types, { positionsByTicker: { 'BTC-USDT': [] } });
  const strategy = new SingleStrategy(connector, makeConfig(), true);
  strategy.connect();

  // 1) allowed universe + shortlist (новые входы)
  const runtimeContext = {
    allowedUniverseTickers: ['BTC-USDT', 'ETH-USDT', 'SOL-USDT'],
    balanceState: 'NORMAL',
    unloadModeEnabled: false,
    safeEntryAssets: [],
    entryLimits: {},
    dynamicAssetSelection: { explanation: { shortlist: ['BTC-USDT', 'SOL-USDT'] } },
  };

  const allowBtc = strategy.evaluateNewEntryAllowance('BTC-USDT', runtimeContext);
  const denyEth = strategy.evaluateNewEntryAllowance('ETH-USDT', runtimeContext);

  assert.equal(allowBtc.allowed, true);
  assert.equal(denyEth.allowed, false);
  assert.deepEqual(runtimeContext.newEntryEligibleUniverse, ['BTC-USDT', 'SOL-USDT']);

  // 2) steps 24-35 via confluence + finalEntryDecision
  const confluence = evaluateConfluenceEntry({
    context: {
      cycleId: 'e2e-paper-1',
      ticker: 'BTC-USDT',
      exchange: 'bingx',
      mode: 'paper',
      marketRegime: 'trend',
      capitalRegime: 'NORMAL',
      balanceState: { capitalRegime: 'NORMAL' },
      setupType: 'byBarsPercents',
      timestamp: '2026-04-06T00:00:00.000Z',
    },
    shortlistCandidate: true,
    sharedSnapshot: {
      candles: [
        { timestamp: 1, open: 100, high: 102, low: 99, close: 101, volume: 1100 },
        { timestamp: 2, open: 101, high: 104, low: 100, close: 103, volume: 1200 },
        { timestamp: 3, open: 103, high: 106, low: 102, close: 105, volume: 1300 },
        { timestamp: 4, open: 105, high: 107, low: 103, close: 104, volume: 1250 },
        { timestamp: 5, open: 104, high: 108, low: 103, close: 107, volume: 1400 },
        { timestamp: 6, open: 107, high: 110, low: 106, close: 109, volume: 1450 },
        { timestamp: 7, open: 109, high: 111, low: 107, close: 110, volume: 1500 },
        { timestamp: 8, open: 110, high: 112, low: 109, close: 111, volume: 1550 },
        { timestamp: 9, open: 111, high: 114, low: 110, close: 113, volume: 1600 },
        { timestamp: 10, open: 113, high: 115, low: 112, close: 114, volume: 1620 },
      ],
      derivatives: { fundingRate: 0.0002, openInterestChangePercent: 0.7, longShortRatio: 1.1 },
    },
    regimeRouterDecision: {
      layerName: 'marketRegimeRouter',
      marketRegime: 'trend',
      allowedSetups: ['byBarsPercents', 'breakout'],
      selectedPredictType: 'byBarsPercents',
      score: 0.81,
      confidence: 0.75,
    },
    htfBiasDecision: {
      layerName: 'higherTimeframeBiasEngine',
      htfBias: 'long',
      score: 0.72,
      confidence: 0.69,
    },
    primarySignal: {
      layerName: 'primarySignalLayer',
      direction: 'long',
      setupType: 'byBarsPercents',
      score: 0.8,
      confidence: 0.74,
    },
    confirmationSignals: [
      { name: 'volume_confirmation', approved: true },
      { name: 'volatility_confirmation', approved: true },
    ],
    orderBookSnapshot: {
      bids: [[113.9, 10], [113.8, 8]],
      asks: [[114.1, 9], [114.2, 7]],
    },
  }, normalizeConfluenceEntryConfig({
    enabled: true,
    mode: 'confluence',
    marketLevel: { enabled: true, lookbackBars: 20, rangeLookbackBars: 12, swingWindow: 1, minSwingPoints: 2 },
    volumeContext: { enabled: true },
    bounceDetection: { enabled: true },
    breakdownDetection: { enabled: true },
    derivativesContext: { enabled: true },
    sessionFilter: { enabled: true, timezone: 'UTC' },
    confirmationEngine: { enabled: true },
    eventRisk: { enabled: true },
  }));

  assert.equal(confluence.enabled, true);
  assert.ok(confluence.layers.marketContextLayer);
  assert.ok(confluence.layers.primarySignalLayer);
  assert.ok(confluence.layers.marketLevelLayer); // шаг 27
  assert.ok(confluence.layers.volumeContextLayer); // шаг 28
  assert.ok(confluence.layers.bounceDetectionLayer); // шаг 29
  assert.ok(confluence.layers.breakdownDetectionLayer); // шаг 30
  assert.ok(confluence.layers.derivativesContextLayer); // шаг 31
  assert.ok(confluence.layers.confirmationLayer); // шаг 32
  assert.ok(confluence.layers.sessionFilterLayer); // шаг 33
  assert.ok(confluence.layers.eventRiskLayer); // шаг 34

  const finalDecision = evaluateFinalEntryDecision({
    context: { cycleId: 'e2e-paper-1', ticker: 'BTC-USDT', exchange: 'bingx', mode: 'paper' },
    noTradeRegime: false,
    capitalRegime: 'NORMAL',
    balanceState: { capitalRegime: 'NORMAL', drawdownProtection: false },
    componentScores: {
      entryPermission: toComponent(confluence.layers.entryPermissionLayer, 24),
      marketContext: toComponent(confluence.layers.marketContextLayer, 24),
      primarySignal: toComponent(confluence.layers.primarySignalLayer, 25),
      confirmation: toComponent(confluence.layers.confirmationLayer, 32),
      marketLevel: toComponent(confluence.layers.marketLevelLayer, 27),
      volumeContext: toComponent(confluence.layers.volumeContextLayer, 28),
      bounceDetection: toComponent(confluence.layers.bounceDetectionLayer, 29),
      breakdownDetection: toComponent(confluence.layers.breakdownDetectionLayer, 30),
      derivativesContext: toComponent(confluence.layers.derivativesContextLayer, 31),
      sessionFilter: toComponent(confluence.layers.sessionFilterLayer, 33),
      eventRisk: toComponent(confluence.layers.eventRiskLayer, 34),
    },
    vetoCandidates: [],
  }, normalizeFinalEntryDecisionConfig({
    enabled: true,
    allowWeakEntryMode: true,
    entryScoreThreshold: 0.5,
    weakEntryThreshold: 0.4,
  }));

  assert.equal(['full_entry', 'weak_entry', 'no_entry'].includes(finalDecision.decisionMode), true);
  assert.equal(finalDecision.explanation.ownership.isFinalVetoOwnerForNewEntries, true);

  // 3) шаг 36: sizing после final decision
  const sizing = evaluateDynamicPositionSizing({
    context: { cycleId: 'e2e-paper-1', ticker: 'BTC-USDT', mode: 'paper' },
    approvedEntryResult: {
      decisionMode: finalDecision.decisionMode,
      entryScore: finalDecision.entryScore,
      confidence: finalDecision.confidence,
      vetoSummary: finalDecision.vetoSummary,
      dataQualityState: finalDecision.dataQualityState,
    },
    decisionMode: finalDecision.decisionMode,
    capitalRegime: 'NORMAL',
    balanceState: { capitalRegime: 'NORMAL', drawdownProtection: false },
    runtimeGuards: { allowNewEntries: true, hardRiskBlocked: false, unloadMode: false },
    tickerRisk: { riskScore: 0.37 },
  }, normalizeDynamicPositionSizingConfig({ enableDynamicPositionSizing: true }));

  if (finalDecision.decisionMode === 'no_entry') {
    assert.equal(sizing.mode, 'no_entry');
    assert.equal(sizing.sizeMultiplier, 0);
  } else {
    assert.ok(sizing.sizeMultiplier > 0);
  }
  assert.equal(sizing.explanation.runtimeMode, 'paper');
  assert.equal(sizing.explanation.ownership.isFinalDecisionOwner, false);

  // 4) paper execution open -> close (без реальных ордеров)
  const events = [];
  const paperStrategy = {
    config: { paperTrading: { enabled: true, mode: 'shadow', initialBalance: 1000 } },
    currentRuntimeContext: {
      cycleId: 'e2e-paper-1',
      exchange: 'bingx',
      marketRegime: 'trend',
      capitalRegime: 'NORMAL',
      setupType: 'byBarsPercents',
      score: finalDecision.entryScore,
      confidence: finalDecision.confidence,
      sizingDecision: `multiplier:${sizing.sizeMultiplier.toFixed(2)}`,
    },
    emitStructuredEvent: (...args) => events.push(args),
    log: () => {},
  };

  const executor = createPaperTradingExecutor(paperStrategy, paperStrategy.config);
  const openResult = await executor.openNewPosition('BTC-USDT', async () => ({ real: true }));
  const closeResult = await executor.closePosition('BTC-USDT', { side: 'LONG' }, 15, async () => ({ real: true }));
  const report = executor.getReport();

  assert.equal(openResult.simulated, true);
  assert.equal(closeResult.simulated, true);
  assert.equal(report.openVirtualPositions, 0);
  assert.equal(report.metrics.virtualEntries, 1);
  assert.equal(report.metrics.virtualCloses, 1);

  // 5) restricted lifecycle + protective logic + dedup close guard
  const lifecycle = evaluatePositionLifecycle({
    context: { cycleId: 'e2e-paper-1', ticker: 'BTC-USDT', positionCapabilityState: 'LEVERAGE_MISMATCH_POSITION' },
    positionState: {
      symbolUnified: 'BTC-USDT',
      side: 'long',
      entryPrice: 100,
      markPrice: 103,
      contracts: 1,
      percentage: 3,
      unrealizedPnl: 1.2,
      positionCapabilityState: 'LEVERAGE_MISMATCH_POSITION',
    },
    lifecycleState: { stage: 'initial_position_state', partialCloseDone: false, breakevenMoved: false, trailingActive: false },
    profitability: { unrealizedPnl: 1.2, unrealizedPnlPercent: 3 },
    ownershipMetadata: { ownerPath: 'execution_lifecycle_manager', token: 'protective-token-1' },
  }, normalizeLifecycleRules({
    enabled: true,
    restrictedLifecycleRules: { allowPartialClose: true, allowBreakeven: false, allowTrailing: false },
  }));

  assert.equal(lifecycle.restrictedLifecycleMode, true);
  assert.ok(lifecycle.allowedActions.includes('protective_close'));
  assert.ok(lifecycle.blockedActions.includes('averaging'));

  const forced = evaluateForcedLossExit({
    context: {
      cycleId: 'e2e-paper-1',
      ticker: 'BTC-USDT',
      mode: 'paper',
      marketRegime: 'trend',
      capitalRegime: 'NORMAL',
      positionCapabilityState: 'LEVERAGE_MISMATCH_POSITION',
      protectiveCloseSource: 'lifecycle_close',
      protectiveActionState: {
        owner: 'execution_lifecycle_manager',
        token: 'protective-token-1',
        closeInitiated: true,
        status: 'initiated',
      },
    },
    position: {
      side: 'LONG',
      minutesSinceEntry: 15,
      entryDeviationPercent: -1.4,
      timeUnderEntryWithoutRecoveryMinutes: 10,
      adverseTrendBars: 3,
      adverseTrendSlope: 0.09,
      adverseMarketConfirmed: true,
      holdMinutesInLoss: 15,
      pnlPercent: -1.4,
      averagesCount: 0,
    },
  }, {
    enabled: true,
    actionMode: 'force_close',
    enablePostEntryObservation: true,
    postEntryGraceMinutes: 3,
    postEntryObservationMinutes: 25,
    maxTimeUnderEntryWithoutRecovery: 8,
    earlyInvalidationLossPercent: 1.1,
    requirePersistentAdverseTrend: true,
    adverseTrendConfirmationBars: 2,
    adverseTrendSlopeThreshold: 0.05,
    actionOnEarlyInvalidation: 'force_close',
  });

  assert.equal(forced.duplicateClosePrevented, true);
  assert.equal(forced.protectiveActionOwner, 'execution_lifecycle_manager');

  // 6) decision trace полностью восстанавливается
  const observability = createObservabilityLayer({
    enabled: true,
    sampling: { decisionEventsRate: 1, diagnosticEventsRate: 1, alwaysKeepCritical: true },
    storage: { enabled: false },
  });

  observability.ingestEvent({
    eventType: 'portfolio_risk_contour',
    cycleId: 'e2e-paper-1',
    ticker: 'BTC-USDT',
    module: 'portfolioRiskContour',
    layer: 'risk.portfolioContour',
    mode: 'paper',
    finalDecision: finalDecision.decisionMode,
    payload: {
      telemetry: {
        forecast: { reasonCodes: ['forecast_ok'], outputHints: { earlyBreakevenHint: true } },
        downstreamContext: {
          universeFilter: {
            allowedUniverse: runtimeContext.allowedUniverseTickers,
            shortlist: runtimeContext.dynamicAssetSelection.explanation.shortlist,
          },
          marketRegimeRouter: confluence.layers.marketContextLayer.explanation,
          confluenceEntry: { finalDecision: confluence.decision.finalDecision, reasonCodes: confluence.decision.reasonCodes },
          dynamicPositionSizing: { mode: sizing.mode, sizeMultiplier: sizing.sizeMultiplier },
        },
      },
    },
  });

  observability.ingestEvent(toForcedLossExitEvent({
    context: {
      cycleId: 'e2e-paper-1',
      ticker: 'BTC-USDT',
      exchange: 'bingx',
      mode: 'paper',
      capitalRegime: 'NORMAL',
      marketRegime: 'trend',
      setupType: 'byBarsPercents',
      positionCapabilityState: 'LEVERAGE_MISMATCH_POSITION',
    },
    decision: forced,
  }));

  observability.ingestEvent({
    eventType: 'execution_reconciliation',
    cycleId: 'e2e-paper-1',
    ticker: 'BTC-USDT',
    mode: 'paper',
    module: 'execution_contour',
    layer: 'reconciliation',
    finalDecision: 'accepted',
    executionAction: 'cleanup_reconciliation',
    protectiveActionToken: 'protective-token-1',
    positionCapabilityState: 'LEVERAGE_MISMATCH_POSITION',
    payload: {
      protectiveActionToken: 'protective-token-1',
      positionCapabilityState: 'LEVERAGE_MISMATCH_POSITION',
    },
  });

  const trails = observability.getAuditTrail({ cycleId: 'e2e-paper-1', ticker: 'BTC-USDT' });
  assert.equal(trails.length, 1);
  assert.deepEqual(trails[0].stagePath.universe.shortlist, ['BTC-USDT', 'SOL-USDT']);
  assert.equal(trails[0].stagePath.sizing.mode, sizing.mode);
  assert.equal(trails[0].stagePath.lifecycle.duplicateClosePrevented, true);
  assert.equal(trails[0].stagePath.reconciliation.protectiveActionToken, 'protective-token-1');

  // no repeated open/close in the tested path
  const orderPhases = events.map((x) => x[1]);
  assert.equal(orderPhases.filter((x) => x === 'virtual_entry_opened').length, 1);
  assert.equal(orderPhases.filter((x) => x === 'virtual_position_closed').length, 1);
});
