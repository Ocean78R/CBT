const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createEngines } = require('../../dist/runtime/engines');
const { createRequestScheduler } = require('../../dist/runtime/scheduler/requestScheduler');

test('performance audit: requestScheduler не использует full queue re-sort на каждом enqueue', async () => {
  const schedulerSource = fs.readFileSync(
    path.join(__dirname, '../../dist/runtime/scheduler/requestScheduler.js'),
    'utf8',
  );
  assert.equal(schedulerSource.includes('queue.sort('), false);

  const scheduler = createRequestScheduler({
    enabled: true,
    maxConcurrency: 1,
    maxRequestsPerWindow: 100,
    windowMs: 1000,
    priorities: {
      coreMarketData: 100,
      optionalMicrostructure: 40,
    },
  });

  const runOrder = [];
  await Promise.all([
    scheduler.enqueue(async () => { runOrder.push('low-1'); return true; }, { priority: 10 }),
    scheduler.enqueue(async () => { runOrder.push('high'); return true; }, { priority: 90 }),
    scheduler.enqueue(async () => { runOrder.push('low-2'); return true; }, { priority: 10 }),
  ]);

  assert.equal(runOrder[0], 'high');
  assert.deepEqual(runOrder.slice(1), ['low-1', 'low-2']);
});

test('performance audit: evaluateMlInferencePhase1 переиспользует ML layer между циклами с тем же config', () => {
  const modelPath = path.join(os.tmpdir(), `ml-model-${Date.now()}.json`);
  fs.writeFileSync(modelPath, JSON.stringify({
    version: 'test',
    bias: 0.1,
    minFeatures: 1,
    weights: {
      block_finalEntryDecisionLayer_score: 0.5,
    },
  }), 'utf8');

  const strategy = {
    log: () => {},
    config: {},
  };

  const engines = createEngines(strategy);
  const runtimeConfig = {
    mlPhase1Integration: {
      enableMlFilter: true,
      allowFallbackWithoutModel: true,
    },
    mlInferenceLayer: {
      enabled: true,
      minFeatureCount: 1,
      modelArtifactPath: modelPath,
      budgets: { featurePreparationMs: 100, inferenceMs: 100 },
      loggingEnabled: false,
    },
  };
  const input = {
    context: { cycleId: 'c1', ticker: 'BTC-USDT' },
    sharedRuntimeBlockOutputs: {
      finalEntryDecisionLayer: { score: 0.71, confidence: 0.65, dataQualityState: 'ok' },
    },
    approvedRuleDecisionContext: {
      score: 0.69,
      confidence: 0.64,
      dataQualityState: 'ok',
    },
    capitalRegime: 'NORMAL',
    dataQualityState: 'ok',
  };

  const originalRead = fs.readFileSync;
  let modelReadCount = 0;
  fs.readFileSync = function patchedRead(...args) {
    if (args[0] === modelPath) modelReadCount += 1;
    return originalRead.apply(this, args);
  };

  try {
    const first = engines.signalEngine.evaluateMlInferencePhase1(input, runtimeConfig, {});
    const second = engines.signalEngine.evaluateMlInferencePhase1({
      ...input,
      context: { cycleId: 'c2', ticker: 'BTC-USDT' },
    }, runtimeConfig, {});

    assert.equal(first.mlFallbackState, 'none');
    assert.equal(second.mlFallbackState, 'none');
    assert.equal(modelReadCount, 1);
  } finally {
    fs.readFileSync = originalRead;
    fs.unlinkSync(modelPath);
  }
});
