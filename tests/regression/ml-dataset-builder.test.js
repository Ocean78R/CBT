const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { createMlDatasetBuilder } = require('../../dist/runtime/analytics/mlDatasetBuilder');

test('ml dataset builder сохраняет features/labels и восстанавливает pending после рестарта', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-dataset-builder-'));

  const events = [];
  const logs = [];

  const builder = createMlDatasetBuilder({
    mlDatasetBuilder: {
      enabled: true,
      dataDir: tempDir,
      flushIntervalMs: 10,
      capture: { potentialEntries: true, actualEntries: true },
      labeling: {
        defaultHoldTimeoutMinutes: 180,
        positivePnlPercent: 0.2,
        negativePnlPercent: -0.2,
        neutralBandAbsPercent: 0.2,
      },
    },
  }, {
    log: (msg) => logs.push(msg),
    emitStructuredEvent: (event) => events.push(event),
    ingestObservabilityEvent: (event) => events.push(event),
    now: () => new Date('2026-04-01T00:00:00.000Z').getTime(),
    randomId: () => 'fixed_sample',
  });

  const sampleId = builder.capturePotentialEntry({
    mode: 'paper',
    exchange: 'bingx',
    ticker: 'BTC-USDT',
    marketRegime: 'trend',
    setupType: 'breakout',
    decision: 'FULL_ENTRY',
    decisionContext: {
      cycleId: 'cycle-1',
      ticker: 'BTC-USDT',
      score: 0.81,
      confidence: 0.72,
      regime: 'trend',
      capitalRegime: 'CAUTION',
      balanceState: { equity: 1050, free: 830, usedMarginPercent: 21 },
      forecastRegimeShiftRisk: 0.31,
      veto: null,
      penalties: [],
      metadata: {
        forecast: {
          portfolioForecastState: 'stable',
          capitalStressForecastScore: 0.28,
          portfolioFragilityScore: 0.17,
          reasonCodes: ['forecast_ok'],
          outputHints: { slTightening: false },
        },
        downstreamContext: {
          universeFilter: { state: 'allow' },
          marketRegimeRouter: { allowedSetups: ['breakout'] },
          confluenceEntry: { approved: true },
          dynamicSizing: { mode: 'normal' },
        },
      },
    },
  });

  assert.equal(sampleId, 'sample_fixed_sample');

  builder.resolveLabel({
    sampleId,
    status: 'closed',
    closeReason: 'tp_hit',
    realizedPnlUsdt: 35,
    realizedPnlPercent: 0.45,
    holdMinutes: 42,
  });
  builder.flush();

  const featuresPath = path.join(tempDir, 'entry_features.csv');
  const labelsPath = path.join(tempDir, 'entry_labels.csv');
  const statePath = path.join(tempDir, 'entry_pending_state.json');

  const featuresText = fs.readFileSync(featuresPath, 'utf8');
  const labelsText = fs.readFileSync(labelsPath, 'utf8');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

  assert.match(featuresText, /sample_fixed_sample/);
  assert.match(featuresText, /BTC-USDT/);
  assert.match(labelsText, /POSITIVE/);
  assert.equal(Array.isArray(state.samples), true);
  assert.equal(state.samples.length, 0);
  assert.ok(events.some((event) => event.eventType === 'ml_dataset_feature_captured'));
  assert.ok(events.some((event) => event.eventType === 'ml_dataset_label_resolved'));
  assert.ok(logs.some((line) => line.includes('[mlDatasetBuilder]')));

  const restarted = createMlDatasetBuilder({
    mlDatasetBuilder: {
      enabled: true,
      dataDir: tempDir,
    },
  });

  const status = restarted.getStatus();
  assert.equal(status.pendingSamples, 0);
});
