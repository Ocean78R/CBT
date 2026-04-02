const test = require('node:test');
const assert = require('node:assert/strict');

process.env.CBT_SKIP_AUTOSTART = '1';
const bot = require('../../dist/index.js');
const { SingleStrategy, PricePredictor, types } = bot.__testkit;
const { MockConnector } = require('./mockConnector');

function makeConfig(overrides = {}) {
  const base = {
    minBalance: 100,
    singleSetts: {
      used: true,
      marginSize: 10,
      futuresLeverage: 25,
      closePositionPnl: 1,
      tickers: { definedAssets: ['BTC'], randomCount: 0, excludedAssets: [] },
      averageTiers: [
        { maxMarginRate: 1.5, allowLossesRate: 0.5, minPurePercents: 1, marginSizeToAvg: 1 },
      ],
      predict: {
        predictType: types.PredictType.long,
        dangerPercentsWeek1: 90,
        dangerPercentsDay1: 90,
        dangerPercentsHour4: 90,
        speedFilter: { enabled: true, lookbackBars: 4, maxMovePercent: 1.2, maxRangePercent: 2.2, maxMoveToAverageRatio: 1.8 },
      },
      averagingProtection: { enabled: true },
      qualityControl: { enabled: true, minClosedTrades: 20, disableOnNegativeExpectation: true, logTopTickers: 10 },
    },
    logger: { runtime: { enabled: false } },
  };

  return {
    ...base,
    ...overrides,
    singleSetts: {
      ...base.singleSetts,
      ...(overrides.singleSetts || {}),
      tickers: {
        ...base.singleSetts.tickers,
        ...((overrides.singleSetts || {}).tickers || {}),
      },
      predict: {
        ...base.singleSetts.predict,
        ...((overrides.singleSetts || {}).predict || {}),
        speedFilter: {
          ...base.singleSetts.predict.speedFilter,
          ...(((overrides.singleSetts || {}).predict || {}).speedFilter || {})
        },
      },
      averagingProtection: {
        ...base.singleSetts.averagingProtection,
        ...((overrides.singleSetts || {}).averagingProtection || {}),
      },
      qualityControl: {
        ...base.singleSetts.qualityControl,
        ...((overrides.singleSetts || {}).qualityControl || {}),
      },
    },
  };
}

function makeStrategy(connector, config = makeConfig()) {
  const strategy = new SingleStrategy(connector, config, true);
  strategy.connect();
  return strategy;
}

test('новый тикер обрабатывается без падения', async () => {
  const connector = new MockConnector(types, { missingTickers: ['NEW-USDT'] });
  const strategy = makeStrategy(connector);
  await assert.doesNotReject(() => strategy.processSingleTicker('NEW-USDT'));
  assert.equal(connector.orders.length, 0);
});

test('ветка позиций: нет позиции -> вход, одна позиция -> обработка, несколько позиций -> пропуск действий', async () => {
  const profitableLong = { symbolUnified: 'BTC-USDT', side: types.PositionSide.long, entryPrice: 100, initialMargin: 10, leverage: 25, unrealizedPnl: 2, percentage: 5, contracts: 1 };
  const connector = new MockConnector(types, {
    positionsByTicker: {
      'NOPOS-USDT': [],
      'ONEPOS-USDT': [profitableLong],
      'MULTI-USDT': [profitableLong, { ...profitableLong, side: types.PositionSide.short, entryPrice: 101 }],
    },
  });
  const strategy = makeStrategy(connector);

  await strategy.processSingleTicker('NOPOS-USDT');
  await strategy.processSingleTicker('ONEPOS-USDT');
  await strategy.processSingleTicker('MULTI-USDT');

  assert.equal(connector.orders.filter((x) => x.type === 'open').length, 1);
  assert.equal(connector.orders.filter((x) => x.type === 'close').length, 1);
});

test('запрет входа при недостаточном балансе', async () => {
  const connector = new MockConnector(types, { availableMargin: 50 });
  const strategy = makeStrategy(connector, makeConfig({ minBalance: 100 }));

  await strategy.processSingleTicker('BTC-USDT');
  assert.equal(connector.orders.length, 0);
});

test('predict logic корректно отрабатывает byBarsPercents', async () => {
  const bullishBars = [
    { openPrice: 100, closePrice: 101, lowPrice: 99, highPrice: 102, deltaOpenClose: 1, percentsLowHigh: 2 },
    { openPrice: 101, closePrice: 102, lowPrice: 100, highPrice: 103, deltaOpenClose: 1, percentsLowHigh: 2 },
    { openPrice: 102, closePrice: 103, lowPrice: 101, highPrice: 104, deltaOpenClose: 1, percentsLowHigh: 2 },
  ];
  const connector = new MockConnector(types, {
    klineByInterval: {
      [types.KLineInterval.Week1]: bullishBars,
      [types.KLineInterval.Day1]: bullishBars,
      [types.KLineInterval.Hour4]: bullishBars,
    },
  });
  const predictor = new PricePredictor(connector);

  const [side, warning] = await predictor.predict('BTC-USDT', {
    predictType: types.PredictType.byBarsPercents,
    dangerPercentsWeek1: 99,
    dangerPercentsDay1: 99,
    dangerPercentsHour4: 99,
  });

  assert.equal(side, types.PositionSide.long);
  assert.equal(warning, '');
});

test('speedFilter как конфиг-хук не ломает вход (fallback текущей логики)', async () => {
  const connector = new MockConnector(types);
  const strategy = makeStrategy(connector, makeConfig({
    singleSetts: {
      predict: {
        predictType: types.PredictType.long,
        dangerPercentsWeek1: 99,
        dangerPercentsDay1: 99,
        dangerPercentsHour4: 99,
        speedFilter: { enabled: true, lookbackBars: 1, maxMovePercent: 0.0001, maxRangePercent: 0.0001, maxMoveToAverageRatio: 0.0001 },
      },
    },
  }));

  await strategy.processSingleTicker('BTC-USDT');
  assert.equal(connector.orders.filter((x) => x.type === 'open').length, 1);
});

test('averagingProtection как конфиг-хук не блокирует валидное усреднение в текущем fallback', async () => {
  const losingPosition = {
    symbolUnified: 'BTC-USDT',
    side: types.PositionSide.long,
    entryPrice: 100,
    initialMargin: 10,
    leverage: 25,
    unrealizedPnl: -3,
    percentage: -30,
    contracts: 1,
  };
  const connector = new MockConnector(types, { positionsByTicker: { 'BTC-USDT': [losingPosition] }, availableMargin: 1000 });
  const strategy = makeStrategy(connector);

  await strategy.processSingleTicker('BTC-USDT');
  assert.equal(connector.orders.filter((x) => x.type === 'open').length, 1);
});

test('qualityControl enabled: тикер не отключается в текущем fallback-режиме', async () => {
  const connector = new MockConnector(types);
  const strategy = makeStrategy(connector);

  await strategy.processSingleTicker('BTC-USDT');
  assert.equal(connector.orders.filter((x) => x.type === 'open').length, 1);
});

test('dynamicAssetSelection: новый вход разрешается только для тикеров из shortlist', async () => {
  const connector = new MockConnector(types, { positionsByTicker: { 'BTC-USDT': [], 'ETH-USDT': [] } });
  const strategy = makeStrategy(connector, makeConfig({
    singleSetts: {
      tickers: {
        dynamicAssetSelection: { enabled: true, shortlistSize: 1 },
      },
    },
  }));
  strategy.dynamicEntryShortlist = {
    layerName: 'dynamicAssetSelection',
    direction: 'long_short',
    score: 0.8,
    confidence: 0.7,
    softPenalty: 0,
    vetoCandidates: [],
    dataQualityState: 'full',
    reasonCodes: ['test_shortlist'],
    explanation: { shortlist: ['BTC-USDT'] },
  };

  await strategy.processSingleTicker('ETH-USDT');
  assert.equal(connector.orders.filter((x) => x.type === 'open').length, 0);
});

test('приоритет unloadMode.safeEntryAssets выше dynamic shortlist', () => {
  const connector = new MockConnector(types);
  const strategy = makeStrategy(connector, makeConfig());
  const decision = strategy.evaluateNewEntryAllowance('SOL-USDT', {
    balanceState: 'NORMAL',
    unloadModeEnabled: true,
    safeEntryAssets: ['BTC', 'ETH'],
    entryLimits: {},
    dynamicAssetSelection: {
      explanation: { shortlist: ['SOL-USDT'] },
    },
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.decision, 'no_trade_regime');
  assert.match(decision.reason, /safeEntryAssets/);
});

test('базовый flow открытия и закрытия позиции', async () => {
  const connector = new MockConnector(types, { positionsByTicker: { 'BTC-USDT': [] } });
  const strategy = makeStrategy(connector);

  await strategy.processSingleTicker('BTC-USDT');
  connector.positionsByTicker.set('BTC-USDT', [{
    symbolUnified: 'BTC-USDT',
    side: types.PositionSide.long,
    entryPrice: 100,
    initialMargin: 10,
    leverage: 25,
    unrealizedPnl: 2,
    percentage: 5,
    contracts: 1,
  }]);
  await strategy.processSingleTicker('BTC-USDT');

  assert.equal(connector.orders.filter((x) => x.type === 'open').length, 1);
  assert.equal(connector.orders.filter((x) => x.type === 'close').length, 1);
});


test('leverage mismatch переводит позицию в restricted state и блокирует усреднение', async () => {
  const losingPosition = {
    symbolUnified: 'BTC-USDT',
    side: types.PositionSide.long,
    entryPrice: 100,
    initialMargin: 10,
    leverage: 10,
    unrealizedPnl: -3,
    percentage: -30,
    contracts: 1,
  };
  const connector = new MockConnector(types, { positionsByTicker: { 'BTC-USDT': [losingPosition] }, availableMargin: 1000 });
  const strategy = makeStrategy(connector, makeConfig({
    logger: { runtime: { enabled: true } },
    executionContour: { leverageMismatchRestrictionEnabled: true },
  }));

  await strategy.processSingleTicker('BTC-USDT');

  assert.equal(connector.orders.filter((x) => x.type === 'open').length, 0);
});

test('leverage mismatch не блокирует безопасное закрытие по профиту', async () => {
  const profitablePosition = {
    symbolUnified: 'BTC-USDT',
    side: types.PositionSide.long,
    entryPrice: 100,
    initialMargin: 10,
    leverage: 10,
    unrealizedPnl: 2,
    percentage: 20,
    contracts: 1,
  };
  const connector = new MockConnector(types, { positionsByTicker: { 'BTC-USDT': [profitablePosition] }, availableMargin: 1000 });
  const strategy = makeStrategy(connector, makeConfig({ executionContour: { leverageMismatchRestrictionEnabled: true } }));

  await strategy.processSingleTicker('BTC-USDT');

  assert.equal(connector.orders.filter((x) => x.type === 'close').length, 1);
});

test('reconciliation на sync детектирует leverage mismatch и сохраняет restricted snapshot', async () => {
  const mismatchPosition = {
    symbolUnified: 'BTC-USDT',
    side: types.PositionSide.long,
    entryPrice: 100,
    initialMargin: 10,
    leverage: 11,
    unrealizedPnl: -1,
    percentage: -10,
    contracts: 1,
  };
  const connector = new MockConnector(types, { positionsByTicker: { 'BTC-USDT': [mismatchPosition] }, availableMargin: 1000 });
  const strategy = makeStrategy(connector, makeConfig({
    logger: { runtime: { enabled: true } },
    executionContour: { leverageMismatchRestrictionEnabled: true, reconcileOnLoopStart: true },
  }));

  await strategy.reconcileExecutionState('BTC-USDT');

  const positionId = strategy.getPositionId('BTC-USDT', mismatchPosition);
  const profile = strategy.positionCapabilityRegistry.get(positionId);
  const snapshot = strategy.reconciliationSnapshots.get('BTC-USDT');
  assert.equal(profile.positionCapabilityState, 'LEVERAGE_MISMATCH_POSITION');
  assert.equal(snapshot.hasRestrictedPositions, true);
  assert.equal(snapshot.restrictedPositionsCount, 1);
});

test('после рестарта mismatch-позиция восстанавливается как restricted, а не normal', async () => {
  const mismatchPosition = {
    symbolUnified: 'BTC-USDT',
    side: types.PositionSide.long,
    entryPrice: 100,
    initialMargin: 10,
    leverage: 15,
    unrealizedPnl: -2,
    percentage: -20,
    contracts: 1,
  };
  const connector = new MockConnector(types, { positionsByTicker: { 'BTC-USDT': [mismatchPosition] }, availableMargin: 1000 });
  const config = makeConfig({
    logger: { runtime: { enabled: true } },
    executionContour: { leverageMismatchRestrictionEnabled: true, reconcileOnLoopStart: true },
  });
  const strategyBeforeRestart = makeStrategy(connector, config);
  await strategyBeforeRestart.processSingleTicker('BTC-USDT');
  const strategyAfterRestart = makeStrategy(connector, config);

  await strategyAfterRestart.processSingleTicker('BTC-USDT');

  const positionId = strategyAfterRestart.getPositionId('BTC-USDT', mismatchPosition);
  const profile = strategyAfterRestart.positionCapabilityRegistry.get(positionId);
  assert.equal(profile.positionCapabilityState, 'LEVERAGE_MISMATCH_POSITION');
});

test('structured propagation positionCapabilityState идёт в PositionState / DecisionContext / lifecycle context', async () => {
  const mismatchPosition = {
    symbolUnified: 'BTC-USDT',
    side: types.PositionSide.long,
    entryPrice: 100,
    initialMargin: 10,
    leverage: 12,
    unrealizedPnl: -2,
    percentage: -20,
    contracts: 1,
  };
  const connector = new MockConnector(types, { positionsByTicker: { 'BTC-USDT': [mismatchPosition] }, availableMargin: 1000 });
  const strategy = makeStrategy(connector, makeConfig({
    logger: { runtime: { enabled: true } },
    executionContour: { leverageMismatchRestrictionEnabled: true, reconcileOnLoopStart: true },
  }));

  await strategy.processSingleTicker('BTC-USDT');

  const lifecycleEvent = (strategy.cycleJournal['BTC-USDT'] || []).find((event) => event.phase === 'position_state');
  const capabilityEvent = (strategy.cycleJournal['BTC-USDT'] || []).find((event) => event.phase === 'position_capability_state');
  const capitalRegimeEvent = (strategy.cycleJournal['BTC-USDT'] || []).find((event) => event.phase === 'capital_regime');
  assert.equal(mismatchPosition.positionCapabilityState, 'LEVERAGE_MISMATCH_POSITION');
  assert.equal(lifecycleEvent.payload.positionCapabilityState, 'LEVERAGE_MISMATCH_POSITION');
  assert.equal(capabilityEvent.payload.positionCapabilityState, 'LEVERAGE_MISMATCH_POSITION');
  assert.equal(capabilityEvent.payload.allowedActions.includes('reduce_only_close'), true);
  assert.equal(capabilityEvent.payload.blockedActions.includes('averaging'), true);
  assert.equal(capitalRegimeEvent.payload.decisionContext.metadata.executionRestrictions.hasRestrictedPositions, true);
});

test('guard: downstream consumer читает special position state только как input-context (read-only contract)', async () => {
  const mismatchPosition = {
    symbolUnified: 'BTC-USDT',
    side: types.PositionSide.long,
    entryPrice: 100,
    initialMargin: 10,
    leverage: 12,
    unrealizedPnl: -2,
    percentage: -20,
    contracts: 1,
  };
  const connector = new MockConnector(types, { positionsByTicker: { 'BTC-USDT': [mismatchPosition] }, availableMargin: 1000 });
  const strategy = makeStrategy(connector, makeConfig({
    logger: { runtime: { enabled: true } },
    executionContour: { leverageMismatchRestrictionEnabled: true, reconcileOnLoopStart: true },
  }));

  await strategy.processSingleTicker('BTC-USDT');

  const lifecycleEvent = (strategy.cycleJournal['BTC-USDT'] || []).find((event) => event.phase === 'position_state');
  const capabilityEvent = (strategy.cycleJournal['BTC-USDT'] || []).find((event) => event.phase === 'position_capability_state');
  const capitalRegimeEvent = (strategy.cycleJournal['BTC-USDT'] || []).find((event) => event.phase === 'capital_regime');
  const propagationProfile = capabilityEvent.payload;
  assert.equal(lifecycleEvent.payload.positionCapabilityState, 'LEVERAGE_MISMATCH_POSITION');
  assert.equal(capabilityEvent.payload.positionCapabilityState, 'LEVERAGE_MISMATCH_POSITION');
  assert.equal(capitalRegimeEvent.payload.decisionContext.metadata.executionRestrictions.hasRestrictedPositions, true);
  assert.equal(propagationProfile.leverageMismatchDetected, true);
  assert.equal(Array.isArray(propagationProfile.allowedActions), true);
  assert.equal(Array.isArray(propagationProfile.blockedActions), true);
  assert.equal(propagationProfile.blockedActions.includes('averaging'), true);

  // Имитация некорректного downstream-потребителя: пытается "перехватить ownership"
  // через правку только контекстных полей, без lifecycle/execution path.
  lifecycleEvent.payload.positionCapabilityState = 'NORMAL_POSITION';
  capabilityEvent.payload.positionCapabilityState = 'NORMAL_POSITION';
  capabilityEvent.payload.leverageMismatchDetected = false;
  capabilityEvent.payload.blockedActions = [];
  capabilityEvent.payload.allowedActions = ['averaging'];
  capitalRegimeEvent.payload.decisionContext.metadata.executionRestrictions.hasRestrictedPositions = false;

  // Даже прямое вмешательство в position объект не должно "снять restricted mode"
  // в следующем цикле: capability-state обязан быть пересчитан execution/lifecycle слоем.
  mismatchPosition.positionCapabilityState = 'NORMAL_POSITION';
  mismatchPosition.leverageMismatchDetected = false;
  mismatchPosition.allowedActions = ['averaging'];
  mismatchPosition.blockedActions = [];

  await strategy.processSingleTicker('BTC-USDT');

  const positionId = strategy.getPositionId('BTC-USDT', mismatchPosition);
  const canonicalProfile = strategy.positionCapabilityRegistry.get(positionId);
  const reconciliationSnapshot = strategy.reconciliationSnapshots.get('BTC-USDT');
  const actionDecision = strategy.canExecutePositionAction(canonicalProfile, 'averaging');

  assert.equal(canonicalProfile.positionCapabilityState, 'LEVERAGE_MISMATCH_POSITION');
  assert.equal(canonicalProfile.leverageMismatchDetected, true);
  assert.equal(canonicalProfile.blockedActions.includes('averaging'), true);
  assert.equal(actionDecision.allowed, false);
  assert.equal(reconciliationSnapshot.hasRestrictedPositions, true);
  assert.equal(connector.orders.filter((x) => x.type === 'open').length, 0);
  assert.equal(mismatchPosition.positionCapabilityState, 'LEVERAGE_MISMATCH_POSITION');
});
