'use strict';

/**
 * Русский комментарий:
 * Tiered cache для clean-slate runtime:
 * - cycle: быстрый cache в рамках цикла
 * - warm: межцикловый cache для режима cached/degraded
 * - degradedFallback: безопасный fallback, когда heavy compute недоступен
 */
function createCacheTiers({ now = () => Date.now() } = {}) {
  const cycleCache = new Map();
  const warmCache = new Map();
  const degradedFallbackCache = new Map();

  function isAlive(entry, ttlMs) {
    if (!entry) {
      return false;
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      return true;
    }
    return (now() - entry.ts) <= ttlMs;
  }

  function setCycle(cycleId, key, value) {
    cycleCache.set(`${cycleId}:${key}`, Object.freeze({ value, ts: now() }));
  }

  function setWarm(key, value) {
    warmCache.set(key, Object.freeze({ value, ts: now() }));
  }

  function setDegradedFallback(key, value) {
    degradedFallbackCache.set(key, Object.freeze({ value, ts: now() }));
  }

  function getFromTier({ cycleId, key, tier, ttlMs }) {
    if (tier === 'cycle') {
      const entry = cycleCache.get(`${cycleId}:${key}`);
      return isAlive(entry, ttlMs) ? entry.value : null;
    }
    if (tier === 'warm') {
      const entry = warmCache.get(key);
      return isAlive(entry, ttlMs) ? entry.value : null;
    }
    if (tier === 'degradedFallback') {
      const entry = degradedFallbackCache.get(key);
      return isAlive(entry, ttlMs) ? entry.value : null;
    }
    return null;
  }

  function getOrCompute({
    cycleId,
    key,
    computeHeavy,
    fallbackValue,
    mode = 'full',
    ttlMs = 0,
  }) {
    const cycleValue = getFromTier({ cycleId, key, tier: 'cycle', ttlMs });
    if (cycleValue !== null) {
      return { source: 'cycle_cache', reused: true, value: cycleValue };
    }

    const warmValue = getFromTier({ key, tier: 'warm', ttlMs });
    if (mode !== 'full' && warmValue !== null) {
      setCycle(cycleId, key, warmValue);
      return { source: 'warm_cache', reused: true, value: warmValue };
    }

    if (mode === 'degraded') {
      const degradedValue = getFromTier({ key, tier: 'degradedFallback', ttlMs: 0 });
      if (degradedValue !== null) {
        setCycle(cycleId, key, degradedValue);
        return { source: 'degraded_fallback_cache', reused: true, value: degradedValue };
      }

      if (typeof fallbackValue !== 'undefined') {
        setDegradedFallback(key, fallbackValue);
        setCycle(cycleId, key, fallbackValue);
        return { source: 'degraded_fallback_static', reused: true, value: fallbackValue };
      }

      return { source: 'degraded_no_data', reused: true, value: null };
    }

    if (mode === 'cached' && warmValue !== null) {
      setCycle(cycleId, key, warmValue);
      return { source: 'warm_cache', reused: true, value: warmValue };
    }

    if (typeof computeHeavy !== 'function') {
      if (warmValue !== null) {
        setCycle(cycleId, key, warmValue);
        return { source: 'warm_cache_no_compute', reused: true, value: warmValue };
      }
      if (typeof fallbackValue !== 'undefined') {
        setDegradedFallback(key, fallbackValue);
        setCycle(cycleId, key, fallbackValue);
        return { source: 'fallback_without_compute', reused: true, value: fallbackValue };
      }
      return { source: 'no_compute_no_cache', reused: true, value: null };
    }

    const computed = computeHeavy();
    setCycle(cycleId, key, computed);
    setWarm(key, computed);
    return { source: 'heavy_compute', reused: false, value: computed };
  }

  function clearCycle(cycleId) {
    const prefix = `${cycleId}:`;
    for (const key of cycleCache.keys()) {
      if (key.startsWith(prefix)) {
        cycleCache.delete(key);
      }
    }
  }

  return {
    getOrCompute,
    clearCycle,
    setDegradedFallback,
    getFromTier,
  };
}

module.exports = {
  createCacheTiers,
};
