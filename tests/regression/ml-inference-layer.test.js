const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const { createMlInferenceLayer } = require('../../dist/runtime/ml/mlInferenceLayer');

function createTempModelArtifact(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbt-ml-phase1-'));
  const filePath = path.join(dir, 'model.json');
  fs.writeFileSync(filePath, JSON.stringify(payload), 'utf8');
  return { dir, filePath };
}

test('mlInferenceLayer: принимает минимальный входной контракт и возвращает стандартизованный output', () => {
  const temp = createTempModelArtifact({
    version: 'phase1-test',
    bias: 0.02,
    minFeatures: 4,
    weights: {
      block_entryPermission_score: 1.4,
      block_marketContext_score: 1.1,
      block_primarySignal_score: 1.2,
      rule_decision_score: 0.8,
      capital_regime_encoded: 0.2,
    },
  });

  const layer = createMlInferenceLayer({
    modelArtifactPath: temp.filePath,
    minFeatureCount: 4,
  });

  const output = layer.evaluate({
    context: { cycleId: 'cycle-37a-1', ticker: 'BTC-USDT' },
    sharedRuntimeBlockOutputs: {
      entryPermission: { score: 0.79, confidence: 0.71, dataQualityState: 'ok' },
      marketContext: { score: 0.75, confidence: 0.68, dataQualityState: 'ok' },
      primarySignal: { score: 0.77, confidence: 0.73, dataQualityState: 'ok' },
    },
    approvedRuleDecisionContext: { score: 0.76, confidence: 0.7, dataQualityState: 'ok' },
    balanceState: { capitalRegime: 'NORMAL', drawdownPct: 0.12 },
    capitalRegime: 'NORMAL',
    dataQualityState: 'ok',
  });

  assert.equal(typeof output.mlScore, 'number');
  assert.equal(typeof output.mlConfidence, 'number');
  assert.ok(['long', 'short', 'neutral'].includes(output.mlDirectionSupport));
  assert.equal(output.mlFallbackState, 'none');
  assert.ok(Array.isArray(output.mlReasonCodes));
  assert.equal(output.metadata.ownership.isFinalDecisionOwner, false);
  assert.equal(output.metadata.ownership.isSizingOwner, false);
  assert.equal(output.metadata.ownership.isExecutionOwner, false);
});

test('mlInferenceLayer: model-unavailable fallback без падения runtime', () => {
  const layer = createMlInferenceLayer({
    modelArtifactPath: '/tmp/not-existing-model-phase1.json',
    minFeatureCount: 2,
  });

  const output = layer.evaluate({
    sharedRuntimeBlockOutputs: {
      entryPermission: { score: 0.8, confidence: 0.8, dataQualityState: 'ok' },
    },
    dataQualityState: 'ok',
  });

  assert.equal(output.mlFallbackState, 'model_unavailable');
  assert.ok(output.mlReasonCodes.includes('ml_phase1_fallback'));
});

test('mlInferenceLayer: missing-feature fallback, если feature subset недостаточен', () => {
  const temp = createTempModelArtifact({
    version: 'phase1-test-missing-features',
    bias: 0,
    minFeatures: 5,
    weights: { block_entryPermission_score: 1 },
  });
  const layer = createMlInferenceLayer({
    modelArtifactPath: temp.filePath,
    minFeatureCount: 5,
  });

  const output = layer.evaluate({
    sharedRuntimeBlockOutputs: {
      entryPermission: { score: 0.6, confidence: 0.5, dataQualityState: 'ok' },
    },
  });

  assert.equal(output.mlFallbackState, 'missing_feature_fallback');
  assert.ok(output.mlReasonCodes.includes('missing_feature_subset'));
});

test('mlInferenceLayer: не пересчитывает heavy features и не вызывает market-data callbacks', () => {
  const temp = createTempModelArtifact({
    version: 'phase1-test-no-heavy',
    bias: 0.01,
    minFeatures: 3,
    weights: {
      block_entryPermission_score: 1,
      block_marketContext_score: 1,
      block_primarySignal_score: 1,
    },
  });
  const layer = createMlInferenceLayer({
    modelArtifactPath: temp.filePath,
    minFeatureCount: 3,
  });

  let heavyRecomputeCalls = 0;
  let marketDataCalls = 0;
  const output = layer.evaluate({
    sharedRuntimeBlockOutputs: {
      entryPermission: { score: 0.8, confidence: 0.7, dataQualityState: 'ok' },
      marketContext: { score: 0.77, confidence: 0.7, dataQualityState: 'ok' },
      primarySignal: { score: 0.74, confidence: 0.7, dataQualityState: 'ok' },
    },
    // Русский комментарий: слой не должен вызывать эти callbacks.
    recomputeHeavyFeatures: () => { heavyRecomputeCalls += 1; },
    fetchMarketData: () => { marketDataCalls += 1; },
  });

  assert.equal(heavyRecomputeCalls, 0);
  assert.equal(marketDataCalls, 0);
  assert.equal(output.metadata.ownership.recalculatesMarketData, false);
  assert.equal(output.metadata.ownership.recalculatesHeavyFeatures, false);
});

test('mlInferenceLayer: budget fallback при превышении budget на feature preparation', () => {
  const temp = createTempModelArtifact({
    version: 'phase1-test-budget',
    bias: 0.02,
    minFeatures: 2,
    weights: {
      block_entryPermission_score: 1,
      block_marketContext_score: 1,
    },
  });

  const layer = createMlInferenceLayer({
    modelArtifactPath: temp.filePath,
    minFeatureCount: 2,
    budgets: {
      featurePreparationMs: 1,
      inferenceMs: 10,
    },
  });
  const originalNow = Date.now;
  let fakeNow = 1000;
  let output;
  try {
    Date.now = () => {
      fakeNow += 5;
      return fakeNow;
    };
    output = layer.evaluate({
      sharedRuntimeBlockOutputs: {
        entryPermission: { score: 0.66, confidence: 0.62, dataQualityState: 'ok' },
        marketContext: { score: 0.64, confidence: 0.61, dataQualityState: 'ok' },
      },
    });
  } finally {
    Date.now = originalNow;
  }

  assert.equal(output.mlFallbackState, 'budget_degraded');
  assert.ok(output.mlReasonCodes.includes('feature_prep_budget_exceeded'));
});
