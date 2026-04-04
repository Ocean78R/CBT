const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateFinalEntryDecision,
  normalizeFinalEntryDecisionConfig,
  toFinalEntryDecisionEvent,
} = require('../../dist/runtime/engines/finalEntryDecisionEngine');

test('finalEntryDecisionEngine: принимает контракт componentScores/veto/dataQuality/capital', () => {
  const config = normalizeFinalEntryDecisionConfig({ enabled: true });
  const output = evaluateFinalEntryDecision({
    context: { cycleId: 'cycle-35-1', ticker: 'BTC-USDT' },
    componentScores: {
      entryPermission: { score: 0.9, confidence: 0.8, weight: 0.3, dataQualityState: 'ok' },
      marketContext: { score: 0.7, confidence: 0.7, weight: 0.3, dataQualityState: 'ok' },
      primarySignal: { score: 0.8, confidence: 0.7, weight: 0.4, dataQualityState: 'ok' },
    },
    vetoCandidates: [{ type: 'soft_alert', severity: 'soft', reason: 'none', source: 'block' }],
    dataQualityState: 'ok',
    capitalRegime: 'NORMAL',
    balanceState: { capitalRegime: 'NORMAL' },
    metadata: { source: 'decisionContext.sharedBlockOutputs.v1' },
  }, config);

  assert.equal(typeof output.entryScore, 'number');
  assert.equal(output.decisionMode, 'full_entry');
  assert.equal(output.vetoSummary.blocked, false);
  assert.equal(output.dataQualityState, 'ok');
  assert.equal(output.capitalRegimeImpact.capitalRegime, 'NORMAL');
  assert.equal(output.mandatoryBlocksSatisfied, true);
  assert.equal(output.explanation.ownership.isSignalRecalculationOwner, false);
});

test('finalEntryDecisionEngine: all minimum blocks passed -> full entry', () => {
  const output = evaluateFinalEntryDecision({
    componentScores: {
      entryPermission: { score: 0.7, confidence: 0.8, weight: 1, dataQualityState: 'ok' },
      marketContext: { score: 0.72, confidence: 0.7, weight: 1, dataQualityState: 'ok' },
      primarySignal: { score: 0.74, confidence: 0.9, weight: 1, dataQualityState: 'ok' },
    },
    vetoCandidates: [],
    balanceState: { capitalRegime: 'NORMAL' },
  }, {
    thresholds: { fullEntryScore: 0.69, weakEntryScore: 0.5 },
    minimumRequiredScorePerBlock: {
      entryPermission: 0.6,
      marketContext: 0.6,
      primarySignal: 0.6,
    },
  });

  assert.equal(output.decisionMode, 'full_entry');
  assert.equal(output.mandatoryBlocksSatisfied, true);
  assert.deepEqual(output.failedMinimumScoreBlocks, []);
  assert.deepEqual(output.unmetMinimumBlocks, []);
});

test('finalEntryDecisionEngine: weak entry branch', () => {
  const output = evaluateFinalEntryDecision({
    componentScores: {
      entryPermission: { score: 0.6, confidence: 0.7, weight: 1, dataQualityState: 'ok' },
      marketContext: { score: 0.58, confidence: 0.6, weight: 1, dataQualityState: 'ok' },
      primarySignal: { score: 0.62, confidence: 0.65, weight: 1, dataQualityState: 'ok' },
    },
    vetoCandidates: [],
    balanceState: { capitalRegime: 'NORMAL' },
  }, {
    entryScoreThreshold: 0.72,
    weakEntryThreshold: 0.56,
    allowWeakEntryMode: true,
    minimumRequiredScorePerBlock: {
      entryPermission: 0.55,
      marketContext: 0.55,
      primarySignal: 0.55,
    },
  });

  assert.equal(output.decisionMode, 'weak_entry');
  assert.equal(output.vetoSummary.blocked, false);
  assert.equal(output.thresholdsApplied.weakEntryAllowed, true);
});

test('finalEntryDecisionEngine: full structured output + event для audit/analytics', () => {
  const output = evaluateFinalEntryDecision({
    context: { cycleId: 'cycle-35-evt', ticker: 'BTC-USDT', exchange: 'binance', mode: 'paper' },
    componentScores: {
      entryPermission: { score: 0.79, confidence: 0.7, weight: 1, dataQualityState: 'ok' },
      marketContext: { score: 0.74, confidence: 0.7, weight: 1, dataQualityState: 'ok' },
      primarySignal: { score: 0.75, confidence: 0.7, weight: 1, dataQualityState: 'ok' },
    },
    vetoCandidates: [],
    balanceState: { capitalRegime: 'NORMAL' },
  }, {});

  const event = toFinalEntryDecisionEvent({
    context: { cycleId: 'cycle-35-evt', ticker: 'BTC-USDT', exchange: 'binance', mode: 'paper' },
    decision: output,
  });

  assert.ok(output.componentScores.entryPermission);
  assert.ok(Array.isArray(output.unmetMinimumBlocks));
  assert.ok(output.vetoSummary && typeof output.vetoSummary === 'object');
  assert.ok(Array.isArray(output.appliedPenalties));
  assert.ok(output.capitalRegimeImpact && typeof output.capitalRegimeImpact === 'object');
  assert.equal(event.eventType, 'final_entry_decision');
  assert.equal(event.mode, 'paper');
  assert.ok(event.payload.componentScores.primarySignal);
  assert.ok(Array.isArray(event.payload.reasonCodes));
});

test('finalEntryDecisionEngine: не пересчитывает сигналы и не трогает market-data owner', () => {
  let recomputeCalls = 0;
  const output = evaluateFinalEntryDecision({
    componentScores: {
      entryPermission: { score: 0.5, confidence: 0.6, weight: 1, dataQualityState: 'ok', sourceMeta: { recalculated: false } },
      marketContext: { score: 0.5, confidence: 0.6, weight: 1, dataQualityState: 'ok', sourceMeta: { recalculated: false } },
      primarySignal: { score: 0.5, confidence: 0.6, weight: 1, dataQualityState: 'ok', sourceMeta: { recalculated: false } },
    },
    // Русский комментарий: проверяем, что ad-hoc callback не используется этим модулем.
    recalculateSignals: () => {
      recomputeCalls += 1;
      return { score: 1 };
    },
  }, {}, {
    log: () => {},
  });

  assert.equal(recomputeCalls, 0);
  assert.equal(output.explanation.ownership.isSignalRecalculationOwner, false);
  assert.equal(output.explanation.ownership.isMarketDataOwner, false);
});

test('finalEntryDecisionEngine: fallback при missing/degraded block outputs и hard capital veto', () => {
  const output = evaluateFinalEntryDecision({
    context: { cycleId: 'cycle-35-4', ticker: 'ETH-USDT' },
    componentScores: {
      entryPermission: { score: 0.9, confidence: 0.8, weight: 1, dataQualityState: 'degraded' },
    },
    vetoCandidates: [{ type: 'risk_unload', severity: 'hard', reason: 'risk controller unload', source: 'risk.layer' }],
    balanceState: { capitalRegime: 'HALT_NEW_ENTRIES', unloadMode: true },
    dataQualityState: 'degraded',
    metadata: { source: 'shared_cache' },
  }, {
    minimumRequiredBlocks: ['entryPermission', 'marketContext', 'primarySignal'],
  });

  assert.equal(output.decisionMode, 'no_entry');
  assert.equal(output.vetoSummary.blocked, true);
  assert.equal(output.vetoSummary.finalVeto.type, 'risk_unload');
  assert.deepEqual(output.unmetMinimumBlocks.sort(), ['marketContext', 'primarySignal'].sort());
  assert.ok(output.appliedPenalties.some((p) => p.type === 'missing_block_output'));
});

test('finalEntryDecisionEngine: hard veto branch', () => {
  const output = evaluateFinalEntryDecision({
    componentScores: {
      entryPermission: { score: 0.99, confidence: 0.8, weight: 1, dataQualityState: 'ok' },
      marketContext: { score: 0.99, confidence: 0.8, weight: 1, dataQualityState: 'ok' },
      primarySignal: { score: 0.99, confidence: 0.8, weight: 1, dataQualityState: 'ok' },
    },
    vetoCandidates: [{ type: 'event_risk_freeze', severity: 'hard', reason: 'macro_event_window', source: 'eventRiskLayer' }],
  }, {});

  assert.equal(output.decisionMode, 'no_entry');
  assert.equal(output.vetoSummary.blocked, true);
  assert.equal(output.vetoSummary.finalVeto.type, 'event_risk_freeze');
});

test('finalEntryDecisionEngine: capitalRegime tightening branch', () => {
  const output = evaluateFinalEntryDecision({
    componentScores: {
      entryPermission: { score: 0.61, confidence: 0.7, weight: 1, dataQualityState: 'ok' },
      marketContext: { score: 0.62, confidence: 0.7, weight: 1, dataQualityState: 'ok' },
      primarySignal: { score: 0.63, confidence: 0.7, weight: 1, dataQualityState: 'ok' },
    },
    capitalRegime: 'CONSERVE_CAPITAL',
    balanceState: { capitalRegime: 'CONSERVE_CAPITAL' },
  }, {
    entryScoreThreshold: 0.6,
    weakEntryThreshold: 0.55,
    allowWeakEntryMode: true,
    minimumRequiredScorePerBlock: {
      entryPermission: 0.6,
      marketContext: 0.6,
      primarySignal: 0.6,
    },
  });

  assert.equal(output.decisionMode, 'no_entry');
  assert.equal(output.thresholdsApplied.weakEntryAllowed, false);
  assert.ok(output.explanation.reasonCodes.includes('capital_regime_tightening:CONSERVE_CAPITAL'));
});

test('finalEntryDecisionEngine: degraded block outputs branch', () => {
  const output = evaluateFinalEntryDecision({
    componentScores: {
      entryPermission: { score: 0.8, confidence: 0.7, weight: 1, dataQualityState: 'degraded' },
      marketContext: { score: 0.79, confidence: 0.7, weight: 1, dataQualityState: 'cached' },
      primarySignal: { score: 0.81, confidence: 0.7, weight: 1, dataQualityState: 'ok' },
    },
    vetoCandidates: [],
  }, {
    thresholds: { fullEntryScore: 0.72, weakEntryScore: 0.65 },
    fallback: { degradedPenalty: 0.1 },
  });

  assert.equal(output.decisionMode, 'no_entry');
  assert.ok(output.appliedPenalties.some((item) => item.type === 'degraded_or_cached_block_output'));
  assert.ok(output.explanation.reasonCodes.includes('degraded_or_cached_input_blocks'));
});

test('finalEntryDecisionEngine: forecast hook branch — интерпретация restriction hints только здесь', () => {
  const output = evaluateFinalEntryDecision({
    componentScores: {
      entryPermission: { score: 0.91, confidence: 0.85, weight: 1, dataQualityState: 'ok' },
      marketContext: { score: 0.88, confidence: 0.82, weight: 1, dataQualityState: 'ok' },
      primarySignal: { score: 0.9, confidence: 0.84, weight: 1, dataQualityState: 'ok' },
    },
    portfolioForecast: {
      enabled: true,
      confidence: 0.91,
      restrictionHints: ['restrict_new_entries_hard_candidate'],
    },
  }, {
    vetoRules: {
      interpretForecastRestrictionHints: true,
      forecastHardHints: ['restrict_new_entries_hard_candidate'],
    },
  });

  assert.equal(output.decisionMode, 'no_entry');
  assert.equal(output.vetoSummary.blocked, true);
  assert.equal(output.vetoSummary.finalVeto.type, 'forecast_restriction_veto');
  assert.equal(output.forecastHook.interpretedInFinalEntryDecision, true);
});

test('finalEntryDecisionEngine: ML hook compatibility branch без перехвата ownership', () => {
  const output = evaluateFinalEntryDecision({
    componentScores: {
      entryPermission: { score: 0.67, confidence: 0.71, weight: 1, dataQualityState: 'ok' },
      marketContext: { score: 0.66, confidence: 0.68, weight: 1, dataQualityState: 'ok' },
      primarySignal: { score: 0.69, confidence: 0.72, weight: 1, dataQualityState: 'ok' },
    },
    mlHooks: {
      enabled: true,
      confidence: 0.6,
      scoreDelta: -0.03,
      advisoryPenalty: 0.02,
      direction: 'neutral',
    },
  }, {
    entryScoreThreshold: 0.69,
    weakEntryThreshold: 0.5,
  });

  assert.equal(output.mlHook.advisoryOnly, true);
  assert.equal(output.explanation.ownership.isFinalVetoOwnerForNewEntries, true);
  assert.ok(output.explanation.reasonCodes.includes('ml_hook_applied_as_advisory_only'));
});

test('finalEntryDecisionEngine: paper/live compatibility на decision layer', () => {
  const baseInput = {
    componentScores: {
      entryPermission: { score: 0.73, confidence: 0.73, weight: 1, dataQualityState: 'ok' },
      marketContext: { score: 0.74, confidence: 0.73, weight: 1, dataQualityState: 'ok' },
      primarySignal: { score: 0.75, confidence: 0.73, weight: 1, dataQualityState: 'ok' },
    },
    balanceState: { capitalRegime: 'NORMAL' },
  };
  const live = evaluateFinalEntryDecision({
    ...baseInput,
    context: { mode: 'live' },
  }, {});
  const paper = evaluateFinalEntryDecision({
    ...baseInput,
    context: { mode: 'paper' },
  }, {});

  assert.equal(live.decisionMode, paper.decisionMode);
  assert.equal(live.entryScore, paper.entryScore);
});

test('finalEntryDecisionEngine: logging completeness без повторного пересчёта block outputs', () => {
  const logs = [];
  evaluateFinalEntryDecision({
    context: { cycleId: 'cycle-35-log', ticker: 'SOL-USDT' },
    componentScores: {
      entryPermission: { score: 0.6, confidence: 0.61, weight: 1, dataQualityState: 'ok' },
      marketContext: { score: 0.61, confidence: 0.61, weight: 1, dataQualityState: 'ok' },
      primarySignal: { score: 0.62, confidence: 0.61, weight: 1, dataQualityState: 'ok' },
    },
  }, {}, {
    log: (line) => logs.push(line),
  });

  assert.equal(logs.length >= 2, true);
  assert.equal(logs.some((line) => line.includes('mode=')), true);
  assert.equal(logs.some((line) => line.includes('componentScores=')), true);
  assert.equal(logs.some((line) => line.includes('capitalImpact=')), true);
});
