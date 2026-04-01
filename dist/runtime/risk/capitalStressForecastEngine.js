'use strict';

const { CAPITAL_REGIMES, CAPITAL_REGIME_ORDER } = require('./capitalRegimeEngine');

const DATA_QUALITY_STATES = {
  SUFFICIENT: 'sufficient',
  DEGRADED: 'degraded',
  INSUFFICIENT: 'insufficient',
};

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeCapitalStressForecastConfig(config = {}) {
  const scenarioWeights = config.scenarioWeights || {};
  const thresholds = config.thresholds || {};
  const restrictions = config.restrictions || {};
  const protectiveTightening = config.protectiveTightening || {};
  const sizingHints = config.sizingHints || {};

  return {
    enabled: !!config.enabled,
    minConfidenceForSignals: Number(config.minConfidenceForSignals || 0.45),
    scenarioWeights: {
      baseline: Number(scenarioWeights.baseline || 0.4),
      adverse: Number(scenarioWeights.adverse || 0.4),
      severe: Number(scenarioWeights.severe || 0.2),
    },
    thresholds: {
      elevatedFragility: Number(thresholds.elevatedFragility || 0.45),
      highFragility: Number(thresholds.highFragility || 0.65),
      criticalFragility: Number(thresholds.criticalFragility || 0.8),
      elevatedRegimeDeteriorationProbability: Number(thresholds.elevatedRegimeDeteriorationProbability || 0.35),
      criticalRegimeDeteriorationProbability: Number(thresholds.criticalRegimeDeteriorationProbability || 0.65),
    },
    restrictions: {
      enableRestrictionHints: restrictions.enableRestrictionHints !== false,
      enableHardRestrictionHints: !!restrictions.enableHardRestrictionHints,
      applyHardRestrictionHintsAsVeto: !!restrictions.applyHardRestrictionHintsAsVeto,
      hardRestrictionScenario: restrictions.hardRestrictionScenario || 'severe_drawdown_spike',
    },
    protectiveTightening: {
      enabled: protectiveTightening.enabled !== false,
      triggerFromFragility: Number(protectiveTightening.triggerFromFragility || 0.6),
      triggerFromRegimeProbability: Number(protectiveTightening.triggerFromRegimeProbability || 0.45),
      forcedLossExitHintMode: protectiveTightening.forcedLossExitHintMode || 'tighten',
    },
    sizingHints: {
      enabled: sizingHints.enabled !== false,
      normalMultiplier: Number(sizingHints.normalMultiplier || 1),
      elevatedMultiplier: Number(sizingHints.elevatedMultiplier || 0.85),
      highMultiplier: Number(sizingHints.highMultiplier || 0.65),
      criticalMultiplier: Number(sizingHints.criticalMultiplier || 0.4),
    },
  };
}

function buildScenario(base = {}, multipliers = {}) {
  const free = clamp01(base.freeBalancePressure * multipliers.freeBalancePressure);
  const margin = clamp01(base.marginPressure * multipliers.marginPressure);
  const drawdown = clamp01(base.drawdownPressure * multipliers.drawdownPressure);
  const regime = clamp01(base.regimeDeteriorationProbability * multipliers.regimeDeteriorationProbability);
  const fragility = clamp01((free * 0.2) + (margin * 0.25) + (drawdown * 0.35) + (regime * 0.2));

  return {
    expectedFreeBalancePressure: free,
    expectedMarginPressure: margin,
    expectedDrawdownPressure: drawdown,
    probabilityOfRegimeDeterioration: regime,
    portfolioFragilityScore: fragility,
  };
}

function detectDataQuality(input = {}) {
  const stats = input.stats || {};
  const required = [
    stats.usedMarginPercent,
    stats.freeBalance,
    stats.totalEquity,
    stats.dayPnlPercent,
    stats.balanceDrawdownPercent,
  ];
  const validCount = required.filter((v) => Number.isFinite(Number(v))).length;
  if (validCount >= 5) return DATA_QUALITY_STATES.SUFFICIENT;
  if (validCount >= 3) return DATA_QUALITY_STATES.DEGRADED;
  return DATA_QUALITY_STATES.INSUFFICIENT;
}

function evaluateCapitalStressForecast(input = {}, rawConfig = {}) {
  const config = normalizeCapitalStressForecastConfig(rawConfig);
  const context = input.context || {};
  const stats = input.stats || {};
  const capitalRegime = context.capitalRegime || CAPITAL_REGIMES.NORMAL;

  if (!config.enabled) {
    return {
      enabled: false,
      layerName: 'capitalStressForecastEngine',
      direction: 'neutral',
      score: 0,
      confidence: 0,
      softPenalty: 0,
      vetoCandidates: [],
      dataQualityState: DATA_QUALITY_STATES.INSUFFICIENT,
      reasonCodes: ['feature_disabled'],
      scenarios: {},
      outputHints: {
        restrictionHints: [],
        protectiveTighteningHints: [],
        sizingHints: { multiplier: 1, reason: 'feature_disabled' },
      },
    };
  }

  const usedMarginPercent = Math.max(0, Number(stats.usedMarginPercent || 0));
  const totalEquity = Math.max(0, Number(stats.totalEquity || 0));
  const freeBalance = Math.max(0, Number(stats.freeBalance || 0));
  const dayPnlPercent = Math.abs(Math.min(0, Number(stats.dayPnlPercent || 0)));
  const balanceDrawdownPercent = Math.max(0, Number(stats.balanceDrawdownPercent || 0));
  const openPositionsCount = Math.max(0, Number(stats.openPositionsCount || 0));

  const freeBalanceRatio = totalEquity > 0 ? clamp01(freeBalance / totalEquity) : 0;
  const base = {
    freeBalancePressure: clamp01((1 - freeBalanceRatio) * 1.1),
    marginPressure: clamp01(usedMarginPercent / 100),
    drawdownPressure: clamp01(Math.max(dayPnlPercent, balanceDrawdownPercent) / 100),
    regimeDeteriorationProbability: clamp01((usedMarginPercent * 0.45 + balanceDrawdownPercent * 0.35 + dayPnlPercent * 0.2) / 100),
  };

  const scenarios = {
    baseline_stabilization: buildScenario(base, {
      freeBalancePressure: 0.92,
      marginPressure: 0.9,
      drawdownPressure: 0.85,
      regimeDeteriorationProbability: 0.82,
    }),
    adverse_margin_expansion: buildScenario(base, {
      freeBalancePressure: 1.1,
      marginPressure: 1.22 + Math.min(0.12, openPositionsCount * 0.01),
      drawdownPressure: 1.08,
      regimeDeteriorationProbability: 1.12,
    }),
    severe_drawdown_spike: buildScenario(base, {
      freeBalancePressure: 1.18,
      marginPressure: 1.25,
      drawdownPressure: 1.3,
      regimeDeteriorationProbability: 1.35,
    }),
  };

  const weights = config.scenarioWeights;
  const weightSum = Math.max(0.001, weights.baseline + weights.adverse + weights.severe);

  const aggregate = {
    expectedFreeBalancePressure: clamp01((scenarios.baseline_stabilization.expectedFreeBalancePressure * weights.baseline
      + scenarios.adverse_margin_expansion.expectedFreeBalancePressure * weights.adverse
      + scenarios.severe_drawdown_spike.expectedFreeBalancePressure * weights.severe) / weightSum),
    expectedMarginPressure: clamp01((scenarios.baseline_stabilization.expectedMarginPressure * weights.baseline
      + scenarios.adverse_margin_expansion.expectedMarginPressure * weights.adverse
      + scenarios.severe_drawdown_spike.expectedMarginPressure * weights.severe) / weightSum),
    expectedDrawdownPressure: clamp01((scenarios.baseline_stabilization.expectedDrawdownPressure * weights.baseline
      + scenarios.adverse_margin_expansion.expectedDrawdownPressure * weights.adverse
      + scenarios.severe_drawdown_spike.expectedDrawdownPressure * weights.severe) / weightSum),
    probabilityOfRegimeDeterioration: clamp01((scenarios.baseline_stabilization.probabilityOfRegimeDeterioration * weights.baseline
      + scenarios.adverse_margin_expansion.probabilityOfRegimeDeterioration * weights.adverse
      + scenarios.severe_drawdown_spike.probabilityOfRegimeDeterioration * weights.severe) / weightSum),
    portfolioFragilityScore: clamp01((scenarios.baseline_stabilization.portfolioFragilityScore * weights.baseline
      + scenarios.adverse_margin_expansion.portfolioFragilityScore * weights.adverse
      + scenarios.severe_drawdown_spike.portfolioFragilityScore * weights.severe) / weightSum),
  };

  const dataQualityState = detectDataQuality({ stats });
  const confidence = dataQualityState === DATA_QUALITY_STATES.SUFFICIENT
    ? 0.85
    : dataQualityState === DATA_QUALITY_STATES.DEGRADED ? 0.55 : 0.25;

  const reasonCodes = [];
  const restrictionHints = [];
  const protectiveTighteningHints = [];
  const vetoCandidates = [];

  if (aggregate.probabilityOfRegimeDeterioration >= config.thresholds.elevatedRegimeDeteriorationProbability) {
    reasonCodes.push('forecast_regime_deterioration_elevated');
    if (config.restrictions.enableRestrictionHints) {
      restrictionHints.push('restrict_new_entries_soft');
    }
  }
  if (aggregate.portfolioFragilityScore >= config.thresholds.highFragility) {
    reasonCodes.push('forecast_fragility_high');
    if (config.restrictions.enableRestrictionHints) {
      restrictionHints.push('restrict_new_entries_high_fragility');
    }
  }
  if (
    config.restrictions.enableHardRestrictionHints
    && aggregate.portfolioFragilityScore >= config.thresholds.criticalFragility
    && aggregate.probabilityOfRegimeDeterioration >= config.thresholds.criticalRegimeDeteriorationProbability
  ) {
    reasonCodes.push('forecast_hard_restriction_candidate');
    vetoCandidates.push({
      type: 'capital_prohibition',
      reason: 'forecast_halt_candidate',
      layer: 'risk.portfolioForecast',
      scenario: config.restrictions.hardRestrictionScenario,
    });
    restrictionHints.push('restrict_new_entries_hard_candidate');
  }

  if (
    config.protectiveTightening.enabled
    && (
      aggregate.portfolioFragilityScore >= config.protectiveTightening.triggerFromFragility
      || aggregate.probabilityOfRegimeDeterioration >= config.protectiveTightening.triggerFromRegimeProbability
    )
  ) {
    reasonCodes.push('forecast_protective_tightening_required');
    protectiveTighteningHints.push(`forced_loss_exit:${config.protectiveTightening.forcedLossExitHintMode}`);
    protectiveTighteningHints.push('server_tp_sl_conservative_preferred');
  }

  const severity = aggregate.portfolioFragilityScore >= config.thresholds.criticalFragility
    ? 'critical'
    : aggregate.portfolioFragilityScore >= config.thresholds.highFragility
      ? 'high'
      : aggregate.portfolioFragilityScore >= config.thresholds.elevatedFragility ? 'elevated' : 'normal';

  const sizingMultiplier = !config.sizingHints.enabled
    ? 1
    : severity === 'critical'
      ? config.sizingHints.criticalMultiplier
      : severity === 'high'
        ? config.sizingHints.highMultiplier
        : severity === 'elevated'
          ? config.sizingHints.elevatedMultiplier
          : config.sizingHints.normalMultiplier;

  const forecastSignals = [];
  if (severity === 'critical') forecastSignals.push('forecast_halt');
  if (severity === 'high') forecastSignals.push('forecast_stress');
  if (severity === 'elevated') forecastSignals.push('forecast_defensive');

  // Русский комментарий: прогнозный слой никогда не ослабляет текущий capitalRegime, только подсвечивает риск ухудшения.
  const capitalRegimeIndex = Math.max(0, CAPITAL_REGIME_ORDER.indexOf(capitalRegime));
  const expectedRegimeIndex = Math.min(CAPITAL_REGIME_ORDER.length - 1, capitalRegimeIndex + (severity === 'critical' ? 2 : severity === 'high' ? 1 : 0));

  return {
    enabled: true,
    layerName: 'capitalStressForecastEngine',
    direction: severity === 'normal' ? 'neutral' : 'risk_off',
    score: aggregate.portfolioFragilityScore,
    confidence,
    softPenalty: severity === 'normal' ? 0 : severity === 'elevated' ? 0.08 : severity === 'high' ? 0.18 : 0.35,
    vetoCandidates,
    dataQualityState,
    reasonCodes,
    scenarios,
    aggregate,
    forecastRegimeShiftRisk: severity,
    forecastSignals,
    expectedCapitalRegime: CAPITAL_REGIME_ORDER[expectedRegimeIndex] || capitalRegime,
    outputHints: {
      restrictionHints,
      protectiveTighteningHints,
      sizingHints: {
        multiplier: Number(sizingMultiplier),
        reason: severity === 'normal' ? 'forecast_neutral' : `forecast_${severity}`,
      },
    },
  };
}

function toCapitalStressForecastEvent(input = {}) {
  const context = input.context || {};
  const decision = input.decision || {};

  return {
    eventType: 'portfolio_capital_stress_forecast',
    cycleId: context.cycleId || '',
    ticker: context.ticker || 'PORTFOLIO',
    exchange: context.exchange || '',
    module: 'capitalStressForecastEngine',
    layer: 'risk.portfolioForecast',
    marketRegime: context.marketRegime || 'unknown',
    capitalRegime: context.capitalRegime || 'NORMAL',
    setupType: context.setupType || 'portfolio',
    score: Number.isFinite(decision.score) ? decision.score : 0,
    confidence: Number.isFinite(decision.confidence) ? decision.confidence : 0,
    vetoReason: decision.vetoCandidates && decision.vetoCandidates[0] ? decision.vetoCandidates[0].reason : null,
    sizingDecision: decision.outputHints && decision.outputHints.sizingHints ? decision.outputHints.sizingHints.reason : 'not_evaluated',
    executionAction: 'none',
    fallbackAction: decision.enabled ? 'owner_layers_interpret_hints' : 'legacy_without_forecast',
    finalDecision: decision.direction || 'neutral',
    payload: {
      dataQualityState: decision.dataQualityState || DATA_QUALITY_STATES.INSUFFICIENT,
      reasonCodes: decision.reasonCodes || [],
      forecastRegimeShiftRisk: decision.forecastRegimeShiftRisk || 'normal',
      scenarios: decision.scenarios || {},
      aggregate: decision.aggregate || {},
      outputHints: decision.outputHints || {},
    },
  };
}

module.exports = {
  DATA_QUALITY_STATES,
  normalizeCapitalStressForecastConfig,
  evaluateCapitalStressForecast,
  toCapitalStressForecastEvent,
};
