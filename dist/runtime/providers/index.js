'use strict';

function normalizePerfConfig(config = {}) {
  const readOnlyCache = config.readOnlyCache || {};
  const metrics = config.metrics || {};
  return {
    enabled: !!config.enabled,
    loggerEnabled: !!config.loggerEnabled,
    logEveryNCalls: Number(config.logEveryNCalls || 200),
    readOnlyCache: {
      enabled: readOnlyCache.enabled !== false,
      ttlMs: Number(readOnlyCache.ttlMs || 1200),
      maxEntries: Number(readOnlyCache.maxEntries || 1000),
      methods: Array.isArray(readOnlyCache.methods) && readOnlyCache.methods.length > 0
        ? readOnlyCache.methods
        : ['getTickerInfo', 'getMarkPrice', 'getKLine', 'getLeverage', 'getMarginMode', 'getBalance'],
    },
    metrics: {
      enabled: metrics.enabled !== false,
      slowCallMs: Number(metrics.slowCallMs || 250),
    },
  };
}

function createPerfState(perfConfig, logger) {
  const cache = new Map();
  const inFlight = new Map();
  return {
    cache,
    inFlight,
    metrics: {
      totalCalls: 0,
      cacheHits: 0,
      inFlightHits: 0,
      slowCalls: 0,
      byMethod: {},
      lastSlowCalls: [],
    },
    logger,
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
    inFlightHits: 0,
    slowCalls: 0,
  };
  methodMetrics.calls += 1;
  methodMetrics.totalMs += Number(durationMs || 0);
  methodMetrics.avgMs = methodMetrics.calls > 0 ? methodMetrics.totalMs / methodMetrics.calls : 0;
  methodMetrics.maxMs = Math.max(methodMetrics.maxMs, Number(durationMs || 0));
  if (source === 'cache') methodMetrics.cacheHits += 1;
  if (source === 'inflight') methodMetrics.inFlightHits += 1;
  if (Number(durationMs || 0) >= state.config.metrics.slowCallMs) methodMetrics.slowCalls += 1;
  state.metrics.byMethod[methodName] = methodMetrics;
}

function createInstrumentedCall(methodName, fn, perfState) {
  return (...args) => {
    if (!perfState.config.enabled) return fn(...args);
    const startedAt = safeNow();
    const key = `${methodName}:${stableArgsKey(args)}`;
    const now = safeNow();
    const canUseCache = perfState.config.readOnlyCache.enabled && perfState.config.readOnlyCache.methods.includes(methodName);
    const cached = canUseCache ? perfState.cache.get(key) : null;
    if (cached && cached.expiresAt > now) {
      perfState.metrics.totalCalls += 1;
      perfState.metrics.cacheHits += 1;
      updateMethodMetrics(perfState, methodName, 0, 'cache');
      return Promise.resolve(cached.value);
    }
    if (perfState.inFlight.has(key)) {
      perfState.metrics.totalCalls += 1;
      perfState.metrics.inFlightHits += 1;
      updateMethodMetrics(perfState, methodName, 0, 'inflight');
      return perfState.inFlight.get(key);
    }

    const requestPromise = Promise.resolve()
      .then(() => fn(...args))
      .then((result) => {
        if (canUseCache) {
          perfState.cache.set(key, {
            value: result,
            expiresAt: safeNow() + perfState.config.readOnlyCache.ttlMs,
          });
          keepCacheLimit(perfState.cache, perfState.config.readOnlyCache.maxEntries);
        }
        return result;
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
          // Русский комментарий: диагностический лог производительности только для read-only части, без влияния на торговые решения.
          perfState.logger(`[perf.providers] totalCalls=${perfState.metrics.totalCalls} cacheHits=${perfState.metrics.cacheHits} inFlightHits=${perfState.metrics.inFlightHits} slowCalls=${perfState.metrics.slowCalls}`);
        }
      });

    perfState.inFlight.set(key, requestPromise);
    return requestPromise;
  };
}

// Русский комментарий: провайдеры инкапсулируют доступ к данным биржи/аккаунта без изменения торговой логики.
function createProviders(connector, utils, options = {}) {
  const perfConfig = normalizePerfConfig(options.performanceDiagnostics || {});
  const perfState = createPerfState(perfConfig, options.logger || null);

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
      updateTickerLeverage: createInstrumentedCall('updateTickerLeverage', (ticker, leverage) => connector.updateTickerLeverage(ticker, leverage), perfState),
      setMarginMode: createInstrumentedCall('setMarginMode', (ticker, marginMode, leverage) => connector.setMarginMode(ticker, marginMode, leverage), perfState),
    },
    getPerformanceDiagnostics: () => ({
      enabled: perfState.config.enabled,
      config: perfState.config,
      metrics: {
        totalCalls: perfState.metrics.totalCalls,
        cacheHits: perfState.metrics.cacheHits,
        inFlightHits: perfState.metrics.inFlightHits,
        slowCalls: perfState.metrics.slowCalls,
        cacheSize: perfState.cache.size,
        inFlightSize: perfState.inFlight.size,
        byMethod: { ...perfState.metrics.byMethod },
        lastSlowCalls: [...perfState.metrics.lastSlowCalls],
      },
    }),
  };
}

module.exports = { createProviders };
