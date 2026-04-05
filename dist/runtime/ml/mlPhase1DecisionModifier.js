'use strict';

function clamp01(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  if (num <= 0) return 0;
  if (num >= 1) return 1;
  return num;
}

function normalizeMode(rawMode) {
  const mode = String(rawMode || 'advisory_only').toLowerCase();
  if (['advisory_only', 'confirm_only', 'veto_mode', 'confidence_sizing'].includes(mode)) {
    return mode;
  }
  return 'advisory_only';
}

function normalizeConfig(raw = {}) {
  return {
    enabled: raw.enabled !== false,
    mode: normalizeMode(raw.mode),
    thresholds: {
      confirmMinScore: clamp01(((raw.thresholds || {}).confirmMinScore) ?? 0.55),
      confirmMinConfidence: clamp01(((raw.thresholds || {}).confirmMinConfidence) ?? 0.45),
      vetoWeakEntryMaxScore: clamp01(((raw.thresholds || {}).vetoWeakEntryMaxScore) ?? 0.46),
      vetoWeakEntryMaxConfidence: clamp01(((raw.thresholds || {}).vetoWeakEntryMaxConfidence) ?? 0.42),
      sizingMinMultiplier: clamp01(((raw.thresholds || {}).sizingMinMultiplier) ?? 0.75),
      sizingMaxMultiplier: clamp01(((raw.thresholds || {}).sizingMaxMultiplier) ?? 1),
    },
    loggingEnabled: raw.loggingEnabled !== false,
  };
}

function resolveBaseRuleDecision(baseRuleDecision = {}) {
  const decisionMode = String(baseRuleDecision.decisionMode || 'no_entry');
  const baseApproved = decisionMode === 'full_entry' || decisionMode === 'weak_entry';
  return {
    decisionMode,
    baseApproved,
    vetoSummary: baseRuleDecision.vetoSummary && typeof baseRuleDecision.vetoSummary === 'object'
      ? baseRuleDecision.vetoSummary
      : { blocked: false, finalVeto: null },
  };
}

function checkCapitalBlock(input = {}, resolvedBase = {}) {
  const balanceState = input.balanceState || {};
  const capitalRegime = String(input.capitalRegime || balanceState.capitalRegime || 'NORMAL');
  const blockedByCapitalRegime = capitalRegime === 'HALT_NEW_ENTRIES' || capitalRegime === 'PROHIBIT_NEW_ENTRIES';
  const blockedByHardRisk = balanceState.unloadMode === true
    || (input.runtimeGuards || {}).hardRiskBlocked === true
    || resolvedBase.vetoSummary.blocked === true;
  return {
    blockedByCapitalRegime,
    blockedByHardRisk,
    capitalRegime,
  };
}

function checkForecastBlocked(input = {}, resolvedBase = {}) {
  const finalVeto = resolvedBase.vetoSummary.finalVeto || {};
  const vetoType = String(finalVeto.type || '');
  if (vetoType === 'forecast_restriction_veto') return true;
  const restrictionHints = (((input.portfolioForecast || {}).restrictionHints) || []);
  return restrictionHints.includes('restrict_new_entries_hard_candidate')
    || restrictionHints.includes('restrict_new_entries_hard');
}

function createMlPhase1DecisionModifier(rawConfig = {}, dependencies = {}) {
  const config = normalizeConfig(rawConfig);

  function log(message) {
    if (!config.loggingEnabled) return;
    if (dependencies && typeof dependencies.log === 'function') dependencies.log(message);
  }

  function evaluate(input = {}) {
    const cycleId = ((input.context || {}).cycleId) || 'n/a';
    const ticker = ((input.context || {}).ticker) || 'n/a';
    const resolvedBase = resolveBaseRuleDecision(input.baseRuleDecision || {});
    const mlOutput = input.mlInferenceOutput || {};
    const mlScore = clamp01(mlOutput.mlScore);
    const mlConfidence = clamp01(mlOutput.mlConfidence);
    const mlMode = normalizeMode(input.mlMode || config.mode);
    const reasonCodes = ['ml_phase1_decision_modifier'];

    const blocks = checkCapitalBlock(input, resolvedBase);
    const forecastBlocked = checkForecastBlocked(input, resolvedBase);

    let decisionMode = resolvedBase.decisionMode;
    let approved = resolvedBase.baseApproved;
    let mlDecisionEffect = 'no_effect';

    if (!config.enabled) {
      reasonCodes.push('ml_phase1_disabled');
      mlDecisionEffect = 'disabled_no_effect';
    } else {
      switch (mlMode) {
        case 'advisory_only': {
          reasonCodes.push('ml_advisory_only');
          mlDecisionEffect = 'logged_only';
          break;
        }
        case 'confirm_only': {
          reasonCodes.push('ml_confirm_only');
          if (approved) {
            const confirmed = mlScore >= config.thresholds.confirmMinScore
              && mlConfidence >= config.thresholds.confirmMinConfidence;
            if (confirmed) {
              mlDecisionEffect = 'confirmed_rule_approved_entry';
            } else {
              decisionMode = 'no_entry';
              approved = false;
              mlDecisionEffect = 'blocked_not_confirmed';
              reasonCodes.push('ml_confirmation_not_met');
            }
          } else {
            mlDecisionEffect = 'cannot_promote_rule_rejected_entry';
            reasonCodes.push('ml_cannot_override_rule_rejection');
          }
          break;
        }
        case 'veto_mode': {
          reasonCodes.push('ml_veto_mode');
          if (approved) {
            const weakByMl = mlScore <= config.thresholds.vetoWeakEntryMaxScore
              || mlConfidence <= config.thresholds.vetoWeakEntryMaxConfidence;
            if (weakByMl) {
              decisionMode = 'no_entry';
              approved = false;
              mlDecisionEffect = 'vetoed_weak_entry';
              reasonCodes.push('ml_veto_weak_signal');
            } else {
              mlDecisionEffect = 'veto_not_triggered';
            }
          } else {
            mlDecisionEffect = 'cannot_promote_rule_rejected_entry';
            reasonCodes.push('ml_cannot_override_rule_rejection');
          }
          break;
        }
        case 'confidence_sizing': {
          reasonCodes.push('ml_confidence_sizing');
          mlDecisionEffect = 'sizing_hint_only';
          break;
        }
        default: {
          reasonCodes.push('ml_mode_fallback_to_advisory');
          mlDecisionEffect = 'logged_only';
        }
      }
    }

    // Русский комментарий: капитал/forecast/hard-risk всегда выше ML, поэтому дополнительно фиксируем неослабляемые блокировки.
    if (blocks.blockedByCapitalRegime || blocks.blockedByHardRisk || forecastBlocked || !resolvedBase.baseApproved) {
      decisionMode = 'no_entry';
      approved = false;
    }
    if (blocks.blockedByCapitalRegime) reasonCodes.push('ml_blocked_by_capital_regime');
    if (blocks.blockedByHardRisk) reasonCodes.push('ml_blocked_by_hard_risk');
    if (forecastBlocked) reasonCodes.push('ml_blocked_by_forecast_restriction');
    if (!resolvedBase.baseApproved) reasonCodes.push('base_rule_decision_no_entry');

    const sizingConfidenceMultiplier = mlMode === 'confidence_sizing'
      ? Number((config.thresholds.sizingMinMultiplier
        + (mlConfidence * (config.thresholds.sizingMaxMultiplier - config.thresholds.sizingMinMultiplier))).toFixed(6))
      : 1;

    const output = {
      mode: mlMode,
      baseRuleDecision: resolvedBase.decisionMode,
      effectiveDecisionMode: decisionMode,
      effectiveApproved: approved,
      mlScore,
      mlConfidence,
      mlMode,
      mlDecisionEffect,
      mlBlockedByCapitalRegime: blocks.blockedByCapitalRegime,
      mlBlockedByHardRisk: blocks.blockedByHardRisk,
      mlBlockedByForecastRestriction: forecastBlocked,
      reasonCodes: Array.from(new Set(reasonCodes)),
      sizingHook: {
        enabled: mlMode === 'confidence_sizing',
        aggressivenessMultiplier: sizingConfidenceMultiplier,
        owner: 'ml_phase1_hint_only',
      },
      ownership: {
        isFinalVetoOwnerForNewEntries: false,
        baselineDecisionOwner: 'finalEntryDecisionEngine',
        isExecutionOwner: false,
        isSizingOwner: false,
      },
    };

    log(`[mlPhase1DecisionModifier] cycle=${cycleId} ticker=${ticker} mode=${mlMode} baseRuleDecision=${resolvedBase.decisionMode} mlScore=${mlScore.toFixed(4)} mlConfidence=${mlConfidence.toFixed(4)} mlDecisionEffect=${mlDecisionEffect} mlBlockedByCapitalRegime=${blocks.blockedByCapitalRegime} mlBlockedByHardRisk=${blocks.blockedByHardRisk}`);

    return output;
  }

  return {
    evaluate,
    normalizeConfig,
  };
}

module.exports = {
  createMlPhase1DecisionModifier,
  normalizeMlPhase1DecisionModifierConfig: normalizeConfig,
};
