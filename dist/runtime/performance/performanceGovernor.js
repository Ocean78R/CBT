'use strict';

const DEFAULT_LAYER_BUDGETS_MS = {
  regimeRouter: 35,
  htfStructure: 70,
  zones: 65,
  vwapProfile: 55,
  bounceBreakdown: 60,
  derivativesContext: 45,
  confirmations: 75,
  mlInference: 90,
};

const DEFAULT_LAYER_PRIORITIES = {
  executionCritical: 100,
  riskProtection: 95,
  regimeRouter: 80,
  cheapContext: 70,
  expensiveConfirmations: 55,
  mlInference: 45,
  analytics: 25,
};

function normalizeGovernorConfig(raw = {}) {
  const cycle = raw.cycle || {};
  const budgets = raw.budgets || {};
  const stagedEvaluation = raw.stagedEvaluation || {};
  const tickerLimits = raw.tickerLimits || {};
  const refreshCadence = raw.refreshCadence || {};
  const observability = raw.observability || {};
  const memory = raw.memory || {};
  const cache = raw.cache || {};
  const loopClasses = raw.loopClasses || {};
  const parallelism = raw.parallelism || {};
  const priorities = raw.priorities || {};
  const degradation = raw.degradation || {};
  const optionalLayers = Array.isArray(raw.optionalLayers) ? raw.optionalLayers : [];

  return {
    enabled: !!raw.enabled,
    mode: ['monitor_only', 'enforce'].includes(raw.mode) ? raw.mode : 'monitor_only',
    cycle: {
      targetMs: Math.max(100, Number(cycle.targetMs || 1200)),
      hardLimitMs: Math.max(100, Number(cycle.hardLimitMs || 1600)),
    },
    budgets: {
      byLayerMs: {
        ...DEFAULT_LAYER_BUDGETS_MS,
        ...(typeof budgets.byLayerMs === 'object' && budgets.byLayerMs ? budgets.byLayerMs : {}),
      },
      reserveForExecutionMs: Math.max(0, Number(budgets.reserveForExecutionMs || 180)),
      optionalContextShare: Math.max(0, Math.min(1, Number(budgets.optionalContextShare || 0.35))),
    },
    priorities: {
      ...DEFAULT_LAYER_PRIORITIES,
      ...(typeof priorities === 'object' && priorities ? priorities : {}),
    },
    stagedEvaluation: {
      enabled: stagedEvaluation.enabled !== false,
      sequence: Array.isArray(stagedEvaluation.sequence) && stagedEvaluation.sequence.length > 0
        ? stagedEvaluation.sequence
        : ['shortlist', 'cheap_context', 'expensive_confirmations', 'final_decision'],
    },
    tickerLimits: {
      maxExpensiveTickersPerCycle: Math.max(1, Number(tickerLimits.maxExpensiveTickersPerCycle || 12)),
      maxMlTickersPerCycle: Math.max(1, Number(tickerLimits.maxMlTickersPerCycle || 6)),
    },
    refreshCadence: {
      enabled: refreshCadence.enabled !== false,
      rareFeatureMinIntervalMs: Math.max(200, Number(refreshCadence.rareFeatureMinIntervalMs || 4000)),
      derivativesContextMinIntervalMs: Math.max(200, Number(refreshCadence.derivativesContextMinIntervalMs || 2000)),
      mlMinIntervalMs: Math.max(500, Number(refreshCadence.mlMinIntervalMs || 8000)),
    },
    observability: {
      maxSyncEventsPerCycle: Math.max(10, Number(observability.maxSyncEventsPerCycle || 120)),
    },
    memory: {
      maxHotStateTickers: Math.max(50, Number(memory.maxHotStateTickers || 300)),
      maxDerivedFeatureEntries: Math.max(100, Number(memory.maxDerivedFeatureEntries || 2000)),
    },
    cache: {
      preferCachedModeOnBudgetPressure: cache.preferCachedModeOnBudgetPressure !== false,
      degradeToCachedBeforeSkip: cache.degradeToCachedBeforeSkip !== false,
    },
    loopClasses: {
      executionCriticalHz: Math.max(1, Number(loopClasses.executionCriticalHz || 1)),
      signalCoreHz: Math.max(1, Number(loopClasses.signalCoreHz || 1)),
      optionalContextHz: Math.max(1, Number(loopClasses.optionalContextHz || 1)),
      analyticsHz: Math.max(1, Number(loopClasses.analyticsHz || 1)),
    },
    parallelism: {
      maxHeavyLayerConcurrency: Math.max(1, Number(parallelism.maxHeavyLayerConcurrency || 2)),
      maxAnalyticsConcurrency: Math.max(1, Number(parallelism.maxAnalyticsConcurrency || 1)),
    },
    degradation: {
      enabled: degradation.enabled !== false,
      pressureThresholdPercent: Math.max(0.5, Math.min(0.99, Number(degradation.pressureThresholdPercent || 0.82))),
      hardPressureThresholdPercent: Math.max(0.7, Math.min(1, Number(degradation.hardPressureThresholdPercent || 0.95))),
    },
    optionalLayers,
  };
}

function nowMs() {
  return Date.now();
}

function createPerformanceGovernor(rawConfig = {}, hooks = {}) {
  const config = normalizeGovernorConfig(rawConfig);
  const rareFeatureState = new Map();
  let cycleState = null;

  function emit(event = {}) {
    if (!hooks || typeof hooks.onGovernorEvent !== 'function') return;
    try {
      hooks.onGovernorEvent(event);
    } catch (_error) {
      // Русский комментарий: governor-события не должны останавливать торговый цикл.
    }
  }

  function createInitialCycleState(context = {}) {
    return {
      cycleId: context.cycleId || null,
      exchange: context.exchange || 'unknown',
      marketRegime: context.marketRegime || 'unknown',
      capitalRegime: context.capitalRegime || 'unknown',
      startedAt: nowMs(),
      consumedMsByLayer: {},
      layerModes: {},
      stage: 'shortlist',
      expensiveTickers: 0,
      mlTickers: 0,
      syncEvents: 0,
      heavyLayerInflight: 0,
      analyticsInflight: 0,
      runtimeBudgetMs: config.cycle.targetMs,
      hardLimitMs: config.cycle.hardLimitMs,
      reserveForExecutionMs: config.budgets.reserveForExecutionMs,
    };
  }

  function onCycleStart(context = {}) {
    cycleState = createInitialCycleState(context);
    emit({
      type: 'performance_governor_cycle_start',
      module: 'performanceGovernor',
      layer: 'performance.controlPlane',
      cycleId: cycleState.cycleId,
      ticker: context.ticker || 'PORTFOLIO',
      exchange: cycleState.exchange,
      marketRegime: cycleState.marketRegime,
      capitalRegime: cycleState.capitalRegime,
      setupType: context.setupType || 'portfolio',
      score: Number.isFinite(context.score) ? context.score : 0,
      confidence: Number.isFinite(context.confidence) ? context.confidence : 0,
      vetoReason: 'none',
      sizingDecision: context.sizingDecision || 'not_evaluated',
      executionAction: 'start_cycle',
      finalDecision: 'allow',
    });
  }

  function getCycleElapsedMs() {
    if (!cycleState) return 0;
    return Math.max(0, nowMs() - cycleState.startedAt);
  }

  function getCyclePressure() {
    if (!cycleState) return 0;
    return getCycleElapsedMs() / Math.max(1, cycleState.runtimeBudgetMs);
  }

  function setStage(stage) {
    if (!cycleState) onCycleStart({});
    cycleState.stage = stage;
  }

  function shouldAllowObservabilitySync() {
    if (!cycleState) onCycleStart({});
    if (cycleState.syncEvents >= config.observability.maxSyncEventsPerCycle) return false;
    cycleState.syncEvents += 1;
    return true;
  }

  function isOptionalLayer(layerName) {
    if (config.optionalLayers.includes(layerName)) return true;
    return ['zones', 'vwapProfile', 'bounceBreakdown', 'confirmations', 'mlInference', 'analytics'].includes(layerName);
  }

  function resolveLayerMode(layerName, context = {}) {
    if (!config.enabled) return { mode: 'full', reason: 'governor_disabled' };
    if (!cycleState) onCycleStart(context);

    const elapsed = getCycleElapsedMs();
    const pressure = getCyclePressure();
    const budgetMs = Number(config.budgets.byLayerMs[layerName] || 0);
    const consumedMs = Number(cycleState.consumedMsByLayer[layerName] || 0);
    const optional = isOptionalLayer(layerName);
    const nearHardLimit = elapsed >= (cycleState.hardLimitMs - cycleState.reserveForExecutionMs);
    const budgetExceeded = budgetMs > 0 && consumedMs >= budgetMs;
    const overPressure = pressure >= config.degradation.pressureThresholdPercent;
    const hardPressure = pressure >= config.degradation.hardPressureThresholdPercent;

    if (!optional) return { mode: 'full', reason: 'priority_layer' };
    if (config.mode !== 'enforce') return { mode: 'full', reason: 'monitor_mode' };
    if (!config.degradation.enabled) return { mode: 'full', reason: 'degradation_disabled' };

    if (nearHardLimit || hardPressure) {
      if (config.cache.degradeToCachedBeforeSkip && config.cache.preferCachedModeOnBudgetPressure) {
        return { mode: 'cached', reason: 'hard_pressure_cached' };
      }
      return { mode: 'skip', reason: 'hard_pressure_skip' };
    }

    if (budgetExceeded || overPressure) {
      if (config.cache.preferCachedModeOnBudgetPressure) return { mode: 'cached', reason: 'budget_pressure_cached' };
      return { mode: 'degraded', reason: 'budget_pressure_degraded' };
    }

    return { mode: 'full', reason: 'within_budget' };
  }

  function registerLayerExecution(layerName, durationMs, mode = 'full') {
    if (!cycleState) onCycleStart({});
    cycleState.consumedMsByLayer[layerName] = Number(cycleState.consumedMsByLayer[layerName] || 0) + Math.max(0, Number(durationMs || 0));
    cycleState.layerModes[layerName] = mode;
  }

  function allowExpensiveTicker(layerName) {
    if (!cycleState) onCycleStart({});
    const limit = config.tickerLimits.maxExpensiveTickersPerCycle;
    if (layerName === 'mlInference') {
      if (cycleState.mlTickers >= config.tickerLimits.maxMlTickersPerCycle) return false;
      cycleState.mlTickers += 1;
      return true;
    }
    if (cycleState.expensiveTickers >= limit) return false;
    cycleState.expensiveTickers += 1;
    return true;
  }

  function shouldRefreshRareFeature(featureKey, bucket = 'rare', timestamp = nowMs()) {
    if (!config.refreshCadence.enabled) return true;
    const key = `${bucket}:${featureKey}`;
    const previous = rareFeatureState.get(key) || 0;
    let minInterval = config.refreshCadence.rareFeatureMinIntervalMs;
    if (bucket === 'derivatives') minInterval = config.refreshCadence.derivativesContextMinIntervalMs;
    if (bucket === 'ml') minInterval = config.refreshCadence.mlMinIntervalMs;
    if ((timestamp - previous) < minInterval) return false;
    rareFeatureState.set(key, timestamp);
    return true;
  }

  function trackInflight(channel, delta) {
    if (!cycleState) onCycleStart({});
    if (channel === 'heavy') {
      cycleState.heavyLayerInflight = Math.max(0, cycleState.heavyLayerInflight + delta);
      return cycleState.heavyLayerInflight <= config.parallelism.maxHeavyLayerConcurrency;
    }
    cycleState.analyticsInflight = Math.max(0, cycleState.analyticsInflight + delta);
    return cycleState.analyticsInflight <= config.parallelism.maxAnalyticsConcurrency;
  }

  function finalizeCycle(context = {}) {
    if (!cycleState) return null;
    const summary = getCycleDiagnostics();
    emit({
      type: 'performance_governor_cycle_end',
      module: 'performanceGovernor',
      layer: 'performance.controlPlane',
      cycleId: cycleState.cycleId,
      ticker: context.ticker || 'PORTFOLIO',
      exchange: cycleState.exchange,
      marketRegime: cycleState.marketRegime,
      capitalRegime: cycleState.capitalRegime,
      setupType: context.setupType || 'portfolio',
      score: Number.isFinite(context.score) ? context.score : 0,
      confidence: Number.isFinite(context.confidence) ? context.confidence : 0,
      vetoReason: 'none',
      sizingDecision: context.sizingDecision || 'not_evaluated',
      executionAction: 'finalize_cycle',
      finalDecision: summary.pressure >= config.degradation.hardPressureThresholdPercent ? 'degraded' : 'allow',
      payload: summary,
    });
    return summary;
  }

  function getCycleDiagnostics() {
    if (!cycleState) return {
      enabled: config.enabled,
      mode: config.mode,
      stage: 'idle',
      pressure: 0,
      elapsedMs: 0,
      consumedMsByLayer: {},
      layerModes: {},
      expensiveTickers: 0,
      mlTickers: 0,
      syncEvents: 0,
    };

    return {
      enabled: config.enabled,
      mode: config.mode,
      stage: cycleState.stage,
      pressure: getCyclePressure(),
      elapsedMs: getCycleElapsedMs(),
      runtimeBudgetMs: cycleState.runtimeBudgetMs,
      hardLimitMs: cycleState.hardLimitMs,
      reserveForExecutionMs: cycleState.reserveForExecutionMs,
      consumedMsByLayer: { ...cycleState.consumedMsByLayer },
      layerModes: { ...cycleState.layerModes },
      expensiveTickers: cycleState.expensiveTickers,
      mlTickers: cycleState.mlTickers,
      syncEvents: cycleState.syncEvents,
      stagedEvaluation: config.stagedEvaluation,
      loopClasses: config.loopClasses,
      priorities: config.priorities,
      memory: config.memory,
    };
  }

  return {
    config,
    onCycleStart,
    finalizeCycle,
    setStage,
    resolveLayerMode,
    registerLayerExecution,
    allowExpensiveTicker,
    shouldRefreshRareFeature,
    shouldAllowObservabilitySync,
    trackInflight,
    getCycleDiagnostics,
  };
}

module.exports = { createPerformanceGovernor, normalizeGovernorConfig, DEFAULT_LAYER_BUDGETS_MS, DEFAULT_LAYER_PRIORITIES };
