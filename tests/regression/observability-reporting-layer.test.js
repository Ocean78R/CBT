const test = require('node:test');
const assert = require('node:assert/strict');

const { createObservabilityLayer, EVENT_CATEGORIES } = require('../../dist/runtime/observability/reportingLayer');

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
