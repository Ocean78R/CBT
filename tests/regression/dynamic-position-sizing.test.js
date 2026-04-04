const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateDynamicPositionSizing,
  normalizeDynamicPositionSizingConfig,
} = require('../../dist/runtime/sizing/dynamicPositionSizing');

function createBaseInput(overrides = {}) {
  return {
    context: { cycleId: 'cycle-36-1', ticker: 'BTC-USDT' },
    approvedEntryResult: {
      decisionMode: 'full_entry',
      entryScore: 0.74,
      confidence: 0.69,
      vetoSummary: { blocked: false },
      dataQualityState: 'ok',
    },
    decisionMode: 'full_entry',
    balanceState: { capitalRegime: 'NORMAL', drawdownProtection: false },
    capitalRegime: 'NORMAL',
    tickerRisk: { riskScore: 0.4 },
    metadata: { sizingDataQualityState: 'ok' },
    runtimeGuards: { allowNewEntries: true, hardRiskBlocked: false, unloadMode: false },
    ...overrides,
  };
}

test('dynamicPositionSizing: корректный входной контракт и базовый выходной контракт', () => {
  const output = evaluateDynamicPositionSizing(createBaseInput(), normalizeDynamicPositionSizingConfig({ enabled: true }));

  assert.equal(typeof output.sizeMultiplier, 'number');
  assert.equal(typeof output.targetMarginSize, 'number');
  assert.equal(typeof output.leverageCap, 'number');
  assert.equal(typeof output.aggressivenessMode, 'string');
  assert.ok(Array.isArray(output.sizingReasonCodes));
  assert.equal(typeof output.sizingDataQualityState, 'string');
  assert.equal(output.explanation.ownership.isSignalRecalculationOwner, false);
  assert.equal(output.explanation.ownership.isFinalDecisionOwner, false);
  assert.equal(output.explanation.ownership.isExecutionOwner, false);
});

test('dynamicPositionSizing: weak entry получает уменьшенный sizing profile', () => {
  const weakOutput = evaluateDynamicPositionSizing(createBaseInput({
    approvedEntryResult: {
      decisionMode: 'weak_entry',
      entryScore: 0.58,
      confidence: 0.56,
      vetoSummary: { blocked: false },
      dataQualityState: 'ok',
    },
    decisionMode: 'weak_entry',
  }), { enabled: true });

  const fullOutput = evaluateDynamicPositionSizing(createBaseInput(), { enabled: true });

  assert.equal(weakOutput.explanation.approvedEntryDecisionMode, 'weak_entry');
  assert.ok(weakOutput.sizeMultiplier < fullOutput.sizeMultiplier);
  assert.ok(weakOutput.leverageCap <= fullOutput.leverageCap);
  assert.ok(weakOutput.sizingReasonCodes.includes('weak_entry_reduced_profile'));
});

test('dynamicPositionSizing: no-entry branch не возвращает размер позиции', () => {
  const output = evaluateDynamicPositionSizing(createBaseInput({
    approvedEntryResult: {
      decisionMode: 'no_entry',
      entryScore: 0.21,
      confidence: 0.4,
      vetoSummary: { blocked: true },
      dataQualityState: 'ok',
    },
    decisionMode: 'no_entry',
  }), { enabled: true });

  assert.equal(output.mode, 'no_entry');
  assert.equal(output.sizeMultiplier, 0);
  assert.equal(output.targetMarginSize, 0);
  assert.equal(output.leverageCap, 0);
});

test('dynamicPositionSizing: fixed-mode fallback при выключенном dynamic sizing и при недостаточном context', () => {
  const disabledOutput = evaluateDynamicPositionSizing(createBaseInput(), { enabled: false });
  assert.equal(disabledOutput.mode, 'fixed_fallback');
  assert.ok(disabledOutput.sizingReasonCodes.includes('dynamic_sizing_disabled_fixed_fallback'));

  const missingContextOutput = evaluateDynamicPositionSizing(createBaseInput({
    balanceState: null,
    capitalRegime: null,
    tickerRisk: null,
  }), { enabled: true });
  assert.equal(missingContextOutput.mode, 'fixed_fallback');
  assert.ok(missingContextOutput.sizingReasonCodes.includes('runtime_context_insufficient_fixed_fallback'));
});

test('dynamicPositionSizing: не пересчитывает сигналы повторно', () => {
  let recomputeCalls = 0;
  const output = evaluateDynamicPositionSizing(createBaseInput({
    recalculateSignals: () => {
      recomputeCalls += 1;
      return { score: 1 };
    },
  }), { enabled: true });

  assert.equal(recomputeCalls, 0);
  assert.equal(output.explanation.ownership.isSignalRecalculationOwner, false);
});
