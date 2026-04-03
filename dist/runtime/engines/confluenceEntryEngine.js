'use strict';

const { classifyDecision, createDecisionContext } = require('../shared/decisionContract');
const { evaluateSupportResistance } = require('./supportResistanceEngine');
const { evaluateVwapProfileLayer } = require('./vwapProfileEngine');
const { evaluateBounceDetection } = require('./bounceDetectionEngine');
const { evaluateBreakdown } = require('./breakdownEngine');
const { evaluateDerivativesContext } = require('./derivativesContextEngine');
const { evaluateConfirmationEngine } = require('./confirmationEngine');

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
  const confirmationEngine = raw.confirmationEngine || {};
  const marketContext = raw.marketContext || {};
  const primarySignal = raw.primarySignal || {};
  const marketLevel = raw.marketLevel || {};
  const volumeContext = raw.volumeContext || {};
  const bounceDetection = raw.bounceDetection || {};
  const breakdownDetection = raw.breakdownDetection || {};
  const derivativesContext = raw.derivativesContext || {};

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
      volumeContext: Number(blockWeights.volumeContext ?? 0),
      bounceDetection: Number(blockWeights.bounceDetection ?? 0),
      breakdownDetection: Number(blockWeights.breakdownDetection ?? 0),
      derivativesContext: Number(blockWeights.derivativesContext ?? 0),
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
    confirmationEngine: {
      enabled: !!confirmationEngine.enabled,
      weights: {
        technical: Number(((confirmationEngine.weights || {}).technical) ?? 0.62),
        microstructure: Number(((confirmationEngine.weights || {}).microstructure) ?? 0.38),
      },
      costSplit: {
        minCheapScoreForMicro: Number(((confirmationEngine.costSplit || {}).minCheapScoreForMicro) ?? 0.42),
        skipMicroWhenBudgetExceeded: ((confirmationEngine.costSplit || {}).skipMicroWhenBudgetExceeded) !== false,
      },
      technical: {
        minCandles: Number(((confirmationEngine.technical || {}).minCandles) ?? 30),
        volumeAveragePeriod: Number(((confirmationEngine.technical || {}).volumeAveragePeriod) ?? 20),
        volumeSpikeThreshold: Number(((confirmationEngine.technical || {}).volumeSpikeThreshold) ?? 1.6),
        volumeConfirmationThreshold: Number(((confirmationEngine.technical || {}).volumeConfirmationThreshold) ?? 1.1),
        weights: typeof ((confirmationEngine.technical || {}).weights) === 'object' && ((confirmationEngine.technical || {}).weights)
          ? confirmationEngine.technical.weights
          : {},
        rsi: typeof ((confirmationEngine.technical || {}).rsi) === 'object' && ((confirmationEngine.technical || {}).rsi
          ? confirmationEngine.technical.rsi
          : {}),
        stochasticRsi: typeof ((confirmationEngine.technical || {}).stochasticRsi) === 'object' && ((confirmationEngine.technical || {}).stochasticRsi
          ? confirmationEngine.technical.stochasticRsi
          : {}),
        mfi: typeof ((confirmationEngine.technical || {}).mfi) === 'object' && ((confirmationEngine.technical || {}).mfi
          ? confirmationEngine.technical.mfi
          : {}),
        cci: typeof ((confirmationEngine.technical || {}).cci) === 'object' && ((confirmationEngine.technical || {}).cci
          ? confirmationEngine.technical.cci
          : {}),
        divergence: typeof ((confirmationEngine.technical || {}).divergence) === 'object' && ((confirmationEngine.technical || {}).divergence
          ? confirmationEngine.technical.divergence
          : {}),
      },
      microstructure: {
        depthLevels: Number(((confirmationEngine.microstructure || {}).depthLevels) ?? 8),
        softPenaltyOnMissingData: Number(((confirmationEngine.microstructure || {}).softPenaltyOnMissingData) ?? 0.06),
        weights: typeof ((confirmationEngine.microstructure || {}).weights) === 'object' && ((confirmationEngine.microstructure || {}).weights)
          ? confirmationEngine.microstructure.weights
          : {},
        imbalance: typeof ((confirmationEngine.microstructure || {}).imbalance) === 'object' && ((confirmationEngine.microstructure || {}).imbalance
          ? confirmationEngine.microstructure.imbalance
          : {}),
        spread: typeof ((confirmationEngine.microstructure || {}).spread) === 'object' && ((confirmationEngine.microstructure || {}).spread
          ? confirmationEngine.microstructure.spread
          : {}),
        bookPressure: typeof ((confirmationEngine.microstructure || {}).bookPressure) === 'object' && ((confirmationEngine.microstructure || {}).bookPressure
          ? confirmationEngine.microstructure.bookPressure
          : {}),
        liquidityWall: typeof ((confirmationEngine.microstructure || {}).liquidityWall) === 'object' && ((confirmationEngine.microstructure || {}).liquidityWall
          ? confirmationEngine.microstructure.liquidityWall
          : {}),
      },
      capitalRegimePenalties: typeof confirmationEngine.capitalRegimePenalties === 'object' && confirmationEngine.capitalRegimePenalties
        ? confirmationEngine.capitalRegimePenalties
        : {},
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
    volumeContext: {
      enabled: !!volumeContext.enabled,
      // Русский комментарий: слой VWAP/profile включается отдельно и остаётся усилителем, не заменяет zones.
      preferSharedFeatures: volumeContext.preferSharedFeatures !== false,
      degradeOnMissingVolume: volumeContext.degradeOnMissingVolume !== false,
      vwapWindowBars: Number(volumeContext.vwapWindowBars ?? 80),
      anchoredVwap: {
        enabled: ((volumeContext.anchoredVwap || {}).enabled) !== false,
        lookbackBars: Number(((volumeContext.anchoredVwap || {}).lookbackBars) ?? 120),
        swingWindow: Number(((volumeContext.anchoredVwap || {}).swingWindow) ?? 3),
        fallbackToSessionAnchor: ((volumeContext.anchoredVwap || {}).fallbackToSessionAnchor) !== false,
      },
      valueArea: {
        enabled: ((volumeContext.valueArea || {}).enabled) !== false,
        valueAreaPercent: Number(((volumeContext.valueArea || {}).valueAreaPercent) ?? 0.7),
      },
      volumeProfile: {
        enabled: ((volumeContext.volumeProfile || {}).enabled) !== false,
        bins: Number(((volumeContext.volumeProfile || {}).bins) ?? 24),
        hvnPercentile: Number(((volumeContext.volumeProfile || {}).hvnPercentile) ?? 0.82),
        lvnPercentile: Number(((volumeContext.volumeProfile || {}).lvnPercentile) ?? 0.18),
      },
      lazyEvaluation: {
        enabled: ((volumeContext.lazyEvaluation || {}).enabled) !== false,
        requireShortlistCandidate: ((volumeContext.lazyEvaluation || {}).requireShortlistCandidate) !== false,
        requirePrimaryDirection: ((volumeContext.lazyEvaluation || {}).requirePrimaryDirection) !== false,
        minPrimaryScore: Number(((volumeContext.lazyEvaluation || {}).minPrimaryScore) ?? 0.4),
        skipWhenBudgetExceeded: ((volumeContext.lazyEvaluation || {}).skipWhenBudgetExceeded) !== false,
      },
      refreshPolicy: {
        minBarsBetweenFullRecalc: Number(((volumeContext.refreshPolicy || {}).minBarsBetweenFullRecalc) ?? 3),
        allowCachedReuse: ((volumeContext.refreshPolicy || {}).allowCachedReuse) !== false,
        forceFullRecalcEveryCycles: Number(((volumeContext.refreshPolicy || {}).forceFullRecalcEveryCycles) ?? 0),
      },
      scoring: {
        vwapAlignmentWeight: Number(((volumeContext.scoring || {}).vwapAlignmentWeight) ?? 0.32),
        anchoredVwapAlignmentWeight: Number(((volumeContext.scoring || {}).anchoredVwapAlignmentWeight) ?? 0.22),
        valueAreaWeight: Number(((volumeContext.scoring || {}).valueAreaWeight) ?? 0.24),
        hvnLvnReactionWeight: Number(((volumeContext.scoring || {}).hvnLvnReactionWeight) ?? 0.22),
        distancePenaltyFactor: Number(((volumeContext.scoring || {}).distancePenaltyFactor) ?? 1.15),
        degradedPenalty: Number(((volumeContext.scoring || {}).degradedPenalty) ?? 0.12),
      },
    },
    bounceDetection: {
      enabled: !!bounceDetection.enabled,
      allowedRegimes: Array.isArray(bounceDetection.allowedRegimes) ? bounceDetection.allowedRegimes : ['trend', 'range', 'pullback'],
      noTradeRegimes: Array.isArray(bounceDetection.noTradeRegimes) ? bounceDetection.noTradeRegimes : ['no_trade_flat'],
      lookbackBars: Number(bounceDetection.lookbackBars ?? 80),
      swingWindow: Number(bounceDetection.swingWindow ?? 2),
      zoneProximityPercent: Number(bounceDetection.zoneProximityPercent ?? 0.25),
      falseBreakoutTolerancePercent: Number(bounceDetection.falseBreakoutTolerancePercent ?? 0.18),
      momentumLookbackBars: Number(bounceDetection.momentumLookbackBars ?? 6),
      minCandlesForAnalysis: Number(bounceDetection.minCandlesForAnalysis ?? 24),
      thresholds: {
        scoreForSetupTag: Number(((bounceDetection.thresholds || {}).scoreForSetupTag) ?? 0.56),
        strongScore: Number(((bounceDetection.thresholds || {}).strongScore) ?? 0.72),
        minConfidence: Number(((bounceDetection.thresholds || {}).minConfidence) ?? 0.3),
        minimumDataCoverage: Number(((bounceDetection.thresholds || {}).minimumDataCoverage) ?? 0.45),
        microstructureActivationScore: Number(((bounceDetection.thresholds || {}).microstructureActivationScore) ?? 0.58),
      },
      setupTypes: typeof bounceDetection.setupTypes === 'object' && bounceDetection.setupTypes ? bounceDetection.setupTypes : {},
      weights: typeof bounceDetection.weights === 'object' && bounceDetection.weights ? bounceDetection.weights : {},
      microstructure: typeof bounceDetection.microstructure === 'object' && bounceDetection.microstructure ? bounceDetection.microstructure : {},
      capitalRegimePenalties: typeof bounceDetection.capitalRegimePenalties === 'object' && bounceDetection.capitalRegimePenalties
        ? bounceDetection.capitalRegimePenalties
        : {},
    },
    breakdownDetection: {
      enabled: !!breakdownDetection.enabled,
      allowedRegimes: Array.isArray(breakdownDetection.allowedRegimes) ? breakdownDetection.allowedRegimes : ['trend', 'pullback', 'volatile_breakout'],
      noTradeRegimes: Array.isArray(breakdownDetection.noTradeRegimes) ? breakdownDetection.noTradeRegimes : ['no_trade_flat'],
      lookbackBars: Number(breakdownDetection.lookbackBars ?? 96),
      minCandlesForAnalysis: Number(breakdownDetection.minCandlesForAnalysis ?? 30),
      supportLookbackBars: Number(breakdownDetection.supportLookbackBars ?? 28),
      supportProximityPercent: Number(breakdownDetection.supportProximityPercent ?? 0.35),
      pressureLookbackBars: Number(breakdownDetection.pressureLookbackBars ?? 8),
      momentumLookbackBars: Number(breakdownDetection.momentumLookbackBars ?? 6),
      repeatedTestsWindowBars: Number(breakdownDetection.repeatedTestsWindowBars ?? 20),
      repeatedTestsTolerancePercent: Number(breakdownDetection.repeatedTestsTolerancePercent ?? 0.2),
      breakdownConfirmationBars: Number(breakdownDetection.breakdownConfirmationBars ?? 2),
      reclaimTolerancePercent: Number(breakdownDetection.reclaimTolerancePercent ?? 0.12),
      thresholds: typeof breakdownDetection.thresholds === 'object' && breakdownDetection.thresholds ? breakdownDetection.thresholds : {},
      setupTypes: typeof breakdownDetection.setupTypes === 'object' && breakdownDetection.setupTypes ? breakdownDetection.setupTypes : {},
      weights: typeof breakdownDetection.weights === 'object' && breakdownDetection.weights ? breakdownDetection.weights : {},
      microstructure: typeof breakdownDetection.microstructure === 'object' && breakdownDetection.microstructure ? breakdownDetection.microstructure : {},
      capitalRegimePenalties: typeof breakdownDetection.capitalRegimePenalties === 'object' && breakdownDetection.capitalRegimePenalties
        ? breakdownDetection.capitalRegimePenalties
        : {},
    },
    derivativesContext: {
      enabled: !!derivativesContext.enabled,
      preferSharedSnapshot: derivativesContext.preferSharedSnapshot !== false,
      skipWhenBudgetExceeded: derivativesContext.skipWhenBudgetExceeded !== false,
      allowNoTradeOnExtremeCrowding: !!derivativesContext.allowNoTradeOnExtremeCrowding,
      thresholds: typeof derivativesContext.thresholds === 'object' && derivativesContext.thresholds
        ? derivativesContext.thresholds
        : {},
      weights: typeof derivativesContext.weights === 'object' && derivativesContext.weights
        ? derivativesContext.weights
        : {},
      crowding: typeof derivativesContext.crowding === 'object' && derivativesContext.crowding
        ? derivativesContext.crowding
        : {},
      liquidation: typeof derivativesContext.liquidation === 'object' && derivativesContext.liquidation
        ? derivativesContext.liquidation
        : {},
      refreshPolicy: typeof derivativesContext.refreshPolicy === 'object' && derivativesContext.refreshPolicy
        ? derivativesContext.refreshPolicy
        : {},
      capitalRegimePenalties: typeof derivativesContext.capitalRegimePenalties === 'object' && derivativesContext.capitalRegimePenalties
        ? derivativesContext.capitalRegimePenalties
        : {},
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

  const confirmationEngineResult = evaluateConfirmationEngine({
    context: input.context || {},
    sharedSnapshot: input.sharedSnapshot || {},
    featureStoreContext: input.featureStoreContext || {},
    direction: primaryDirection,
    budgetState: input.budgetState || 'normal',
  }, config.confirmationEngine || {});

  let score = confirmationEngineResult.enabled ? confirmationEngineResult.score : 0.35;
  let confidence = confirmationEngineResult.enabled ? confirmationEngineResult.confidence : 0.45;
  let softPenalty = confirmationEngineResult.enabled ? confirmationEngineResult.softPenalty : 0;
  const reasonCodes = Array.isArray(confirmationEngineResult.reasonCodes) ? [...confirmationEngineResult.reasonCodes] : [];
  const vetoCandidates = [];

  let confirmationsApproved = 0;
  if (!confirmationEngineResult.enabled) {
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
  } else {
    const technicalSignals = (((confirmationEngineResult || {}).technical || {}).explanation || {}).signals || [];
    const microSignals = (((confirmationEngineResult || {}).microstructure || {}).explanation || {}).signals || [];
    confirmationsApproved = technicalSignals.concat(microSignals).filter((x) => x && x.approved === true).length;
    reasonCodes.push('confirmation_engine_applied');
  }

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
    dataQualityState: confirmationEngineResult.enabled
      ? (confirmationEngineResult.dataQualityState || 'degraded')
      : (htfBias.layerName ? 'full' : 'degraded'),
    reasonCodes,
    explanation: {
      confirmationsApproved,
      confirmationSignalsCount: confirmationSignals.length,
      confirmationEngineEnabled: confirmationEngineResult.enabled === true,
      htfMode: htfBias.mode || 'unavailable',
      technical: confirmationEngineResult.technical ? (confirmationEngineResult.technical.explanation || {}) : {},
      microstructure: confirmationEngineResult.microstructure ? (confirmationEngineResult.microstructure.explanation || {}) : {},
      confirmationEngineMode: (confirmationEngineResult.explanation || {}).mode || 'legacy_fallback',
      // Русский комментарий: confirmations влияют только на quality-score и штрафы, но не открывают сделку без primary signal + final layer.
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
    ['volumeContextLayer', weights.volumeContext],
    ['bounceDetectionLayer', weights.bounceDetection],
    ['breakdownDetectionLayer', weights.breakdownDetection],
    ['derivativesContextLayer', weights.derivativesContext],
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
      derivativesContext: (layers.derivativesContextLayer || {}).explanation || {},
      confirmationContext: (layers.confirmationLayer || {}).explanation || {},
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
      volumeContextLayer: createLayerResult('volumeContextLayer', { dataQualityState: 'fallback', reasonCodes: ['confluence_disabled'] }),
      bounceDetectionLayer: createLayerResult('bounceDetectionLayer', { dataQualityState: 'fallback', reasonCodes: ['confluence_disabled'] }),
      breakdownDetectionLayer: createLayerResult('breakdownDetectionLayer', { dataQualityState: 'fallback', reasonCodes: ['confluence_disabled'] }),
      derivativesContextLayer: createLayerResult('derivativesContextLayer', { dataQualityState: 'fallback', reasonCodes: ['confluence_disabled'] }),
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
  layers.volumeContextLayer = evaluateVwapProfileLayer({
    context,
    sharedSnapshot: input.sharedSnapshot || {},
    featureStoreContext: input.featureStoreContext || {},
    primarySignal: input.primarySignal || {},
    shortlistCandidate: input.shortlistCandidate !== false,
    budgetState: input.budgetState || 'normal',
  }, config.volumeContext || {});
  // Русский комментарий: bounce-слой запускается после market-context/primary-signal и перед final decision; не может открыть позицию сам.
  const bounceResult = evaluateBounceDetection({
    context,
    sharedSnapshot: input.sharedSnapshot || {},
    primarySignal: input.primarySignal || {},
    budgetState: input.budgetState || 'normal',
  }, config.bounceDetection || {});
  layers.bounceDetectionLayer = createLayerResult('bounceDetectionLayer', {
    direction: bounceResult.direction || 'none',
    score: bounceResult.score,
    confidence: bounceResult.confidence,
    softPenalty: bounceResult.softPenalty,
    vetoCandidates: bounceResult.vetoCandidates,
    dataQualityState: bounceResult.dataQualityState || 'degraded',
    reasonCodes: bounceResult.reasonCodes,
    explanation: bounceResult.explanation || {},
  });
  // Русский комментарий: breakdown-слой читается как bearish continuation сигнал и передаётся только в final decision.
  const breakdownResult = evaluateBreakdown({
    context,
    sharedSnapshot: input.sharedSnapshot || {},
    primarySignal: input.primarySignal || {},
    budgetState: input.budgetState || 'normal',
  }, config.breakdownDetection || {});
  layers.breakdownDetectionLayer = createLayerResult('breakdownDetectionLayer', {
    direction: breakdownResult.direction || 'none',
    score: breakdownResult.score,
    confidence: breakdownResult.confidence,
    softPenalty: breakdownResult.softPenalty,
    vetoCandidates: breakdownResult.vetoCandidates,
    dataQualityState: breakdownResult.dataQualityState || 'degraded',
    reasonCodes: breakdownResult.reasonCodes,
    explanation: breakdownResult.explanation || {},
  });
  // Русский комментарий: derivatives-context слой работает после базовых gating-слоёв и перед final decision.
  const derivativesResult = evaluateDerivativesContext({
    context,
    sharedSnapshot: input.sharedSnapshot || {},
    featureStoreContext: input.featureStoreContext || {},
    primarySignal: input.primarySignal || {},
    budgetState: input.budgetState || 'normal',
  }, config.derivativesContext || {});
  if (derivativesResult && derivativesResult.cacheWrite && input.featureStoreContext && typeof input.featureStoreContext === 'object') {
    input.featureStoreContext[(config.derivativesContext || {}).refreshPolicy && (config.derivativesContext || {}).refreshPolicy.cacheKey
      ? config.derivativesContext.refreshPolicy.cacheKey
      : 'derivatives_context_engine'] = derivativesResult.cacheWrite;
  }
  layers.derivativesContextLayer = createLayerResult('derivativesContextLayer', {
    direction: derivativesResult.direction || 'none',
    score: derivativesResult.score,
    confidence: derivativesResult.confidence,
    softPenalty: derivativesResult.softPenalty,
    vetoCandidates: derivativesResult.vetoCandidates,
    dataQualityState: derivativesResult.dataQualityState || 'degraded',
    reasonCodes: derivativesResult.reasonCodes,
    explanation: derivativesResult.explanation || {},
  });
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
      { source: 'volumeContextLayer', value: layers.volumeContextLayer.softPenalty },
      { source: 'bounceDetectionLayer', value: layers.bounceDetectionLayer.softPenalty },
      { source: 'breakdownDetectionLayer', value: layers.breakdownDetectionLayer.softPenalty },
      { source: 'derivativesContextLayer', value: layers.derivativesContextLayer.softPenalty },
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
      volumeContext: layers.volumeContextLayer ? layers.volumeContextLayer.explanation : {},
      bounceDetection: layers.bounceDetectionLayer ? layers.bounceDetectionLayer.explanation : {},
      breakdownDetection: layers.breakdownDetectionLayer ? layers.breakdownDetectionLayer.explanation : {},
      derivativesContext: layers.derivativesContextLayer ? layers.derivativesContextLayer.explanation : {},
      confirmationContext: layers.confirmationLayer ? layers.confirmationLayer.explanation : {},
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
      volumeContext: (layerScores.volumeContextLayer || {}).explanation || {},
      bounceDetection: (layerScores.bounceDetectionLayer || {}).explanation || {},
      breakdownDetection: (layerScores.breakdownDetectionLayer || {}).explanation || {},
      derivativesContext: (layerScores.derivativesContextLayer || {}).explanation || {},
      confirmationContext: (layerScores.confirmationLayer || {}).explanation || {},
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
            volumeContext: (layerScores.volumeContextLayer || {}).explanation || {},
            bounceDetection: (layerScores.bounceDetectionLayer || {}).explanation || {},
            breakdownDetection: (layerScores.breakdownDetectionLayer || {}).explanation || {},
            derivativesContext: (layerScores.derivativesContextLayer || {}).explanation || {},
            confirmationContext: (layerScores.confirmationLayer || {}).explanation || {},
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
