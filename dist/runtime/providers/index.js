'use strict';

const { createRequestScheduler, normalizeSchedulerConfig } = require('../scheduler/requestScheduler');

function normalizePerfConfig(config = {}) {
  const readOnlyCache = config.readOnlyCache || {};
  const hotState = config.hotState || {};
  const invalidation = config.invalidation || {};
  const metrics = config.metrics || {};
  const derivedFeatureCache = config.derivedFeatureCache || {};
  const ttl = derivedFeatureCache.ttl || {};
  const forcedRefresh = derivedFeatureCache.forcedRefresh || {};
  const requestScheduler = config.requestScheduler || {};

  return {
    enabled: !!config.enabled,
    loggerEnabled: !!config.loggerEnabled,
    logEveryNCalls: Number(config.logEveryNCalls || 200),
    readOnlyCache: {
      enabled: readOnlyCache.enabled !== false,
      markPriceTtlMs: Number(readOnlyCache.markPriceTtlMs || readOnlyCache.ttlMs || 1200),
      klineTtlMs: Number(readOnlyCache.klineTtlMs || readOnlyCache.ttlMs || 2500),
      accountReadTtlMs: Number(readOnlyCache.accountReadTtlMs || readOnlyCache.ttlMs || 900),
      maxEntries: Number(readOnlyCache.maxEntries || 1000),
      methods: Array.isArray(readOnlyCache.methods) && readOnlyCache.methods.length > 0
        ? readOnlyCache.methods
        : ['getTickerInfo', 'getMarkPrice', 'getKLine', 'getLeverage', 'getMarginMode', 'getBalance'],
    },
    hotState: {
      enabled: hotState.enabled !== false,
      maxTickers: Number(hotState.maxTickers || 300),
      staleReuseGraceMs: Number(hotState.staleReuseGraceMs || 350),
    },
    invalidation: {
      onError: invalidation.onError !== false,
      onExecutionTickers: invalidation.onExecutionTickers !== false,
      fullFlushOnCycleStart: !!invalidation.fullFlushOnCycleStart,
    },
    derivedFeatureCache: {
      enabled: derivedFeatureCache.enabled !== false,
      featureVersion: derivedFeatureCache.featureVersion || 'v1',
      ttl: {
        ultraShortMs: Number(ttl.ultraShortMs || 800),
        perCycleMs: Number(ttl.perCycleMs || 4500),
        contextMs: Number(ttl.contextMs || 25000),
      },
      forcedRefresh: {
        indicatorsEveryCycles: Number(forcedRefresh.indicatorsEveryCycles || 0),
        htfStructureEveryCycles: Number(forcedRefresh.htfStructureEveryCycles || 0),
      },
    },
    metrics: {
      enabled: metrics.enabled !== false,
      slowCallMs: Number(metrics.slowCallMs || 250),
    },
    requestScheduler: normalizeSchedulerConfig(requestScheduler),
  };
}

function createPerfState(perfConfig, logger, hooks = {}) {
  return {
    cache: new Map(),
    inFlight: new Map(),
    hotStateByTicker: new Map(),
    derivedFeatureCache: {
      ultraShort: new Map(),
      perCycle: new Map(),
      context: new Map(),
    },
    metrics: {
      totalCalls: 0,
      cacheHits: 0,
      cacheMisses: 0,
      staleReuseHits: 0,
      forcedRefreshes: 0,
      inFlightHits: 0,
      slowCalls: 0,
      byMethod: {},
      lastSlowCalls: [],
      readOnly: {
        markPrice: { hit: 0, miss: 0, staleReuse: 0, forcedRefresh: 0 },
        kline: { hit: 0, miss: 0, staleReuse: 0, forcedRefresh: 0 },
      },
      derivedFeatures: {
        hit: 0,
        miss: 0,
        staleReuse: 0,
        forcedRefresh: 0,
      },
    },
    logger,
    hooks,
    config: perfConfig,
  };
}

function stableArgsKey(args = []) {
  try {
    return JSON.stringify(args);
  } catch (_error) {
    return String(args);
  }
}

function safeNow() {
  return Date.now();
}

function keepCacheLimit(cache, maxEntries) {
  if (cache.size <= maxEntries) return;
  const firstKey = cache.keys().next().value;
  if (firstKey) cache.delete(firstKey);
}

function updateMethodMetrics(state, methodName, durationMs, source) {
  const methodMetrics = state.metrics.byMethod[methodName] || {
    calls: 0,
    totalMs: 0,
    avgMs: 0,
    maxMs: 0,
    cacheHits: 0,
    cacheMisses: 0,
    staleReuseHits: 0,
    forcedRefreshes: 0,
    inFlightHits: 0,
    slowCalls: 0,
  };
  methodMetrics.calls += 1;
  methodMetrics.totalMs += Number(durationMs || 0);
  methodMetrics.avgMs = methodMetrics.calls > 0 ? methodMetrics.totalMs / methodMetrics.calls : 0;
  methodMetrics.maxMs = Math.max(methodMetrics.maxMs, Number(durationMs || 0));
  if (source === 'cache') methodMetrics.cacheHits += 1;
  if (source === 'miss') methodMetrics.cacheMisses += 1;
  if (source === 'stale') methodMetrics.staleReuseHits += 1;
  if (source === 'forced_refresh') methodMetrics.forcedRefreshes += 1;
  if (source === 'inflight') methodMetrics.inFlightHits += 1;
  if (Number(durationMs || 0) >= state.config.metrics.slowCallMs) methodMetrics.slowCalls += 1;
  state.metrics.byMethod[methodName] = methodMetrics;
}

// Русский комментарий: runtime hook под внешний governor/observability слой, без жёсткой зависимости.
function emitDiagnosticEvent(state, event) {
  if (!state.hooks || typeof state.hooks.onDiagnosticEvent !== 'function') return;
  try {
    state.hooks.onDiagnosticEvent(event);
  } catch (_error) {
    // Русский комментарий: диагностические события не должны ломать торговый runtime.
  }
}

function deriveReadOnlyTtl(methodName, perfState, args = []) {
  if (methodName === 'getMarkPrice') return perfState.config.readOnlyCache.markPriceTtlMs;
  if (methodName === 'getKLine') return perfState.config.readOnlyCache.klineTtlMs;
  if (['getLeverage', 'getMarginMode', 'getBalance'].includes(methodName)) return perfState.config.readOnlyCache.accountReadTtlMs;
  if (methodName === 'getTickerInfo') {
    const ticker = args[0];
    const hotState = ticker ? perfState.hotStateByTicker.get(ticker) : null;
    if (hotState && hotState.lastCycleId !== undefined && hotState.lastCycleId !== null) {
      // Русский комментарий: в пределах цикла допускаем короткий reuse для метаданных тикера.
      return Math.max(500, Math.floor(perfState.config.readOnlyCache.markPriceTtlMs / 2));
    }
  }
  return perfState.config.readOnlyCache.markPriceTtlMs;
}

function updateHotState(perfState, methodName, args, value, source, now) {
  if (!perfState.config.hotState.enabled) return;
  const ticker = args[0];
  if (!ticker || typeof ticker !== 'string') return;

  const current = perfState.hotStateByTicker.get(ticker) || {
    ticker,
    lastCycleId: null,
    marketRegime: 'unknown',
    capitalRegime: 'unknown',
    markPrice: null,
    markPriceTs: 0,
    klineByInterval: {},
    exchange: 'unknown',
  };

  if (methodName === 'getMarkPrice') {
    current.markPrice = value;
    current.markPriceTs = now;
    current.lastSource = source;
  }

  if (methodName === 'getKLine') {
    const interval = args[1] || 'unknown';
    current.klineByInterval[interval] = {
      value,
      ts: now,
      source,
    };
  }

  current.updatedAt = now;
  perfState.hotStateByTicker.set(ticker, current);
  keepCacheLimit(perfState.hotStateByTicker, perfState.config.hotState.maxTickers);
}

function createInstrumentedCall(methodName, fn, perfState) {
  return (...args) => {
    if (!perfState.config.enabled) return fn(...args);
    const startedAt = safeNow();
    const key = `${methodName}:${stableArgsKey(args)}`;
    const now = safeNow();
    const canUseCache = perfState.config.readOnlyCache.enabled && perfState.config.readOnlyCache.methods.includes(methodName);
    const ttlMs = canUseCache ? deriveReadOnlyTtl(methodName, perfState, args) : 0;
    const cached = canUseCache ? perfState.cache.get(key) : null;

    if (cached && cached.expiresAt > now) {
      perfState.metrics.totalCalls += 1;
      perfState.metrics.cacheHits += 1;
      if (methodName === 'getMarkPrice') perfState.metrics.readOnly.markPrice.hit += 1;
      if (methodName === 'getKLine') perfState.metrics.readOnly.kline.hit += 1;
      updateMethodMetrics(perfState, methodName, 0, 'cache');
      updateHotState(perfState, methodName, args, cached.value, 'cache', now);
      emitDiagnosticEvent(perfState, {
        type: 'cache_hit',
        module: 'providers.read_only_cache',
        layer: 'signalReadOnly',
        method: methodName,
        ticker: args[0] || null,
        exchange: (perfState.hooks.getRuntimeTags && perfState.hooks.getRuntimeTags().exchange) || 'unknown',
        cycleId: (perfState.hooks.getRuntimeTags && perfState.hooks.getRuntimeTags().cycleId) || null,
      });
      return Promise.resolve(cached.value);
    }

    if (cached && cached.expiresAt <= now && (now - cached.expiresAt) <= perfState.config.hotState.staleReuseGraceMs) {
      perfState.metrics.totalCalls += 1;
      perfState.metrics.staleReuseHits += 1;
      if (methodName === 'getMarkPrice') perfState.metrics.readOnly.markPrice.staleReuse += 1;
      if (methodName === 'getKLine') perfState.metrics.readOnly.kline.staleReuse += 1;
      updateMethodMetrics(perfState, methodName, 0, 'stale');
      updateHotState(perfState, methodName, args, cached.value, 'stale_reuse', now);
      emitDiagnosticEvent(perfState, {
        type: 'cache_stale_reuse',
        module: 'providers.read_only_cache',
        layer: 'signalReadOnly',
        method: methodName,
        ticker: args[0] || null,
        exchange: (perfState.hooks.getRuntimeTags && perfState.hooks.getRuntimeTags().exchange) || 'unknown',
        cycleId: (perfState.hooks.getRuntimeTags && perfState.hooks.getRuntimeTags().cycleId) || null,
      });
      return Promise.resolve(cached.value);
    }

    if (canUseCache) {
      perfState.metrics.cacheMisses += 1;
      if (methodName === 'getMarkPrice') perfState.metrics.readOnly.markPrice.miss += 1;
      if (methodName === 'getKLine') perfState.metrics.readOnly.kline.miss += 1;
      updateMethodMetrics(perfState, methodName, 0, 'miss');
      emitDiagnosticEvent(perfState, {
        type: 'cache_miss',
        module: 'providers.read_only_cache',
        layer: 'signalReadOnly',
        method: methodName,
        ticker: args[0] || null,
        exchange: (perfState.hooks.getRuntimeTags && perfState.hooks.getRuntimeTags().exchange) || 'unknown',
        cycleId: (perfState.hooks.getRuntimeTags && perfState.hooks.getRuntimeTags().cycleId) || null,
      });
    }

    if (perfState.inFlight.has(key)) {
      perfState.metrics.totalCalls += 1;
      perfState.metrics.inFlightHits += 1;
      updateMethodMetrics(perfState, methodName, 0, 'inflight');
      return perfState.inFlight.get(key);
    }

    const runLiveRequest = () => Promise.resolve().then(() => fn(...args));
    const requestPromise = (perfState.scheduler && typeof perfState.scheduler.enqueue === 'function' && canUseCache)
      ? perfState.scheduler.enqueue(runLiveRequest, {
        queueClass: resolveSchedulerQueueClass(methodName),
        priority: resolveSchedulerPriority(perfState, methodName),
        ticker: typeof args[0] === 'string' ? args[0] : null,
        cycleId: perfState.hooks.getRuntimeTags ? perfState.hooks.getRuntimeTags().cycleId : null,
        exchange: perfState.hooks.getRuntimeTags ? perfState.hooks.getRuntimeTags().exchange : 'unknown',
      })
      : runLiveRequest();

    const wrappedPromise = requestPromise
      .then((result) => {
        if (canUseCache) {
          perfState.cache.set(key, {
            value: result,
            expiresAt: safeNow() + ttlMs,
          });
          keepCacheLimit(perfState.cache, perfState.config.readOnlyCache.maxEntries);
        }
        updateHotState(perfState, methodName, args, result, 'live_fetch', safeNow());
        return result;
      })
      .catch((error) => {
        if (perfState.config.invalidation.onError && canUseCache) {
          // Русский комментарий: при ошибке read-only запроса удаляем только проблемный ключ, execution-path не трогаем.
          perfState.cache.delete(key);
        }
        throw error;
      })
      .finally(() => {
        perfState.inFlight.delete(key);
        const durationMs = safeNow() - startedAt;
        perfState.metrics.totalCalls += 1;
        if (durationMs >= perfState.config.metrics.slowCallMs) {
          perfState.metrics.slowCalls += 1;
          perfState.metrics.lastSlowCalls.push({ method: methodName, durationMs, ts: new Date().toISOString() });
          if (perfState.metrics.lastSlowCalls.length > 50) {
            perfState.metrics.lastSlowCalls = perfState.metrics.lastSlowCalls.slice(perfState.metrics.lastSlowCalls.length - 50);
          }
        }
        updateMethodMetrics(perfState, methodName, durationMs, 'network');
        if (
          perfState.config.loggerEnabled
          && perfState.logger
          && perfState.config.logEveryNCalls > 0
          && perfState.metrics.totalCalls % perfState.config.logEveryNCalls === 0
        ) {
          // Русский комментарий: служебный лог hit/miss/stale/forced refresh для наблюдаемости кэша.
          perfState.logger(`[perf.providers] total=${perfState.metrics.totalCalls} hit=${perfState.metrics.cacheHits} miss=${perfState.metrics.cacheMisses} stale=${perfState.metrics.staleReuseHits} inflight=${perfState.metrics.inFlightHits} slow=${perfState.metrics.slowCalls}`);
        }
      });

    perfState.inFlight.set(key, wrappedPromise);
    return wrappedPromise;
  };
}

function resolveSchedulerQueueClass(methodName) {
  if (['getTickerInfo', 'getMarkPrice', 'getKLine', 'getBalance'].includes(methodName)) return 'coreMarketData';
  if (['getLeverage', 'getMarginMode', 'getFuturesActivePositions', 'getFuturesPositionsForTicker'].includes(methodName)) return 'derivativesContext';
  return 'analyticsRefresh';
}

function resolveSchedulerPriority(perfState, methodName) {
  const queueClass = resolveSchedulerQueueClass(methodName);
  const schedulerConfig = perfState && perfState.config && perfState.config.requestScheduler
    ? perfState.config.requestScheduler
    : {};
  const priorities = schedulerConfig.priorities || {};
  return Number(priorities[queueClass] || 0);
}

function deriveFeatureTier(perfState, featureType) {
  if (['regime_inputs', 'indicator'].includes(featureType)) return { tier: 'ultraShort', ttlMs: perfState.config.derivedFeatureCache.ttl.ultraShortMs };
  if (['htf_structure', 'support_resistance', 'vwap_profile'].includes(featureType)) return { tier: 'perCycle', ttlMs: perfState.config.derivedFeatureCache.ttl.perCycleMs };
  return { tier: 'context', ttlMs: perfState.config.derivedFeatureCache.ttl.contextMs };
}

function buildDerivedFeatureKey(input = {}, featureVersion) {
  const ticker = input.ticker || 'unknown';
  const timeframe = input.timeframe || 'na';
  const featureType = input.featureType || 'generic';
  const cycleContext = input.cycleContext || 'na';
  return `${ticker}:${timeframe}:${featureVersion}:${featureType}:${cycleContext}`;
}

function createDerivedFeatureAccessor(perfState) {
  return {
    get(input = {}) {
      if (!perfState.config.enabled || !perfState.config.derivedFeatureCache.enabled) return { status: 'disabled', value: null };
      const { tier } = deriveFeatureTier(perfState, input.featureType);
      const cache = perfState.derivedFeatureCache[tier];
      const key = buildDerivedFeatureKey(input, perfState.config.derivedFeatureCache.featureVersion);
      const now = safeNow();
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now) {
        perfState.metrics.derivedFeatures.hit += 1;
        emitDiagnosticEvent(perfState, { type: 'cache_hit', module: 'providers.derived_feature_cache', layer: 'signalReadOnly', method: 'getDerivedFeature', ticker: input.ticker || null });
        return { status: 'hit', value: cached.value, key, tier };
      }
      if (cached && cached.expiresAt <= now && (now - cached.expiresAt) <= perfState.config.hotState.staleReuseGraceMs) {
        perfState.metrics.derivedFeatures.staleReuse += 1;
        emitDiagnosticEvent(perfState, { type: 'cache_stale_reuse', module: 'providers.derived_feature_cache', layer: 'signalReadOnly', method: 'getDerivedFeature', ticker: input.ticker || null });
        return { status: 'stale-but-allowed', value: cached.value, key, tier };
      }
      perfState.metrics.derivedFeatures.miss += 1;
      emitDiagnosticEvent(perfState, { type: 'cache_miss', module: 'providers.derived_feature_cache', layer: 'signalReadOnly', method: 'getDerivedFeature', ticker: input.ticker || null });
      return { status: 'miss', value: null, key, tier };
    },
    set(input = {}, value) {
      if (!perfState.config.enabled || !perfState.config.derivedFeatureCache.enabled) return;
      const { tier, ttlMs } = deriveFeatureTier(perfState, input.featureType);
      const cache = perfState.derivedFeatureCache[tier];
      const key = buildDerivedFeatureKey(input, perfState.config.derivedFeatureCache.featureVersion);
      cache.set(key, { value, expiresAt: safeNow() + ttlMs });
      keepCacheLimit(cache, perfState.config.readOnlyCache.maxEntries);
    },
    forceRefresh(input = {}) {
      if (!perfState.config.enabled || !perfState.config.derivedFeatureCache.enabled) return;
      const { tier } = deriveFeatureTier(perfState, input.featureType);
      const key = buildDerivedFeatureKey(input, perfState.config.derivedFeatureCache.featureVersion);
      perfState.derivedFeatureCache[tier].delete(key);
      perfState.metrics.forcedRefreshes += 1;
      perfState.metrics.derivedFeatures.forcedRefresh += 1;
      emitDiagnosticEvent(perfState, { type: 'cache_forced_refresh', module: 'providers.derived_feature_cache', layer: 'signalReadOnly', method: 'forceRefreshDerivedFeature', ticker: input.ticker || null });
    },
  };
}

function createCacheControl(perfState) {
  return {
    invalidateTicker(ticker) {
      if (!ticker) return;
      for (const key of perfState.cache.keys()) {
        if (key.includes(`:${JSON.stringify([ticker])}`) || key.includes(`:["${ticker}",`)) {
          perfState.cache.delete(key);
        }
      }
      perfState.hotStateByTicker.delete(ticker);
    },
    onCycleStart(cycleId) {
      if (!perfState.config.enabled) return;
      if (perfState.scheduler && typeof perfState.scheduler.onCycleStart === 'function') {
        perfState.scheduler.onCycleStart(cycleId);
      }
      if (perfState.config.invalidation.fullFlushOnCycleStart) {
        perfState.cache.clear();
      }
      for (const hotState of perfState.hotStateByTicker.values()) {
        hotState.lastCycleId = cycleId;
      }
      // Русский комментарий: per-cycle кэш derived признаков очищается на новом цикле.
      perfState.derivedFeatureCache.perCycle.clear();
    },
    onExecutionActivity(tickers = []) {
      if (!perfState.config.enabled || !perfState.config.invalidation.onExecutionTickers) return;
      tickers.forEach((ticker) => {
        this.invalidateTicker(ticker);
      });
    },
    forceRefreshReadOnly(methodName, ...args) {
      const key = `${methodName}:${stableArgsKey(args)}`;
      perfState.cache.delete(key);
      perfState.metrics.forcedRefreshes += 1;
      if (methodName === 'getMarkPrice') perfState.metrics.readOnly.markPrice.forcedRefresh += 1;
      if (methodName === 'getKLine') perfState.metrics.readOnly.kline.forcedRefresh += 1;
      updateMethodMetrics(perfState, methodName, 0, 'forced_refresh');
      emitDiagnosticEvent(perfState, { type: 'cache_forced_refresh', module: 'providers.read_only_cache', layer: 'signalReadOnly', method: methodName, ticker: args[0] || null });
    },
  };
}

// Русский комментарий: провайдеры инкапсулируют доступ к данным биржи/аккаунта без изменения торговой логики.
function createProviders(connector, utils, options = {}) {
  const perfConfig = normalizePerfConfig(options.performanceDiagnostics || {});
  const perfState = createPerfState(perfConfig, options.logger || null, {
    onDiagnosticEvent: options.onDiagnosticEvent,
    getRuntimeTags: options.getRuntimeTags,
  });
  perfState.scheduler = createRequestScheduler(perfConfig.requestScheduler, {
    onDiagnosticEvent: options.onDiagnosticEvent,
  });
  const cacheControl = createCacheControl(perfState);
  const derivedFeatureAccessor = createDerivedFeatureAccessor(perfState);

  return {
    marketDataProvider: {
      getTickerInfo: createInstrumentedCall('getTickerInfo', (ticker) => connector.getTickerInfo(ticker), perfState),
      getMarkPrice: createInstrumentedCall('getMarkPrice', (ticker) => connector.getMarkPrice(ticker), perfState),
      getKLine: createInstrumentedCall('getKLine', (ticker, interval) => connector.getKLine(ticker, interval), perfState),
      getSymbolsByLeverage: createInstrumentedCall('getSymbolsByLeverage', (leverage) => connector.getSymbolsByLeverage(leverage), perfState),
      getMaxLeverageForTicker: createInstrumentedCall('getMaxLeverageForTicker', (ticker) => connector.getMaxLeverageForTicker(ticker), perfState),
      getLeverage: createInstrumentedCall('getLeverage', (ticker) => connector.getLeverage(ticker), perfState),
      getMarginMode: createInstrumentedCall('getMarginMode', (ticker) => connector.getMarginMode(ticker), perfState),
    },
    accountDataProvider: {
      getBalance: createInstrumentedCall('getBalance', () => connector.getBalance(), perfState),
    },
    positionProvider: {
      getFuturesActivePositions: createInstrumentedCall('getFuturesActivePositions', () => connector.getFuturesActivePositions(), perfState),
      getFuturesPositionsForTicker: createInstrumentedCall('getFuturesPositionsForTicker', (ticker) => connector.getFuturesPositionsForTicker(ticker), perfState),
      filterActive: (positions) => (Array.isArray(positions) ? positions : []).filter((x) => utils.positionIsActive(x)),
    },
    exchangeCapabilitiesProvider: {
      // Русский комментарий: execution-critical методы идут только live, без TTL-кэша.
      updateTickerLeverage: createInstrumentedCall('updateTickerLeverage', (ticker, leverage) => connector.updateTickerLeverage(ticker, leverage), perfState),
      setMarginMode: createInstrumentedCall('setMarginMode', (ticker, marginMode, leverage) => connector.setMarginMode(ticker, marginMode, leverage), perfState),
    },
    cacheControl,
    derivedFeatureCache: derivedFeatureAccessor,
    getHotStateSnapshot: () => ({
      tickers: Array.from(perfState.hotStateByTicker.entries()).reduce((acc, [ticker, value]) => {
        acc[ticker] = { ...value };
        return acc;
      }, {}),
      generatedAt: new Date().toISOString(),
    }),
    getPerformanceDiagnostics: () => ({
      enabled: perfState.config.enabled,
      config: perfState.config,
      metrics: {
        totalCalls: perfState.metrics.totalCalls,
        cacheHits: perfState.metrics.cacheHits,
        cacheMisses: perfState.metrics.cacheMisses,
        staleReuseHits: perfState.metrics.staleReuseHits,
        forcedRefreshes: perfState.metrics.forcedRefreshes,
        inFlightHits: perfState.metrics.inFlightHits,
        slowCalls: perfState.metrics.slowCalls,
        cacheSize: perfState.cache.size,
        inFlightSize: perfState.inFlight.size,
        hotStateSize: perfState.hotStateByTicker.size,
        readOnly: { ...perfState.metrics.readOnly },
        derivedFeatures: { ...perfState.metrics.derivedFeatures },
        byMethod: { ...perfState.metrics.byMethod },
        lastSlowCalls: [...perfState.metrics.lastSlowCalls],
      },
      requestScheduler: perfState.scheduler ? perfState.scheduler.getDiagnostics() : { enabled: false },
    }),
    getRequestSchedulerDiagnostics: () => (perfState.scheduler ? perfState.scheduler.getDiagnostics() : { enabled: false }),
  };
}

module.exports = { createProviders };
