'use strict';

const DECISION_STAGES = ['universe', 'regime', 'confluence', 'veto', 'sizing', 'execution', 'lifecycle'];

const EVENT_CLASS = {
  DECISION: 'decision_events',
  EXECUTION: 'execution_events',
  PROTECTIVE: 'protective_events',
  REGIME: 'regime_events',
  LIFECYCLE: 'lifecycle_events',
  FORECAST_EVENTS: 'forecast_events',
  FORECAST_RESTRICTIONS: 'forecast_restrictions',
  FORECAST_PROTECTIVE_HINTS: 'forecast_protective_hints',
  UNKNOWN: 'unknown_events',
};

function clamp01(value, fallback = 1) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, Number(value)));
}

function normalizeObservabilityConfig(config = {}) {
  const sampling = config.sampling || {};
  const aggregation = config.aggregation || {};

  return {
    enabled: !!config.enabled,
    captureAuditTrail: config.captureAuditTrail !== false,
    includeMlDecisions: config.includeMlDecisions !== false,
    flushBatchSize: Math.max(1, Number(config.flushBatchSize || 200)),
    maxBufferSize: Math.max(100, Number(config.maxBufferSize || 5000)),
    sampling: {
      decisionEventsRate: clamp01(sampling.decisionEventsRate, 1),
      diagnosticEventsRate: clamp01(sampling.diagnosticEventsRate, 0.4),
      mlEventsRate: clamp01(sampling.mlEventsRate, 1),
    },
    aggregation: {
      enabled: aggregation.enabled !== false,
      windowMs: Math.max(1000, Number(aggregation.windowMs || 30000)),
    },
  };
}

function buildEmptyCounters() {
  return {
    decision_events: 0,
    execution_events: 0,
    protective_events: 0,
    regime_events: 0,
    lifecycle_events: 0,
    forecast_events: 0,
    forecast_restrictions: 0,
    forecast_protective_hints: 0,
    unknown_events: 0,
  };
}

function dateKey(timestampMs) {
  return new Date(Number(timestampMs || Date.now())).toISOString().slice(0, 10);
}

function shallowCopy(obj) {
  return obj && typeof obj === 'object' ? { ...obj } : {};
}

function classifyEvent(event = {}) {
  const type = String(event.eventType || '').toLowerCase();
  const layer = String(event.layer || '').toLowerCase();
  const module = String(event.module || '').toLowerCase();

  if (type.includes('forecast') || module.includes('forecast')) return EVENT_CLASS.FORECAST_EVENTS;
  if (type.includes('forced_loss_exit') || layer.includes('positionprotection') || layer.includes('protect')) return EVENT_CLASS.PROTECTIVE;
  if (type.includes('execution') || layer.includes('execution') || module.includes('execution')) return EVENT_CLASS.EXECUTION;
  if (type.includes('regime') || layer.includes('regime') || module.includes('regime')) return EVENT_CLASS.REGIME;
  if (type.includes('lifecycle') || layer.includes('lifecycle')) return EVENT_CLASS.LIFECYCLE;
  if (type.includes('decision') || type.includes('veto') || layer.includes('entry') || layer.includes('confluence')) return EVENT_CLASS.DECISION;

  return EVENT_CLASS.UNKNOWN;
}

function createUnifiedObservabilityLayer(rawConfig = {}) {
  const config = normalizeObservabilityConfig(rawConfig);
  const state = {
    counters: buildEmptyCounters(),
    cycleStats: new Map(),
    tickerStats: new Map(),
    positionStats: new Map(),
    dayStats: new Map(),
    decisionTypeStats: new Map(),
    refusalReasons: new Map(),
    regimeChanges: [],
    mlDecisions: [],
    executionEvents: [],
    protectiveEvents: [],
    lifecycleEvents: [],
    forecastEvents: [],
    forecastRestrictions: [],
    forecastProtectiveHints: [],
    auditTrail: new Map(),
    ingestionBuffer: [],
    aggregatedDiagnostics: new Map(),
  };

  function shouldKeepEvent(eventClass, event = {}) {
    if (!config.enabled) return false;

    const critical = eventClass === EVENT_CLASS.EXECUTION
      || eventClass === EVENT_CLASS.PROTECTIVE
      || eventClass === EVENT_CLASS.LIFECYCLE
      || eventClass === EVENT_CLASS.REGIME
      || eventClass === EVENT_CLASS.FORECAST_EVENTS;

    if (critical) return true;

    const eventType = String(event.eventType || '').toLowerCase();
    const isMl = eventType.includes('ml') || String(event.module || '').toLowerCase().includes('ml');
    const rate = isMl ? config.sampling.mlEventsRate : config.sampling.decisionEventsRate;
    return Math.random() <= rate;
  }

  function ingestToBuffer(event, eventClass) {
    if (state.ingestionBuffer.length >= config.maxBufferSize) {
      state.ingestionBuffer.shift();
    }

    state.ingestionBuffer.push({
      event,
      eventClass,
      ts: Number(event.timestampMs || Date.now()),
    });

    if (state.ingestionBuffer.length >= config.flushBatchSize) {
      flushBuffered();
    }
  }

  function flushBuffered() {
    if (state.ingestionBuffer.length === 0) return;
    const batch = state.ingestionBuffer.splice(0, state.ingestionBuffer.length);
    for (const item of batch) {
      applyEvent(item.event, item.eventClass, item.ts);
    }
  }

  function updateMapCounter(map, key, field) {
    const current = map.get(key) || { eventsTotal: 0, counters: buildEmptyCounters() };
    current.eventsTotal += 1;
    current.counters[field] += 1;
    map.set(key, current);
  }

  function applyDecisionDetails(event, ts) {
    const finalDecision = event.finalDecision || 'unknown';
    state.decisionTypeStats.set(finalDecision, Number(state.decisionTypeStats.get(finalDecision) || 0) + 1);

    if (event.vetoReason) {
      state.refusalReasons.set(event.vetoReason, Number(state.refusalReasons.get(event.vetoReason) || 0) + 1);
    }

    if (event.capitalRegime && event.payload && event.payload.balanceState && event.payload.balanceState.regimeChanged) {
      state.regimeChanges.push({
        cycleId: event.cycleId || '',
        ticker: event.ticker || 'PORTFOLIO',
        previous: event.payload.balanceState.previousCapitalRegime || 'NORMAL',
        current: event.capitalRegime,
        timestampMs: ts,
      });
    }
  }

  function applyForecastDetails(event, ts) {
    const payload = event.payload || {};
    const outputHints = payload.outputHints || {};

    state.forecastEvents.push({
      cycleId: event.cycleId || '',
      ticker: event.ticker || 'PORTFOLIO',
      risk: payload.forecastRegimeShiftRisk || 'normal',
      reasonCodes: Array.isArray(payload.reasonCodes) ? payload.reasonCodes : [],
      timestampMs: ts,
    });

    const restrictionHints = Array.isArray(outputHints.restrictionHints) ? outputHints.restrictionHints : [];
    for (const hint of restrictionHints) {
      state.forecastRestrictions.push({ cycleId: event.cycleId || '', ticker: event.ticker || '', hint, timestampMs: ts });
    }

    const protectiveHints = Array.isArray(outputHints.protectiveTighteningHints) ? outputHints.protectiveTighteningHints : [];
    for (const hint of protectiveHints) {
      state.forecastProtectiveHints.push({ cycleId: event.cycleId || '', ticker: event.ticker || '', hint, timestampMs: ts });
    }
  }

  function applyEvent(event, eventClass, ts) {
    state.counters[eventClass] += 1;

    const cycleId = event.cycleId || 'unknown_cycle';
    const ticker = event.ticker || 'PORTFOLIO';
    const positionKey = event.positionId || `${ticker}:${event.side || 'unknown'}`;
    const day = dateKey(ts);

    updateMapCounter(state.cycleStats, cycleId, eventClass);
    updateMapCounter(state.tickerStats, ticker, eventClass);
    updateMapCounter(state.positionStats, positionKey, eventClass);
    updateMapCounter(state.dayStats, day, eventClass);

    if (eventClass === EVENT_CLASS.DECISION || eventClass === EVENT_CLASS.REGIME) {
      applyDecisionDetails(event, ts);
    }
    if (eventClass === EVENT_CLASS.FORECAST_EVENTS) {
      applyForecastDetails(event, ts);
    }
    if (eventClass === EVENT_CLASS.EXECUTION) {
      state.executionEvents.push({ ...event, timestampMs: ts });
    }
    if (eventClass === EVENT_CLASS.PROTECTIVE) {
      state.protectiveEvents.push({ ...event, timestampMs: ts });
    }
    if (eventClass === EVENT_CLASS.LIFECYCLE) {
      state.lifecycleEvents.push({ ...event, timestampMs: ts });
    }

    maybeUpdateAuditTrail(event, eventClass, ts);
  }

  function maybeUpdateAuditTrail(event, eventClass, ts) {
    if (!config.captureAuditTrail) return;

    const trailKey = `${event.cycleId || 'cycle'}:${event.ticker || 'PORTFOLIO'}`;
    const trail = state.auditTrail.get(trailKey) || {
      cycleId: event.cycleId || '',
      ticker: event.ticker || 'PORTFOLIO',
      updatedAtMs: ts,
      chain: {
        capital_state: null,
        forecast_stress: null,
        universe: null,
        regime: null,
        confluence: null,
        veto: null,
        sizing: null,
        execution: null,
        lifecycle: null,
      },
      raw: [],
    };

    trail.updatedAtMs = ts;

    if (eventClass === EVENT_CLASS.REGIME || eventClass === EVENT_CLASS.DECISION) {
      trail.chain.regime = {
        capitalRegime: event.capitalRegime || null,
        marketRegime: event.marketRegime || null,
        finalDecision: event.finalDecision || null,
      };

      trail.chain.veto = event.vetoReason ? { reason: event.vetoReason, layer: event.layer || 'unknown' } : trail.chain.veto;
      trail.chain.sizing = event.sizingDecision ? { decision: event.sizingDecision } : trail.chain.sizing;
      trail.chain.capital_state = {
        capitalRegime: event.capitalRegime || null,
        forecastRegimeShiftRisk: event.forecastRegimeShiftRisk || null,
      };
    }

    if (eventClass === EVENT_CLASS.FORECAST_EVENTS) {
      const payload = event.payload || {};
      trail.chain.forecast_stress = {
        risk: payload.forecastRegimeShiftRisk || null,
        restrictions: payload.outputHints && payload.outputHints.restrictionHints ? payload.outputHints.restrictionHints : [],
        protective: payload.outputHints && payload.outputHints.protectiveTighteningHints ? payload.outputHints.protectiveTighteningHints : [],
        sizing: payload.outputHints && payload.outputHints.sizingHints ? payload.outputHints.sizingHints : null,
      };
    }

    if (eventClass === EVENT_CLASS.EXECUTION) {
      trail.chain.execution = {
        action: event.executionAction || event.eventType || 'unknown_execution',
        finalDecision: event.finalDecision || null,
      };
    }
    if (eventClass === EVENT_CLASS.LIFECYCLE || eventClass === EVENT_CLASS.PROTECTIVE) {
      trail.chain.lifecycle = {
        action: event.finalDecision || event.eventType || 'unknown_lifecycle',
        protective: eventClass === EVENT_CLASS.PROTECTIVE,
      };
    }

    trail.raw.push({
      eventType: event.eventType || 'unknown',
      layer: event.layer || 'unknown',
      class: eventClass,
      finalDecision: event.finalDecision || null,
      timestampMs: ts,
    });
    if (trail.raw.length > 60) trail.raw.shift();

    state.auditTrail.set(trailKey, trail);
  }

  function aggregateDiagnosticEvent(event, eventClass) {
    if (!config.aggregation.enabled) {
      ingestToBuffer(event, eventClass);
      return;
    }

    const now = Number(event.timestampMs || Date.now());
    const key = `${eventClass}|${event.eventType || 'unknown'}|${event.ticker || 'PORTFOLIO'}`;
    const bucketStart = now - (now % config.aggregation.windowMs);
    const bucketKey = `${key}|${bucketStart}`;

    const bucket = state.aggregatedDiagnostics.get(bucketKey) || {
      count: 0,
      bucketStart,
      sampleEvent: { ...event },
      eventClass,
    };

    bucket.count += 1;
    state.aggregatedDiagnostics.set(bucketKey, bucket);

    // Русский комментарий: при накоплении агрегата пишем только одну запись в буфер, не блокируя торговый цикл тяжёлой сериализацией.
    if (bucket.count === 1 || bucket.count % Math.max(1, Math.floor(config.flushBatchSize / 4)) === 0) {
      ingestToBuffer({
        ...bucket.sampleEvent,
        eventType: `${bucket.sampleEvent.eventType || 'diagnostic'}_aggregated`,
        payload: {
          ...(bucket.sampleEvent.payload || {}),
          aggregatedCount: bucket.count,
          aggregationWindowMs: config.aggregation.windowMs,
        },
      }, eventClass);
    }
  }

  function captureStructuredEvent(rawEvent = {}) {
    if (!config.enabled || !rawEvent || typeof rawEvent !== 'object') return;

    const event = {
      ...rawEvent,
      timestampMs: Number(rawEvent.timestampMs || Date.now()),
    };

    const eventClass = classifyEvent(event);
    if (!shouldKeepEvent(eventClass, event)) return;

    const isDiagnostic = eventClass === EVENT_CLASS.DECISION || eventClass === EVENT_CLASS.UNKNOWN;
    if (isDiagnostic && Math.random() > config.sampling.diagnosticEventsRate) {
      aggregateDiagnosticEvent(event, eventClass);
      return;
    }

    ingestToBuffer(event, eventClass);
  }

  function captureDecisionSnapshot(input = {}) {
    if (!config.enabled) return;

    const context = input.context || {};
    const decision = input.decision || {};
    const event = {
      eventType: 'decision_contract_snapshot',
      cycleId: context.cycleId || '',
      ticker: context.ticker || 'PORTFOLIO',
      exchange: context.exchange || '',
      module: 'unifiedObservability',
      layer: 'observability.decisionContract',
      marketRegime: context.regime || context.marketRegime || 'unknown',
      capitalRegime: context.capitalRegime || 'NORMAL',
      score: Number.isFinite(context.score) ? Number(context.score) : 0,
      confidence: Number.isFinite(context.confidence) ? Number(context.confidence) : 0,
      vetoReason: context.veto ? (context.veto.reason || context.veto.type || null) : null,
      sizingDecision: decision.sizingDecision || 'not_evaluated',
      executionAction: decision.executionAction || 'not_requested',
      finalDecision: decision.finalDecision || 'unknown',
      payload: {
        decisionContext: shallowCopy(context),
        score: Number.isFinite(context.score) ? Number(context.score) : 0,
        veto: context.veto || null,
        execution: decision.execution || null,
      },
    };

    captureStructuredEvent(event);
  }

  function captureMlDecision(input = {}) {
    if (!config.enabled || !config.includeMlDecisions) return;

    const event = {
      eventType: input.eventType || 'ml_decision',
      cycleId: input.cycleId || '',
      ticker: input.ticker || 'PORTFOLIO',
      exchange: input.exchange || '',
      module: input.module || 'mlMetaController',
      layer: input.layer || 'ml.decision',
      marketRegime: input.marketRegime || 'unknown',
      capitalRegime: input.capitalRegime || 'NORMAL',
      finalDecision: input.finalDecision || 'ml_observe_only',
      score: Number.isFinite(input.score) ? Number(input.score) : 0,
      confidence: Number.isFinite(input.confidence) ? Number(input.confidence) : 0,
      payload: {
        features: input.features || {},
        modelVersion: input.modelVersion || 'unknown',
      },
    };

    state.mlDecisions.push({ ...event, timestampMs: Date.now() });
    captureStructuredEvent(event);
  }

  function emitCycleSummary(cycleId) {
    flushBuffered();
    return state.cycleStats.get(cycleId) || { eventsTotal: 0, counters: buildEmptyCounters() };
  }

  function getReports() {
    flushBuffered();

    const auditTrail = {};
    for (const [key, value] of state.auditTrail.entries()) {
      auditTrail[key] = {
        ...value,
        // Русский комментарий: фиксированная цепочка стадий нужна для восстановления последовательности universe->...->lifecycle в audit trail.
        orderedStages: DECISION_STAGES,
      };
    }

    return {
      totals: { ...state.counters },
      byCycle: Object.fromEntries(state.cycleStats.entries()),
      byTicker: Object.fromEntries(state.tickerStats.entries()),
      byPosition: Object.fromEntries(state.positionStats.entries()),
      byDay: Object.fromEntries(state.dayStats.entries()),
      byDecisionType: Object.fromEntries(state.decisionTypeStats.entries()),
      refusalReasons: Object.fromEntries(state.refusalReasons.entries()),
      executionEvents: state.executionEvents.slice(-500),
      protectiveEvents: state.protectiveEvents.slice(-500),
      lifecycleEvents: state.lifecycleEvents.slice(-500),
      regimeChanges: state.regimeChanges.slice(-500),
      mlDecisions: state.mlDecisions.slice(-500),
      forecast_events: state.forecastEvents.slice(-500),
      forecast_restrictions: state.forecastRestrictions.slice(-500),
      forecast_protective_hints: state.forecastProtectiveHints.slice(-500),
      auditTrail,
    };
  }

  return {
    config,
    eventClasses: EVENT_CLASS,
    captureStructuredEvent,
    captureDecisionSnapshot,
    captureMlDecision,
    emitCycleSummary,
    getReports,
    flushBuffered,
  };
}

module.exports = {
  DECISION_STAGES,
  EVENT_CLASS,
  normalizeObservabilityConfig,
  createUnifiedObservabilityLayer,
};
