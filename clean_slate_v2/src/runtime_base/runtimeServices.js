'use strict';

const { createCacheTiers } = require('./cacheTiers');
const { createRequestScheduler } = require('./requestScheduler');
const { createPerformanceGuardrails } = require('./performanceGuardrails');
const { createStructuredLogger } = require('./structuredLogger');

/**
 * Русский комментарий:
 * Единая сборка runtime-подсистем:
 * cache tiers + scheduler + performance guardrails + structured logging.
 */
function createRuntimeServices(config = {}) {
  const cacheTiers = createCacheTiers(config.cache);
  const scheduler = createRequestScheduler(config.scheduler);
  const performance = createPerformanceGuardrails(config.performance);
  const logger = createStructuredLogger(config.logging);

  function computeWithGuardrails({
    cycleId,
    key,
    computeHeavy,
    fallbackValue,
    estimatedCostMs = 0,
  }) {
    const mode = performance.getCycleMode(cycleId);

    if (mode === 'degraded') {
      return cacheTiers.getOrCompute({
        cycleId,
        key,
        computeHeavy: null,
        fallbackValue,
        mode: 'degraded',
      });
    }

    const heavyCheck = performance.canRunHeavy({ cycleId, estimatedCostMs });
    if (!heavyCheck.allowed) {
      const fallbackMode = heavyCheck.forcedMode || 'cached';
      logger.log({
        level: 'warn',
        event: 'performance_fallback_mode',
        cycleId,
        reasonCodes: [heavyCheck.reason],
        details: { key, fallbackMode },
      });

      return cacheTiers.getOrCompute({
        cycleId,
        key,
        computeHeavy: null,
        fallbackValue,
        mode: fallbackMode,
      });
    }

    const startedAt = Date.now();
    const result = cacheTiers.getOrCompute({
      cycleId,
      key,
      computeHeavy,
      fallbackValue,
      mode: 'full',
    });

    if (!result.reused && result.source === 'heavy_compute') {
      const elapsedMs = Date.now() - startedAt;
      performance.recordHeavyRun({ cycleId, elapsedMs });
    }

    return result;
  }

  function clearCycle(cycleId) {
    cacheTiers.clearCycle(cycleId);
    scheduler.clearCycle(cycleId);
    performance.clearCycle(cycleId);
  }

  return {
    cacheTiers,
    scheduler,
    performance,
    logger,
    computeWithGuardrails,
    clearCycle,
  };
}

module.exports = {
  createRuntimeServices,
};
