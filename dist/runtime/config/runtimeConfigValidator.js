'use strict';

// Русский комментарий: валидатор/нормализатор конфигурации с fallback на прежний merge-процесс.
function buildRuntimeConfig(utilsConfig, globalConfig, exchangeConfig) {
  const coreConfig = utilsConfig.getCoreConfig(globalConfig);
  const merged = utilsConfig.merge(coreConfig, utilsConfig.getExchangeConfig(exchangeConfig));
  const unloadMode = merged.unloadMode || {};
  const capitalRegime = unloadMode.capitalRegime || {};
  const entryLimits = unloadMode.entryLimits || {};
  const executionContour = merged.executionContour || {};

  const normalized = {
    ...merged,
    enabled: !!merged.enabled,
    minBalance: Number(merged.minBalance || 0),
    warningThresholdAboveMinBalance: Number(merged.warningThresholdAboveMinBalance || 0),
    loopsLength: Number(globalConfig.loopsLength || 0),
    intervalSeconds: Number(globalConfig.intervalSeconds || 1),
    executionContour: {
      enabled: executionContour.enabled !== false,
      queueLimit: Number(executionContour.queueLimit || 200),
      retryAttempts: Number(executionContour.retryAttempts || 3),
      retryBackoffMs: Number(executionContour.retryBackoffMs || 350),
      dedupWindowMs: Number(executionContour.dedupWindowMs || 120000),
      reconcileOnLoopStart: executionContour.reconcileOnLoopStart !== false,
    },
    unloadMode: {
      enabled: !!unloadMode.enabled,
      safeEntryAssets: Array.isArray(unloadMode.safeEntryAssets) ? unloadMode.safeEntryAssets : [],
      entryLimits: {
        maxNewEntriesPerCycle: Number(entryLimits.maxNewEntriesPerCycle || 0),
        maxNewEntriesPerDay: Number(entryLimits.maxNewEntriesPerDay || 0),
        haltNewEntries: !!entryLimits.haltNewEntries,
      },
      capitalRegime: {
        enabled: capitalRegime.enabled !== false,
        forceHaltOnRiskSignals: !!capitalRegime.forceHaltOnRiskSignals,
        cautionRiskSignals: Array.isArray(capitalRegime.cautionRiskSignals) ? capitalRegime.cautionRiskSignals : [],
        defensiveRiskSignals: Array.isArray(capitalRegime.defensiveRiskSignals) ? capitalRegime.defensiveRiskSignals : [],
        haltRiskSignals: Array.isArray(capitalRegime.haltRiskSignals) ? capitalRegime.haltRiskSignals : [],
      },
    },
  };

  return normalized;
}

module.exports = { buildRuntimeConfig };
