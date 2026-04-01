const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createUnifiedObservabilityLayer,
  EVENT_CLASS,
} = require('../../dist/runtime/observability/unifiedObservability');

test('unifiedObservabilityLayer строит отчёты по циклам/тикерам/решениям и категориям forecast', () => {
  const layer = createUnifiedObservabilityLayer({
    enabled: true,
    flushBatchSize: 2,
    maxBufferSize: 100,
    sampling: {
      decisionEventsRate: 1,
      diagnosticEventsRate: 1,
      mlEventsRate: 1,
    },
  });

  layer.captureStructuredEvent({
    eventType: 'portfolio_risk_contour_decision',
    cycleId: 'cycle-1',
    ticker: 'BTC-USDT',
    module: 'portfolioRiskContour',
    layer: 'risk.portfolioContour',
    capitalRegime: 'DEFENSIVE',
    finalDecision: 'block',
    vetoReason: 'daily_loss_limit',
    payload: {
      balanceState: {
        regimeChanged: true,
        previousCapitalRegime: 'CAUTION',
      },
    },
  });

  layer.captureStructuredEvent({
    eventType: 'portfolio_capital_stress_forecast',
    cycleId: 'cycle-1',
    ticker: 'BTC-USDT',
    module: 'capitalStressForecastEngine',
    layer: 'risk.portfolioForecast',
    finalDecision: 'risk_off',
    payload: {
      forecastRegimeShiftRisk: 'high',
      reasonCodes: ['forecast_fragility_high'],
      outputHints: {
        restrictionHints: ['restrict_new_entries_high_fragility'],
        protectiveTighteningHints: ['forced_loss_exit:tighten'],
        sizingHints: { multiplier: 0.65, reason: 'forecast_high' },
      },
    },
  });

  const reports = layer.getReports();

  assert.equal(reports.totals.decision_events >= 1, true);
  assert.equal(reports.totals.forecast_events >= 1, true);
  assert.equal(reports.byCycle['cycle-1'].eventsTotal >= 2, true);
  assert.equal(reports.byTicker['BTC-USDT'].eventsTotal >= 2, true);
  assert.equal(reports.byDecisionType.block >= 1, true);
  assert.equal(reports.refusalReasons.daily_loss_limit >= 1, true);
  assert.equal(reports.forecast_events.length >= 1, true);
  assert.equal(reports.forecast_restrictions.length >= 1, true);
  assert.equal(reports.forecast_protective_hints.length >= 1, true);

  const trail = reports.auditTrail['cycle-1:BTC-USDT'];
  assert.ok(trail);
  assert.equal(Array.isArray(trail.orderedStages), true);
  assert.equal(trail.chain.capital_state.capitalRegime, 'DEFENSIVE');
  assert.equal(trail.chain.forecast_stress.risk, 'high');
});

test('unifiedObservabilityLayer принимает DecisionContext/score/veto/execution контракты', () => {
  const layer = createUnifiedObservabilityLayer({
    enabled: true,
    sampling: { decisionEventsRate: 1, diagnosticEventsRate: 1, mlEventsRate: 1 },
  });

  layer.captureDecisionSnapshot({
    context: {
      cycleId: 'cycle-2',
      ticker: 'ETH-USDT',
      exchange: 'bingx',
      regime: 'trend_up',
      capitalRegime: 'NORMAL',
      score: 0.71,
      confidence: 0.84,
      veto: null,
    },
    decision: {
      finalDecision: 'FULL_ENTRY',
      sizingDecision: 'dynamic_size_approved',
      executionAction: 'open_new_position',
      execution: { path: 'execution_lifecycle_manager' },
    },
  });

  const reports = layer.getReports();
  assert.equal(reports.totals[EVENT_CLASS.DECISION] >= 1, true);
  assert.equal(reports.byDecisionType.FULL_ENTRY >= 1, true);
  assert.equal(reports.byTicker['ETH-USDT'].eventsTotal >= 1, true);
});
