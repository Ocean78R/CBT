'use strict';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function safeNow() {
  return Date.now();
}

function detectRateLimitLikeError(error) {
  const status = error && (error.status || error.statusCode || error.code);
  if (status === 429 || status === 418 || status === 503 || status === 'ETIMEDOUT') return true;
  const message = String((error && error.message) || '').toLowerCase();
  return message.includes('rate limit') || message.includes('too many request') || message.includes('429');
}

function normalizeSchedulerConfig(config = {}) {
  const priorities = config.priorities || {};
  const optionalBudget = config.optionalBudget || {};
  return {
    enabled: !!config.enabled,
    maxConcurrency: Math.max(1, Number(config.maxConcurrency || 6)),
    maxRequestsPerWindow: Math.max(1, Number(config.maxRequestsPerWindow || 20)),
    windowMs: Math.max(50, Number(config.windowMs || 1000)),
    backoffBaseMs: Math.max(25, Number(config.backoffBaseMs || 250)),
    backoffMaxMs: Math.max(100, Number(config.backoffMaxMs || 3000)),
    priorities: {
      coreMarketData: Number(priorities.coreMarketData || 100),
      optionalMicrostructure: Number(priorities.optionalMicrostructure || 40),
      derivativesContext: Number(priorities.derivativesContext || 30),
      analyticsRefresh: Number(priorities.analyticsRefresh || 20),
    },
    optionalBudget: {
      enabled: optionalBudget.enabled !== false,
      maxOptionalPerCycle: Math.max(0, Number(optionalBudget.maxOptionalPerCycle || 300)),
    },
  };
}

function createRequestScheduler(inputConfig = {}, hooks = {}) {
  const config = normalizeSchedulerConfig(inputConfig);
  let activeCount = 0;
  let backoffUntilTs = 0;
  let backoffStep = 0;
  const queue = [];
  const startedTimestamps = [];
  const optionalUsageByCycle = new Map();
  let sequence = 0;

  const metrics = {
    enqueued: 0,
    started: 0,
    completed: 0,
    rejected: 0,
    budgetSkipped: 0,
    rateLimitSleeps: 0,
    backoffSleeps: 0,
    maxObservedQueue: 0,
    queueByClass: {
      coreMarketData: 0,
      optionalMicrostructure: 0,
      derivativesContext: 0,
      analyticsRefresh: 0,
    },
  };

  function emit(event) {
    if (!hooks || typeof hooks.onDiagnosticEvent !== 'function') return;
    try {
      hooks.onDiagnosticEvent(event);
    } catch (_error) {
      // Русский комментарий: диагностические события scheduler не должны ломать runtime.
    }
  }

  function getPriorityByClass(queueClass) {
    return config.priorities[queueClass] || 0;
  }

  function cleanupWindow(now) {
    while (startedTimestamps.length > 0 && now - startedTimestamps[0] >= config.windowMs) {
      startedTimestamps.shift();
    }
  }

  function canStartNow(now) {
    cleanupWindow(now);
    return activeCount < config.maxConcurrency && startedTimestamps.length < config.maxRequestsPerWindow && now >= backoffUntilTs;
  }

  function scheduleDrain() {
    setImmediate(drain);
  }

  function applyOptionalBudget(meta, now) {
    if (!config.optionalBudget.enabled) return { allow: true };
    const queueClass = meta.queueClass || 'coreMarketData';
    if (queueClass === 'coreMarketData') return { allow: true };
    const cycleId = meta.cycleId || 'global';
    const used = optionalUsageByCycle.get(cycleId) || 0;
    if (used >= config.optionalBudget.maxOptionalPerCycle) {
      return { allow: false, reason: 'optional_budget_exceeded', cycleId };
    }
    optionalUsageByCycle.set(cycleId, used + 1);
    if (optionalUsageByCycle.size > 200) {
      const firstKey = optionalUsageByCycle.keys().next().value;
      optionalUsageByCycle.delete(firstKey);
    }
    return { allow: true };
  }

  function enqueue(taskFn, meta = {}) {
    if (!config.enabled) {
      return Promise.resolve().then(() => taskFn());
    }

    const queueClass = meta.queueClass || 'coreMarketData';
    const priority = Number(meta.priority || getPriorityByClass(queueClass));
    const budgetCheck = applyOptionalBudget({ ...meta, queueClass }, safeNow());

    if (!budgetCheck.allow) {
      metrics.budgetSkipped += 1;
      emit({
        type: 'scheduler_optional_budget_skip',
        module: 'runtime.requestScheduler',
        layer: 'signalReadOnly',
        cycleId: meta.cycleId || null,
        ticker: meta.ticker || null,
        exchange: meta.exchange || 'unknown',
        marketRegime: meta.marketRegime || 'unknown',
        capitalRegime: meta.capitalRegime || 'unknown',
        setupType: meta.setupType || 'unknown',
        score: Number.isFinite(meta.score) ? meta.score : 0,
        confidence: Number.isFinite(meta.confidence) ? meta.confidence : 0,
        vetoReason: meta.vetoReason || 'none',
        sizingDecision: meta.sizingDecision || 'not_evaluated',
        executionAction: 'skip_optional_read',
        finalDecision: 'skip',
      });
      return Promise.resolve(meta.fallbackValue !== undefined ? meta.fallbackValue : null);
    }

    return new Promise((resolve, reject) => {
      queue.push({
        id: ++sequence,
        taskFn,
        priority,
        queueClass,
        meta,
        resolve,
        reject,
        enqueuedAt: safeNow(),
      });
      metrics.enqueued += 1;
      metrics.queueByClass[queueClass] = (metrics.queueByClass[queueClass] || 0) + 1;
      metrics.maxObservedQueue = Math.max(metrics.maxObservedQueue, queue.length);
      queue.sort((a, b) => (b.priority - a.priority) || (a.id - b.id));
      emit({
        type: 'scheduler_enqueued',
        module: 'runtime.requestScheduler',
        layer: 'signalReadOnly',
        cycleId: meta.cycleId || null,
        ticker: meta.ticker || null,
        exchange: meta.exchange || 'unknown',
        marketRegime: meta.marketRegime || 'unknown',
        capitalRegime: meta.capitalRegime || 'unknown',
        setupType: meta.setupType || 'unknown',
        score: Number.isFinite(meta.score) ? meta.score : 0,
        confidence: Number.isFinite(meta.confidence) ? meta.confidence : 0,
        vetoReason: meta.vetoReason || 'none',
        sizingDecision: meta.sizingDecision || 'not_evaluated',
        executionAction: 'enqueue_read_only',
        finalDecision: 'queued',
      });
      scheduleDrain();
    });
  }

  async function runTask(task) {
    activeCount += 1;
    metrics.started += 1;
    metrics.queueByClass[task.queueClass] = Math.max(0, (metrics.queueByClass[task.queueClass] || 1) - 1);
    const startTs = safeNow();
    startedTimestamps.push(startTs);
    emit({
      type: 'scheduler_started',
      module: 'runtime.requestScheduler',
      layer: 'signalReadOnly',
      cycleId: task.meta.cycleId || null,
      ticker: task.meta.ticker || null,
      exchange: task.meta.exchange || 'unknown',
      marketRegime: task.meta.marketRegime || 'unknown',
      capitalRegime: task.meta.capitalRegime || 'unknown',
      setupType: task.meta.setupType || 'unknown',
      score: Number.isFinite(task.meta.score) ? task.meta.score : 0,
      confidence: Number.isFinite(task.meta.confidence) ? task.meta.confidence : 0,
      vetoReason: task.meta.vetoReason || 'none',
      sizingDecision: task.meta.sizingDecision || 'not_evaluated',
      executionAction: 'run_read_only',
      finalDecision: 'started',
    });

    try {
      const result = await task.taskFn();
      metrics.completed += 1;
      backoffStep = 0;
      task.resolve(result);
    } catch (error) {
      metrics.rejected += 1;
      if (detectRateLimitLikeError(error)) {
        backoffStep += 1;
        const backoffMs = Math.min(config.backoffMaxMs, config.backoffBaseMs * Math.pow(2, backoffStep - 1));
        backoffUntilTs = Math.max(backoffUntilTs, safeNow() + backoffMs);
        emit({
          type: 'scheduler_backoff_set',
          module: 'runtime.requestScheduler',
          layer: 'signalReadOnly',
          cycleId: task.meta.cycleId || null,
          ticker: task.meta.ticker || null,
          exchange: task.meta.exchange || 'unknown',
          executionAction: 'backoff',
          finalDecision: 'retry_later',
          backoffMs,
        });
      }
      task.reject(error);
    } finally {
      activeCount = Math.max(0, activeCount - 1);
      scheduleDrain();
    }
  }

  async function drain() {
    if (!config.enabled) return;
    while (queue.length > 0) {
      const now = safeNow();
      cleanupWindow(now);

      if (activeCount >= config.maxConcurrency) return;

      if (now < backoffUntilTs) {
        metrics.backoffSleeps += 1;
        await sleep(Math.min(100, backoffUntilTs - now));
        continue;
      }

      if (startedTimestamps.length >= config.maxRequestsPerWindow) {
        metrics.rateLimitSleeps += 1;
        const waitMs = Math.max(1, config.windowMs - (now - startedTimestamps[0]));
        await sleep(Math.min(waitMs, 100));
        continue;
      }

      if (!canStartNow(safeNow())) return;
      const task = queue.shift();
      if (!task) return;
      runTask(task);
    }
  }

  return {
    enqueue,
    onCycleStart(cycleId) {
      if (cycleId === undefined || cycleId === null) return;
      optionalUsageByCycle.delete(cycleId);
    },
    getDiagnostics() {
      return {
        enabled: config.enabled,
        config: { ...config, priorities: { ...config.priorities }, optionalBudget: { ...config.optionalBudget } },
        state: {
          activeCount,
          queueSize: queue.length,
          backoffUntilTs,
          inflightWindowRequests: startedTimestamps.length,
        },
        metrics: {
          ...metrics,
          queueByClass: { ...metrics.queueByClass },
        },
      };
    },
  };
}

module.exports = { createRequestScheduler, normalizeSchedulerConfig };
