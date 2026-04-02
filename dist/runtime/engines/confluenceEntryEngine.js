'use strict';

const { classifyDecision, createDecisionContext } = require('../shared/decisionContract');
const { evaluateSupportResistance } = require('./supportResistanceEngine');

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function normalizeConfig(raw = {}) {
  const blockWeights = raw.blockWeights || {};
  const thresholds = raw.thresholds || {};
  const confirmation = raw.confirmation || {};
  const marketContext = raw.marketContext || {};
  const primarySignal = raw.primarySignal || {};
  const marketLevel = raw.marketLevel || {};

  return {
    enabled: !!raw.enabled,
    mode: raw.mode === 'confluence' ? 'confluence' : 'legacy_fallback',
    allowWeakEntry: raw.allowWeakEntry !== false,
    enforceRegimeSetupCompatibility: raw.enforceRegimeSetupCompatibility !== false,
    blockWeights: {
      entryPermission: Number(blockWeights.entryPermission ?? 0.28),
      marketContext: Number(blockWeights.marketContext ?? 0.2),
      primarySignal: Number(blockWeights.primarySignal ?? 0.32),
      confirmation: Number(blockWeights.confirmation ?? 0.2),
      marketLevel: Number(blockWeights.marketLevel ?? 0),
    },
    thresholds: {
      fullEntryScore: Number(thresholds.fullEntryScore ?? 0.68),
      weakEntryScore: Number(thresholds.weakEntryScore ?? 0.45),
      minConfidence: Number(thresholds.minConfidence ?? 0.35),
      hardVetoConfidenceByCapital: Number(thresholds.hardVetoConfidenceByCapital ?? 0),
    },
    marketContext: {
      noTradeSoftPenalty: Number(marketContext.noTradeSoftPenalty ?? 0.45),
      degradedDataSoftPenalty: Number(marketContext.degradedDataSoftPenalty ?? 0.12),
    },
    primarySignal: {
      fallbackConfidence: Number(primarySignal.fallbackConfidence ?? 0.42),
      fallbackScore: Number(primarySignal.fallbackScore ?? 0.4),
    },
    confirmation: {
      minSignalsForFull: Number(confirmation.minSignalsForFull ?? 2),
      minSignalsForWeak: Number(confirmation.minSignalsForWeak ?? 1),
      htfBiasBoost: Number(confirmation.htfBiasBoost ?? 0.08),
      htfCounterTrendPenalty: Number(confirmation.htfCounterTrendPenalty ?? 0.18),
    },
    marketLevel: {
      enabled: !!marketLevel.enabled,
      priceSource: marketLevel.priceSource === 'close' ? 'close' : 'wick',
      lookbackBars: Number(marketLevel.lookbackBars ?? 120),
      rangeLookbackBars: Number(marketLevel.rangeLookbackBars ?? 40),
      swingWindow: Number(marketLevel.swingWindow ?? 2),
      minSwingPoints: Number(marketLevel.minSwingPoints ?? 3),
      zoneWidthPercent: Number(marketLevel.zoneWidthPercent ?? 0.2),
      proximityThresholdPercent: Number(marketLevel.proximityThresholdPercent ?? 0.35),
      breakoutTolerancePercent: Number(marketLevel.breakoutTolerancePercent ?? 0.16),
      retestWindowBars: Number(marketLevel.retestWindowBars ?? 6),
      falseBreakoutWindowBars: Number(marketLevel.falseBreakoutWindowBars ?? 3),
      minBreakoutBodyPercent: Number(marketLevel.minBreakoutBodyPercent ?? 0.12),
      scoring: {
        proximityScore: Number((marketLevel.scoring || {}).proximityScore ?? 0.33),
        retestScore: Number((marketLevel.scoring || {}).retestScore ?? 0.24),
        falseBreakoutScore: Number((marketLevel.scoring || {}).falseBreakoutScore ?? 0.24),
        breakoutContextScore: Number((marketLevel.scoring || {}).breakoutContextScore ?? 0.19),
        rangePenalty: Number((marketLevel.scoring || {}).rangePenalty ?? 0.12),
        degradedPenalty: Number((marketLevel.scoring || {}).degradedPenalty ?? 0.08),
      },
      detection: {
        requireBreakoutForRetest: ((marketLevel.detection || {}).requireBreakoutForRetest) !== false,
      },
    },
  };
}

function normalizeDirection(side) {
  if (side === 'long') return 'long';
  if (side === 'short') return 'short';
  return 'none';
}

function createLayerResult(layerName, payload = {}) {
  return {
    layerName,
    direction: payload.direction || 'none',
    score: clamp01(Number(payload.score ?? 0)),
    confidence: clamp01(Number(payload.confidence ?? 0)),
    softPenalty: clamp01(Number(payload.softPenalty ?? 0)),
    vetoCandidates: Array.isArray(payload.vetoCandidates) ? payload.vetoCandidates : [],
    dataQualityState: payload.dataQualityState || 'full',
    reasonCodes: Array.isArray(payload.reasonCodes) ? payload.reasonCodes : [],
    explanation: payload.explanation || {},
  };
}

function evaluateEntryPermissionLayer(input, config) {
  const context = input.context || {};
  const balanceState = context.balanceState || input.balanceState || {};
  const capitalRegime = context.capitalRegime || balanceState.capitalRegime || 'NORMAL';
  const forecastRisk = context.forecastRegimeShiftRisk || balanceState.forecastRegimeShiftRisk || null;
  const forecastSignals = Array.isArray(context.forecastSignals)
    ? context.forecastSignals
    : (Array.isArray((context.portfolioForecast || {}).forecastSignals) ? context.portfolioForecast.forecastSignals : []);

  const reasonCodes = [];
  const vetoCandidates = [];
  let score = 1;
  let confidence = 0.85;
  let softPenalty = 0;

  if (capitalRegime === 'HALT_NEW_ENTRIES' || balanceState === 'HALT_NEW_ENTRIES') {
    score = 0;
    confidence = 1;
    vetoCandidates.push({ type: 'capital_prohibition', reason: 'capital_regime_halt_new_entries' });
    reasonCodes.push('capital_regime_halt_new_entries');
  } else if (capitalRegime === 'CAPITAL_PRESERVATION') {
    score = 0.15;
    softPenalty = 0.45;
    reasonCodes.push('capital_regime_capital_preservation');
  } else if (capitalRegime === 'DEFENSIVE') {
    score = 0.32;
    softPenalty = 0.3;
    reasonCodes.push('capital_regime_defensive');
  } else if (capitalRegime === 'CAUTION') {
    score = 0.6;
    softPenalty = 0.18;
    reasonCodes.push('capital_regime_caution');
  } else {
    score = 0.88;
    softPenalty = 0;
    reasonCodes.push('capital_regime_normal');
  }

  if (forecastRisk === 'HIGH' || forecastRisk === 'ELEVATED') {
    softPenalty = clamp01(softPenalty + 0.15);
    reasonCodes.push('forecast_regime_shift_risk_elevated');
  }
  if (forecastSignals.length > 0) {
    softPenalty = clamp01(softPenalty + 0.12);
    reasonCodes.push('forecast_restriction_hints_present');
  }

  return createLayerResult('entryPermissionLayer', {
    direction: 'long_short',
    score,
    confidence,
    softPenalty,
    vetoCandidates,
    dataQualityState: 'full',
    reasonCodes,
    explanation: {
      capitalRegime,
      forecastRegimeShiftRisk: forecastRisk,
      forecastSignals,
      // Русский комментарий: слой permission не снимает risk-ограничения, а только ужесточает допуск.
      restrictionPolicy: 'strict_non_override',
    },
  });
}

function evaluateMarketContextLayer(input, config) {
  const regime = input.regimeRouterDecision || {};
  const reasonCodes = [];
  const vetoCandidates = [];
  let dataQualityState = 'full';

  const marketRegime = regime.marketRegime || ((input.context || {}).marketRegime || 'unknown');
  const allowedSetups = Array.isArray(regime.allowedSetups) ? regime.allowedSetups : [];
  const selectedSetup = regime.selectedPredictType || ((input.primarySignal || {}).setupType || 'none');

  let score = Number.isFinite(regime.score) ? regime.score : 0.5;
  let confidence = Number.isFinite(regime.confidence) ? regime.confidence : 0.5;
  let softPenalty = Number.isFinite(regime.softPenalty) ? regime.softPenalty : 0;

  if (!regime.layerName) {
    dataQualityState = 'degraded';
    softPenalty = clamp01(softPenalty + config.marketContext.degradedDataSoftPenalty);
    reasonCodes.push('regime_router_context_missing');
  }

  const noTradeRegime = marketRegime === 'no_trade_flat' || allowedSetups.length === 0;
  if (noTradeRegime) {
    softPenalty = clamp01(softPenalty + config.marketContext.noTradeSoftPenalty);
    reasonCodes.push('no_trade_regime');
    vetoCandidates.push({ type: 'no_trade_regime', reason: 'regime_router_restricted_setup' });
  }

  if (config.enforceRegimeSetupCompatibility && selectedSetup !== 'none' && allowedSetups.length > 0 && !allowedSetups.includes(selectedSetup)) {
    softPenalty = clamp01(softPenalty + 0.22);
    reasonCodes.push('setup_type_not_allowed_by_regime');
    vetoCandidates.push({ type: 'hard_veto', reason: 'setup_not_allowed_by_regime_router' });
  }

  if (reasonCodes.length === 0) reasonCodes.push('regime_router_context_ok');

  return createLayerResult('marketContextLayer', {
    direction: 'long_short',
    score,
    confidence,
    softPenalty,
    vetoCandidates,
    dataQualityState,
    reasonCodes,
    explanation: {
      marketRegime,
      allowedSetups,
      selectedSetup,
      // Русский комментарий: confluence не может отменить no-trade из regime-router.
      regimeRouterOwnership: 'strict',
    },
  });
}

function evaluatePrimarySignalLayer(input, config) {
  const primarySignal = input.primarySignal || {};
  const direction = normalizeDirection(primarySignal.direction || primarySignal.side);
  const reasonCodes = [];

  let score = Number.isFinite(primarySignal.score) ? primarySignal.score : config.primarySignal.fallbackScore;
  let confidence = Number.isFinite(primarySignal.confidence) ? primarySignal.confidence : config.primarySignal.fallbackConfidence;
  let softPenalty = Number.isFinite(primarySignal.softPenalty) ? primarySignal.softPenalty : 0;
  const vetoCandidates = Array.isArray(primarySignal.vetoCandidates) ? primarySignal.vetoCandidates : [];
  let dataQualityState = primarySignal.dataQualityState || 'cached';

  if (direction === 'none') {
    score = 0;
    confidence = Math.max(confidence, 0.55);
    softPenalty = clamp01(softPenalty + 0.2);
    reasonCodes.push('primary_signal_direction_none');
  } else {
    reasonCodes.push('primary_signal_direction_detected');
  }

  if (!primarySignal.layerName) {
    dataQualityState = 'degraded';
    reasonCodes.push('primary_signal_from_legacy_fallback');
  }

  return createLayerResult('primarySignalLayer', {
    direction,
    score,
    confidence,
    softPenalty,
    vetoCandidates,
    dataQualityState,
    reasonCodes,
    explanation: {
      setupType: primarySignal.setupType || 'legacy_predict_type',
      signalSource: primarySignal.layerName || 'legacy_predictor',
    },
  });
}

function evaluateConfirmationLayer(input, config) {
  const htfBias = input.htfBiasDecision || {};
  const confirmationSignals = Array.isArray(input.confirmationSignals) ? input.confirmationSignals : [];
  const primaryDirection = normalizeDirection(((input.primarySignal || {}).direction || (input.primarySignal || {}).side));

  let score = 0.35;
  let confidence = 0.45;
  let softPenalty = 0;
  const reasonCodes = [];
  const vetoCandidates = [];
  let confirmationsApproved = 0;

  confirmationSignals.forEach((signal) => {
    if (!signal) return;
    if (signal.approved === true) {
      confirmationsApproved += 1;
      score += 0.18;
      confidence += 0.1;
      reasonCodes.push(`confirmation:${signal.name || 'unnamed'}:approved`);
    } else if (signal.approved === false) {
      softPenalty = clamp01(softPenalty + 0.08);
      reasonCodes.push(`confirmation:${signal.name || 'unnamed'}:rejected`);
    }
  });

  if (htfBias.layerName) {
    const htfDirection = normalizeDirection(htfBias.htfBias || htfBias.direction);
    if (htfDirection !== 'none' && primaryDirection !== 'none' && htfDirection === primaryDirection) {
      score += config.confirmation.htfBiasBoost;
      confidence += 0.08;
      reasonCodes.push('htf_bias_alignment');
    } else if (htfDirection !== 'none' && primaryDirection !== 'none' && htfDirection !== primaryDirection) {
      softPenalty = clamp01(softPenalty + config.confirmation.htfCounterTrendPenalty);
      reasonCodes.push('htf_bias_counter_trend');
    }
  } else {
    reasonCodes.push('htf_bias_unavailable');
  }

  score = clamp01(score);
  confidence = clamp01(confidence);
  if (confirmationsApproved < config.confirmation.minSignalsForWeak) {
    softPenalty = clamp01(softPenalty + 0.15);
    reasonCodes.push('insufficient_confirmations_for_weak');
  }
  if (confirmationsApproved < config.confirmation.minSignalsForFull) {
    reasonCodes.push('insufficient_confirmations_for_full');
  }

  return createLayerResult('confirmationLayer', {
    direction: primaryDirection,
    score,
    confidence,
    softPenalty,
    vetoCandidates,
    dataQualityState: htfBias.layerName ? 'full' : 'degraded',
    reasonCodes,
    explanation: {
      confirmationsApproved,
      confirmationSignalsCount: confirmationSignals.length,
      htfMode: htfBias.mode || 'unavailable',
      // Русский комментарий: подтверждения влияют только на качество входа, не на sizing/execution.
      scope: 'entry_quality_only',
    },
  });
}

function evaluateMarketLevelLayer(input, config) {
  const result = evaluateSupportResistance(input, config.marketLevel || {});
  if (!result || result.layerName !== 'supportResistanceEngine') {
    return createLayerResult('marketLevelLayer', {
      direction: 'none',
      score: 0,
      confidence: 0,
      softPenalty: config.marketContext.degradedDataSoftPenalty,
      dataQualityState: 'degraded',
      reasonCodes: ['market_level_result_invalid'],
      explanation: {
        // Русский комментарий: при ошибке слоя зон confluence не останавливается и продолжает legacy-confluence flow.
        fallbackPolicy: 'continue_without_market_levels',
      },
    });
  }

  return createLayerResult('marketLevelLayer', {
    direction: result.direction || 'none',
    score: result.score,
    confidence: result.confidence,
    softPenalty: result.softPenalty,
    vetoCandidates: result.vetoCandidates,
    dataQualityState: result.dataQualityState || 'degraded',
    reasonCodes: result.reasonCodes,
    explanation: result.explanation || {},
  });
}

function combineLayerScores(layers, config) {
  const weights = config.blockWeights;
  const weighted = [
    ['entryPermissionLayer', weights.entryPermission],
    ['marketContextLayer', weights.marketContext],
    ['primarySignalLayer', weights.primarySignal],
    ['confirmationLayer', weights.confirmation],
    ['marketLevelLayer', weights.marketLevel],
  ];

  let weightedScore = 0;
  let weightedConfidence = 0;
  let totalPenalty = 0;

  weighted.forEach(([name, weight]) => {
    const layer = layers[name] || createLayerResult(name, {});
    weightedScore += clamp01(layer.score) * weight;
    weightedConfidence += clamp01(layer.confidence) * weight;
    totalPenalty += clamp01(layer.softPenalty) * weight;
  });

  return {
    score: clamp01(weightedScore),
    confidence: clamp01(weightedConfidence),
    softPenalty: clamp01(totalPenalty),
  };
}

function evaluateFinalEntryDecisionLayer(input, config, layers) {
  const combined = combineLayerScores(layers, config);
  const allVetoes = Object.values(layers).flatMap((layer) => (Array.isArray(layer.vetoCandidates) ? layer.vetoCandidates : []));
  const hardVeto = allVetoes.find((v) => v && (v.type === 'hard_veto' || v.type === 'capital_prohibition' || v.type === 'no_trade_regime')) || null;

  const reasonCodes = [];
  if (hardVeto) reasonCodes.push(`hard_veto:${hardVeto.reason || hardVeto.type}`);
  if (combined.confidence < config.thresholds.minConfidence) reasonCodes.push('confidence_below_threshold');

  const finalScore = clamp01(combined.score - combined.softPenalty);
  let finalDecision = 'NO_ENTRY';

  if (!hardVeto && combined.confidence >= config.thresholds.minConfidence) {
    if (finalScore >= config.thresholds.fullEntryScore) {
      finalDecision = 'FULL_ENTRY';
    } else if (config.allowWeakEntry && finalScore >= config.thresholds.weakEntryScore) {
      finalDecision = 'WEAK_ENTRY';
    }
  }

  const context = input.context || {};
  const decisionContext = createDecisionContext({
    cycleId: context.cycleId,
    ticker: context.ticker,
    regime: (layers.marketContextLayer && layers.marketContextLayer.explanation.marketRegime) || context.marketRegime || 'unknown',
    mode: 'confluence',
    capitalRegime: context.capitalRegime || 'NORMAL',
    balanceState: context.balanceState || null,
    forecastRegimeShiftRisk: context.forecastRegimeShiftRisk || null,
    score: finalScore,
    confidence: combined.confidence,
    veto: hardVeto,
    penalties: [
      { source: 'combinedSoftPenalty', value: combined.softPenalty },
    ],
    metadata: {
      layerScores: layers,
      reasonCodes,
      finalDecision,
      fallbackAction: finalDecision === 'NO_ENTRY' ? 'legacy_entry_flow' : 'none',
      setupType: (layers.marketContextLayer && layers.marketContextLayer.explanation.selectedSetup) || 'unknown',
      marketRegime: (layers.marketContextLayer && layers.marketContextLayer.explanation.marketRegime) || context.marketRegime || 'unknown',
      sizingDecision: 'not_evaluated',
      marketLevels: (layers.marketLevelLayer || {}).explanation || {},
    },
  });

  return createLayerResult('finalEntryDecisionLayer', {
    direction: (layers.primarySignalLayer || {}).direction || 'none',
    score: finalScore,
    confidence: combined.confidence,
    softPenalty: combined.softPenalty,
    vetoCandidates: hardVeto ? [hardVeto] : [],
    dataQualityState: Object.values(layers).some((layer) => layer.dataQualityState === 'degraded') ? 'degraded' : 'full',
    reasonCodes,
    explanation: {
      aggregateScoreRaw: combined.score,
      aggregatePenalty: combined.softPenalty,
      finalScore,
      finalDecision,
      decisionClassifiedByContract: classifyDecision(decisionContext),
      // Русский комментарий: final layer — единственная точка интерпретации veto-контракта.
      vetoOwner: 'finalEntryDecisionLayer',
    },
  });
}

function evaluateConfluenceEntry(input = {}, rawConfig = {}) {
  const config = normalizeConfig(rawConfig);
  const context = input.context || {};

  if (!config.enabled || config.mode !== 'confluence') {
    return {
      enabled: false,
      mode: 'legacy_fallback',
      layers: {
        entryPermissionLayer: createLayerResult('entryPermissionLayer', { dataQualityState: 'fallback', reasonCodes: ['confluence_disabled'] }),
        marketContextLayer: createLayerResult('marketContextLayer', { dataQualityState: 'fallback', reasonCodes: ['confluence_disabled'] }),
        primarySignalLayer: createLayerResult('primarySignalLayer', { dataQualityState: 'fallback', reasonCodes: ['confluence_disabled'] }),
        confirmationLayer: createLayerResult('confirmationLayer', { dataQualityState: 'fallback', reasonCodes: ['confluence_disabled'] }),
        marketLevelLayer: createLayerResult('marketLevelLayer', { dataQualityState: 'fallback', reasonCodes: ['confluence_disabled'] }),
        finalEntryDecisionLayer: createLayerResult('finalEntryDecisionLayer', { dataQualityState: 'fallback', reasonCodes: ['confluence_disabled'] }),
      },
      decision: {
        finalDecision: 'LEGACY_FALLBACK',
        entryAllowed: null,
        entryGrade: 'fallback',
        score: 0,
        confidence: 0,
        veto: null,
        reasonCodes: ['confluence_disabled'],
      },
      decisionContext: createDecisionContext({
        cycleId: context.cycleId,
        ticker: context.ticker,
        regime: context.marketRegime || 'unknown',
        mode: 'fallback',
        capitalRegime: context.capitalRegime || 'NORMAL',
      }),
    };
  }

  const layers = {};
  layers.entryPermissionLayer = evaluateEntryPermissionLayer(input, config);
  layers.marketContextLayer = evaluateMarketContextLayer(input, config);
  layers.primarySignalLayer = evaluatePrimarySignalLayer(input, config);
  layers.confirmationLayer = evaluateConfirmationLayer(input, config);
  layers.marketLevelLayer = evaluateMarketLevelLayer(input, config);
  layers.finalEntryDecisionLayer = evaluateFinalEntryDecisionLayer(input, config, layers);

  const final = layers.finalEntryDecisionLayer;
  const finalDecision = final.explanation.finalDecision || 'NO_ENTRY';
  const entryAllowed = finalDecision === 'FULL_ENTRY' || finalDecision === 'WEAK_ENTRY';

  const decisionContext = createDecisionContext({
    cycleId: context.cycleId,
    ticker: context.ticker,
    regime: (layers.marketContextLayer.explanation || {}).marketRegime || context.marketRegime || 'unknown',
    mode: 'confluence',
    capitalRegime: context.capitalRegime || 'NORMAL',
    balanceState: context.balanceState || null,
    forecastRegimeShiftRisk: context.forecastRegimeShiftRisk || null,
    score: final.score,
    confidence: final.confidence,
    veto: (final.vetoCandidates || [])[0] || null,
    penalties: [
      { source: 'entryPermissionLayer', value: layers.entryPermissionLayer.softPenalty },
      { source: 'marketContextLayer', value: layers.marketContextLayer.softPenalty },
      { source: 'primarySignalLayer', value: layers.primarySignalLayer.softPenalty },
      { source: 'confirmationLayer', value: layers.confirmationLayer.softPenalty },
      { source: 'marketLevelLayer', value: layers.marketLevelLayer.softPenalty },
    ],
    metadata: {
      layerScores: layers,
      reasonCodes: final.reasonCodes,
      finalDecision,
      setupType: (layers.marketContextLayer.explanation || {}).selectedSetup || 'unknown',
      marketRegime: (layers.marketContextLayer.explanation || {}).marketRegime || context.marketRegime || 'unknown',
      vetoOwner: 'finalEntryDecisionLayer',
      dataQualityState: final.dataQualityState,
      runtimeMode: Object.values(layers).some((x) => x.dataQualityState === 'degraded') ? 'degraded_mode' : 'full_mode',
      executionAction: entryAllowed ? 'forward_to_execution' : 'skip_entry',
      fallbackAction: entryAllowed ? 'none' : 'legacy_entry_flow',
      sizingDecision: 'not_evaluated',
      marketLevels: layers.marketLevelLayer ? layers.marketLevelLayer.explanation : {},
    },
  });

  return {
    enabled: true,
    mode: 'confluence',
    layers,
    decision: {
      finalDecision,
      entryAllowed,
      entryGrade: finalDecision === 'FULL_ENTRY' ? 'full' : (finalDecision === 'WEAK_ENTRY' ? 'weak' : 'none'),
      score: final.score,
      confidence: final.confidence,
      veto: (final.vetoCandidates || [])[0] || null,
      reasonCodes: final.reasonCodes || [],
    },
    decisionContext,
  };
}

function toConfluenceEntryEvent(input = {}) {
  const context = input.context || {};
  const result = input.result || {};
  const decision = result.decision || {};
  const layerScores = result.layers || {};

  return {
    eventType: 'confluence_entry_decision',
    cycleId: context.cycleId || '',
    ticker: context.ticker || '',
    exchange: context.exchange || '',
    mode: context.mode || 'live',
    module: 'confluenceEntryEngine',
    layer: 'entry.confluence',
    marketRegime: context.marketRegime || 'unknown',
    capitalRegime: context.capitalRegime || 'NORMAL',
    forecastRegimeShiftRisk: context.forecastRegimeShiftRisk || null,
    setupType: context.setupType || (((layerScores.marketContextLayer || {}).explanation || {}).selectedSetup) || 'unknown',
    score: Number.isFinite(decision.score) ? decision.score : 0,
    confidence: Number.isFinite(decision.confidence) ? decision.confidence : 0,
    vetoReason: decision.veto ? decision.veto.reason : null,
    sizingDecision: 'not_evaluated',
    executionAction: decision.entryAllowed ? 'forward_to_execution' : 'skip_entry',
    fallbackAction: decision.entryAllowed ? 'none' : 'legacy_entry_flow',
    finalDecision: decision.finalDecision || 'NO_ENTRY',
    payload: {
      layerScores,
      decision,
      marketLevels: (layerScores.marketLevelLayer || {}).explanation || {},
      // Русский комментарий: совместимый downstream-контекст для audit trail/reporting без ad-hoc форматов.
      telemetry: {
        downstreamContext: {
          confluenceEntry: {
            finalDecision: decision.finalDecision || 'NO_ENTRY',
            entryAllowed: decision.entryAllowed === true,
            score: Number.isFinite(decision.score) ? decision.score : 0,
            confidence: Number.isFinite(decision.confidence) ? decision.confidence : 0,
            veto: decision.veto || null,
            reasonCodes: Array.isArray(decision.reasonCodes) ? decision.reasonCodes : [],
          },
        },
      },
    },
  };
}

module.exports = {
  normalizeConfluenceEntryConfig: normalizeConfig,
  evaluateConfluenceEntry,
  toConfluenceEntryEvent,
};
