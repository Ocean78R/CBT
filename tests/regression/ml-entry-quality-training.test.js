const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { trainEntryQualityPipeline } = require('../../dist/runtime/ml/entryQualityTrainingPipeline');

function writeCsv(filePath, header, rows) {
  const lines = [header.join(',')];
  rows.forEach((row) => {
    lines.push(header.map((name) => row[name] ?? '').join(','));
  });
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

test('ML pipeline: обучает модель и сохраняет артефакты при достаточном датасете', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-train-ok-'));
  const featuresPath = path.join(tempDir, 'features.csv');
  const labelsPath = path.join(tempDir, 'labels.csv');
  const outDir = path.join(tempDir, 'artifacts');

  const featureHeader = [
    'sampleId', 'mode', 'eventType', 'marketRegime', 'capitalRegime', 'setupType',
    'decision', 'direction', 'score', 'confidence', 'softPenalty', 'dataQualityState',
    'sizingDecision', 'executionAction', 'balanceEquity', 'balanceFree', 'balanceUsedMarginPercent',
    'portfolioForecastState', 'capitalStressForecastScore', 'forecastRegimeShiftRisk', 'portfolioFragilityScore',
  ];
  const labelHeader = ['sampleId', 'label'];

  const featureRows = [];
  const labelRows = [];
  for (let i = 0; i < 90; i += 1) {
    featureRows.push({
      sampleId: `s_${i}`,
      mode: i % 2 === 0 ? 'paper' : 'live',
      eventType: 'potential_entry',
      marketRegime: i % 3 === 0 ? 'TREND' : 'RANGE',
      capitalRegime: i % 4 === 0 ? 'SAFE' : 'NORMAL',
      setupType: i % 2 === 0 ? 'breakout' : 'bounce',
      decision: 'approved',
      direction: i % 2 === 0 ? 'long' : 'short',
      score: (0.2 + (i % 10) * 0.07).toFixed(3),
      confidence: (0.1 + (i % 7) * 0.1).toFixed(3),
      softPenalty: String(i % 3),
      dataQualityState: 'ok',
      sizingDecision: 'normal',
      executionAction: 'none',
      balanceEquity: String(1000 + i * 5),
      balanceFree: String(700 + i * 3),
      balanceUsedMarginPercent: String((i % 10) * 2),
      portfolioForecastState: i % 2 === 0 ? 'stable' : 'risk_on',
      capitalStressForecastScore: String((i % 10) / 10),
      forecastRegimeShiftRisk: String((i % 9) / 10),
      portfolioFragilityScore: String((i % 8) / 10),
    });

    const label = i % 5 === 0 ? 'NEGATIVE' : (i % 3 === 0 ? 'NEUTRAL' : 'POSITIVE');
    labelRows.push({ sampleId: `s_${i}`, label });
  }

  writeCsv(featuresPath, featureHeader, featureRows);
  writeCsv(labelsPath, labelHeader, labelRows);

  const report = trainEntryQualityPipeline({
    featuresPath,
    labelsPath,
    artifactsDir: outDir,
    minSamples: 50,
    validationShare: 0.2,
  });

  assert.equal(report.status, 'trained');
  assert.ok(fs.existsSync(path.join(outDir, 'entry_quality_model.json')));
  assert.ok(fs.existsSync(path.join(outDir, 'training_report.json')));
});

test('ML pipeline: безопасно пропускает обучение при малом датасете', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-train-small-'));
  const featuresPath = path.join(tempDir, 'features.csv');
  const labelsPath = path.join(tempDir, 'labels.csv');

  writeCsv(featuresPath, ['sampleId', 'score', 'confidence'], [
    { sampleId: 'a', score: '0.5', confidence: '0.5' },
  ]);
  writeCsv(labelsPath, ['sampleId', 'label'], [
    { sampleId: 'a', label: 'POSITIVE' },
  ]);

  const report = trainEntryQualityPipeline({ featuresPath, labelsPath, artifactsDir: tempDir, minSamples: 10 });
  assert.equal(report.status, 'skipped_insufficient_data');
});
