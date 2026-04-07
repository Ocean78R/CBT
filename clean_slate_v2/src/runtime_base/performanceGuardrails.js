'use strict';

/**
 * Русский комментарий:
 * Performance guardrails для runtime:
 * - ограничение heavy операций на цикл;
 * - ограничение суммарного budget времени;
 * - переключение режима full -> cached -> degraded.
 */
function createPerformanceGuardrails({
  maxHeavyOpsPerCycle = 8,
  cycleBudgetMs = 180,
  maxSingleOpMs = 90,
} = {}) {
  const cycleStats = new Map();

  function getStats(cycleId) {
    if (!cycleStats.has(cycleId)) {
      cycleStats.set(cycleId, {
        heavyOps: 0,
        spentMs: 0,
        forcedMode: 'full',
      });
    }
    return cycleStats.get(cycleId);
  }

  function canRunHeavy({ cycleId, estimatedCostMs = 0 }) {
    const stats = getStats(cycleId);

    if (stats.heavyOps >= maxHeavyOpsPerCycle) {
      return { allowed: false, forcedMode: 'cached', reason: 'heavy_ops_limit' };
    }

    if ((stats.spentMs + estimatedCostMs) > cycleBudgetMs) {
      return { allowed: false, forcedMode: 'degraded', reason: 'cycle_budget_limit' };
    }

    if (stats.forcedMode === 'degraded') {
      return { allowed: false, forcedMode: 'degraded', reason: 'already_degraded' };
    }

    return { allowed: true, forcedMode: stats.forcedMode, reason: null };
  }

  function recordHeavyRun({ cycleId, elapsedMs }) {
    const stats = getStats(cycleId);
    stats.heavyOps += 1;
    stats.spentMs += Math.max(0, Number(elapsedMs) || 0);

    if (elapsedMs > maxSingleOpMs || stats.spentMs > cycleBudgetMs) {
      stats.forcedMode = 'degraded';
    } else if (stats.heavyOps >= maxHeavyOpsPerCycle) {
      stats.forcedMode = 'cached';
    }

    return Object.freeze({
      heavyOps: stats.heavyOps,
      spentMs: stats.spentMs,
      forcedMode: stats.forcedMode,
    });
  }

  function getCycleMode(cycleId) {
    return getStats(cycleId).forcedMode;
  }

  function clearCycle(cycleId) {
    cycleStats.delete(cycleId);
  }

  return {
    canRunHeavy,
    recordHeavyRun,
    getCycleMode,
    clearCycle,
  };
}

module.exports = {
  createPerformanceGuardrails,
};
