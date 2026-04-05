const test = require('node:test');
const assert = require('node:assert/strict');

const { createObservabilityLayer, EVENT_CATEGORIES } = require('../../dist/runtime/observability/reportingLayer');
const { evaluateForcedLossExit, toForcedLossExitEvent } = require('../../dist/runtime/risk/forcedLossExit');
const { toMlPhase1DecisionEvent } = require('../../dist/runtime/ml/mlPhase1DecisionModifier');

test('observability слой агрегирует отчёты по циклу/тикеру/дню и причинам veto', () => {
  const layer = createObservabilityLayer({
    enabled: true,
    sampling: { decisionEventsRate: 1, diagnosticEventsRate: 1, alwaysKeepCritical: true },
    storage: { enabled: false },
  });

  layer.ingestEvent({
    eventType: 'portfolio_risk_contour_decision',
    cycleId: 'c-1',
    ticker: 'BTC-USDT',
    exchange: 'bingx',
    module: 'portfolioRiskContour',
    layer: 'risk.portfolioContour',
    finalDecision: 'block',
    vetoReason: 'daily_loss_limit',
    executionAction: 'block_new_entries',
    payload: {
      balanceState: { capitalRegime: 'DEFENSIVE', regimeChanged: true },
      telemetry: { forecast: { reasonCodes: ['forecast_fragility_high'], outputHints: { sizingHints: { multiplier: 0.65 } } } },
    },
  });

  const reports = layer.getReports();
  assert.equal(reports.byCycle['c-1'].totalEvents, 1);
  assert.equal(reports.byTicker['BTC-USDT'].totalEvents, 1);
  assert.equal(reports.vetoReasons.daily_loss_limit, 1);
  assert.equal(reports.regimeChanges.DEFENSIVE, 1);
});

test('audit trail восстанавливает цепочку capital -> forecast -> veto -> sizing -> execution -> lifecycle', () => {
  const layer = createObservabilityLayer({
    enabled: true,
    sampling: { decisionEventsRate: 1, diagnosticEventsRate: 1, alwaysKeepCritical: true },
    storage: { enabled: false },
  });

  const payload = {
    balanceState: { capitalRegime: 'CAPITAL_PRESERVATION', regimeChanged: true, forecastRegimeShiftRisk: 'high' },
    telemetry: {
      forecast: {
        reasonCodes: ['forecast_regime_deterioration_elevated'],
        outputHints: {
          restrictionHints: ['restrict_new_entries_soft'],
          protectiveTighteningHints: ['forced_loss_exit:tighten'],
          sizingHints: { multiplier: 0.65, reason: 'forecast_high_fragility' },
        },
      },
      downstreamContext: {
        universeFilter: { capitalRegime: 'CAPITAL_PRESERVATION' },
        marketRegimeRouter: { marketRegime: 'range' },
        confluenceEntry: { forecastRegimeShiftRisk: 'high' },
        dynamicPositionSizing: { sizingMultiplier: 0.65, forecastSignals: ['forecast_stress'] },
      },
    },
  };

  layer.ingestEvent({
    eventType: 'portfolio_risk_contour_decision',
    cycleId: 'c-2',
    ticker: 'ETH-USDT',
    module: 'portfolioRiskContour',
    layer: 'risk.portfolioContour',
    finalDecision: 'block',
    vetoReason: 'capital_prohibition',
    payload,
  });
  layer.ingestEvent({
    eventType: 'execution_event',
    cycleId: 'c-2',
    ticker: 'ETH-USDT',
    module: 'executionManager',
    layer: 'execution.orders',
    finalDecision: 'force_close',
    executionAction: 'position_force_close_request',
  });

  const trails = layer.getAuditTrail({ cycleId: 'c-2', ticker: 'ETH-USDT' });
  assert.equal(trails.length, 1);
  assert.equal(trails[0].requiredPath.capital.capitalRegime, 'CAPITAL_PRESERVATION');
  assert.equal(trails[0].requiredPath.forecast.forecastRegimeShiftRisk, 'high');
  assert.equal(trails[0].requiredPath.veto.reason, 'capital_prohibition');
  assert.equal(trails[0].requiredPath.sizing.sizingMultiplier, 0.65);
  assert.equal(trails[0].requiredPath.execution.action, 'position_force_close_request');
});

test('critical execution/protective события не теряются при sampling decision событий', () => {
  const layer = createObservabilityLayer({
    enabled: true,
    sampling: { decisionEventsRate: 0, diagnosticEventsRate: 0, alwaysKeepCritical: true },
    storage: { enabled: false },
  });

  const decision = layer.ingestEvent({
    eventType: 'decision_event',
    cycleId: 'c-3',
    ticker: 'SOL-USDT',
    module: 'entryDecision',
    layer: 'decision.entry',
    finalDecision: 'weak_entry',
  });
  const protective = layer.ingestEvent({
    eventType: 'forced_loss_exit_decision',
    cycleId: 'c-3',
    ticker: 'SOL-USDT',
    module: 'forcedLossExit',
    layer: 'risk.positionProtection',
    finalDecision: 'force_close',
  });

  assert.equal(decision.accepted, false);
  assert.equal(protective.accepted, true);
  assert.equal(protective.category, EVENT_CATEGORIES.PROTECTIVE);
});

test('observability слой ведёт performance-метрики и делит события по частям pipeline', () => {
  let ts = 1000;
  const layer = createObservabilityLayer({
    enabled: true,
    sampling: { decisionEventsRate: 1, diagnosticEventsRate: 1, alwaysKeepCritical: true },
    storage: { enabled: false },
  }, {
    now: () => {
      ts += 5;
      return ts;
    },
  });

  const result = layer.ingestEvent({
    eventType: 'execution_event',
    cycleId: 'c-4',
    ticker: 'ADA-USDT',
    module: 'executionManager',
    layer: 'execution.orders',
    finalDecision: 'allow',
    executionAction: 'open_position',
  });
  assert.equal(result.pipelinePart, 'executionProtection');

  const reports = layer.getReports();
  assert.equal(reports.performance.ingestEvents.calls, 1);
  assert.equal(reports.performance.byPipelinePart.executionProtection.events, 1);
  assert.equal(reports.performance.analytics.getReportsCalls >= 1, true);

  const trails = layer.getAuditTrail({ cycleId: 'c-4' });
  assert.equal(Array.isArray(trails), true);
  const reportsAfterAudit = layer.getReports();
  assert.equal(reportsAfterAudit.performance.analytics.getAuditTrailCalls >= 1, true);
});

test('duplicateClosePrevented и protectiveActionToken попадают в structured report/audit и reconciliation trace', () => {
  const layer = createObservabilityLayer({
    enabled: true,
    sampling: { decisionEventsRate: 1, diagnosticEventsRate: 1, alwaysKeepCritical: true },
    storage: { enabled: false },
  });

  const decision = evaluateForcedLossExit({
    context: {
      cycleId: 'c-protective-1',
      ticker: 'BTC-USDT',
      exchange: 'bingx',
      mode: 'live',
      capitalRegime: 'NORMAL',
      marketRegime: 'trend',
      setupType: 'momentum',
      positionCapabilityState: 'LEVERAGE_MISMATCH_POSITION',
      protectiveCloseSource: 'lifecycle_close',
      protectiveActionState: {
        owner: 'execution_lifecycle_manager',
        token: 'restart-token-42',
        closeInitiated: true,
        status: 'initiated',
      },
    },
    position: {
      side: 'LONG',
      minutesSinceEntry: 18,
      entryDeviationPercent: -1.5,
      timeUnderEntryWithoutRecoveryMinutes: 14,
      adverseTrendBars: 4,
      adverseTrendSlope: 0.08,
      adverseMarketConfirmed: true,
      holdMinutesInLoss: 23,
      pnlPercent: -1.5,
    },
  }, {
    enabled: true,
    actionMode: 'warn',
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

  const protectiveEvent = toForcedLossExitEvent({
    context: {
      cycleId: 'c-protective-1',
      ticker: 'BTC-USDT',
      exchange: 'bingx',
      mode: 'live',
      capitalRegime: 'NORMAL',
      marketRegime: 'trend',
      setupType: 'momentum',
      positionCapabilityState: 'LEVERAGE_MISMATCH_POSITION',
    },
    decision,
  });
  layer.ingestEvent(protectiveEvent);

  layer.ingestEvent({
    eventType: 'execution_reconciliation',
    cycleId: 'c-protective-1',
    ticker: 'BTC-USDT',
    module: 'execution_contour',
    layer: 'reconciliation',
    finalDecision: 'accepted',
    executionAction: 'cleanup_reconciliation',
    protectiveActionToken: 'restart-token-42',
    positionCapabilityState: 'LEVERAGE_MISMATCH_POSITION',
    payload: {
      protectiveActionToken: 'restart-token-42',
      positionCapabilityState: 'LEVERAGE_MISMATCH_POSITION',
    },
  });

  const reports = layer.getReports();
  assert.equal(reports.protectiveDiagnostics.duplicateClosePrevented, 1);
  assert.equal(reports.protectiveDiagnostics.byOwner.execution_lifecycle_manager, 1);
  assert.equal(reports.protectiveDiagnostics.byCloseSource.lifecycle_close, 1);

  const trails = layer.getAuditTrail({ cycleId: 'c-protective-1', ticker: 'BTC-USDT' });
  assert.equal(trails.length, 1);
  assert.equal(trails[0].stagePath.lifecycle.duplicateClosePrevented, true);
  assert.equal(trails[0].stagePath.lifecycle.protectiveActionToken, 'restart-token-42');
  assert.equal(trails[0].stagePath.lifecycle.protectiveActionOwner, 'execution_lifecycle_manager');
  assert.equal(trails[0].stagePath.reconciliation.protectiveActionToken, 'restart-token-42');
  assert.equal(trails[0].stagePath.reconciliation.positionCapabilityState, 'LEVERAGE_MISMATCH_POSITION');
});

test('audit trail хранит ML phase1 цепочку rule decision -> ml output -> ml effect -> sizing hook', () => {
  const layer = createObservabilityLayer({
    enabled: true,
    sampling: { decisionEventsRate: 1, diagnosticEventsRate: 1, alwaysKeepCritical: true },
    storage: { enabled: false },
  });

  const mlEvent = toMlPhase1DecisionEvent({
    context: { cycleId: 'c-ml-audit-1', ticker: 'SOL-USDT', mode: 'live', capitalRegime: 'NORMAL' },
    decision: {
      baseRuleDecision: 'weak_entry',
      effectiveDecisionMode: 'weak_entry',
      effectiveApproved: true,
      mlMode: 'confidence_sizing',
      mlScore: 0.74,
      mlConfidence: 0.79,
      mlDecisionEffect: 'sizing_hint_only',
      capitalRegimeImpact: 'no_block',
      forecastImpact: 'no_block',
      fallbackWithoutModelState: 'enabled',
      confidenceSizingHookApplied: true,
      sizingHook: { enabled: true, aggressivenessMultiplier: 0.93, owner: 'ml_phase1_hint_only' },
      ownership: {
        isFinalVetoOwnerForNewEntries: false,
        baselineDecisionOwner: 'finalEntryDecisionEngine',
        isExecutionOwner: false,
        isSizingOwner: false,
      },
      telemetry: {
        featureComputation: {
          recomputedHeavyFeatures: false,
        },
      },
    },
    mlInferenceOutput: {
      mlFallbackState: 'none',
      mlDataQualityState: 'ok',
      mlReasonCodes: ['ml_phase1_inference_layer'],
      metadata: {
        ownership: { recalculatesHeavyFeatures: false },
      },
    },
  });

  layer.ingestEvent(mlEvent);

  const trails = layer.getAuditTrail({ cycleId: 'c-ml-audit-1', ticker: 'SOL-USDT' });
  assert.equal(trails.length, 1);
  const mlStage = trails[0].stagePath.veto.mlPhase1Decision;
  assert.equal(mlStage.baseRuleDecision, 'weak_entry');
  assert.equal(mlStage.mlDecisionEffect, 'sizing_hint_only');
  assert.equal(mlStage.mlInferenceFallbackState, 'none');
  assert.equal(mlStage.featureComputation.recomputedHeavyFeatures, false);
  assert.equal(trails[0].stagePath.sizing.confidenceSizingHookApplied, true);
  assert.equal(trails[0].stagePath.sizing.mlPhase1SizingHook.owner, 'ml_phase1_hint_only');
});
