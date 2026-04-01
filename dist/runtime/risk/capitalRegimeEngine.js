'use strict';

const CAPITAL_REGIMES = {
  NORMAL: 'NORMAL',
  CAUTION: 'CAUTION',
  DEFENSIVE: 'DEFENSIVE',
  CAPITAL_PRESERVATION: 'CAPITAL_PRESERVATION',
  HALT_NEW_ENTRIES: 'HALT_NEW_ENTRIES',
};

const CAPITAL_REGIME_ORDER = [
  CAPITAL_REGIMES.NORMAL,
  CAPITAL_REGIMES.CAUTION,
  CAPITAL_REGIMES.DEFENSIVE,
  CAPITAL_REGIMES.CAPITAL_PRESERVATION,
  CAPITAL_REGIMES.HALT_NEW_ENTRIES,
];

function normalizeCapitalRegimeEngineConfig(config = {}) {
  const thresholds = config.thresholds || {};
  return {
    enabled: config.enabled !== false,
    escalationOnly: config.escalationOnly !== false,
    thresholds: {
      cautionDailyLossPercent: Number(thresholds.cautionDailyLossPercent || 0),
      defensiveDailyLossPercent: Number(thresholds.defensiveDailyLossPercent || 0),
      capitalPreservationDailyLossPercent: Number(thresholds.capitalPreservationDailyLossPercent || 0),
      haltDailyLossPercent: Number(thresholds.haltDailyLossPercent || 0),
      cautionMarginUsagePercent: Number(thresholds.cautionMarginUsagePercent || 0),
      defensiveMarginUsagePercent: Number(thresholds.defensiveMarginUsagePercent || 0),
      capitalPreservationMarginUsagePercent: Number(thresholds.capitalPreservationMarginUsagePercent || 0),
      haltMarginUsagePercent: Number(thresholds.haltMarginUsagePercent || 0),
      cautionBalanceDrawdownPercent: Number(thresholds.cautionBalanceDrawdownPercent || 0),
      defensiveBalanceDrawdownPercent: Number(thresholds.defensiveBalanceDrawdownPercent || 0),
      capitalPreservationBalanceDrawdownPercent: Number(thresholds.capitalPreservationBalanceDrawdownPercent || 0),
      haltBalanceDrawdownPercent: Number(thresholds.haltBalanceDrawdownPercent || 0),
    },
  };
}

function getMaxRegime(left, right) {
  return CAPITAL_REGIME_ORDER[Math.max(CAPITAL_REGIME_ORDER.indexOf(left), CAPITAL_REGIME_ORDER.indexOf(right))] || CAPITAL_REGIMES.NORMAL;
}

function pickRegimeByThresholds(value, caution, defensive, preservation, halt) {
  if (halt > 0 && value >= halt) return CAPITAL_REGIMES.HALT_NEW_ENTRIES;
  if (preservation > 0 && value >= preservation) return CAPITAL_REGIMES.CAPITAL_PRESERVATION;
  if (defensive > 0 && value >= defensive) return CAPITAL_REGIMES.DEFENSIVE;
  if (caution > 0 && value >= caution) return CAPITAL_REGIMES.CAUTION;
  return CAPITAL_REGIMES.NORMAL;
}

function evaluateCapitalRegime(input = {}, rawConfig = {}) {
  const config = normalizeCapitalRegimeEngineConfig(rawConfig);
  const context = input.context || {};
  const stats = input.stats || {};
  if (!config.enabled) {
    return {
      enabled: false,
      capitalRegime: CAPITAL_REGIMES.NORMAL,
      previousCapitalRegime: context.previousCapitalRegime || CAPITAL_REGIMES.NORMAL,
      regimeChanged: false,
      reasons: ['feature_disabled'],
      telemetry: { regimeByLoss: CAPITAL_REGIMES.NORMAL, regimeByMargin: CAPITAL_REGIMES.NORMAL, regimeByDrawdown: CAPITAL_REGIMES.NORMAL },
    };
  }

  const dayPnlPercent = Math.abs(Math.min(0, Number(stats.dayPnlPercent || 0)));
  const usedMarginPercent = Math.max(0, Number(stats.usedMarginPercent || 0));
  const balanceDrawdownPercent = Math.max(0, Number(stats.balanceDrawdownPercent || 0));

  const regimeByLoss = pickRegimeByThresholds(
    dayPnlPercent,
    config.thresholds.cautionDailyLossPercent,
    config.thresholds.defensiveDailyLossPercent,
    config.thresholds.capitalPreservationDailyLossPercent,
    config.thresholds.haltDailyLossPercent,
  );
  const regimeByMargin = pickRegimeByThresholds(
    usedMarginPercent,
    config.thresholds.cautionMarginUsagePercent,
    config.thresholds.defensiveMarginUsagePercent,
    config.thresholds.capitalPreservationMarginUsagePercent,
    config.thresholds.haltMarginUsagePercent,
  );
  const regimeByDrawdown = pickRegimeByThresholds(
    balanceDrawdownPercent,
    config.thresholds.cautionBalanceDrawdownPercent,
    config.thresholds.defensiveBalanceDrawdownPercent,
    config.thresholds.capitalPreservationBalanceDrawdownPercent,
    config.thresholds.haltBalanceDrawdownPercent,
  );

  let capitalRegime = getMaxRegime(regimeByLoss, getMaxRegime(regimeByMargin, regimeByDrawdown));
  const previousCapitalRegime = context.previousCapitalRegime || CAPITAL_REGIMES.NORMAL;
  if (config.escalationOnly) {
    capitalRegime = getMaxRegime(previousCapitalRegime, capitalRegime);
  }

  const reasons = [];
  if (regimeByLoss !== CAPITAL_REGIMES.NORMAL) reasons.push(`loss_regime:${regimeByLoss}`);
  if (regimeByMargin !== CAPITAL_REGIMES.NORMAL) reasons.push(`margin_regime:${regimeByMargin}`);
  if (regimeByDrawdown !== CAPITAL_REGIMES.NORMAL) reasons.push(`drawdown_regime:${regimeByDrawdown}`);
  if (config.escalationOnly && previousCapitalRegime !== capitalRegime && CAPITAL_REGIME_ORDER.indexOf(previousCapitalRegime) > CAPITAL_REGIME_ORDER.indexOf(capitalRegime)) {
    reasons.push('escalation_only_keeps_previous');
  }

  return {
    enabled: true,
    capitalRegime,
    previousCapitalRegime,
    regimeChanged: previousCapitalRegime !== capitalRegime,
    reasons,
    telemetry: {
      regimeByLoss,
      regimeByMargin,
      regimeByDrawdown,
    },
  };
}

function buildCapitalRegimeDownstreamContext(input = {}) {
  const capitalRegime = input.capitalRegime || CAPITAL_REGIMES.NORMAL;
  const forecastRegimeShiftRisk = input.forecastRegimeShiftRisk || null;
  const forecastSignals = Array.isArray(input.forecastSignals) ? input.forecastSignals : [];
  const base = {
    cycleId: input.cycleId || '',
    ticker: input.ticker || '',
    exchange: input.exchange || '',
    marketRegime: input.marketRegime || 'unknown',
    capitalRegime,
    forecastRegimeShiftRisk,
    forecastSignals,
  };

  // Русский комментарий: единая точка передачи контекста капитала для всех downstream-слоёв.
  return {
    unloadMode: { ...base, layer: 'unload_mode' },
    dynamicAssetSelection: { ...base, layer: 'dynamic_asset_selection' },
    marketRegimeRouter: { ...base, layer: 'market_regime_router' },
    confluenceEntry: { ...base, layer: 'confluence_entry' },
    finalEntryDecision: { ...base, layer: 'final_entry_decision' },
    dynamicPositionSizing: { ...base, layer: 'dynamic_position_sizing' },
    mlFeatureContext: { ...base, layer: 'ml_feature_context' },
    mlMetaController: { ...base, layer: 'ml_meta_controller' },
  };
}

module.exports = {
  CAPITAL_REGIMES,
  CAPITAL_REGIME_ORDER,
  normalizeCapitalRegimeEngineConfig,
  evaluateCapitalRegime,
  buildCapitalRegimeDownstreamContext,
  getMaxRegime,
  pickRegimeByThresholds,
};
