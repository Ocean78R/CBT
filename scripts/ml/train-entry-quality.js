'use strict';

const path = require('node:path');
const { trainEntryQualityPipeline } = require('../../dist/runtime/ml/entryQualityTrainingPipeline');

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      result[key] = true;
      continue;
    }
    result[key] = next;
    i += 1;
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = trainEntryQualityPipeline({
    featuresPath: args.features,
    labelsPath: args.labels,
    artifactsDir: args.outDir,
    validationShare: args.validationShare,
    minSamples: args.minSamples,
  });

  // Русский комментарий: сохраняем короткий вывод для CI/оператора без раскрытия лишних деталей.
  const out = {
    status: report.status,
    reason: report.reason || null,
    dataset: report.dataset,
    models: report.models || null,
    artifactsDir: path.resolve(report.artifactsDir),
  };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);

  if (report.status !== 'trained') {
    process.exitCode = 2;
  }
}

if (require.main === module) {
  main();
}
