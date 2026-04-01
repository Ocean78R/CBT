'use strict';

const fs = require('node:fs');
const path = require('node:path');

function normalizeConfig(config = {}) {
  const mlDatasetBuilder = config.mlDatasetBuilder || {};
  const labeling = mlDatasetBuilder.labeling || {};
  const capture = mlDatasetBuilder.capture || {};

  return {
    enabled: !!mlDatasetBuilder.enabled,
    storage: mlDatasetBuilder.storage === 'sqlite' ? 'sqlite' : 'csv',
    dataDir: mlDatasetBuilder.dataDir || './data/ml_dataset',
    featuresCsv: mlDatasetBuilder.featuresCsv || 'entry_features.csv',
    labelsCsv: mlDatasetBuilder.labelsCsv || 'entry_labels.csv',
    pendingStateJson: mlDatasetBuilder.pendingStateJson || 'entry_pending_state.json',
    flushIntervalMs: Number(mlDatasetBuilder.flushIntervalMs || 1200),
    includePaperMode: mlDatasetBuilder.includePaperMode !== false,
    includeLiveMode: mlDatasetBuilder.includeLiveMode !== false,
    capture: {
      potentialEntries: capture.potentialEntries !== false,
      actualEntries: capture.actualEntries !== false,
    },
    labeling: {
      defaultHoldTimeoutMinutes: Number(labeling.defaultHoldTimeoutMinutes || 180),
      positivePnlPercent: Number(labeling.positivePnlPercent || 0.2),
      negativePnlPercent: Number(labeling.negativePnlPercent || -0.2),
      neutralBandAbsPercent: Number(labeling.neutralBandAbsPercent || 0.2),
    },
  };
}

function safeNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function ensureCsvHeader(filePath, headerLine, writer) {
  if (fs.existsSync(filePath)) return;
  writer.writeFileSync(filePath, `${headerLine}\n`, 'utf8');
}

function csvCell(value) {
  if (value === undefined || value === null) return '';
  const text = String(value);
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function toCsvLine(columns, row) {
  return columns.map((name) => csvCell(row[name])).join(',');
}

function createMlDatasetBuilder(rawConfig = {}, deps = {}) {
  const config = normalizeConfig(rawConfig);
  const writer = deps.writer || fs;
  const now = deps.now || (() => Date.now());
  const randomId = deps.randomId || (() => `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
  const log = deps.log || (() => {});
  const emitStructuredEvent = deps.emitStructuredEvent || (() => {});
  const ingestObservabilityEvent = deps.ingestObservabilityEvent || (() => {});

  const featureColumns = [
    'sampleId', 'timestamp', 'mode', 'eventType', 'cycleId', 'ticker', 'exchange', 'module', 'layer',
    'marketRegime', 'capitalRegime', 'setupType', 'decision', 'decisionSource',
    'direction', 'score', 'confidence', 'softPenalty', 'vetoType', 'vetoReason', 'reasonCodes',
    'dataQualityState', 'sizingDecision', 'executionAction', 'fallbackAction',
    'balanceEquity', 'balanceFree', 'balanceUsedMarginPercent',
    'portfolioForecastState', 'capitalStressForecastScore', 'forecastRegimeShiftRisk', 'portfolioFragilityScore',
    'forecastRestrictionHints', 'forecastProtectiveHints',
    'downstreamUniverse', 'downstreamRegimeRouter', 'downstreamConfluence', 'downstreamSizing',
    'rawContextJson',
  ];

  const labelColumns = [
    'sampleId', 'positionId', 'status', 'label', 'labelReason', 'resolvedAt',
    'holdMinutes', 'realizedPnlUsdt', 'realizedPnlPercent', 'maxAdverseExcursionPercent', 'closeReason',
  ];

  const state = {
    flushTimer: null,
    featureBuffer: [],
    labelBuffer: [],
    pendingSamples: new Map(),
  };

  function storagePaths() {
    const dataDir = path.resolve(config.dataDir);
    return {
      dataDir,
      featuresCsv: path.join(dataDir, config.featuresCsv),
      labelsCsv: path.join(dataDir, config.labelsCsv),
      pendingStateJson: path.join(dataDir, config.pendingStateJson),
    };
  }

  function ensureStoragePrepared() {
    const paths = storagePaths();
    writer.mkdirSync(paths.dataDir, { recursive: true });
    ensureCsvHeader(paths.featuresCsv, featureColumns.join(','), writer);
    ensureCsvHeader(paths.labelsCsv, labelColumns.join(','), writer);
  }

  function loadPendingState() {
    if (!config.enabled) return;
    const paths = storagePaths();
    ensureStoragePrepared();
    if (!writer.existsSync(paths.pendingStateJson)) return;

    try {
      const raw = writer.readFileSync(paths.pendingStateJson, 'utf8');
      const parsed = JSON.parse(raw || '{}');
      const samples = Array.isArray(parsed.samples) ? parsed.samples : [];
      for (const item of samples) {
        if (!item || !item.sampleId) continue;
        state.pendingSamples.set(item.sampleId, item);
      }
    } catch (_error) {
      // Русский комментарий: некорректное состояние не должно ломать runtime; просто стартуем с пустого pending.
      state.pendingSamples.clear();
    }
  }

  function persistPendingState() {
    if (!config.enabled) return;
    const paths = storagePaths();
    const payload = {
      updatedAt: new Date(now()).toISOString(),
      samples: Array.from(state.pendingSamples.values()),
    };
    writer.writeFileSync(paths.pendingStateJson, JSON.stringify(payload, null, 2), 'utf8');
  }

  function appendCsv(filePath, columns, rows) {
    if (!rows.length) return;
    const payload = `${rows.map((row) => toCsvLine(columns, row)).join('\n')}\n`;
    writer.appendFileSync(filePath, payload, 'utf8');
  }

  function flush() {
    if (!config.enabled) return;
    if (state.featureBuffer.length === 0 && state.labelBuffer.length === 0) return;
    ensureStoragePrepared();
    const paths = storagePaths();
    appendCsv(paths.featuresCsv, featureColumns, state.featureBuffer.splice(0, state.featureBuffer.length));
    appendCsv(paths.labelsCsv, labelColumns, state.labelBuffer.splice(0, state.labelBuffer.length));
    persistPendingState();
  }

  function scheduleFlush() {
    if (state.flushTimer || !config.enabled) return;
    state.flushTimer = setTimeout(() => {
      state.flushTimer = null;
      try {
        flush();
      } catch (_error) {
        // Русский комментарий: ошибки dataset writer не должны блокировать торговый ownership path.
      }
    }, config.flushIntervalMs);
    if (typeof state.flushTimer.unref === 'function') state.flushTimer.unref();
  }

  function toFeatureRow(input = {}) {
    const decisionContext = input.decisionContext || {};
    const telemetry = input.telemetry || decisionContext.metadata || {};
    const veto = decisionContext.veto || input.veto || null;
    const balanceState = decisionContext.balanceState || input.balanceState || {};
    const downstream = telemetry.downstreamContext || {};
    const forecast = telemetry.forecast || {};

    return {
      sampleId: input.sampleId,
      timestamp: input.timestamp || new Date(now()).toISOString(),
      mode: input.mode || 'unknown',
      eventType: input.eventType || 'potential_entry',
      cycleId: decisionContext.cycleId || input.cycleId || '',
      ticker: decisionContext.ticker || input.ticker || '',
      exchange: input.exchange || decisionContext.exchange || '',
      module: input.module || 'mlDatasetBuilder',
      layer: input.layer || 'analytics.mlDataset',
      marketRegime: input.marketRegime || decisionContext.regime || decisionContext.marketRegime || 'unknown',
      capitalRegime: decisionContext.capitalRegime || balanceState.capitalRegime || 'NORMAL',
      setupType: input.setupType || telemetry.setupType || 'unknown',
      decision: input.decision || input.finalDecision || 'unknown',
      decisionSource: input.decisionSource || 'runtime_decision_context',
      direction: input.direction || telemetry.direction || 'unknown',
      score: safeNumber(decisionContext.score, 0),
      confidence: safeNumber(decisionContext.confidence, 0),
      softPenalty: safeNumber(input.softPenalty ?? (Array.isArray(decisionContext.penalties) ? decisionContext.penalties.length : 0), 0),
      vetoType: veto ? (veto.type || 'hard_veto') : '',
      vetoReason: veto ? (veto.reason || '') : '',
      reasonCodes: JSON.stringify(input.reasonCodes || telemetry.reasonCodes || []),
      dataQualityState: input.dataQualityState || telemetry.dataQualityState || 'unknown',
      sizingDecision: input.sizingDecision || telemetry.sizingDecision || 'not_evaluated',
      executionAction: input.executionAction || telemetry.executionAction || 'none',
      fallbackAction: input.fallbackAction || telemetry.fallbackAction || 'none',
      balanceEquity: safeNumber(balanceState.equity ?? balanceState.currentBalance, null),
      balanceFree: safeNumber(balanceState.free ?? balanceState.freeBalance, null),
      balanceUsedMarginPercent: safeNumber(balanceState.usedMarginPercent, null),
      portfolioForecastState: input.portfolioForecastState || forecast.portfolioForecastState || balanceState.portfolioForecastState || '',
      capitalStressForecastScore: safeNumber(input.capitalStressForecastScore ?? forecast.capitalStressForecastScore, null),
      forecastRegimeShiftRisk: safeNumber(decisionContext.forecastRegimeShiftRisk ?? input.forecastRegimeShiftRisk, null),
      portfolioFragilityScore: safeNumber(input.portfolioFragilityScore ?? forecast.portfolioFragilityScore, null),
      forecastRestrictionHints: JSON.stringify(input.forecastRestrictionHints || forecast.reasonCodes || []),
      forecastProtectiveHints: JSON.stringify(input.forecastProtectiveHints || forecast.outputHints || {}),
      downstreamUniverse: JSON.stringify(downstream.universeFilter || {}),
      downstreamRegimeRouter: JSON.stringify(downstream.marketRegimeRouter || {}),
      downstreamConfluence: JSON.stringify(downstream.confluenceEntry || {}),
      downstreamSizing: JSON.stringify(downstream.dynamicSizing || {}),
      rawContextJson: JSON.stringify({ decisionContext, telemetry }),
    };
  }

  function buildLabel(input = {}) {
    const pnlPercent = safeNumber(input.realizedPnlPercent, null);
    const pnlUsdt = safeNumber(input.realizedPnlUsdt, 0);
    const holdMinutes = safeNumber(input.holdMinutes, null);
    const closeReason = input.closeReason || 'unknown';
    const status = input.status || 'closed';

    if (status === 'not_opened') {
      return { label: 'NO_TRADE', labelReason: input.labelReason || 'entry_not_executed' };
    }

    if (status === 'timeout') {
      return { label: 'TIMEOUT', labelReason: 'hold_window_timeout' };
    }

    if (pnlPercent === null) {
      return { label: pnlUsdt >= 0 ? 'POSITIVE' : 'NEGATIVE', labelReason: 'pnl_usdt_fallback' };
    }

    if (pnlPercent >= config.labeling.positivePnlPercent) {
      return { label: 'POSITIVE', labelReason: 'pnl_above_positive_threshold' };
    }

    if (pnlPercent <= config.labeling.negativePnlPercent) {
      return { label: 'NEGATIVE', labelReason: 'pnl_below_negative_threshold' };
    }

    if (Math.abs(pnlPercent) <= config.labeling.neutralBandAbsPercent) {
      return { label: 'NEUTRAL', labelReason: 'pnl_inside_neutral_band' };
    }

    return {
      label: pnlPercent > 0 ? 'POSITIVE' : 'NEGATIVE',
      labelReason: 'pnl_outside_neutral_band',
      holdMinutes,
      closeReason,
    };
  }

  function emitDatasetEvent(kind, payload) {
    const event = {
      eventType: `ml_dataset_${kind}`,
      module: 'mlDatasetBuilder',
      layer: 'analytics.mlDataset',
      cycleId: payload.cycleId || 'unknown_cycle',
      ticker: payload.ticker || 'unknown_ticker',
      exchange: payload.exchange || 'unknown_exchange',
      mode: payload.mode || 'unknown',
      marketRegime: payload.marketRegime || 'unknown',
      capitalRegime: payload.capitalRegime || 'NORMAL',
      finalDecision: payload.decision || payload.label || 'unknown',
      vetoReason: payload.vetoReason || null,
      executionAction: payload.executionAction || 'none',
      payload,
      timestamp: payload.timestamp || new Date(now()).toISOString(),
    };
    ingestObservabilityEvent(event);
    emitStructuredEvent(event);
  }

  function capturePotentialEntry(input = {}) {
    if (!config.enabled || !config.capture.potentialEntries) return null;
    const mode = input.mode || 'unknown';
    if ((mode === 'paper' && !config.includePaperMode) || (mode === 'live' && !config.includeLiveMode)) return null;

    const sampleId = input.sampleId || `sample_${randomId()}`;
    const featureRow = toFeatureRow({ ...input, sampleId, eventType: 'potential_entry' });
    state.featureBuffer.push(featureRow);
    state.pendingSamples.set(sampleId, {
      sampleId,
      createdAt: featureRow.timestamp,
      positionId: input.positionId || null,
      ticker: featureRow.ticker,
      exchange: featureRow.exchange,
      cycleId: featureRow.cycleId,
      mode,
      capitalRegime: featureRow.capitalRegime,
      marketRegime: featureRow.marketRegime,
      timeoutMinutes: Number(input.timeoutMinutes || config.labeling.defaultHoldTimeoutMinutes),
    });

    log(`[mlDatasetBuilder] cycle=${featureRow.cycleId || 'n/a'} ticker=${featureRow.ticker || 'n/a'} exchange=${featureRow.exchange || 'n/a'} module=mlDatasetBuilder layer=analytics.mlDataset regime=${featureRow.marketRegime} capital=${featureRow.capitalRegime} setup=${featureRow.setupType} score=${featureRow.score} confidence=${featureRow.confidence} veto=${featureRow.vetoReason || 'none'} sizing=${featureRow.sizingDecision} execution=${featureRow.executionAction} fallback=${featureRow.fallbackAction} final=feature_captured sampleId=${sampleId}`);

    emitDatasetEvent('feature_captured', {
      ...featureRow,
      cycleId: featureRow.cycleId,
      ticker: featureRow.ticker,
      exchange: featureRow.exchange,
      mode,
      marketRegime: featureRow.marketRegime,
      capitalRegime: featureRow.capitalRegime,
      decision: featureRow.decision,
      executionAction: featureRow.executionAction,
      vetoReason: featureRow.vetoReason,
      sampleId,
    });

    scheduleFlush();
    return sampleId;
  }

  function captureExecutedEntry(input = {}) {
    if (!config.enabled || !config.capture.actualEntries) return null;
    return capturePotentialEntry({ ...input, eventType: 'executed_entry', decisionSource: 'execution_path' });
  }

  function resolveLabel(input = {}) {
    if (!config.enabled) return null;
    const sampleId = input.sampleId;
    if (!sampleId) return null;
    const pending = state.pendingSamples.get(sampleId);
    if (!pending) return null;

    const label = buildLabel(input);
    const row = {
      sampleId,
      positionId: input.positionId || pending.positionId || '',
      status: input.status || 'closed',
      label: label.label,
      labelReason: input.labelReason || label.labelReason,
      resolvedAt: input.resolvedAt || new Date(now()).toISOString(),
      holdMinutes: safeNumber(input.holdMinutes, null),
      realizedPnlUsdt: safeNumber(input.realizedPnlUsdt, 0),
      realizedPnlPercent: safeNumber(input.realizedPnlPercent, null),
      maxAdverseExcursionPercent: safeNumber(input.maxAdverseExcursionPercent, null),
      closeReason: input.closeReason || 'unknown',
    };

    state.labelBuffer.push(row);
    state.pendingSamples.delete(sampleId);

    log(`[mlDatasetBuilder] cycle=${pending.cycleId || 'n/a'} ticker=${pending.ticker || 'n/a'} exchange=${pending.exchange || 'n/a'} module=mlDatasetBuilder layer=analytics.mlDataset regime=${pending.marketRegime || 'unknown'} capital=${pending.capitalRegime || 'NORMAL'} setup=entry_label score=0 confidence=0 veto=none sizing=not_evaluated execution=label_resolution fallback=none final=${row.label} sampleId=${sampleId}`);

    emitDatasetEvent('label_resolved', {
      sampleId,
      cycleId: pending.cycleId,
      ticker: pending.ticker,
      exchange: pending.exchange,
      mode: pending.mode,
      marketRegime: pending.marketRegime,
      capitalRegime: pending.capitalRegime,
      label: row.label,
      executionAction: 'label_resolution',
      vetoReason: null,
      status: row.status,
      closeReason: row.closeReason,
      realizedPnlPercent: row.realizedPnlPercent,
    });

    scheduleFlush();
    return row;
  }

  function markTimeouts(currentTimestamp = now()) {
    if (!config.enabled) return 0;
    let resolvedCount = 0;
    for (const pending of state.pendingSamples.values()) {
      const createdAtTs = Date.parse(pending.createdAt || '');
      if (!Number.isFinite(createdAtTs)) continue;
      const maxMs = Number(pending.timeoutMinutes || config.labeling.defaultHoldTimeoutMinutes) * 60 * 1000;
      if (currentTimestamp - createdAtTs < maxMs) continue;
      resolveLabel({ sampleId: pending.sampleId, status: 'timeout', closeReason: 'timeout' });
      resolvedCount += 1;
    }
    return resolvedCount;
  }

  function getStatus() {
    return {
      enabled: config.enabled,
      pendingSamples: state.pendingSamples.size,
      bufferedFeatures: state.featureBuffer.length,
      bufferedLabels: state.labelBuffer.length,
      storage: storagePaths(),
    };
  }

  loadPendingState();

  return {
    isEnabled: () => config.enabled,
    capturePotentialEntry,
    captureExecutedEntry,
    resolveLabel,
    markTimeouts,
    flush,
    getStatus,
  };
}

module.exports = {
  normalizeConfig,
  createMlDatasetBuilder,
};
