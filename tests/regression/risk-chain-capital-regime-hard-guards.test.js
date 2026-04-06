const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluatePortfolioRiskContour,
  CAPITAL_REGIMES,
} = require('../../dist/runtime/risk/portfolioRiskContour');
const {
  evaluateFinalEntryDecision,
} = require('../../dist/runtime/engines/finalEntryDecisionEngine');
const {
  evaluateDynamicPositionSizing,
} = require('../../dist/runtime/sizing/dynamicPositionSizing');
const {
  evaluatePositionLifecycle,
  normalizeLifecycleRules,
  LIFECYCLE_STATES,
} = require('../../dist/runtime/lifecycle/positionLifecycleManager');
const {
  createMlPhase1DecisionModifier,
} = require('../../dist/runtime/ml/mlPhase1DecisionModifier');
const {
  createMlMetaController,
} = require('../../dist/runtime/ml/mlMetaController');

function makeRiskConfig(overrides = {}) {
  return {
    enabled: true,
    dailyLossLimitPercent: 7,
    maxNewEntriesPerDay: 10,
    maxOpenPositions: 8,
    maxUsedMarginPercent: 80,
    capitalRegimeThresholds: {
      cautionDailyLossPercent: 2,
      defensiveDailyLossPercent: 4,
      capitalPreservationDailyLossPercent: 6,
      haltDailyLossPercent: 8,
      cautionMarginUsagePercent: 45,
      defensiveMarginUsagePercent: 60,
      capitalPreservationMarginUsagePercent: 70,
      haltMarginUsagePercent: 85,
    },
    capitalRegimeEngine: {
      enabled: true,
      escalationOnly: true,
      cautionBalanceDrawdownPercent: 6,
      defensiveBalanceDrawdownPercent: 10,
      capitalPreservationBalanceDrawdownPercent: 14,
      haltBalanceDrawdownPercent: 18,
    },
    portfolioForecastEngine: {
      enabled: true,
      minConfidenceForSignals: 0.45,
      scenarioWeights: { baseline: 0.4, adverse: 0.35, severe: 0.25 },
      thresholds: {
        elevatedFragility: 0.45,
        highFragility: 0.65,
        criticalFragility: 0.8,
        elevatedRegimeDeteriorationProbability: 0.35,
        criticalRegimeDeteriorationProbability: 0.65,
      },
      restrictions: {
        enableRestrictionHints: true,
        enableHardRestrictionHints: true,
        applyHardRestrictionHintsAsVeto: false,
      },
    },
    ...overrides,
  };
}

function strongComponentScores() {
  return {
    entryPermission: { score: 0.95, confidence: 0.9, weight: 1, dataQualityState: 'ok' },
    marketContext: { score: 0.93, confidence: 0.9, weight: 1, dataQualityState: 'ok' },
    primarySignal: { score: 0.94, confidence: 0.91, weight: 1, dataQualityState: 'ok' },
  };
}

test('audit chain: capitalRegime из portfolio contour передаётся без ослабления в finalEntry и sizing', () => {
  const risk = evaluatePortfolioRiskContour({
    context: { cycleId: 'audit-1', ticker: 'BTC-USDT', previousCapitalRegime: CAPITAL_REGIMES.CAUTION },
    stats: { dayPnlPercent: -4.6, usedMarginPercent: 62, balanceDrawdownPercent: 11, newEntriesToday: 1, openPositionsCount: 2 },
  }, makeRiskConfig());

  const downstreamRegime = risk.telemetry.downstreamContext.finalEntryDecision.capitalRegime;
  assert.equal(downstreamRegime, CAPITAL_REGIMES.DEFENSIVE);

  const finalDecision = evaluateFinalEntryDecision({
    componentScores: strongComponentScores(),
    capitalRegime: downstreamRegime,
    balanceState: { capitalRegime: downstreamRegime },
  }, {});

  assert.equal(finalDecision.capitalRegimeImpact.capitalRegime, CAPITAL_REGIMES.DEFENSIVE);

  const sizing = evaluateDynamicPositionSizing({
    approvedEntryResult: {
      decisionMode: finalDecision.decisionMode,
      entryScore: finalDecision.entryScore,
      confidence: 0.9,
      vetoSummary: finalDecision.vetoSummary,
    },
    decisionMode: finalDecision.decisionMode,
    capitalRegime: downstreamRegime,
    balanceState: { capitalRegime: downstreamRegime },
    tickerRisk: { riskScore: 0.2 },
    runtimeGuards: { allowNewEntries: true, hardRiskBlocked: false, unloadMode: false },
  }, { enableDynamicPositionSizing: true });

  assert.ok(sizing.sizingReasonCodes.includes('capital_regime_tightening:DEFENSIVE'));
  assert.ok(sizing.sizeMultiplier < 1);
});

test('audit chain: HALT_NEW_ENTRIES блокирует новые входы, а lifecycle уже открытой позиции продолжает работать', () => {
  const risk = evaluatePortfolioRiskContour({
    context: { cycleId: 'audit-2', ticker: 'ETH-USDT', previousCapitalRegime: CAPITAL_REGIMES.NORMAL },
    stats: { dayPnlPercent: -8.2, usedMarginPercent: 25, balanceDrawdownPercent: 5, newEntriesToday: 1, openPositionsCount: 1 },
  }, makeRiskConfig());

  assert.equal(risk.balanceState.capitalRegime, CAPITAL_REGIMES.HALT_NEW_ENTRIES);
  assert.equal(risk.allowNewEntries, false);

  const finalDecision = evaluateFinalEntryDecision({
    componentScores: strongComponentScores(),
    capitalRegime: risk.balanceState.capitalRegime,
    balanceState: risk.balanceState,
  }, {});
  assert.equal(finalDecision.decisionMode, 'no_entry');
  assert.equal(finalDecision.vetoSummary.blocked, true);

  const sizing = evaluateDynamicPositionSizing({
    approvedEntryResult: {
      decisionMode: 'full_entry',
      entryScore: 0.9,
      confidence: 0.9,
      vetoSummary: { blocked: false },
    },
    decisionMode: 'full_entry',
    capitalRegime: risk.balanceState.capitalRegime,
    balanceState: risk.balanceState,
    tickerRisk: { riskScore: 0.1 },
    runtimeGuards: { allowNewEntries: risk.allowNewEntries, hardRiskBlocked: false, unloadMode: false },
  }, { enableDynamicPositionSizing: true });
  assert.equal(sizing.sizeMultiplier, 0);

  const lifecycle = evaluatePositionLifecycle({
    context: { cycleId: 'audit-2', ticker: 'ETH-USDT', capitalRegime: CAPITAL_REGIMES.HALT_NEW_ENTRIES },
    positionState: {
      symbolUnified: 'ETH-USDT',
      side: 'long',
      entryPrice: 100,
      markPrice: 104,
      contracts: 1,
      percentage: 4,
      unrealizedPnl: 2,
      isClosed: false,
    },
    lifecycleState: {
      stage: LIFECYCLE_STATES.INITIAL,
      partialCloseDone: false,
      breakevenMoved: false,
      trailingActive: false,
    },
    profitability: { unrealizedPnl: 2, unrealizedPnlPercent: 4 },
  }, normalizeLifecycleRules({
    enableAdvancedLifecycle: true,
    partialTakeProfitRules: { enabled: true, triggerProfitPercent: 1.5, closeShare: 0.3 },
    breakevenRules: { enabled: false },
    trailingRules: { enabled: false },
    capitalRegimeLifecycleModifiers: {
      enabled: true,
      HALT_NEW_ENTRIES: { preserveOpenLifecycle: true },
    },
  }));

  assert.equal(lifecycle.partialCloseIntent.shouldClosePartially, true);
  assert.ok(lifecycle.lifecycleReasonCodes.includes('capital_regime_halt_new_entries_preserves_open_lifecycle'));
});

test('audit chain: ML phase1 не может ослабить capitalRegime/hard-risk запрет', () => {
  const modifier = createMlPhase1DecisionModifier({ mode: 'confirm_only' });
  const output = modifier.evaluate({
    baseRuleDecision: {
      decisionMode: 'full_entry',
      vetoSummary: { blocked: false, finalVeto: null },
    },
    mlInferenceOutput: { mlScore: 0.99, mlConfidence: 0.99 },
    capitalRegime: CAPITAL_REGIMES.HALT_NEW_ENTRIES,
    balanceState: { capitalRegime: CAPITAL_REGIMES.HALT_NEW_ENTRIES },
    runtimeGuards: { hardRiskBlocked: true },
  });

  assert.equal(output.effectiveDecisionMode, 'no_entry');
  assert.equal(output.effectiveApproved, false);
  assert.equal(output.mlBlockedByCapitalRegime, true);
  assert.equal(output.mlBlockedByHardRisk, true);
});

test('audit chain: ML phase2 meta-controller + final entry не пропускают ослабление hard constraints', () => {
  const meta = createMlMetaController({ enabled: true });
  const metaOutput = meta.evaluate({
    context: { cycleId: 'audit-4', ticker: 'SOL-USDT' },
    decisionContext: { cycleId: 'audit-4', ticker: 'SOL-USDT' },
    finalEntryDecisionOutput: { decisionMode: 'no_entry', vetoSummary: { blocked: true } },
    dynamicPositionSizingOutput: { mode: 'dynamic_base_formula', sizeMultiplier: 0.2 },
    balanceState: { capitalRegime: CAPITAL_REGIMES.HALT_NEW_ENTRIES },
    capitalRegime: CAPITAL_REGIMES.HALT_NEW_ENTRIES,
    runtimeDataQualityState: 'ok',
    modelState: { available: true },
    metaSuggestions: {
      entryThresholdModifier: -0.05,
      fullEntryBoundaryModifier: -0.05,
      directCapitalRegimeOverride: true,
    },
  });

  assert.ok(metaOutput.blockedAdjustmentReasons.includes('forbidden_parameter_blocked:directCapitalRegimeOverride'));

  const finalDecision = evaluateFinalEntryDecision({
    componentScores: strongComponentScores(),
    capitalRegime: CAPITAL_REGIMES.HALT_NEW_ENTRIES,
    balanceState: { capitalRegime: CAPITAL_REGIMES.HALT_NEW_ENTRIES },
    mlMetaControllerOutput: metaOutput,
    metaSuggestions: {
      entryThresholdModifier: -0.05,
      fullEntryBoundaryModifier: -0.05,
    },
  }, {});

  assert.equal(finalDecision.decisionMode, 'no_entry');
  assert.equal(finalDecision.vetoSummary.blocked, true);
  assert.ok(finalDecision.explanation.metaRuntimeInfluence.events.some((evt) => evt.reasonCode === 'metaAdjustmentBlocked'));
});

test('audit chain: sizing не может ослабить risk contour даже с ML phase2 modifier', () => {
  const sizing = evaluateDynamicPositionSizing({
    approvedEntryResult: {
      decisionMode: 'full_entry',
      entryScore: 0.88,
      confidence: 0.85,
      vetoSummary: { blocked: false },
    },
    decisionMode: 'full_entry',
    capitalRegime: CAPITAL_REGIMES.HALT_NEW_ENTRIES,
    balanceState: { capitalRegime: CAPITAL_REGIMES.HALT_NEW_ENTRIES },
    tickerRisk: { riskScore: 0.1 },
    runtimeGuards: { allowNewEntries: false, hardRiskBlocked: true, unloadMode: false },
    mlMetaControllerOutput: {
      metaAdjustmentSet: { sizingAggressivenessModifier: 0.15 },
      allowedAdjustmentBounds: { sizingAggressivenessModifier: { min: -0.15, max: 0.15 } },
      metaControllerFallbackState: 'none',
    },
  }, {
    enableDynamicPositionSizing: true,
    mlCompatibilityHooks: {
      phase2BoundedAdjustmentHookEnabled: true,
      phase2BoundedAdjustmentLimits: { multiplierDeltaAbsMax: 0.15, leverageCapDeltaAbsMax: 1 },
    },
  });

  assert.equal(sizing.sizeMultiplier, 0);
  assert.equal(sizing.leverageCap, 0);
  assert.ok(sizing.sizingReasonCodes.includes('hard_risk_or_capital_guard_active'));
  assert.ok(sizing.explanation.structured.metaRuntimeInfluence.events.some((evt) => evt.reasonCode === 'metaAdjustmentBlocked'));
});

test('audit chain: compatibility с forecast restrictions сохраняет hard-veto выше ML/meta', () => {
  const finalDecision = evaluateFinalEntryDecision({
    componentScores: strongComponentScores(),
    capitalRegime: CAPITAL_REGIMES.NORMAL,
    balanceState: { capitalRegime: CAPITAL_REGIMES.NORMAL },
    portfolioForecast: {
      enabled: true,
      confidence: 0.9,
      restrictionHints: ['restrict_new_entries_hard_candidate'],
    },
    mlHooks: {
      enabled: true,
      scoreDelta: 0.5,
      confidence: 1,
    },
    mlMetaControllerOutput: {
      metaAdjustmentSet: {
        entryThresholdModifier: -0.05,
        weakEntryBoundaryModifier: -0.05,
        fullEntryBoundaryModifier: -0.05,
      },
      allowedAdjustmentBounds: {
        entryThresholdModifier: { min: -0.05, max: 0.05 },
        weakEntryBoundaryModifier: { min: -0.05, max: 0.05 },
        fullEntryBoundaryModifier: { min: -0.05, max: 0.05 },
      },
      metaControllerFallbackState: 'none',
    },
    metaSuggestions: {
      entryThresholdModifier: -0.05,
      weakEntryBoundaryModifier: -0.05,
      fullEntryBoundaryModifier: -0.05,
    },
  }, {
    vetoRules: {
      interpretForecastRestrictionHints: true,
      forecastHardHints: ['restrict_new_entries_hard_candidate'],
    },
  });

  assert.equal(finalDecision.vetoSummary.blocked, true);
  assert.equal(finalDecision.vetoSummary.finalVeto.type, 'forecast_restriction_veto');
  assert.equal(finalDecision.decisionMode, 'no_entry');
  assert.ok(finalDecision.explanation.metaRuntimeInfluence.events.some((evt) => evt.reasonCode === 'metaAdjustmentBlocked'));
});
