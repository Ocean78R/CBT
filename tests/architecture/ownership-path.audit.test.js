const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateFinalEntryDecision } = require('../../dist/runtime/engines/finalEntryDecisionEngine');
const { evaluateDynamicPositionSizing } = require('../../dist/runtime/sizing/dynamicPositionSizing');
const { evaluatePositionLifecycle, normalizeLifecycleRules } = require('../../dist/runtime/lifecycle/positionLifecycleManager');
const { evaluateForcedLossExit } = require('../../dist/runtime/risk/forcedLossExit');
const { createMlPhase1DecisionModifier } = require('../../dist/runtime/ml/mlPhase1DecisionModifier');
const { createMlMetaController } = require('../../dist/runtime/ml/mlMetaController');
const { createExchangeRuntimeIntegration } = require('../../dist/runtime/exchange/exchangeRuntimeIntegration');

function buildFinalEntryInput() {
  return {
    context: { cycleId: 'audit-35', ticker: 'BTC-USDT' },
    componentScores: {
      entryPermission: { score: 0.75, confidence: 0.7, weight: 1, dataQualityState: 'ok' },
      marketContext: { score: 0.72, confidence: 0.68, weight: 1, dataQualityState: 'ok' },
      primarySignal: { score: 0.74, confidence: 0.69, weight: 1, dataQualityState: 'ok' },
    },
    vetoCandidates: [],
    balanceState: { capitalRegime: 'NORMAL' },
  };
}

test('ownership audit: шаг 35 остаётся final decision owner, шаг 36 остаётся sizing owner', () => {
  const finalDecision = evaluateFinalEntryDecision(buildFinalEntryInput(), {});
  assert.equal(finalDecision.explanation.ownership.isFinalVetoOwnerForNewEntries, true);
  assert.equal(finalDecision.explanation.ownership.isSizingOwner, false);
  assert.equal(finalDecision.explanation.ownership.isExecutionOwner, false);

  const sizing = evaluateDynamicPositionSizing({
    context: { cycleId: 'audit-36', ticker: 'BTC-USDT', mode: 'live' },
    approvedEntryResult: finalDecision,
    decisionMode: finalDecision.decisionMode,
    balanceState: { capitalRegime: 'NORMAL', drawdownProtection: false },
    capitalRegime: 'NORMAL',
    tickerRisk: { riskScore: 0.45 },
    runtimeGuards: { allowNewEntries: true, hardRiskBlocked: false, unloadMode: false },
  }, { enabled: true });

  assert.equal(sizing.explanation.ownership.isFinalDecisionOwner, false);
  assert.equal(sizing.explanation.ownership.isExecutionOwner, false);
  assert.equal(sizing.mode !== 'no_entry', true);
});

test('ownership audit: шаг 38 lifecycle не становится execution owner и сохраняет restricted-path', () => {
  const lifecycle = evaluatePositionLifecycle({
    context: {
      cycleId: 'audit-38',
      ticker: 'ETH-USDT',
      positionCapabilityState: 'LEVERAGE_MISMATCH_POSITION',
      capitalRegime: 'NORMAL',
    },
    positionState: {
      symbolUnified: 'ETH-USDT',
      side: 'long',
      entryPrice: 100,
      markPrice: 103,
      contracts: 1,
      percentage: 3,
      unrealizedPnl: 1.8,
      isClosed: false,
    },
    lifecycleState: {
      stage: 'initial_position_state',
      partialCloseDone: false,
      breakevenMoved: false,
      trailingActive: false,
    },
    profitability: { unrealizedPnl: 1.8, unrealizedPnlPercent: 3 },
  }, normalizeLifecycleRules({ enabled: true }));

  assert.equal(lifecycle.contract.output.executionOwner, false);
  assert.equal(lifecycle.lifecycleActionIntent.ownership.isExecutionOwner, false);
  assert.equal(lifecycle.restrictedLifecycleMode, true);
  assert.ok(lifecycle.allowedActions.includes('reduce_only_profit_close'));
  assert.ok(lifecycle.allowedActions.includes('protective_close'));
  assert.ok(lifecycle.allowedActions.includes('cleanup_protective_orders'));
  assert.ok(lifecycle.blockedActions.includes('averaging'));
  assert.equal(lifecycle.managerRouting.serverTakeProfitManager.owner, 'server_take_profit_manager');
  assert.equal(lifecycle.managerRouting.serverStopLossManager.owner, 'server_stop_loss_manager');
});

test('ownership audit: ML phase 1 и ML meta-controller не перехватывают strategy/final ownership', () => {
  const mlPhase1 = createMlPhase1DecisionModifier({ mode: 'confirm_only' }).evaluate({
    context: { cycleId: 'audit-ml1', ticker: 'SOL-USDT' },
    baseRuleDecision: { decisionMode: 'weak_entry', vetoSummary: { blocked: false, finalVeto: null } },
    mlInferenceOutput: { mlScore: 0.7, mlConfidence: 0.7 },
    balanceState: { capitalRegime: 'NORMAL', unloadMode: false },
    runtimeGuards: { hardRiskBlocked: false },
  });

  assert.equal(mlPhase1.ownership.baselineDecisionOwner, 'finalEntryDecisionEngine');
  assert.equal(mlPhase1.ownership.isFinalVetoOwnerForNewEntries, false);
  assert.equal(mlPhase1.ownership.isExecutionOwner, false);

  const mlMeta = createMlMetaController({ enabled: true }).evaluate({
    context: { cycleId: 'audit-ml2', ticker: 'SOL-USDT' },
    decisionContext: { cycleId: 'audit-ml2', ticker: 'SOL-USDT' },
    sharedRuntimeBlockOutputs: {},
    finalEntryDecisionOutput: { decisionMode: 'weak_entry', approved: true, vetoSummary: { blocked: false } },
    dynamicPositionSizingOutput: { mode: 'dynamic_base_formula', sizeMultiplier: 0.4 },
    balanceState: { capitalRegime: 'NORMAL', unloadMode: false },
    runtimeDataQualityState: 'ok',
    modelState: { available: true },
    metaSuggestions: {
      entryThresholdModifier: 0.03,
      directExecutionOwnership: true,
      directHardRiskOverride: true,
    },
  });

  assert.equal(mlMeta.ownershipGuards.canBecomeDecisionOwner, false);
  assert.equal(mlMeta.ownershipGuards.isExecutionOwner, false);
  assert.equal(mlMeta.ownershipGuards.isLifecycleOwner, false);
  assert.ok(mlMeta.blockedAdjustmentReasons.includes('forbidden_parameter_blocked:directExecutionOwnership'));
  assert.ok(mlMeta.blockedAdjustmentReasons.includes('forbidden_parameter_blocked:directHardRiskOverride'));
});

test('ownership audit: exchange capability layer остаётся capability layer, не подменяет runtime owners', () => {
  const integration = createExchangeRuntimeIntegration({
    activeExchange: 'bingx',
    exchangeCapabilitiesSource: 'matrix_step40a',
    enableExchangeCapabilityChecks: true,
  });

  assert.equal(integration.ownershipSafety.ownershipPathChanged, false);
  assert.equal(integration.ownershipSafety.canBecomeDecisionOwner, false);
  assert.equal(integration.ownershipSafety.canOverrideHardRisk, false);
  assert.equal(integration.contract.decisionLayerInvariant.exchangeDifferencesOnlyThroughCapabilityLayer, true);
});

test('ownership audit: protective close/server managers path остаётся консистентным', () => {
  const decision = evaluateForcedLossExit({
    context: {
      cycleId: 'audit-protective',
      ticker: 'BNB-USDT',
      capitalRegime: 'NORMAL',
      serverStopLossState: {
        status: 'close_confirmed',
        closeInitiated: true,
        closeConfirmed: true,
        protectiveActionToken: 'srv-audit-1',
      },
    },
    position: {
      side: 'LONG',
      minutesSinceEntry: 12,
      entryDeviationPercent: -1.6,
      timeUnderEntryWithoutRecoveryMinutes: 12,
      adverseTrendBars: 4,
      adverseTrendSlope: 0.08,
      adverseMarketConfirmed: true,
      holdMinutesInLoss: 12,
      pnlPercent: -1.6,
      averagesCount: 0,
    },
  }, {
    enabled: true,
    actionMode: 'force_close',
    earlyInvalidationLossPercent: 1.1,
    maxTimeUnderEntryWithoutRecovery: 10,
    requirePersistentAdverseTrend: true,
    adverseTrendConfirmationBars: 3,
    adverseTrendSlopeThreshold: 0.05,
  });

  assert.equal(decision.duplicateClosePrevented, false);
  assert.equal(decision.protectiveActionOwner, 'server_stop_loss_manager');
  assert.equal(decision.protectiveActionToken, 'srv-audit-1');
  assert.equal(decision.ownershipAction, null);
});
