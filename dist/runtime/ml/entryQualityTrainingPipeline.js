'use strict';

const fs = require('node:fs');
const path = require('node:path');

function safeNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  result.push(current);
  return result;
}

function readCsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? '';
    });
    return row;
  });
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function sigmoid(x) {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

function trainBinaryLogistic(features, labels, options = {}) {
  const learningRate = Number(options.learningRate || 0.05);
  const epochs = Number(options.epochs || 350);
  const l2 = Number(options.l2 || 0.0001);

  const dimensions = features[0]?.length || 0;
  const weights = Array.from({ length: dimensions }, () => 0);
  let bias = 0;

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gradW = Array.from({ length: dimensions }, () => 0);
    let gradB = 0;

    for (let i = 0; i < features.length; i += 1) {
      const x = features[i];
      const y = labels[i];
      const p = sigmoid(dot(x, weights) + bias);
      const error = p - y;
      for (let d = 0; d < dimensions; d += 1) gradW[d] += error * x[d];
      gradB += error;
    }

    for (let d = 0; d < dimensions; d += 1) {
      const reg = l2 * weights[d];
      weights[d] -= learningRate * ((gradW[d] / features.length) + reg);
    }
    bias -= learningRate * (gradB / features.length);
  }

  return { weights, bias };
}

function predictBinary(model, vector) {
  return sigmoid(dot(vector, model.weights) + model.bias);
}

function makeConfusion(labels, predictions) {
  const matrix = new Map();
  const classes = Array.from(new Set([...labels, ...predictions]));
  classes.forEach((truth) => {
    matrix.set(truth, new Map());
    classes.forEach((pred) => matrix.get(truth).set(pred, 0));
  });

  for (let i = 0; i < labels.length; i += 1) {
    const truth = labels[i];
    const pred = predictions[i];
    matrix.get(truth).set(pred, matrix.get(truth).get(pred) + 1);
  }

  const serializable = {};
  classes.forEach((truth) => {
    serializable[truth] = {};
    classes.forEach((pred) => {
      serializable[truth][pred] = matrix.get(truth).get(pred);
    });
  });

  return serializable;
}

function calcBinaryMetrics(labels, probabilities, threshold = 0.5) {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;

  for (let i = 0; i < labels.length; i += 1) {
    const y = labels[i];
    const p = probabilities[i];
    const pred = p >= threshold ? 1 : 0;
    if (y === 1 && pred === 1) tp += 1;
    if (y === 0 && pred === 1) fp += 1;
    if (y === 0 && pred === 0) tn += 1;
    if (y === 1 && pred === 0) fn += 1;
  }

  const accuracy = (tp + tn) / Math.max(labels.length, 1);
  const precision = tp / Math.max(tp + fp, 1);
  const recall = tp / Math.max(tp + fn, 1);
  const f1 = (2 * precision * recall) / Math.max(precision + recall, Number.EPSILON);

  let logLoss = 0;
  for (let i = 0; i < labels.length; i += 1) {
    const y = labels[i];
    const p = Math.max(1e-8, Math.min(1 - 1e-8, probabilities[i]));
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }
  logLoss /= Math.max(labels.length, 1);

  return { accuracy, precision, recall, f1, logLoss, threshold, tp, fp, tn, fn };
}

function calcMacroF1(labels, predictions, classes) {
  const perClass = {};
  let totalF1 = 0;

  classes.forEach((cls) => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (let i = 0; i < labels.length; i += 1) {
      const y = labels[i];
      const p = predictions[i];
      if (y === cls && p === cls) tp += 1;
      if (y !== cls && p === cls) fp += 1;
      if (y === cls && p !== cls) fn += 1;
    }
    const precision = tp / Math.max(tp + fp, 1);
    const recall = tp / Math.max(tp + fn, 1);
    const f1 = (2 * precision * recall) / Math.max(precision + recall, Number.EPSILON);
    totalF1 += f1;
    perClass[cls] = { precision, recall, f1, support: labels.filter((y) => y === cls).length };
  });

  return {
    macroF1: totalF1 / Math.max(classes.length, 1),
    perClass,
  };
}

function selectFeatureConfig(config = {}) {
  return {
    numericFeatures: config.numericFeatures || [
      'score',
      'confidence',
      'softPenalty',
      'balanceEquity',
      'balanceFree',
      'balanceUsedMarginPercent',
      'capitalStressForecastScore',
      'forecastRegimeShiftRisk',
      'portfolioFragilityScore',
    ],
    categoricalFeatures: config.categoricalFeatures || [
      'mode',
      'eventType',
      'marketRegime',
      'capitalRegime',
      'setupType',
      'decision',
      'direction',
      'dataQualityState',
      'sizingDecision',
      'executionAction',
      'portfolioForecastState',
    ],
  };
}

function buildDataset(featuresRows, labelsRows, options = {}) {
  const featureConfig = selectFeatureConfig(options);
  const labelBySampleId = new Map(labelsRows.map((row) => [row.sampleId, row]));

  const joined = [];
  featuresRows.forEach((feature) => {
    const label = labelBySampleId.get(feature.sampleId);
    if (!label) return;
    if (!label.label) return;

    const qualityClass = ['POSITIVE', 'NEUTRAL', 'NEGATIVE'].includes(label.label) ? label.label : null;
    if (!qualityClass) return;

    joined.push({ feature, label, qualityClass });
  });

  return { joined, featureConfig };
}

function fitPreprocessor(rows, featureConfig) {
  const numericFill = {};
  const categoricalValues = {};

  featureConfig.numericFeatures.forEach((name) => {
    const values = rows
      .map((row) => safeNumber(row.feature[name], null))
      .filter((v) => v !== null);
    numericFill[name] = median(values);
  });

  featureConfig.categoricalFeatures.forEach((name) => {
    const values = Array.from(new Set(rows.map((row) => String(row.feature[name] || 'unknown'))));
    categoricalValues[name] = values.length ? values : ['unknown'];
  });

  const featureNames = ['bias'];
  featureConfig.numericFeatures.forEach((name) => featureNames.push(`num:${name}`));
  featureConfig.categoricalFeatures.forEach((name) => {
    categoricalValues[name].forEach((value) => featureNames.push(`cat:${name}=${value}`));
  });

  return { numericFill, categoricalValues, featureNames, featureConfig };
}

function vectorizeRow(row, preprocessor) {
  const vector = [1];

  preprocessor.featureConfig.numericFeatures.forEach((name) => {
    const raw = safeNumber(row.feature[name], null);
    const value = raw === null ? preprocessor.numericFill[name] : raw;
    vector.push(value);
  });

  preprocessor.featureConfig.categoricalFeatures.forEach((name) => {
    const raw = String(row.feature[name] || 'unknown');
    preprocessor.categoricalValues[name].forEach((value) => {
      vector.push(raw === value ? 1 : 0);
    });
  });

  return vector;
}

function stableHash(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0);
}

function splitDataset(rows, validationShare = 0.2) {
  const train = [];
  const validation = [];
  rows.forEach((row) => {
    const seed = stableHash(row.feature.sampleId || `${row.feature.ticker}_${row.feature.timestamp}`) % 1000;
    const ratio = seed / 1000;
    if (ratio < validationShare) validation.push(row);
    else train.push(row);
  });
  return { train, validation };
}

function trainEntryQualityPipeline(options = {}) {
  const featuresPath = path.resolve(options.featuresPath || './data/ml_dataset/entry_features.csv');
  const labelsPath = path.resolve(options.labelsPath || './data/ml_dataset/entry_labels.csv');
  const artifactsDir = path.resolve(options.artifactsDir || './data/ml_models/entry_quality');
  const validationShare = Number(options.validationShare || 0.2);
  const minSamples = Number(options.minSamples || 80);

  const featuresRows = readCsv(featuresPath);
  const labelsRows = readCsv(labelsPath);
  const { joined, featureConfig } = buildDataset(featuresRows, labelsRows, options);

  fs.mkdirSync(artifactsDir, { recursive: true });

  const report = {
    createdAt: new Date().toISOString(),
    featuresPath,
    labelsPath,
    artifactsDir,
    dataset: {
      featuresRows: featuresRows.length,
      labelsRows: labelsRows.length,
      joinedRows: joined.length,
      minSamples,
      validationShare,
    },
    status: 'ok',
  };

  // Русский комментарий: защита от обучения на слишком маленькой выборке, чтобы не получить шумовую модель.
  if (joined.length < minSamples) {
    report.status = 'skipped_insufficient_data';
    report.reason = `Недостаточно данных для устойчивого обучения: нужно >= ${minSamples}, получено ${joined.length}`;
    fs.writeFileSync(path.join(artifactsDir, 'training_report.json'), JSON.stringify(report, null, 2));
    return report;
  }

  const split = splitDataset(joined, validationShare);
  if (split.train.length < 10 || split.validation.length < 10) {
    report.status = 'skipped_bad_split';
    report.reason = 'После split недостаточно train/validation данных.';
    fs.writeFileSync(path.join(artifactsDir, 'training_report.json'), JSON.stringify(report, null, 2));
    return report;
  }

  const preprocessor = fitPreprocessor(split.train, featureConfig);
  const xTrain = split.train.map((row) => vectorizeRow(row, preprocessor));
  const xValidation = split.validation.map((row) => vectorizeRow(row, preprocessor));

  // Цель 1: бинарная оценка качества входа (POSITIVE vs not POSITIVE).
  const yTrainBinary = split.train.map((row) => (row.qualityClass === 'POSITIVE' ? 1 : 0));
  const yValidationBinary = split.validation.map((row) => (row.qualityClass === 'POSITIVE' ? 1 : 0));
  const binaryModel = trainBinaryLogistic(xTrain, yTrainBinary, options.binaryModel || {});
  const binaryProbs = xValidation.map((vec) => predictBinary(binaryModel, vec));
  const binaryMetrics = calcBinaryMetrics(yValidationBinary, binaryProbs, Number(options.binaryThreshold || 0.5));

  // Цель 2: мультикласс качества входа (NEGATIVE/NEUTRAL/POSITIVE) через one-vs-rest.
  const qualityClasses = ['NEGATIVE', 'NEUTRAL', 'POSITIVE'];
  const ovrModels = {};
  qualityClasses.forEach((cls) => {
    const yTrainCls = split.train.map((row) => (row.qualityClass === cls ? 1 : 0));
    ovrModels[cls] = trainBinaryLogistic(xTrain, yTrainCls, options.multiclassModel || {});
  });

  const multiclassPredictions = xValidation.map((vec) => {
    const scores = qualityClasses.map((cls) => ({ cls, p: predictBinary(ovrModels[cls], vec) }));
    scores.sort((a, b) => b.p - a.p);
    return scores[0].cls;
  });
  const multiclassLabels = split.validation.map((row) => row.qualityClass);
  const multiclassAccuracy = multiclassPredictions
    .filter((pred, index) => pred === multiclassLabels[index]).length / multiclassLabels.length;
  const multiclassF1 = calcMacroF1(multiclassLabels, multiclassPredictions, qualityClasses);

  const modelArtifact = {
    modelType: 'logistic_regression_ovr_v1',
    createdAt: report.createdAt,
    trainingData: {
      trainRows: split.train.length,
      validationRows: split.validation.length,
      qualityClasses,
    },
    featureContract: {
      numericFeatures: preprocessor.featureConfig.numericFeatures,
      categoricalFeatures: preprocessor.featureConfig.categoricalFeatures,
      currentCapitalStateFields: [
        'balanceEquity',
        'balanceFree',
        'balanceUsedMarginPercent',
        'capitalRegime',
      ],
      forecastStateFields: [
        'portfolioForecastState',
        'capitalStressForecastScore',
        'forecastRegimeShiftRisk',
        'portfolioFragilityScore',
      ],
      vectorFeatureNames: preprocessor.featureNames,
      numericFill: preprocessor.numericFill,
      categoricalValues: preprocessor.categoricalValues,
    },
    targets: {
      binaryPositiveEntry: {
        description: 'POSITIVE vs not POSITIVE',
        threshold: Number(options.binaryThreshold || 0.5),
        model: binaryModel,
        metrics: binaryMetrics,
      },
      multiclassEntryQuality: {
        classes: qualityClasses,
        models: ovrModels,
        metrics: {
          accuracy: multiclassAccuracy,
          macroF1: multiclassF1.macroF1,
          perClass: multiclassF1.perClass,
          confusionMatrix: makeConfusion(multiclassLabels, multiclassPredictions),
        },
      },
    },
  };

  report.status = 'trained';
  report.models = {
    binaryPositiveEntry: {
      metric: binaryMetrics,
    },
    multiclassEntryQuality: {
      accuracy: multiclassAccuracy,
      macroF1: multiclassF1.macroF1,
    },
  };

  fs.writeFileSync(path.join(artifactsDir, 'entry_quality_model.json'), JSON.stringify(modelArtifact, null, 2));
  fs.writeFileSync(path.join(artifactsDir, 'training_report.json'), JSON.stringify(report, null, 2));

  return report;
}

module.exports = {
  trainEntryQualityPipeline,
  readCsv,
  buildDataset,
  splitDataset,
};
