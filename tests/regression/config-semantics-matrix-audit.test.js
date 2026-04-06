const test = require('node:test');
const assert = require('node:assert/strict');

process.env.CBT_SKIP_AUTOSTART = '1';
const bot = require('../../dist/index.js');
const { SingleStrategy, types } = bot.__testkit;
const { MockConnector } = require('./mockConnector');

const { buildRuntimeConfig } = require('../../dist/runtime/config/runtimeConfigValidator');
const {
  evaluateDynamicPositionSizing,
  normalizeDynamicPositionSizingConfig,
} = require('../../dist/runtime/sizing/dynamicPositionSizing');
const {
  evaluateFinalEntryDecision,
  normalizeFinalEntryDecisionConfig,
} = require('../../dist/runtime/engines/finalEntryDecisionEngine');
const {
  createMlInferenceLayer,
  normalizeMlInferenceConfig,
} = require('../../dist/runtime/ml/mlInferenceLayer');
const {
  createMlMetaController,
} = require('../../dist/runtime/ml/mlMetaController');
const {
  createExchangeRuntimeIntegration,
} = require('../../dist/runtime/exchange/exchangeRuntimeIntegration');
const {
  evaluatePositionLifecycle,
  normalizeLifecycleRules,
} = require('../../dist/runtime/lifecycle/positionLifecycleManager');

function createUtilsConfig() {
  return {
    getCoreConfig: (globalConfig) => globalConfig || {},
    getExchangeConfig: (exchangeConfig) => exchangeConfig || {},
    merge: (base, extra) => ({ ...(base || {}), ...(extra || {}) }),
  };
}

function makeStrategyConfig(overrides = {}) {
  const base = {
    minBalance: 100,
    singleSetts: {
      used: true,
      marginSize: 10,
      futuresLeverage: 25,
      closePositionPnl: 1,
      tickers: {
        definedAssets: ['BTC', 'ETH'],
        randomCount: 0,
        excludedAssets: [],
        dynamicAssetSelection: { enabled: false, shortlistSize: 2 },
      },
      averageTiers: [{ maxMarginRate: 1.5, allowLossesRate: 0.5, minPurePercents: 1, marginSizeToAvg: 1 }],
      predict: {
        predictType: types.PredictType.long,
        dangerPercentsWeek1: 90,
        dangerPercentsDay1: 90,
        dangerPercentsHour4: 90,
      },
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
        dynamicAssetSelection: {
          ...base.singleSetts.tickers.dynamicAssetSelection,
          ...((((overrides.singleSetts || {}).tickers || {}).dynamicAssetSelection) || {}),
        },
      },
    },
  };
}

function baseSizingInput() {
  return {
    approvedEntryResult: {
      decisionMode: 'full_entry',
      entryScore: 0.74,
      confidence: 0.69,
      vetoSummary: { blocked: false },
      dataQualityState: 'ok',
    },
    decisionMode: 'full_entry',
    balanceState: { capitalRegime: 'NORMAL', drawdownProtection: false },
    capitalRegime: 'NORMAL',
    tickerRisk: { riskScore: 0.4 },
    metadata: { sizingDataQualityState: 'ok' },
    runtimeGuards: { allowNewEntries: true, hardRiskBlocked: false, unloadMode: false },
    context: { cycleId: 'cfg-audit', ticker: 'BTC-USDT', mode: 'live' },
  };
}

test('matrix audit: ключевые on/off флаги нормализуются в согласованное runtime state', () => {
  const matrix = [
    {
      name: 'all enabled + shadow',
      input: {
        exchangeLayer: {
          enableExchangeCapabilityChecks: true,
          safeUnsupportedFeatureMode: 'fallback',
        },
        paperTrading: { enabled: true, mode: 'shadow' },
        dynamicPositionSizing: { enableDynamicPositionSizing: true },
        mlPhase1Integration: { enableMlFilter: true },
        mlMetaController: { enableMlMetaController: true },
        positionLifecycle: { enableAdvancedLifecycle: true },
      },
    },
    {
      name: 'hard fallback profile',
      input: {
        exchangeLayer: {
          enableExchangeCapabilityChecks: true,
          safeUnsupportedFeatureMode: 'block',
        },
        paperTrading: { enabled: false },
        dynamicPositionSizing: { enableDynamicPositionSizing: false },
        mlPhase1Integration: { enableMlFilter: false },
        mlMetaController: { enableMlMetaController: false },
        positionLifecycle: { enableAdvancedLifecycle: false },
      },
    },
    {
      name: 'conflicting exchange flags: checks off + block',
      input: {
        exchangeLayer: {
          enableExchangeCapabilityChecks: false,
          safeUnsupportedFeatureMode: 'block',
        },
      },
    },
  ];

  matrix.forEach((scenario) => {
    const cfg = buildRuntimeConfig(createUtilsConfig(), {
      loopsLength: 2,
      intervalSeconds: 1,
      ...scenario.input,
    }, {});

    assert.equal(typeof cfg.enableExchangeCapabilityChecks, 'boolean', scenario.name);
    assert.ok(['fallback', 'disable', 'block'].includes(cfg.safeUnsupportedFeatureMode), scenario.name);
    assert.ok(['paper', 'shadow'].includes(cfg.paperTrading.mode), scenario.name);
    assert.equal(typeof cfg.dynamicPositionSizing.enableDynamicPositionSizing, 'boolean', scenario.name);
    assert.equal(typeof cfg.mlPhase1Integration.enableMlFilter, 'boolean', scenario.name);
    assert.equal(typeof cfg.mlMetaController.enableMlMetaController, 'boolean', scenario.name);
    assert.equal(typeof cfg.positionLifecycle.enableAdvancedLifecycle, 'boolean', scenario.name);
  });
});

test('matrix audit: disabled branches возвращают explicit fallback без runtime crash', () => {
  const disabledSizing = evaluateDynamicPositionSizing(baseSizingInput(), normalizeDynamicPositionSizingConfig({
    enabled: false,
  }));
  assert.equal(disabledSizing.mode, 'fixed_fallback');
  assert.ok(disabledSizing.sizingReasonCodes.includes('dynamic_sizing_disabled_fixed_fallback'));

  const inference = createMlInferenceLayer(normalizeMlInferenceConfig({
    enabled: false,
    allowFallbackWithoutModel: true,
  }));
  const mlOut = inference.evaluate({
    context: { cycleId: 'cfg-audit-ml', ticker: 'ETH-USDT' },
    marketFeatures: { momentum: 0.4 },
  });
  assert.equal(mlOut.mlFallbackState, 'disabled');

  const metaController = createMlMetaController({ enableMlMetaController: false });
  const metaOut = metaController.evaluate({
    context: { cycleId: 'cfg-audit-meta', ticker: 'ETH-USDT' },
    modelState: { available: true },
    finalEntryDecisionOutput: { decisionMode: 'weak_entry' },
    dynamicPositionSizingOutput: { sizeMultiplier: 0.4 },
  });
  assert.equal(metaOut.metaControllerFallbackState, 'disabled');

  const lifecycleOut = evaluatePositionLifecycle({
    context: { cycleId: 'cfg-audit-lifecycle', ticker: 'ETH-USDT' },
    positionState: { symbolUnified: 'ETH-USDT', side: 'long', entryPrice: 100, markPrice: 101, percentage: 1, unrealizedPnl: 1 },
    lifecycleState: { stage: 'initial', partialCloseDone: false, breakevenMoved: false, trailingActive: false },
    profitability: { unrealizedPnl: 1, unrealizedPnlPercent: 1 },
  }, normalizeLifecycleRules({ enabled: false }));
  assert.equal(lifecycleOut.lifecycleActionIntent.action, 'fallback_legacy_close_logic');

  assert.doesNotThrow(() => evaluateFinalEntryDecision({
    componentScores: {
      entryPermission: { score: 0.7, confidence: 0.7, weight: 1, dataQualityState: 'ok' },
      marketContext: { score: 0.7, confidence: 0.7, weight: 1, dataQualityState: 'ok' },
      primarySignal: { score: 0.7, confidence: 0.7, weight: 1, dataQualityState: 'ok' },
    },
  }, normalizeFinalEntryDecisionConfig({ enabled: false })));
});

test('matrix audit: exchange safeUnsupportedFeatureMode и checks не создают невалидный state', () => {
  const scenarios = [
    { checks: true, mode: 'fallback', expected: { allowed: true, blocked: false, fallbackUsed: true } },
    { checks: true, mode: 'disable', expected: { allowed: false, blocked: false, fallbackUsed: false } },
    { checks: true, mode: 'block', expected: { allowed: false, blocked: true, fallbackUsed: false } },
    { checks: false, mode: 'block', expected: { allowed: true, blocked: false, fallbackUsed: false } },
  ];

  scenarios.forEach((scenario) => {
    const integration = createExchangeRuntimeIntegration({
      activeExchange: 'unknown_exchange',
      enableExchangeCapabilityChecks: scenario.checks,
      safeUnsupportedFeatureMode: scenario.mode,
    });

    const gate = integration.protectiveContext.featureGates.serverTpSupport;
    const resolved = integration.resolveUnsupportedFeature('serverTpSupport', gate);

    assert.equal(resolved.allowed, scenario.expected.allowed, `${scenario.mode}/${scenario.checks}`);
    assert.equal(resolved.blocked, scenario.expected.blocked, `${scenario.mode}/${scenario.checks}`);
    assert.equal(resolved.fallbackUsed, scenario.expected.fallbackUsed, `${scenario.mode}/${scenario.checks}`);
  });
});

test('matrix audit: dynamic asset selection on/off корректно переключает fallback на allowedUniverse', async () => {
  const connector = new MockConnector(types, { positionsByTicker: { 'BTC-USDT': [], 'ETH-USDT': [] } });

  const dynamicEnabled = new SingleStrategy(connector, makeStrategyConfig({
    singleSetts: {
      tickers: {
        dynamicAssetSelection: { enabled: true, shortlistSize: 1 },
      },
    },
  }), true);
  dynamicEnabled.connect();
  dynamicEnabled.dynamicEntryShortlist = {
    explanation: { shortlist: ['BTC-USDT'] },
  };

  const blocked = dynamicEnabled.evaluateNewEntryAllowance('ETH-USDT', {
    allowedUniverseTickers: ['BTC-USDT', 'ETH-USDT'],
    balanceState: 'NORMAL',
    unloadModeEnabled: false,
    safeEntryAssets: [],
    entryLimits: {},
    dynamicAssetSelection: dynamicEnabled.dynamicEntryShortlist,
  });
  assert.equal(blocked.allowed, false);

  const dynamicDisabled = new SingleStrategy(connector, makeStrategyConfig({
    singleSetts: {
      tickers: {
        dynamicAssetSelection: { enabled: false, shortlistSize: 1 },
      },
    },
  }), true);
  dynamicDisabled.connect();
  const allowed = dynamicDisabled.evaluateNewEntryAllowance('ETH-USDT', {
    allowedUniverseTickers: ['BTC-USDT', 'ETH-USDT'],
    balanceState: 'NORMAL',
    unloadModeEnabled: false,
    safeEntryAssets: [],
    entryLimits: {},
    dynamicAssetSelection: null,
  });
  assert.equal(allowed.allowed, true);
});
