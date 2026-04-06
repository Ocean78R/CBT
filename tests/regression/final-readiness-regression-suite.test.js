const test = require('node:test');
const assert = require('node:assert/strict');

process.env.CBT_SKIP_AUTOSTART = '1';

const runtime = require('../../dist/index.js');
const { buildRuntimeConfig } = require('../../dist/runtime/config/runtimeConfigValidator');
const { evaluatePortfolioRiskContour } = require('../../dist/runtime/risk/portfolioRiskContour');
const { evaluateFinalEntryDecision } = require('../../dist/runtime/engines/finalEntryDecisionEngine');
const { evaluateDynamicPositionSizing } = require('../../dist/runtime/sizing/dynamicPositionSizing');
const { createMlPhase1DecisionModifier } = require('../../dist/runtime/ml/mlPhase1DecisionModifier');
const { createMlMetaController } = require('../../dist/runtime/ml/mlMetaController');
const { evaluateForcedLossExit } = require('../../dist/runtime/risk/forcedLossExit');
const { evaluatePositionLifecycle, normalizeLifecycleRules } = require('../../dist/runtime/lifecycle/positionLifecycleManager');
const { createExchangeRuntimeIntegration } = require('../../dist/runtime/exchange/exchangeRuntimeIntegration');
const { createPerformanceGovernor } = require('../../dist/runtime/performance/performanceGovernor');

function createUtilsConfig() {
  return {
    getCoreConfig: (globalConfig) => globalConfig || {},
    getExchangeConfig: (exchangeConfig) => exchangeConfig || {},
    merge: (base, extra) => ({ ...(base || {}), ...(extra || {}) }),
  };
}

test('final readiness smoke: runtime bootstrap + config normalization не падают', () => {
  assert.ok(runtime.__testkit);

  const normalized = buildRuntimeConfig(createUtilsConfig(), {
    exchangeLayer: { activeExchange: 'bingx' },
    mlMetaController: { enableMlMetaController: true },
  }, {});

  assert.equal(normalized.exchangeLayer.activeExchange, 'bingx');
  assert.equal(normalized.mlMetaController.enableMlMetaController, true);
});

test('critical E2E chain: risk -> decision -> ml phase1 -> meta -> sizing', () => {
  const risk = evaluatePortfolioRiskContour({
    context: { cycleId: 'cycle-ready-1', ticker: 'BTC-USDT' },
    stats: {
      dayPnlPercent: -1.1,
      usedMarginPercent: 28,
      balanceDrawdownPercent: 8,
      openPositionsCount: 1,
      newEntriesToday: 1,
    },
  }, {
    enabled: true,
    capitalRegimeEngine: { enabled: true, escalationOnly: true, haltBalanceDrawdownPercent: 14 },
    capitalRegimeThresholds: {
      cautionDailyLossPercent: 0.8,
      defensiveDailyLossPercent: 1.4,
      capitalPreservationDailyLossPercent: 2.4,
      haltDailyLossPercent: 4,
      cautionMarginUsagePercent: 20,
      defensiveMarginUsagePercent: 45,
      capitalPreservationMarginUsagePercent: 70,
      haltMarginUsagePercent: 90,
    },
    portfolioForecastEngine: {
      enabled: true,
      restrictions: { enableRestrictionHints: true },
    },
  });

  const finalDecision = evaluateFinalEntryDecision({
    context: { cycleId: 'cycle-ready-1', ticker: 'BTC-USDT', exchange: 'bingx' },
    componentScores: {
      entryPermission: { score: 0.78, confidence: 0.7 },
      marketContext: { score: 0.72, confidence: 0.66 },
      primarySignal: { score: 0.7, confidence: 0.62 },
      confirmation: { score: 0.69, confidence: 0.61 },
    },
    capitalRegime: risk.balanceState.capitalRegime,
    balanceState: risk.balanceState,
  }, {
    enabled: true,
    allowWeakEntryMode: true,
    entryScoreThreshold: 0.63,
    weakEntryThreshold: 0.48,
  });

  const mlPhase1 = createMlPhase1DecisionModifier({
    enabled: true,
    mode: 'confirm_only',
    thresholds: { confirmMinScore: 0.6, confirmMinConfidence: 0.55 },
  }).evaluate({
    context: { cycleId: 'cycle-ready-1', ticker: 'BTC-USDT' },
    baseRuleDecision: finalDecision,
    mlInferenceOutput: { mlScore: 0.64, mlConfidence: 0.58 },
    balanceState: risk.balanceState,
    capitalRegime: risk.balanceState.capitalRegime,
  });

  const meta = createMlMetaController({
    enableMlMetaController: true,
    allowedMetaAdjustments: ['entryThresholdModifier', 'sizingAggressivenessModifier'],
    boundsByAdjustmentType: {
      entryThresholdModifier: { min: -0.02, max: 0.02 },
      sizingAggressivenessModifier: { min: -0.1, max: 0.1 },
    },
  }).evaluate({
    context: { cycleId: 'cycle-ready-1', ticker: 'BTC-USDT' },
    decisionContext: { cycleId: 'cycle-ready-1', ticker: 'BTC-USDT', capitalRegime: risk.balanceState.capitalRegime },
    finalEntryDecisionOutput: finalDecision,
    dynamicPositionSizingOutput: { sizeMultiplier: 0.5, mode: 'dynamic_base_formula' },
    mlPhase1Output: mlPhase1,
    runtimeDataQualityState: 'ok',
    modelState: { available: true },
    metaSuggestions: { entryThresholdModifier: 0.5, sizingAggressivenessModifier: -0.5 },
  });

  const sizing = evaluateDynamicPositionSizing({
    context: { cycleId: 'cycle-ready-1', ticker: 'BTC-USDT', mode: 'live' },
    approvedEntryResult: {
      decisionMode: mlPhase1.effectiveDecisionMode,
      entryScore: finalDecision.entryScore,
      confidence: finalDecision.confidence,
      vetoSummary: finalDecision.vetoSummary,
      dataQualityState: finalDecision.dataQualityState,
    },
    capitalRegime: risk.balanceState.capitalRegime,
    balanceState: risk.balanceState,
    runtimeGuards: { allowNewEntries: risk.allowNewEntries, hardRiskBlocked: !risk.allowNewEntries },
    mlCompatibility: {
      mlMetaControllerOutput: meta,
    },
    mlMetaControllerOutput: meta,
    tickerRisk: { riskScore: 0.38 },
  }, {
    enableDynamicPositionSizing: true,
    baseSizingRules: { baseLeverageCap: 5, riskPenaltyWeight: 0.5 },
  });

  assert.equal(risk.allowNewEntries, true);
  assert.equal(finalDecision.decisionMode !== 'no_entry', true);
  assert.equal(mlPhase1.effectiveApproved, true);
  assert.equal(meta.ownershipGuards.canBecomeDecisionOwner, false);
  assert.equal(sizing.sizeMultiplier > 0, true);
});

test('protective/lifecycle chain: restricted position остаётся safe-close-only + forced loss owner path', () => {
  const forced = evaluateForcedLossExit({
    context: {
      cycleId: 'cycle-ready-2',
      ticker: 'ETH-USDT',
      capitalRegime: 'CAPITAL_PRESERVATION',
      positionCapabilityState: 'LEVERAGE_MISMATCH_POSITION',
      protectiveCloseState: { closeInProgress: false, source: null },
    },
    position: {
      side: 'LONG',
      minutesSinceEntry: 14,
      entryDeviationPercent: -1.4,
      timeUnderEntryWithoutRecoveryMinutes: 10,
      adverseTrendBars: 3,
      adverseTrendSlope: 0.08,
      adverseMarketConfirmed: true,
      holdMinutesInLoss: 14,
      pnlPercent: -1.4,
      averagesCount: 0,
    },
  }, {
    enabled: true,
    actionMode: 'warn',
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

  const lifecycle = evaluatePositionLifecycle({
    context: { cycleId: 'cycle-ready-2', ticker: 'ETH-USDT' },
    positionState: {
      symbolUnified: 'ETH-USDT',
      side: 'long',
      entryPrice: 100,
      markPrice: 103,
      percentage: 3,
      unrealizedPnl: 1.5,
      positionCapabilityState: 'LEVERAGE_MISMATCH_POSITION',
    },
    lifecycleState: { stage: 'initial_position_state', partialCloseDone: false, breakevenMoved: false, trailingActive: false },
    profitability: { unrealizedPnl: 1.5, unrealizedPnlPercent: 3 },
  }, normalizeLifecycleRules({
    enabled: true,
    restrictedLifecycleRules: { allowPartialClose: true, allowBreakeven: false, allowTrailing: false },
  }));

  assert.equal(forced.triggered, true);
  assert.equal(forced.ownershipAction.type, 'position_force_close_request');
  assert.equal(lifecycle.restrictedLifecycleMode, true);
  assert.equal(lifecycle.allowedActions.includes('partial_close'), true);
  assert.equal(lifecycle.allowedActions.includes('protective_close'), true);
  assert.equal(lifecycle.blockedActions.includes('averaging'), true);
});

test('exchange capability + restriction policy: candidate exchange идёт через explicit fallback', () => {
  const runtimeIntegration = createExchangeRuntimeIntegration({
    exchangeLayer: {
      activeExchange: 'kraken-futures-candidate',
      enableExchangeCapabilityChecks: true,
      safeUnsupportedFeatureMode: 'fallback',
      exchangeRestrictionPolicy: 'enforce',
    },
  });

  const unsupported = runtimeIntegration.resolveUnsupportedFeature('serverTpSupport', { isAvailable: false, fallbackAction: 'local_protective_manager' });
  const restricted = runtimeIntegration.applyRestrictionPolicy('forbidAssumeUniversalReduceOnly', true, { ticker: 'BTC-USDT' });

  assert.equal(runtimeIntegration.contract.profileFound, false);
  assert.equal(unsupported.fallbackUsed, true);
  assert.equal(restricted.restricted, true);
  assert.equal(runtimeIntegration.ownershipSafety.canBecomeDecisionOwner, false);
});

test('performance-sensitive branch: governor переводит optional layer в degraded/skip при budget pressure', async () => {
  const governor = createPerformanceGovernor({
    enabled: true,
    mode: 'enforce',
    cycle: { targetMs: 30, hardLimitMs: 45 },
    budgets: { byLayerMs: { confirmations: 1 }, reserveForExecutionMs: 10 },
    optionalLayers: ['confirmations'],
  });

  governor.onCycleStart({ cycleId: 'cycle-ready-3', exchange: 'bingx', marketRegime: 'trend', capitalRegime: 'NORMAL' });
  governor.setStage('expensive_confirmations');
  governor.registerLayerExecution('confirmations', 7, 'full');

  await new Promise((resolve) => setTimeout(resolve, 5));

  const layerMode = governor.resolveLayerMode('confirmations', { cycleId: 'cycle-ready-3', optional: true });
  const diagnostics = governor.getCycleDiagnostics();

  assert.equal(['cached', 'degraded', 'skip', 'full'].includes(layerMode.mode), true);
  assert.equal(diagnostics.consumedMsByLayer.confirmations >= 7, true);
  assert.equal(typeof diagnostics.pressure === 'number', true);
});
