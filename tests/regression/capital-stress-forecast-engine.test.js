const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateCapitalStressForecast,
  toCapitalStressForecastEvent,
} = require('../../dist/runtime/risk/capitalStressForecastEngine');

function makeConfig(overrides = {}) {
  const base = {
    enabled: true,
    minConfidenceForSignals: 0.45,
    scenarioWeights: { baseline: 0.4, adverse: 0.4, severe: 0.2 },
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
      hardRestrictionScenario: 'severe_drawdown_spike',
    },
    protectiveTightening: {
      enabled: true,
      triggerFromFragility: 0.6,
      triggerFromRegimeProbability: 0.45,
      forcedLossExitHintMode: 'tighten',
    },
    sizingHints: {
      enabled: true,
      normalMultiplier: 1,
      elevatedMultiplier: 0.85,
      highMultiplier: 0.65,
      criticalMultiplier: 0.4,
    },
  };

  return {
    ...base,
    ...overrides,
    scenarioWeights: { ...base.scenarioWeights, ...(overrides.scenarioWeights || {}) },
    thresholds: { ...base.thresholds, ...(overrides.thresholds || {}) },
    restrictions: { ...base.restrictions, ...(overrides.restrictions || {}) },
    protectiveTightening: { ...base.protectiveTightening, ...(overrides.protectiveTightening || {}) },
    sizingHints: { ...base.sizingHints, ...(overrides.sizingHints || {}) },
  };
}

test('capitalStressForecastEngine формирует сценарии и forecast hints без прямого управления позициями', () => {
  const decision = evaluateCapitalStressForecast({
    context: { cycleId: 'c-forecast-1', capitalRegime: 'DEFENSIVE' },
    stats: {
      usedMarginPercent: 74,
      freeBalance: 230,
      totalEquity: 1000,
      dayPnlPercent: -3.4,
      balanceDrawdownPercent: 12,
      openPositionsCount: 5,
    },
  }, makeConfig());

  assert.equal(decision.enabled, true);
  assert.equal(decision.layerName, 'capitalStressForecastEngine');
  assert.ok(decision.scenarios.baseline_stabilization);
  assert.ok(decision.scenarios.adverse_margin_expansion);
  assert.ok(decision.scenarios.severe_drawdown_spike);
  assert.ok(decision.outputHints.restrictionHints.length >= 1);
  assert.ok(Array.isArray(decision.outputHints.protectiveTighteningHints));
  assert.ok(Number.isFinite(decision.outputHints.sizingHints.multiplier));
  assert.equal(decision.direction === 'risk_off' || decision.direction === 'neutral', true);
});

test('capitalStressForecastEngine при недостатке данных возвращает degraded/insufficient без ложной уверенности', () => {
  const decision = evaluateCapitalStressForecast({
    context: { cycleId: 'c-forecast-2', capitalRegime: 'NORMAL' },
    stats: {
      usedMarginPercent: 18,
      dayPnlPercent: -0.2,
    },
  }, makeConfig());

  assert.equal(decision.confidence <= 0.55, true);
  assert.equal(decision.dataQualityState === 'degraded' || decision.dataQualityState === 'insufficient', true);
});

test('capitalStressForecastEngine event содержит audit-поля и разделяет current-state и forecast-state', () => {
  const decision = evaluateCapitalStressForecast({
    context: { cycleId: 'c-forecast-3', capitalRegime: 'CAUTION', marketRegime: 'range' },
    stats: {
      usedMarginPercent: 52,
      freeBalance: 450,
      totalEquity: 1000,
      dayPnlPercent: -1.6,
      balanceDrawdownPercent: 7,
      openPositionsCount: 3,
    },
  }, makeConfig());

  const event = toCapitalStressForecastEvent({
    context: { cycleId: 'c-forecast-3', ticker: 'BTC-USDT', exchange: 'bingx', marketRegime: 'range', capitalRegime: 'CAUTION' },
    decision,
  });

  assert.equal(event.eventType, 'portfolio_capital_stress_forecast');
  assert.equal(event.module, 'capitalStressForecastEngine');
  assert.equal(event.layer, 'risk.portfolioForecast');
  assert.equal(event.capitalRegime, 'CAUTION');
  assert.ok('score' in event);
  assert.ok('confidence' in event);
});
