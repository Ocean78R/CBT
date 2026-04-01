'use strict';

// Русский комментарий: единый shared-store для market/feature snapshot с кэшами разной частоты обновления.
function createFeatureStore() {
  const rawMarketDataCache = new Map();
  const derivedIndicatorCache = new Map();
  const perCycleFeatureCache = new Map();
  const slowerRefreshContextCache = new Map();

  return {
    rawMarketDataCache,
    derivedIndicatorCache,
    perCycleFeatureCache,
    slowerRefreshContextCache,
    clearCycle(cycleId) {
      perCycleFeatureCache.delete(cycleId);
    },
  };
}

function createMarketSnapshot(data = {}) { return { ...data, snapshotType: 'market' }; }
function createFeatureSnapshot(data = {}) { return { ...data, snapshotType: 'feature' }; }

module.exports = {
  createFeatureStore,
  createMarketSnapshot,
  createFeatureSnapshot,
};
