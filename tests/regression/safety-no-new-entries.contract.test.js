const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateFinalEntryDecision } = require('../../dist/runtime/engines/finalEntryDecisionEngine');
const { evaluateDynamicPositionSizing } = require('../../dist/runtime/sizing/dynamicPositionSizing');
const { evaluatePositionLifecycle, normalizeLifecycleRules } = require('../../dist/runtime/lifecycle/positionLifecycleManager');
const { evaluateForcedLossExit } = require('../../dist/runtime/risk/forcedLossExit');
const { createExchangeRuntimeIntegration, normalizeExchangeRuntimeConfig } = require('../../dist/runtime/exchange/exchangeRuntimeIntegration');
const { createMlMetaController } = require('../../dist/runtime/ml/mlMetaController');

function strongComponents() {
  return {
    entryPermission: { score: 0.95, confidence: 0.92, weight: 1, dataQualityState: 'ok' },
    marketContext: { score: 0.92, confidence: 0.9, weight: 1, dataQualityState: 'ok' },
    primarySignal: { score: 0.94, confidence: 0.91, weight: 1, dataQualityState: 'ok' },
  };
}

function lifecycleRules() {
  return normalizeLifecycleRules({
    enableAdvancedLifecycle: true,
    partialTakeProfitRules: { enabled: true, triggerProfitPercent: 1, closeShare: 0.25 },
    breakevenRules: { enabled: true, triggerProfitPercent: 2, offsetPercent: 0 },
    trailingRules: { enabled: true, triggerProfitPercent: 3, distancePercent: 1 },
    restrictedLifecycleRules: { allowPartialClose: true, allowBreakeven: false, allowTrailing: false },
    capitalRegimeLifecycleModifiers: {
      enabled: true,
      HALT_NEW_ENTRIES: { preserveOpenLifecycle: true },
    },
  });
}

function assertNoNewEntriesAndSafeContinuation({
  scenario,
  finalInput,
  runtimeGuards,
  lifecycleContext = {},
  expectReasonCode,
}) {
  const finalDecision = evaluateFinalEntryDecision(finalInput, {});
  const sizing = evaluateDynamicPositionSizing({
    context: { cycleId: `safety-${scenario}`, ticker: 'BTC-USDT', mode: 'paper' },
    approvedEntryResult: {
      decisionMode: finalDecision.decisionMode,
      entryScore: finalDecision.entryScore,
      confidence: finalDecision.confidence,
      vetoSummary: finalDecision.vetoSummary,
      dataQualityState: finalDecision.dataQualityState,
    },
    decisionMode: finalDecision.decisionMode,
    capitalRegime: finalInput.capitalRegime || (finalInput.balanceState || {}).capitalRegime || 'NORMAL',
    balanceState: finalInput.balanceState || {},
    tickerRisk: { riskScore: 0.25 },
    runtimeGuards,
  }, { enableDynamicPositionSizing: true });

  const lifecycle = evaluatePositionLifecycle({
    context: {
      cycleId: `safety-${scenario}`,
      ticker: 'BTC-USDT',
      capitalRegime: finalInput.capitalRegime || (finalInput.balanceState || {}).capitalRegime || 'NORMAL',
      ...lifecycleContext,
    },
    positionState: {
      symbolUnified: 'BTC-USDT',
      side: 'long',
      entryPrice: 100,
      markPrice: 103,
      contracts: 1,
      percentage: 3,
      unrealizedPnl: 3,
      isClosed: false,
      positionCapabilityState: lifecycleContext.positionCapabilityState || 'NORMAL_POSITION',
    },
    lifecycleState: {
      stage: 'INITIAL',
      partialCloseDone: false,
      breakevenMoved: false,
      trailingActive: false,
    },
    profitability: { unrealizedPnl: 3, unrealizedPnlPercent: 3 },
    restrictedLifecycleMode: lifecycleContext.restrictedLifecycleMode === true,
  }, lifecycleRules());

  const protective = evaluateForcedLossExit({
    context: {
      cycleId: `safety-${scenario}`,
      ticker: 'BTC-USDT',
      capitalRegime: finalInput.capitalRegime || (finalInput.balanceState || {}).capitalRegime || 'NORMAL',
      positionCapabilityState: lifecycleContext.positionCapabilityState || 'NORMAL_POSITION',
    },
    position: {
      side: 'LONG',
      minutesSinceEntry: 25,
      entryDeviationPercent: -2,
      timeUnderEntryWithoutRecoveryMinutes: 15,
      adverseTrendBars: 4,
      adverseTrendSlope: 0.08,
      adverseMarketConfirmed: true,
      holdMinutesInLoss: 25,
      pnlPercent: -2,
      averagesCount: 0,
    },
  }, {
    enabled: true,
    actionMode: 'force_close',
    maxNegativeHoldMinutes: 240,
    maxPostAveragingNegativeHoldMinutes: 120,
    maxLossPercentOnPosition: 6,
    maxAveragesPerPosition: 3,
    requireAdverseMarketConfirmation: true,
    enablePostEntryObservation: true,
    postEntryGraceMinutes: 5,
    postEntryObservationMinutes: 30,
    maxTimeUnderEntryWithoutRecovery: 12,
    earlyInvalidationLossPercent: 1.1,
    requirePersistentAdverseTrend: true,
    adverseTrendConfirmationBars: 3,
    adverseTrendSlopeThreshold: 0.05,
    actionOnEarlyInvalidation: 'force_close',
  });

  // 1) no new entries
  assert.equal(finalDecision.decisionMode, 'no_entry', `${scenario}: final decision must be no_entry`);
  assert.equal(sizing.sizeMultiplier, 0, `${scenario}: sizing must stay disabled`);
  assert.equal(sizing.aggressivenessMode, 'disabled', `${scenario}: aggressiveness must be disabled`);

  if (expectReasonCode) {
    const allCodes = [
      ...finalDecision.explanation.reasonCodes,
      ...(finalDecision.vetoSummary.reasonCodes || []),
      ...sizing.sizingReasonCodes,
    ];
    assert.ok(allCodes.some((code) => String(code).includes(expectReasonCode)), `${scenario}: missing reason code ${expectReasonCode}`);
  }

  // 2) safe lifecycle continuation for already-open positions
  assert.equal(lifecycle.lifecycleActionIntent.ownership.isExecutionOwner, false, `${scenario}: lifecycle ownership safety`);
  assert.equal(lifecycle.lifecycleActionIntent.ownership.ownsServerTpSl, false, `${scenario}: lifecycle must not own TP/SL`);
  assert.ok(lifecycle.allowedActions.includes('protective_close'), `${scenario}: protective lifecycle path must remain`);

  // 3) protective actions for existing positions remain operational
  assert.equal(protective.triggered, true, `${scenario}: protective action must remain available`);
  assert.equal(protective.ownershipAction.type, 'position_force_close_request', `${scenario}: protective owner must be lifecycle close request`);

  return { finalDecision, sizing, lifecycle, protective };
}

test('safety contract: bot must stand still in forbidden entry states while preserving position safety', async (t) => {
  await t.test('HALT_NEW_ENTRIES', () => {
    assertNoNewEntriesAndSafeContinuation({
      scenario: 'halt-new-entries',
      finalInput: {
        componentScores: strongComponents(),
        capitalRegime: 'HALT_NEW_ENTRIES',
        balanceState: { capitalRegime: 'HALT_NEW_ENTRIES' },
      },
      runtimeGuards: { allowNewEntries: false, hardRiskBlocked: true, unloadMode: false },
      expectReasonCode: 'capital',
    });
  });

  await t.test('capital prohibition veto', () => {
    assertNoNewEntriesAndSafeContinuation({
      scenario: 'capital-prohibition',
      finalInput: {
        componentScores: strongComponents(),
        capitalRegime: 'NORMAL',
        balanceState: { capitalRegime: 'NORMAL' },
        vetoCandidates: [{ type: 'capital_prohibition', severity: 'hard', reason: 'capital_controller_block', source: 'portfolioRiskContour' }],
      },
      runtimeGuards: { allowNewEntries: false, hardRiskBlocked: true, unloadMode: false, capitalProhibition: true },
      expectReasonCode: 'capital_prohibition',
    });
  });

  await t.test('no-trade regime', () => {
    assertNoNewEntriesAndSafeContinuation({
      scenario: 'no-trade-regime',
      finalInput: {
        componentScores: strongComponents(),
        noTradeRegime: true,
        balanceState: { capitalRegime: 'NORMAL' },
      },
      runtimeGuards: { allowNewEntries: false, hardRiskBlocked: true, unloadMode: false },
      expectReasonCode: 'no_trade_regime',
    });
  });

  await t.test('shock/event-risk hard veto', () => {
    assertNoNewEntriesAndSafeContinuation({
      scenario: 'event-risk-veto',
      finalInput: {
        componentScores: strongComponents(),
        balanceState: { capitalRegime: 'NORMAL' },
        vetoCandidates: [{ type: 'event_risk_freeze', severity: 'hard', reason: 'critical_shock_window', source: 'eventRiskLayer' }],
      },
      runtimeGuards: { allowNewEntries: false, hardRiskBlocked: true, unloadMode: false },
      expectReasonCode: 'event_risk',
    });
  });

  await t.test('unsupported feature on current exchange', () => {
    const integration = createExchangeRuntimeIntegration({
      activeExchange: 'candidate_without_reduce_only',
      safeUnsupportedFeatureMode: 'block',
      exchangeRestrictionPolicy: 'enforce',
      enableExchangeCapabilityChecks: true,
    });
    const unsupported = integration.resolveUnsupportedFeature('reduceOnlySemantics', {
      isAvailable: false,
      fallbackAction: 'SAFE_NOOP_AND_LOG',
    });

    assert.equal(unsupported.blocked, true);

    assertNoNewEntriesAndSafeContinuation({
      scenario: 'unsupported-feature',
      finalInput: {
        componentScores: strongComponents(),
        vetoCandidates: [{ type: 'unsupported_exchange_feature', severity: 'hard', reason: 'reduce_only_semantics_missing', source: 'exchangeRuntimeIntegration' }],
        balanceState: { capitalRegime: 'NORMAL' },
      },
      runtimeGuards: { allowNewEntries: false, hardRiskBlocked: unsupported.blocked, unloadMode: false },
      expectReasonCode: 'unsupported_exchange_feature',
    });
  });

  await t.test('invalid config fallback', () => {
    const normalized = normalizeExchangeRuntimeConfig({
      activeExchange: 'bingx',
      safeUnsupportedFeatureMode: 'invalid-mode',
      exchangeRestrictionPolicy: 'invalid-policy',
      exchangeCapabilitiesSource: 'invalid-source',
    });

    assert.equal(normalized.safeUnsupportedFeatureMode, 'fallback');
    assert.equal(normalized.exchangeRestrictionPolicy, 'enforce');
    assert.equal(normalized.exchangeCapabilitiesSource, 'matrix_step40a');

    assertNoNewEntriesAndSafeContinuation({
      scenario: 'invalid-config-fallback',
      finalInput: {
        componentScores: {
          entryPermission: { score: 0.93, confidence: 0.8, dataQualityState: 'degraded' },
        },
        balanceState: { capitalRegime: 'HALT_NEW_ENTRIES', unloadMode: true },
      },
      runtimeGuards: { allowNewEntries: false, hardRiskBlocked: true, unloadMode: true },
      expectReasonCode: 'hard_risk',
    });
  });

  await t.test('missing model fallback', () => {
    const meta = createMlMetaController({ enabled: true, allowMetaFallbackWithoutModel: true });
    const metaOutput = meta.evaluate({
      context: { cycleId: 'missing-model', ticker: 'BTC-USDT' },
      decisionContext: { cycleId: 'missing-model', ticker: 'BTC-USDT' },
      finalEntryDecisionOutput: { decisionMode: 'full_entry', vetoSummary: { blocked: false } },
      dynamicPositionSizingOutput: { mode: 'dynamic_base_formula', sizeMultiplier: 0.7 },
      balanceState: { capitalRegime: 'NORMAL' },
      capitalRegime: 'NORMAL',
      runtimeDataQualityState: 'ok',
      modelState: { available: false },
      metaSuggestions: { sizingAggressivenessModifier: 0.1 },
    });

    assert.equal(metaOutput.metaControllerFallbackState, 'model_unavailable');

    assertNoNewEntriesAndSafeContinuation({
      scenario: 'missing-model-fallback',
      finalInput: {
        componentScores: strongComponents(),
        vetoCandidates: [{ type: 'model_unavailable_fallback', severity: 'hard', reason: 'ml_meta_model_missing', source: 'mlMetaController' }],
        balanceState: { capitalRegime: 'NORMAL' },
        mlMetaControllerOutput: metaOutput,
      },
      runtimeGuards: { allowNewEntries: false, hardRiskBlocked: true, unloadMode: false },
      expectReasonCode: 'model_unavailable',
    });
  });

  await t.test('restricted state constraints', () => {
    const result = assertNoNewEntriesAndSafeContinuation({
      scenario: 'restricted-state-constraints',
      finalInput: {
        componentScores: strongComponents(),
        vetoCandidates: [{ type: 'restricted_state_constraints', severity: 'hard', reason: 'leverage_mismatch_restricted_position', source: 'reconciliation' }],
        balanceState: { capitalRegime: 'NORMAL' },
      },
      runtimeGuards: { allowNewEntries: false, hardRiskBlocked: true, unloadMode: false },
      lifecycleContext: { positionCapabilityState: 'LEVERAGE_MISMATCH_POSITION' },
      expectReasonCode: 'restricted_state_constraints',
    });

    assert.equal(result.lifecycle.restrictedLifecycleMode, true);
    assert.ok(result.lifecycle.blockedActions.includes('activate_trailing'));
    assert.ok(result.lifecycle.allowedActions.includes('reduce_only_profit_close'));
  });
});
