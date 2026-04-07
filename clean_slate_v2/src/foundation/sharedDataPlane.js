'use strict';

/**
 * Русский комментарий:
 * Shared data-plane для market/feature snapshot и already-computed outputs.
 * Heavy вычисления выполняются только через cache key и переиспользуются слоями.
 */
function createMarketSnapshot(data = {}) {
  return Object.freeze({
    snapshotType: 'market',
    ticker: data.ticker || '',
    timeframe: data.timeframe || '5m',
    candles: Array.isArray(data.candles) ? data.candles : [],
    orderBook: data.orderBook || null,
    ts: data.ts || null,
  });
}

function createFeatureSnapshot(data = {}) {
  return Object.freeze({
    snapshotType: 'feature',
    ticker: data.ticker || '',
    timeframe: data.timeframe || '5m',
    indicators: data.indicators || {},
    microStructure: data.microStructure || {},
    ts: data.ts || null,
  });
}

function createSharedDataPlane() {
  const cycleSnapshots = new Map();
  const computedOutputCache = new Map();

  return {
    setCycleSnapshots(cycleId, { marketSnapshot, featureSnapshot }) {
      cycleSnapshots.set(cycleId, Object.freeze({ marketSnapshot, featureSnapshot }));
    },

    getCycleSnapshots(cycleId) {
      return cycleSnapshots.get(cycleId) || null;
    },

    getOrComputeOutput({ cycleId, blockKey, compute }) {
      const cacheKey = `${cycleId}:${blockKey}`;
      if (computedOutputCache.has(cacheKey)) {
        return {
          reused: true,
          value: computedOutputCache.get(cacheKey),
        };
      }

      const value = compute();
      const frozenValue = value && typeof value === 'object' ? Object.freeze(value) : value;
      computedOutputCache.set(cacheKey, frozenValue);
      return {
        reused: false,
        value: frozenValue,
      };
    },

    clearCycle(cycleId) {
      cycleSnapshots.delete(cycleId);
      const prefix = `${cycleId}:`;
      for (const key of computedOutputCache.keys()) {
        if (key.startsWith(prefix)) {
          computedOutputCache.delete(key);
        }
      }
    },
  };
}

module.exports = {
  createMarketSnapshot,
  createFeatureSnapshot,
  createSharedDataPlane,
};
