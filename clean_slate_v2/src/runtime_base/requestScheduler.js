'use strict';

/**
 * Русский комментарий:
 * Request scheduler с защитами:
 * - лимит запросов на цикл;
 * - лимит запросов в rolling window;
 * - cooldown по активу;
 * - запрет дубликатов requestKey в одном цикле.
 */
function createRequestScheduler({
  maxRequestsPerCycle = 50,
  maxRequestsPerWindow = 120,
  windowMs = 60_000,
  assetCooldownMs = 2_000,
  now = () => Date.now(),
} = {}) {
  const cycleCounters = new Map();
  const windowEvents = [];
  const assetLastTs = new Map();
  const cycleRequestDedup = new Set();

  function trimWindow() {
    const border = now() - windowMs;
    while (windowEvents.length > 0 && windowEvents[0] < border) {
      windowEvents.shift();
    }
  }

  function tryAcquire({ cycleId, asset = 'UNKNOWN', requestKey = '' }) {
    trimWindow();

    const dedupKey = `${cycleId}:${requestKey}`;
    if (requestKey && cycleRequestDedup.has(dedupKey)) {
      return { allowed: false, reason: 'duplicate_request_in_cycle' };
    }

    const cycleCount = cycleCounters.get(cycleId) || 0;
    if (cycleCount >= maxRequestsPerCycle) {
      return { allowed: false, reason: 'cycle_budget_exceeded' };
    }

    if (windowEvents.length >= maxRequestsPerWindow) {
      return { allowed: false, reason: 'window_budget_exceeded' };
    }

    const lastAssetTs = assetLastTs.get(asset) || 0;
    if ((now() - lastAssetTs) < assetCooldownMs) {
      return { allowed: false, reason: 'asset_cooldown_active' };
    }

    cycleCounters.set(cycleId, cycleCount + 1);
    windowEvents.push(now());
    assetLastTs.set(asset, now());
    if (requestKey) {
      cycleRequestDedup.add(dedupKey);
    }

    return { allowed: true, reason: null };
  }

  function clearCycle(cycleId) {
    cycleCounters.delete(cycleId);
    const prefix = `${cycleId}:`;
    for (const dedupKey of Array.from(cycleRequestDedup)) {
      if (dedupKey.startsWith(prefix)) {
        cycleRequestDedup.delete(dedupKey);
      }
    }
  }

  return {
    tryAcquire,
    clearCycle,
  };
}

module.exports = {
  createRequestScheduler,
};
