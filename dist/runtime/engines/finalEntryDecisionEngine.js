'use strict';

// Русский комментарий: finalEntryDecisionEngine работает только как агрегатор уже рассчитанных upstream block outputs.
// Он не должен пересчитывать market data, не владеет sizing/execution и выдаёт унифицированный финальный контракт для downstream слоёв.

function clamp01(value) {
  if (!Number.isFinite(Number(value))) return 0;
  const n = Number(value);
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function normalizeConfig(raw = {}) {
  const thresholds = raw.thresholds || {};
  const fallback = raw.fallback || {};
  const tightening = raw.tightening || {};
  const minimumRequiredScorePerBlock = raw.minimumRequiredScorePerBlock || {};
  const weakEntryRange = raw.weakEntryRange || {};
  const vetoRules = raw.vetoRules || {};
  return {
    enabled: raw.enabled !== false,
    // Русский комментарий: backward compatibility для старого allowWeakEntry + новое поле allowWeakEntryMode.
    allowWeakEntryMode: raw.allowWeakEntryMode !== false && raw.allowWeakEntry !== false,
    // Русский комментарий: новый alias entryScoreThreshold с fallback на старый fullEntryScore.
    entryScoreThreshold: clamp01(raw.entryScoreThreshold ?? thresholds.fullEntryScore ?? 0.68),
    // Русский комментарий: weakEntryThreshold остаётся точкой включения weak entry; weakEntryRange задаёт диагностический коридор.
    weakEntryThreshold: clamp01(raw.weakEntryThreshold ?? thresholds.weakEntryScore ?? 0.44),
    weakEntryRange: {
      min: clamp01(weakEntryRange.min ?? raw.weakEntryThreshold ?? thresholds.weakEntryScore ?? 0.44),
      max: clamp01(weakEntryRange.max ?? raw.entryScoreThreshold ?? thresholds.fullEntryScore ?? 0.68),
    },
    minimumRequiredBlocks: Array.isArray(raw.minimumRequiredBlocks)
      ? raw.minimumRequiredBlocks
      : ['entryPermission', 'marketContext', 'primarySignal'],
    degradedPenalty: clamp01(fallback.degradedPenalty ?? 0.08),
    missingBlockPenalty: clamp01(fallback.missingBlockPenalty ?? 0.12),
    defaultWeight: Number(raw.defaultWeight ?? 1),
    minimumRequiredScorePerBlock: {
      entryPermission: clamp01(minimumRequiredScorePerBlock.entryPermission ?? 0.55),
      marketContext: clamp01(minimumRequiredScorePerBlock.marketContext ?? 0.5),
      primarySignal: clamp01(minimumRequiredScorePerBlock.primarySignal ?? 0.52),
      confirmation: clamp01(minimumRequiredScorePerBlock.confirmation ?? 0),
      ...Object.keys(minimumRequiredScorePerBlock).reduce((acc, name) => {
        acc[name] = clamp01(minimumRequiredScorePerBlock[name]);
        return acc;
      }, {}),
    },
    vetoRules: {
      hardVetoTypes: Array.isArray(vetoRules.hardVetoTypes) ? vetoRules.hardVetoTypes : ['no_trade_regime', 'capital_prohibition'],
      interpretForecastRestrictionHints: vetoRules.interpretForecastRestrictionHints !== false,
      forecastHardHints: Array.isArray(vetoRules.forecastHardHints)
        ? vetoRules.forecastHardHints
        : ['restrict_new_entries_hard_candidate', 'restrict_new_entries_hard'],
      mlCannotOverrideHardVeto: vetoRules.mlCannotOverrideHardVeto !== false,
    },
    tightening: {
      balanceState: {
        enabledWhen: String((tightening.balanceState || {}).enabledWhen || 'drawdownProtection'),
        thresholdDelta: clamp01((tightening.balanceState || {}).thresholdDelta ?? 0.05),
        weakThresholdDelta: clamp01((tightening.balanceState || {}).weakThresholdDelta ?? 0.03),
        minBlockDelta: clamp01((tightening.balanceState || {}).minBlockDelta ?? 0.05),
        disableWeakEntry: (tightening.balanceState || {}).disableWeakEntry === true,
      },
      capitalRegime: {
        REDUCE_RISK: {
          thresholdDelta: clamp01((((tightening.capitalRegime || {}).REDUCE_RISK) || {}).thresholdDelta ?? 0.04),
          weakThresholdDelta: clamp01((((tightening.capitalRegime || {}).REDUCE_RISK) || {}).weakThresholdDelta ?? 0.03),
          minBlockDelta: clamp01((((tightening.capitalRegime || {}).REDUCE_RISK) || {}).minBlockDelta ?? 0.05),
          disableWeakEntry: (((tightening.capitalRegime || {}).REDUCE_RISK) || {}).disableWeakEntry === true,
        },
        CONSERVE_CAPITAL: {
          thresholdDelta: clamp01((((tightening.capitalRegime || {}).CONSERVE_CAPITAL) || {}).thresholdDelta ?? 0.08),
          weakThresholdDelta: clamp01((((tightening.capitalRegime || {}).CONSERVE_CAPITAL) || {}).weakThresholdDelta ?? 0.05),
          minBlockDelta: clamp01((((tightening.capitalRegime || {}).CONSERVE_CAPITAL) || {}).minBlockDelta ?? 0.08),
          disableWeakEntry: (((tightening.capitalRegime || {}).CONSERVE_CAPITAL) || {}).disableWeakEntry !== false,
        },
      },
    },
  };
}

function normalizeComponent(name, component, defaultWeight) {
  const sourceMeta = component && typeof component.sourceMeta === 'object' ? component.sourceMeta : {};
  const score = clamp01(component && component.score);
  const confidence = clamp01(component && component.confidence);
  const weight = Number.isFinite(Number(component && component.weight))
    ? Number(component.weight)
    : Number(defaultWeight);
  const dataQualityState = component && component.dataQualityState ? component.dataQualityState : 'missing';
  return {
    name,
    score,
    confidence,
    weight: Number.isFinite(weight) ? Math.max(0, weight) : 0,
    dataQualityState,
    sourceMeta: {
      block: sourceMeta.block || name,
      step: sourceMeta.step || null,
      source: sourceMeta.source || 'shared_decision_context',
      recalculated: false,
      ...sourceMeta,
    },
    reasonCodes: Array.isArray(component && component.reasonCodes) ? component.reasonCodes.slice(0, 32) : [],
  };
}

function normalizeVetoCandidate(veto) {
  if (!veto || typeof veto !== 'object') return null;
  return {
    type: String(veto.type || 'unknown_veto'),
    severity: veto.severity === 'hard' ? 'hard' : 'soft',
    reason: String(veto.reason || veto.type || 'unknown_veto_reason'),
    source: String(veto.source || veto.layerName || 'shared_decision_context'),
    blocking: veto.blocking === true || veto.severity === 'hard',
  };
}

function normalizeForecastHook(input = {}) {
  const source = input.portfolioForecast || input.forecastHooks || {};
  return {
    enabled: source.enabled === true,
    confidence: clamp01(source.confidence),
    restrictionHints: Array.isArray(source.restrictionHints) ? source.restrictionHints : [],
    vetoCandidates: Array.isArray(source.vetoCandidates) ? source.vetoCandidates.map(normalizeVetoCandidate).filter(Boolean) : [],
    metadata: typeof source.metadata === 'object' && source.metadata ? source.metadata : {},
  };
}

function normalizeMlHook(input = {}) {
  const source = input.mlHooks || input.mlAdvice || {};
  return {
    enabled: source.enabled === true,
    direction: source.direction || 'neutral',
    confidence: clamp01(source.confidence),
    scoreDelta: Math.max(-1, Math.min(1, Number.isFinite(Number(source.scoreDelta)) ? Number(source.scoreDelta) : 0)),
    advisoryPenalty: clamp01(source.advisoryPenalty),
    metadata: typeof source.metadata === 'object' && source.metadata ? source.metadata : {},
  };
}

function pickHardRiskVeto(input, vetoCandidates, config) {
  const hardTypes = new Set(config.vetoRules.hardVetoTypes || []);
  const hardVeto = vetoCandidates.find((v) => v && (v.blocking || hardTypes.has(v.type) || v.type === 'capital_prohibition'));
  if (hardVeto) return hardVeto;

  const capitalRegime = ((input || {}).capitalRegime || (((input || {}).balanceState || {}).capitalRegime) || 'NORMAL');
  if (capitalRegime === 'HALT_NEW_ENTRIES' || capitalRegime === 'PROHIBIT_NEW_ENTRIES') {
    return {
      type: 'capital_prohibition',
      severity: 'hard',
      reason: 'capital_regime_blocks_new_entries',
      source: 'capitalRegime',
      blocking: true,
    };
  }

  const unloadMode = ((input || {}).balanceState || {}).unloadMode === true;
  if (unloadMode) {
    return {
      type: 'unload_mode',
      severity: 'hard',
      reason: 'balance_state_unload_mode_active',
      source: 'balanceState',
      blocking: true,
    };
  }

  return null;
}

function evaluateNoTradeRegimeVeto(input = {}) {
  if (input.noTradeRegime === true || input.regimeState === 'NO_TRADE') {
    return {
      type: 'no_trade_regime',
      severity: 'hard',
      reason: 'regime_router_prohibits_new_entries',
      source: 'regimeRouter',
      blocking: true,
    };
  }
  return null;
}

function resolveTightening(config, input = {}) {
  const capitalRegime = input.capitalRegime || ((input.balanceState || {}).capitalRegime) || 'NORMAL';
  const balanceState = input.balanceState || {};
  const result = {
    fullEntryDelta: 0,
    weakEntryDelta: 0,
    minBlockDelta: 0,
    weakEntryForcedDisabled: false,
    reasons: [],
  };

  const capitalRule = (config.tightening.capitalRegime || {})[capitalRegime];
  if (capitalRule) {
    result.fullEntryDelta += clamp01(capitalRule.thresholdDelta);
    result.weakEntryDelta += clamp01(capitalRule.weakThresholdDelta);
    result.minBlockDelta += clamp01(capitalRule.minBlockDelta);
    if (capitalRule.disableWeakEntry) result.weakEntryForcedDisabled = true;
    result.reasons.push(`capital_regime_tightening:${capitalRegime}`);
  }

  const balanceTrigger = config.tightening.balanceState.enabledWhen;
  if (balanceState && balanceState[balanceTrigger] === true) {
    result.fullEntryDelta += clamp01(config.tightening.balanceState.thresholdDelta);
    result.weakEntryDelta += clamp01(config.tightening.balanceState.weakThresholdDelta);
    result.minBlockDelta += clamp01(config.tightening.balanceState.minBlockDelta);
    if (config.tightening.balanceState.disableWeakEntry) result.weakEntryForcedDisabled = true;
    result.reasons.push(`balance_state_tightening:${balanceTrigger}`);
  }

  if (balanceState.allowWeakEntry === false) {
    result.weakEntryForcedDisabled = true;
    result.reasons.push('balance_state_weak_entry_disabled');
  }

  return result;
}

function evaluateForecastVeto(forecastHook, config) {
  if (!forecastHook.enabled || !config.vetoRules.interpretForecastRestrictionHints) return null;
  const hardHintSet = new Set(config.vetoRules.forecastHardHints || []);
  const matchedHint = forecastHook.restrictionHints.find((hint) => hardHintSet.has(String(hint)));
  if (!matchedHint) return null;
  return {
    type: 'forecast_restriction_veto',
    severity: 'hard',
    reason: `forecast_hint:${matchedHint}`,
    source: 'portfolioForecastEngine',
    blocking: true,
  };
}

function evaluateFinalEntryDecision(input = {}, rawConfig = {}, runtime = {}) {
  const config = normalizeConfig(rawConfig);
  const componentScoresInput = input && typeof input.componentScores === 'object' && input.componentScores
    ? input.componentScores
    : {};

  const componentScores = Object.keys(componentScoresInput).reduce((acc, name) => {
    acc[name] = normalizeComponent(name, componentScoresInput[name], config.defaultWeight);
    return acc;
  }, {});

  const componentList = Object.values(componentScores);
  const vetoCandidates = Array.isArray(input.vetoCandidates)
    ? input.vetoCandidates.map(normalizeVetoCandidate).filter(Boolean)
    : [];

  const forecastHook = normalizeForecastHook(input);
  const forecastHintVeto = evaluateForecastVeto(forecastHook, config);
  const mlHook = normalizeMlHook(input);
  const mlApplied = mlHook.enabled === true;

  const mergedVetoCandidates = [
    ...vetoCandidates,
    ...forecastHook.vetoCandidates,
  ];

  const noTradeRegimeVeto = evaluateNoTradeRegimeVeto(input);
  const hardVeto = noTradeRegimeVeto || forecastHintVeto || pickHardRiskVeto(input, mergedVetoCandidates, config);
  const tightening = resolveTightening(config, input);
  const unmetMinimumBlocks = config.minimumRequiredBlocks.filter((name) => !componentScores[name]);
  const minimumRequiredScorePerBlock = config.minimumRequiredBlocks.reduce((acc, name) => {
    const baseMinScore = config.minimumRequiredScorePerBlock[name] ?? 0;
    acc[name] = clamp01(baseMinScore + tightening.minBlockDelta);
    return acc;
  }, {});
  const blocksFailedByScore = config.minimumRequiredBlocks.filter((name) => {
    const block = componentScores[name];
    if (!block) return false;
    return block.score < (minimumRequiredScorePerBlock[name] ?? 0);
  });
  const mandatoryBlocksSatisfied = unmetMinimumBlocks.length === 0 && blocksFailedByScore.length === 0;
  const appliedPenalties = [];

  const missingPenalty = unmetMinimumBlocks.length * config.missingBlockPenalty;
  if (missingPenalty > 0) {
    appliedPenalties.push({
      type: 'missing_block_output',
      value: clamp01(missingPenalty),
      reason: `missing_blocks:${unmetMinimumBlocks.join(',')}`,
    });
  }

  const degradedBlocks = componentList
    .filter((item) => item.dataQualityState === 'degraded' || item.dataQualityState === 'cached')
    .map((item) => item.name);
  const degradedPenalty = degradedBlocks.length * config.degradedPenalty;
  if (degradedPenalty > 0) {
    appliedPenalties.push({
      type: 'degraded_or_cached_block_output',
      value: clamp01(degradedPenalty),
      reason: `degraded_blocks:${degradedBlocks.join(',')}`,
    });
  }

  if (mlApplied && mlHook.advisoryPenalty > 0) {
    appliedPenalties.push({
      type: 'ml_advisory_penalty',
      value: clamp01(mlHook.advisoryPenalty),
      reason: `ml_confidence:${mlHook.confidence}`,
    });
  }

  const totalWeight = componentList.reduce((sum, item) => sum + item.weight, 0);
  const weightedScore = totalWeight > 0
    ? componentList.reduce((sum, item) => sum + (item.score * item.weight), 0) / totalWeight
    : 0;

  const mlScoreDelta = mlApplied ? mlHook.scoreDelta : 0;
  const totalPenalty = appliedPenalties.reduce((sum, item) => sum + clamp01(item.value), 0);
  const entryScore = clamp01(weightedScore + mlScoreDelta - totalPenalty);
  const fullEntryScoreThreshold = clamp01(config.entryScoreThreshold + tightening.fullEntryDelta);
  const weakEntryScoreThreshold = clamp01(config.weakEntryThreshold + tightening.weakEntryDelta);
  const weakEntryAllowed = config.allowWeakEntryMode && !tightening.weakEntryForcedDisabled;

  let decisionMode = 'no_entry';
  if (!hardVeto && mandatoryBlocksSatisfied) {
    if (entryScore >= fullEntryScoreThreshold) decisionMode = 'full_entry';
    else if (
      weakEntryAllowed
      && entryScore >= weakEntryScoreThreshold
      && entryScore >= config.weakEntryRange.min
      && entryScore <= config.weakEntryRange.max
    ) {
      decisionMode = 'weak_entry';
    }
  }

  const dataQualityState = input.dataQualityState
    || (componentList.length === 0
      ? 'missing'
      : (degradedBlocks.length > 0 ? 'degraded' : 'ok'));

  const reasonCodes = [];
  if (hardVeto) reasonCodes.push(`hard_veto:${hardVeto.type}`);
  if (unmetMinimumBlocks.length) reasonCodes.push('missing_minimum_blocks');
  if (blocksFailedByScore.length) reasonCodes.push('minimum_block_score_not_met');
  if (tightening.reasons.length) reasonCodes.push(...tightening.reasons);
  if (degradedBlocks.length) reasonCodes.push('degraded_or_cached_input_blocks');
  if (!weakEntryAllowed) reasonCodes.push('weak_entry_disabled_by_runtime_context');
  if (forecastHintVeto) reasonCodes.push('forecast_restriction_hint_interpreted');
  if (mlApplied) reasonCodes.push('ml_hook_applied_as_advisory_only');
  if (decisionMode === 'no_entry' && !hardVeto) reasonCodes.push('entry_score_below_threshold');

  const output = {
    entryScore,
    decisionMode,
    componentScores,
    unmetMinimumBlocks,
    failedMinimumScoreBlocks: blocksFailedByScore,
    mandatoryBlocksSatisfied,
    minimumRequiredScorePerBlock,
    thresholdsApplied: {
      fullEntry: fullEntryScoreThreshold,
      weakEntry: weakEntryScoreThreshold,
      weakEntryAllowed,
      weakEntryRange: {
        min: config.weakEntryRange.min,
        max: config.weakEntryRange.max,
      },
    },
    vetoSummary: {
      blocked: !!hardVeto,
      finalVeto: hardVeto,
      candidates: mergedVetoCandidates,
      forecastHintVeto,
    },
    appliedPenalties,
    decisionModeMetadata: {
      mode: decisionMode,
      weakEntryModeEnabled: config.allowWeakEntryMode,
      decisionOwner: 'finalEntryDecisionEngine',
    },
    forecastHook: {
      enabled: forecastHook.enabled,
      confidence: forecastHook.confidence,
      restrictionHints: forecastHook.restrictionHints,
      interpretedInFinalEntryDecision: true,
      metadata: forecastHook.metadata,
    },
    mlHook: {
      enabled: mlApplied,
      confidence: mlHook.confidence,
      direction: mlHook.direction,
      scoreDelta: mlScoreDelta,
      advisoryOnly: true,
      metadata: mlHook.metadata,
    },
    capitalRegimeImpact: {
      capitalRegime: input.capitalRegime || (input.balanceState || {}).capitalRegime || 'NORMAL',
      allowNewEntries: !hardVeto,
      reason: hardVeto ? hardVeto.reason : 'no_capital_block',
      tighteningReasons: tightening.reasons,
    },
    dataQualityState,
    explanation: {
      reasonCodes,
      hardVetoType: hardVeto ? hardVeto.type : 'none',
      softPenaltyTypes: appliedPenalties.map((item) => item.type),
      noTradeRegime: noTradeRegimeVeto ? 'active' : 'inactive',
      sourceMetadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
      ownership: {
        isSignalRecalculationOwner: false,
        isMarketDataOwner: false,
        isSizingOwner: false,
        isExecutionOwner: false,
        isFinalVetoOwnerForNewEntries: true,
      },
      downstreamHints: {
        sizingReady: true,
        mlPhase1Ready: true,
        mlPhase2Ready: true,
        multiExchangeAdaptationReady: true,
      },
    },
  };

  if (runtime && typeof runtime.log === 'function') {
    const componentScoresCompact = Object.keys(componentScores)
      .map((name) => `${name}:${componentScores[name].score.toFixed(3)}`)
      .join('|') || 'none';
    const penaltiesCompact = appliedPenalties
      .map((item) => `${item.type}:${Number(item.value).toFixed(3)}`)
      .join('|') || 'none';

    runtime.log(`[finalEntryDecision] cycle=${(input.context || {}).cycleId || 'n/a'} ticker=${(input.context || {}).ticker || 'n/a'} mode=${decisionMode} entryScore=${entryScore.toFixed(4)} fullThr=${fullEntryScoreThreshold.toFixed(4)} weakThr=${weakEntryScoreThreshold.toFixed(4)} hardVeto=${hardVeto ? hardVeto.type : 'none'} noTrade=${noTradeRegimeVeto ? 'active' : 'inactive'} weakAllowed=${weakEntryAllowed ? 'yes' : 'no'} unmetMinimum=${unmetMinimumBlocks.join('|') || 'none'} minScoreFailed=${blocksFailedByScore.join('|') || 'none'} capitalRegime=${output.capitalRegimeImpact.capitalRegime} forecastHints=${forecastHook.restrictionHints.join('|') || 'none'} mlApplied=${mlApplied ? 'yes' : 'no'}`);
    runtime.log(`[finalEntryDecision:details] componentScores=${componentScoresCompact} penalties=${penaltiesCompact} vetoSummary=${hardVeto ? hardVeto.reason : 'none'} decisionMode=${decisionMode} capitalImpact=${output.capitalRegimeImpact.reason}`);
  }

  return output;
}

function toFinalEntryDecisionEvent({ context = {}, decision = {} } = {}) {
  return {
    eventType: 'final_entry_decision',
    cycleId: context.cycleId || 'n/a',
    ticker: context.ticker || 'n/a',
    exchange: context.exchange || 'n/a',
    mode: context.mode || 'live',
    module: 'finalEntryDecisionEngine',
    layer: 'entry.finalDecision',
    marketRegime: context.marketRegime || 'unknown',
    capitalRegime: context.capitalRegime || (decision.capitalRegimeImpact || {}).capitalRegime || 'NORMAL',
    finalDecision: decision.decisionMode || 'no_entry',
    payload: {
      entryScore: Number.isFinite(Number(decision.entryScore)) ? Number(decision.entryScore) : 0,
      componentScores: decision.componentScores || {},
      unmetMinimumBlocks: Array.isArray(decision.unmetMinimumBlocks) ? decision.unmetMinimumBlocks : [],
      failedMinimumScoreBlocks: Array.isArray(decision.failedMinimumScoreBlocks) ? decision.failedMinimumScoreBlocks : [],
      vetoSummary: decision.vetoSummary || { blocked: false, finalVeto: null, candidates: [] },
      appliedPenalties: Array.isArray(decision.appliedPenalties) ? decision.appliedPenalties : [],
      decisionMode: decision.decisionMode || 'no_entry',
      decisionModeMetadata: decision.decisionModeMetadata || {},
      capitalRegimeImpact: decision.capitalRegimeImpact || {},
      forecastHook: decision.forecastHook || {},
      mlHook: decision.mlHook || {},
      dataQualityState: decision.dataQualityState || 'unknown',
      reasonCodes: decision.explanation && Array.isArray(decision.explanation.reasonCodes)
        ? decision.explanation.reasonCodes
        : [],
    },
  };
}

module.exports = {
  evaluateFinalEntryDecision,
  normalizeFinalEntryDecisionConfig: normalizeConfig,
  toFinalEntryDecisionEvent,
};
