const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateFinalEntryDecision,
  normalizeFinalEntryDecisionConfig,
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
  assert.equal(output.explanation.ownership.isSignalRecalculationOwner, false);
});

test('finalEntryDecisionEngine: возвращает структурированный выходной контракт', () => {
  const output = evaluateFinalEntryDecision({
    componentScores: {
      entryPermission: { score: 0.4, confidence: 0.5, weight: 1, dataQualityState: 'ok' },
      marketContext: { score: 0.42, confidence: 0.4, weight: 1, dataQualityState: 'cached' },
      primarySignal: { score: 0.45, confidence: 0.6, weight: 1, dataQualityState: 'ok' },
    },
    vetoCandidates: [],
    balanceState: { capitalRegime: 'NORMAL' },
  }, {
    thresholds: { fullEntryScore: 0.8, weakEntryScore: 0.35 },
  });

  assert.ok(output && output.vetoSummary && output.explanation);
  assert.ok(Array.isArray(output.unmetMinimumBlocks));
  assert.ok(Array.isArray(output.appliedPenalties));
  assert.ok(output.explanation.reasonCodes.includes('degraded_or_cached_input_blocks'));
  assert.ok(['full_entry', 'weak_entry', 'no_entry'].includes(output.decisionMode));
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
