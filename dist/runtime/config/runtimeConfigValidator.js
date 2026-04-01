'use strict';

// Русский комментарий: валидатор/нормализатор конфигурации с fallback на прежний merge-процесс.
function buildRuntimeConfig(utilsConfig, globalConfig, exchangeConfig) {
  const coreConfig = utilsConfig.getCoreConfig(globalConfig);
  const merged = utilsConfig.merge(coreConfig, utilsConfig.getExchangeConfig(exchangeConfig));

  const normalized = {
    ...merged,
    enabled: !!merged.enabled,
    minBalance: Number(merged.minBalance || 0),
    loopsLength: Number(globalConfig.loopsLength || 0),
    intervalSeconds: Number(globalConfig.intervalSeconds || 1),
  };

  return normalized;
}

module.exports = { buildRuntimeConfig };
