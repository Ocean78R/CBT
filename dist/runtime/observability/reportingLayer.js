'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EVENT_CATEGORIES = {
  DECISION: 'decision_events',
  EXECUTION: 'execution_events',
  PROTECTIVE: 'protective_events',
  REGIME: 'regime_events',
  LIFECYCLE: 'lifecycle_events',
  FORECAST: 'forecast_events',
};

const AUDIT_STAGES = ['capital', 'forecast', 'universe', 'regime', 'confluence', 'veto', 'sizing', 'execution', 'lifecycle'];

function normalizeConfig(config = {}) {
  const auditTrail = config.auditTrail || {};
  const sampling = config.sampling || {};
  const storage = config.storage || {};

  return {
    enabled: !!config.enabled,
    flushIntervalMs: Number(config.flushIntervalMs || 1500),
    maxBufferSize: Number(config.maxBufferSize || 250),
    aggregateWindowCycles: Number(config.aggregateWindowCycles || 200),
    includePaperMode: config.includePaperMode !== false,
    includeLiveMode: config.includeLiveMode !== false,
    sampling: {
      decisionEventsRate: Number(sampling.decisionEventsRate ?? 1),
      diagnosticEventsRate: Number(sampling.diagnosticEventsRate ?? 0.25),
      alwaysKeepCritical: sampling.alwaysKeepCritical !== false,
    },
    auditTrail: {
      enabled: auditTrail.enabled !== false,
      keepPayload: auditTrail.keepPayload !== false,
      maxEntries: Number(auditTrail.maxEntries || 3000),
    },
    storage: {
      enabled: !!storage.enabled,
      dataDir: storage.dataDir || './data/analytics',
      eventsFile: storage.eventsFile || 'observability_events.ndjson',
    },
  };
}

function classifyEvent(event = {}) {
  const eventType = String(event.eventType || '').toLowerCase();
  const layer = String(event.layer || '').toLowerCase();
  const payload = event.payload || {};

  if (eventType.includes('execution') || layer.includes('execution')) return EVENT_CATEGORIES.EXECUTION;
  if (eventType.includes('forced_loss') || eventType.includes('protective') || layer.includes('protection')) return EVENT_CATEGORIES.PROTECTIVE;
  if (eventType.includes('regime') || layer.includes('regime') || layer.includes('portfoliocontour')) return EVENT_CATEGORIES.REGIME;
  if (eventType.includes('lifecycle') || eventType.includes('position_')) return EVENT_CATEGORIES.LIFECYCLE;
  if (eventType.includes('forecast') || payload.forecastRegimeShiftRisk || (payload.telemetry && payload.telemetry.forecast)) return EVENT_CATEGORIES.FORECAST;
  return EVENT_CATEGORIES.DECISION;
}

function isCriticalEvent(category, event = {}) {
  if (category === EVENT_CATEGORIES.EXECUTION || category === EVENT_CATEGORIES.PROTECTIVE || category === EVENT_CATEGORIES.LIFECYCLE) return true;
  const decision = String(event.finalDecision || '').toLowerCase();
  return decision.includes('force_close') || decision.includes('block');
}

function toAuditKey(event = {}) {
  return `${event.cycleId || 'unknown_cycle'}::${event.ticker || 'portfolio'}::${event.positionId || 'shared'}`;
}

function createEmptySummary() {
  return {
    totalEvents: 0,
    categories: {},
    decisions: {},
    vetoReasons: {},
    executionActions: {},
    protectiveActions: {},
    regimeChanges: {},
    forecastEvents: {
      forecast_events: 0,
      forecast_restrictions: 0,
      forecast_protective_hints: 0,
    },
    mlDecisions: 0,
    paperModeEvents: 0,
    liveModeEvents: 0,
  };
}

function increment(map, key, add = 1) {
  map[key] = Number(map[key] || 0) + add;
}

function createObservabilityLayer(rawConfig = {}, deps = {}) {
  const config = normalizeConfig(rawConfig);
  const writer = deps.writer || fs.promises;
  const now = deps.now || (() => Date.now());
  let flushTimer = null;
  let tickCounter = 0;
  const buffer = [];

  const reports = {
    byCycle: new Map(),
    byTicker: new Map(),
    byPosition: new Map(),
    byDay: new Map(),
    byDecisionType: {},
    vetoReasons: {},
    executionEvents: {},
    protectiveEvents: {},
    regimeChanges: {},
    mlDecisions: {},
    modeSplit: { paper: 0, live: 0 },
    performance: {
      ingestEvents: { calls: 0, totalMs: 0, avgMs: 0, maxMs: 0 },
      flush: { calls: 0, totalMs: 0, avgMs: 0, maxMs: 0, errors: 0 },
      analytics: { getReportsCalls: 0, getAuditTrailCalls: 0 },
      byPipelinePart: {
        signalReadOnly: { events: 0 },
        executionProtection: { events: 0 },
        analyticsReporting: { events: 0 },
      },
      bufferHighWatermark: 0,
    },
  };
  const auditTrail = new Map();

  function shouldSample(category) {
    if (category === EVENT_CATEGORIES.DECISION) return Math.random() <= Math.max(0, Math.min(1, config.sampling.decisionEventsRate));
    return true;
  }

  async function flushBuffer() {
    if (!config.enabled || !config.storage.enabled || buffer.length === 0) return;
    const startedAt = now();
    const dataDir = path.resolve(config.storage.dataDir);
    const filePath = path.join(dataDir, config.storage.eventsFile);
    const payload = `${buffer.splice(0, buffer.length).map((e) => JSON.stringify(e)).join('\n')}\n`;
    try {
      await writer.mkdir(dataDir, { recursive: true });
      await writer.appendFile(filePath, payload, 'utf8');
    } catch (error) {
      reports.performance.flush.errors += 1;
      throw error;
    } finally {
      const duration = now() - startedAt;
      reports.performance.flush.calls += 1;
      reports.performance.flush.totalMs += duration;
      reports.performance.flush.avgMs = reports.performance.flush.calls > 0
        ? reports.performance.flush.totalMs / reports.performance.flush.calls
        : 0;
      reports.performance.flush.maxMs = Math.max(reports.performance.flush.maxMs, duration);
    }
  }

  function classifyPipelinePart(event = {}, category) {
    if (category === EVENT_CATEGORIES.EXECUTION || category === EVENT_CATEGORIES.PROTECTIVE || category === EVENT_CATEGORIES.LIFECYCLE) return 'executionProtection';
    if (String(event.module || '').toLowerCase().includes('analytics') || String(event.layer || '').toLowerCase().includes('reporting')) return 'analyticsReporting';
    return 'signalReadOnly';
  }

  function scheduleFlush() {
    if (flushTimer || !config.storage.enabled) return;
    flushTimer = setTimeout(async () => {
      flushTimer = null;
      try {
        await flushBuffer();
      } catch (_error) {
        // Русский комментарий: observability-ошибки не должны блокировать торговый runtime.
      }
    }, config.flushIntervalMs);
    if (typeof flushTimer.unref === 'function') flushTimer.unref();
  }

  function updateSummary(summary, event, category) {
    summary.totalEvents += 1;
    increment(summary.categories, category);
    increment(summary.decisions, event.finalDecision || 'unknown');
    if (event.vetoReason) increment(summary.vetoReasons, event.vetoReason);
    if (event.executionAction) increment(summary.executionActions, event.executionAction);
    if (event.module === 'forcedLossExit' || category === EVENT_CATEGORIES.PROTECTIVE) increment(summary.protectiveActions, event.finalDecision || 'none');
    if (event.payload && event.payload.balanceState && event.payload.balanceState.regimeChanged) {
      increment(summary.regimeChanges, event.payload.balanceState.capitalRegime || 'unknown');
    }
    if (event.module && String(event.module).toLowerCase().includes('ml')) summary.mlDecisions += 1;
    if (event.mode === 'paper') summary.paperModeEvents += 1;
    if (event.mode === 'live') summary.liveModeEvents += 1;

    if (category === EVENT_CATEGORIES.FORECAST) {
      summary.forecastEvents.forecast_events += 1;
      if (event.payload && event.payload.telemetry && event.payload.telemetry.forecast && (event.payload.telemetry.forecast.reasonCodes || []).length > 0) {
        summary.forecastEvents.forecast_restrictions += 1;
      }
      if (event.payload && event.payload.telemetry && event.payload.telemetry.forecast && event.payload.telemetry.forecast.outputHints) {
        summary.forecastEvents.forecast_protective_hints += 1;
      }
    }
  }

  function updateReports(event, category) {
    const cycleKey = event.cycleId || 'unknown_cycle';
    const tickerKey = event.ticker || 'PORTFOLIO';
    const positionKey = event.positionId || `${tickerKey}:shared`;
    const dayKey = String(event.timestamp || new Date().toISOString()).slice(0, 10);

    if (!reports.byCycle.has(cycleKey)) reports.byCycle.set(cycleKey, createEmptySummary());
    if (!reports.byTicker.has(tickerKey)) reports.byTicker.set(tickerKey, createEmptySummary());
    if (!reports.byPosition.has(positionKey)) reports.byPosition.set(positionKey, createEmptySummary());
    if (!reports.byDay.has(dayKey)) reports.byDay.set(dayKey, createEmptySummary());

    updateSummary(reports.byCycle.get(cycleKey), event, category);
    updateSummary(reports.byTicker.get(tickerKey), event, category);
    updateSummary(reports.byPosition.get(positionKey), event, category);
    updateSummary(reports.byDay.get(dayKey), event, category);

    increment(reports.byDecisionType, event.finalDecision || 'unknown');
    if (event.vetoReason) increment(reports.vetoReasons, event.vetoReason);
    if (category === EVENT_CATEGORIES.EXECUTION) increment(reports.executionEvents, event.executionAction || 'none');
    if (category === EVENT_CATEGORIES.PROTECTIVE) increment(reports.protectiveEvents, event.finalDecision || 'none');
    if (category === EVENT_CATEGORIES.REGIME) {
      const regime = event.capitalRegime
        || (event.payload && event.payload.balanceState ? event.payload.balanceState.capitalRegime : null);
      if (regime) increment(reports.regimeChanges, regime);
    }
    if (event.module && String(event.module).toLowerCase().includes('ml')) increment(reports.mlDecisions, event.finalDecision || 'unknown');
    if (event.mode === 'paper') reports.modeSplit.paper += 1;
    if (event.mode === 'live') reports.modeSplit.live += 1;
  }

  function updateAuditTrail(event, category) {
    if (!config.auditTrail.enabled) return;
    const key = toAuditKey(event);
    const current = auditTrail.get(key) || {
      key,
      cycleId: event.cycleId || '',
      ticker: event.ticker || 'PORTFOLIO',
      stagePath: {},
      chain: [],
      latestFinalDecision: 'unknown',
      timestamp: event.timestamp || new Date().toISOString(),
    };

    if (event.payload && event.payload.balanceState) current.stagePath.capital = event.payload.balanceState;
    if (category === EVENT_CATEGORIES.FORECAST || (event.payload && event.payload.telemetry && event.payload.telemetry.forecast)) {
      current.stagePath.forecast = {
        forecastRegimeShiftRisk: event.forecastRegimeShiftRisk || (event.payload && event.payload.balanceState ? event.payload.balanceState.forecastRegimeShiftRisk || null : null),
        restrictions: event.payload && event.payload.telemetry && event.payload.telemetry.forecast
          ? event.payload.telemetry.forecast.reasonCodes || []
          : [],
        protectiveHints: event.payload && event.payload.telemetry && event.payload.telemetry.forecast
          ? event.payload.telemetry.forecast.outputHints || {}
          : {},
      };
    }
    if (event.payload && event.payload.telemetry && event.payload.telemetry.downstreamContext) {
      const downstream = event.payload.telemetry.downstreamContext;
      current.stagePath.universe = downstream.universeFilter || {};
      current.stagePath.regime = downstream.marketRegimeRouter || {};
      current.stagePath.confluence = downstream.confluenceEntry || {};
      current.stagePath.veto = event.vetoReason ? { reason: event.vetoReason, type: 'hard_veto' } : current.stagePath.veto || null;
      current.stagePath.sizing = downstream.dynamicPositionSizing || {};
    }
    if (category === EVENT_CATEGORIES.EXECUTION) current.stagePath.execution = { action: event.executionAction || 'none', module: event.module || 'unknown' };
    if (category === EVENT_CATEGORIES.LIFECYCLE || category === EVENT_CATEGORIES.PROTECTIVE) current.stagePath.lifecycle = { decision: event.finalDecision || 'unknown' };

    current.latestFinalDecision = event.finalDecision || current.latestFinalDecision;
    current.chain.push({
      timestamp: event.timestamp || new Date().toISOString(),
      category,
      module: event.module || 'unknown',
      eventType: event.eventType || 'unknown',
      finalDecision: event.finalDecision || 'unknown',
    });

    if (current.chain.length > 100) current.chain = current.chain.slice(current.chain.length - 100);
    auditTrail.set(key, current);

    if (auditTrail.size > config.auditTrail.maxEntries) {
      const firstKey = auditTrail.keys().next().value;
      auditTrail.delete(firstKey);
    }
  }

  function ingestEvent(rawEvent = {}) {
    const startedAt = now();
    if (!config.enabled) return { accepted: false, reason: 'disabled' };
    const event = {
      timestamp: new Date().toISOString(),
      mode: rawEvent.mode || 'live',
      ...rawEvent,
    };
    if (event.mode === 'paper' && !config.includePaperMode) return { accepted: false, reason: 'paper_mode_filtered' };
    if (event.mode === 'live' && !config.includeLiveMode) return { accepted: false, reason: 'live_mode_filtered' };

    const category = classifyEvent(event);
    const critical = isCriticalEvent(category, event);
    const sampledIn = critical || shouldSample(category);
    if (!sampledIn && !critical) return { accepted: false, reason: 'sampled_out', category };

    updateReports(event, category);
    const pipelinePart = classifyPipelinePart(event, category);
    reports.performance.byPipelinePart[pipelinePart].events += 1;
    updateAuditTrail(event, category);
    if (config.storage.enabled && (critical || config.sampling.alwaysKeepCritical || shouldSample(category))) {
      buffer.push({ ...event, category, critical });
      reports.performance.bufferHighWatermark = Math.max(reports.performance.bufferHighWatermark, buffer.length);
      if (buffer.length >= config.maxBufferSize) {
        flushBuffer().catch(() => {});
      } else {
        scheduleFlush();
      }
    }

    tickCounter += 1;
    if (tickCounter > config.aggregateWindowCycles) {
      tickCounter = 0;
      const cycleKeys = Array.from(reports.byCycle.keys());
      if (cycleKeys.length > config.aggregateWindowCycles) {
        cycleKeys.slice(0, cycleKeys.length - config.aggregateWindowCycles).forEach((key) => reports.byCycle.delete(key));
      }
    }

    const duration = now() - startedAt;
    reports.performance.ingestEvents.calls += 1;
    reports.performance.ingestEvents.totalMs += duration;
    reports.performance.ingestEvents.avgMs = reports.performance.ingestEvents.calls > 0
      ? reports.performance.ingestEvents.totalMs / reports.performance.ingestEvents.calls
      : 0;
    reports.performance.ingestEvents.maxMs = Math.max(reports.performance.ingestEvents.maxMs, duration);

    return { accepted: true, category, critical, pipelinePart };
  }

  function getReports() {
    reports.performance.analytics.getReportsCalls += 1;
    return {
      byCycle: Object.fromEntries(reports.byCycle),
      byTicker: Object.fromEntries(reports.byTicker),
      byPosition: Object.fromEntries(reports.byPosition),
      byDay: Object.fromEntries(reports.byDay),
      byDecisionType: { ...reports.byDecisionType },
      vetoReasons: { ...reports.vetoReasons },
      executionEvents: { ...reports.executionEvents },
      protectiveEvents: { ...reports.protectiveEvents },
      regimeChanges: { ...reports.regimeChanges },
      mlDecisions: { ...reports.mlDecisions },
      modeSplit: { ...reports.modeSplit },
      performance: {
        ingestEvents: { ...reports.performance.ingestEvents },
        flush: { ...reports.performance.flush },
        analytics: { ...reports.performance.analytics },
        byPipelinePart: { ...reports.performance.byPipelinePart },
        bufferHighWatermark: reports.performance.bufferHighWatermark,
      },
    };
  }

  function getAuditTrail(filters = {}) {
    reports.performance.analytics.getAuditTrailCalls += 1;
    const values = Array.from(auditTrail.values()).filter((item) => {
      if (filters.cycleId && item.cycleId !== filters.cycleId) return false;
      if (filters.ticker && item.ticker !== filters.ticker) return false;
      return true;
    }).map((item) => ({
      ...item,
      requiredPath: AUDIT_STAGES.reduce((acc, stage) => ({ ...acc, [stage]: item.stagePath[stage] || null }), {}),
    }));
    return values;
  }

  return {
    EVENT_CATEGORIES,
    AUDIT_STAGES,
    config,
    ingestEvent,
    getReports,
    getAuditTrail,
    flush: flushBuffer,
  };
}

module.exports = {
  EVENT_CATEGORIES,
  AUDIT_STAGES,
  normalizeConfig,
  classifyEvent,
  createObservabilityLayer,
};
