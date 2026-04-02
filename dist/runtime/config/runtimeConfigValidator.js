'use strict';

// Русский комментарий: валидатор/нормализатор конфигурации с fallback на прежний merge-процесс.
function buildRuntimeConfig(utilsConfig, globalConfig, exchangeConfig) {
  const coreConfig = utilsConfig.getCoreConfig(globalConfig);
  const merged = utilsConfig.merge(coreConfig, utilsConfig.getExchangeConfig(exchangeConfig));
  const unloadMode = merged.unloadMode || {};
  const capitalRegime = unloadMode.capitalRegime || {};
  const entryLimits = unloadMode.entryLimits || {};
  const executionContour = merged.executionContour || {};
  const serverTakeProfit = merged.serverTakeProfit || {};
  const serverStopLoss = merged.serverStopLoss || {};
  const tpConservativeMode = serverTakeProfit.conservativeMode || {};
  const slConservativeMode = serverStopLoss.conservativeMode || {};
  const forcedLossExit = merged.forcedLossExit || {};
  const regimeTightening = forcedLossExit.regimeTightening || {};
  const forecastInfluence = forcedLossExit.forecastInfluence || {};
  const portfolioRiskContour = merged.portfolioRiskContour || {};
  const tradeAnalytics = merged.tradeAnalytics || {};
  const paperTrading = merged.paperTrading || {};
  const mlDatasetBuilder = merged.mlDatasetBuilder || {};
  const higherTimeframeBiasEngine = merged.higherTimeframeBiasEngine || {};
  const confluenceEntryEngine = merged.confluenceEntryEngine || {};

  const observabilityReporting = merged.observabilityReporting || {};
  const observabilitySampling = observabilityReporting.sampling || {};
  const observabilityAuditTrail = observabilityReporting.auditTrail || {};
  const observabilityStorage = observabilityReporting.storage || {};
  const datasetCapture = mlDatasetBuilder.capture || {};
  const datasetLabeling = mlDatasetBuilder.labeling || {};
  const performanceDiagnostics = merged.performanceDiagnostics || {};
  const perfReadOnlyCache = performanceDiagnostics.readOnlyCache || {};
  const perfHotState = performanceDiagnostics.hotState || {};
  const perfInvalidation = performanceDiagnostics.invalidation || {};
  const perfDerivedFeatureCache = performanceDiagnostics.derivedFeatureCache || {};
  const perfDerivedTtl = perfDerivedFeatureCache.ttl || {};
  const perfDerivedForcedRefresh = perfDerivedFeatureCache.forcedRefresh || {};
  const perfMetrics = performanceDiagnostics.metrics || {};
  const perfRequestScheduler = performanceDiagnostics.requestScheduler || {};
  const performanceGovernor = merged.performanceGovernor || performanceDiagnostics.performanceGovernor || {};
  const perfGovernorCycle = performanceGovernor.cycle || {};
  const perfGovernorBudgets = performanceGovernor.budgets || {};
  const perfGovernorLayerBudgets = perfGovernorBudgets.byLayerMs || {};
  const perfGovernorTickerLimits = performanceGovernor.tickerLimits || {};
  const perfGovernorRefreshCadence = performanceGovernor.refreshCadence || {};
  const perfGovernorObservability = performanceGovernor.observability || {};
  const perfGovernorMemory = performanceGovernor.memory || {};
  const perfGovernorCache = performanceGovernor.cache || {};
  const perfGovernorLoopClasses = performanceGovernor.loopClasses || {};
  const perfGovernorParallelism = performanceGovernor.parallelism || {};
  const perfGovernorPriorities = performanceGovernor.priorities || {};
  const perfGovernorDegradation = performanceGovernor.degradation || {};
  const perfSchedulerPriorities = perfRequestScheduler.priorities || {};
  const perfSchedulerOptionalBudget = perfRequestScheduler.optionalBudget || {};
  const cooldownAfterBadStreak = portfolioRiskContour.cooldownAfterBadStreak || {};
  const capitalRegimeThresholds = portfolioRiskContour.capitalRegimeThresholds || {};
  const capitalRegimeEngine = portfolioRiskContour.capitalRegimeEngine || {};
  const portfolioForecastEngine = portfolioRiskContour.portfolioForecastEngine || {};
  const htfTrendWeights = higherTimeframeBiasEngine.trendWeights || {};
  const htfRangeWeights = higherTimeframeBiasEngine.rangeWeights || {};
  const htfConfidence = higherTimeframeBiasEngine.confidence || {};
  const htfAlignmentPenalties = higherTimeframeBiasEngine.alignmentPenalties || {};
  const htfSlowerRefresh = higherTimeframeBiasEngine.slowerRefresh || {};
  const confluenceBlockWeights = confluenceEntryEngine.blockWeights || {};
  const confluenceThresholds = confluenceEntryEngine.thresholds || {};
  const confluenceMarketContext = confluenceEntryEngine.marketContext || {};
  const confluencePrimarySignal = confluenceEntryEngine.primarySignal || {};
  const confluenceConfirmation = confluenceEntryEngine.confirmation || {};
  const confluenceMarketLevel = confluenceEntryEngine.marketLevel || {};
  const confluenceVolumeContext = confluenceEntryEngine.volumeContext || {};
  const confluenceBounceDetection = confluenceEntryEngine.bounceDetection || {};
  const confluenceBreakdownDetection = confluenceEntryEngine.breakdownDetection || {};
  const confluenceDerivativesContext = confluenceEntryEngine.derivativesContext || {};
  const confluenceMarketLevelScoring = confluenceMarketLevel.scoring || {};
  const confluenceMarketLevelDetection = confluenceMarketLevel.detection || {};
  const confluenceVolumeContextAnchoredVwap = confluenceVolumeContext.anchoredVwap || {};
  const confluenceVolumeContextValueArea = confluenceVolumeContext.valueArea || {};
  const confluenceVolumeContextVolumeProfile = confluenceVolumeContext.volumeProfile || {};
  const confluenceVolumeContextLazyEvaluation = confluenceVolumeContext.lazyEvaluation || {};
  const confluenceVolumeContextRefreshPolicy = confluenceVolumeContext.refreshPolicy || {};
  const confluenceVolumeContextScoring = confluenceVolumeContext.scoring || {};
  const confluenceBounceThresholds = confluenceBounceDetection.thresholds || {};
  const confluenceBounceWeights = confluenceBounceDetection.weights || {};
  const confluenceBounceMicrostructure = confluenceBounceDetection.microstructure || {};
  const confluenceBounceSetupTypes = confluenceBounceDetection.setupTypes || {};
  const confluenceBreakdownThresholds = confluenceBreakdownDetection.thresholds || {};
  const confluenceBreakdownWeights = confluenceBreakdownDetection.weights || {};
  const confluenceBreakdownMicrostructure = confluenceBreakdownDetection.microstructure || {};
  const confluenceBreakdownSetupTypes = confluenceBreakdownDetection.setupTypes || {};
  const confluenceDerivativesThresholds = confluenceDerivativesContext.thresholds || {};
  const confluenceDerivativesWeights = confluenceDerivativesContext.weights || {};
  const confluenceDerivativesCrowding = confluenceDerivativesContext.crowding || {};
  const confluenceDerivativesLiquidation = confluenceDerivativesContext.liquidation || {};
  const confluenceDerivativesRefresh = confluenceDerivativesContext.refreshPolicy || {};

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
      leverageMismatchRestrictionEnabled: executionContour.leverageMismatchRestrictionEnabled !== false,
    },
    serverTakeProfit: {
      enabled: !!serverTakeProfit.enabled,
      provider: serverTakeProfit.provider || 'bingx_reduce_only_v2',
      fallbackToLocalClose: serverTakeProfit.fallbackToLocalClose !== false,
      refreshOnAveraging: serverTakeProfit.refreshOnAveraging !== false,
      reconcileOnLoop: serverTakeProfit.reconcileOnLoop !== false,
      conservativeMode: {
        enabled: !!tpConservativeMode.enabled,
        onlyForCapitalRegimes: Array.isArray(tpConservativeMode.onlyForCapitalRegimes)
          ? tpConservativeMode.onlyForCapitalRegimes
          : ['DEFENSIVE', 'HALT_NEW_ENTRIES'],
        pnlMultiplier: Number(tpConservativeMode.pnlMultiplier || 0.85),
      },
    },


    portfolioRiskContour: {
      enabled: !!portfolioRiskContour.enabled,
      dailyLossLimitPercent: Number(portfolioRiskContour.dailyLossLimitPercent || 0),
      maxNewEntriesPerDay: Number(portfolioRiskContour.maxNewEntriesPerDay || 0),
      maxOpenPositions: Number(portfolioRiskContour.maxOpenPositions || 0),
      maxUsedMarginPercent: Number(portfolioRiskContour.maxUsedMarginPercent || 0),
      cooldownAfterBadStreak: {
        enabled: !!cooldownAfterBadStreak.enabled,
        consecutiveBadCycles: Number(cooldownAfterBadStreak.consecutiveBadCycles || 0),
        consecutiveLosingClosures: Number(cooldownAfterBadStreak.consecutiveLosingClosures || 0),
        pauseMinutes: Number(cooldownAfterBadStreak.pauseMinutes || 0),
      },
      capitalRegimeThresholds: {
        cautionDailyLossPercent: Number(capitalRegimeThresholds.cautionDailyLossPercent || 0),
        defensiveDailyLossPercent: Number(capitalRegimeThresholds.defensiveDailyLossPercent || 0),
        capitalPreservationDailyLossPercent: Number(capitalRegimeThresholds.capitalPreservationDailyLossPercent || 0),
        haltDailyLossPercent: Number(capitalRegimeThresholds.haltDailyLossPercent || 0),
        cautionMarginUsagePercent: Number(capitalRegimeThresholds.cautionMarginUsagePercent || 0),
        defensiveMarginUsagePercent: Number(capitalRegimeThresholds.defensiveMarginUsagePercent || 0),
        capitalPreservationMarginUsagePercent: Number(capitalRegimeThresholds.capitalPreservationMarginUsagePercent || 0),
        haltMarginUsagePercent: Number(capitalRegimeThresholds.haltMarginUsagePercent || 0),
      },
      capitalRegimeEngine: {
        enabled: capitalRegimeEngine.enabled !== false,
        escalationOnly: capitalRegimeEngine.escalationOnly !== false,
        cautionBalanceDrawdownPercent: Number(capitalRegimeEngine.cautionBalanceDrawdownPercent || 0),
        defensiveBalanceDrawdownPercent: Number(capitalRegimeEngine.defensiveBalanceDrawdownPercent || 0),
        capitalPreservationBalanceDrawdownPercent: Number(capitalRegimeEngine.capitalPreservationBalanceDrawdownPercent || 0),
        haltBalanceDrawdownPercent: Number(capitalRegimeEngine.haltBalanceDrawdownPercent || 0),
      },
      portfolioForecastEngine: {
        enabled: !!portfolioForecastEngine.enabled,
        minConfidenceForSignals: Number(portfolioForecastEngine.minConfidenceForSignals || 0.45),
        scenarioWeights: typeof portfolioForecastEngine.scenarioWeights === 'object' && portfolioForecastEngine.scenarioWeights
          ? portfolioForecastEngine.scenarioWeights
          : {},
        thresholds: typeof portfolioForecastEngine.thresholds === 'object' && portfolioForecastEngine.thresholds
          ? portfolioForecastEngine.thresholds
          : {},
        restrictions: typeof portfolioForecastEngine.restrictions === 'object' && portfolioForecastEngine.restrictions
          ? portfolioForecastEngine.restrictions
          : {},
        protectiveTightening: typeof portfolioForecastEngine.protectiveTightening === 'object' && portfolioForecastEngine.protectiveTightening
          ? portfolioForecastEngine.protectiveTightening
          : {},
        sizingHints: typeof portfolioForecastEngine.sizingHints === 'object' && portfolioForecastEngine.sizingHints
          ? portfolioForecastEngine.sizingHints
          : {},
      },
    },
    forcedLossExit: {
      enabled: !!forcedLossExit.enabled,
      maxNegativeHoldMinutes: Number(forcedLossExit.maxNegativeHoldMinutes || 0),
      maxPostAveragingNegativeHoldMinutes: Number(forcedLossExit.maxPostAveragingNegativeHoldMinutes || 0),
      maxLossPercentOnPosition: Number(forcedLossExit.maxLossPercentOnPosition || 0),
      maxAveragesPerPosition: Number(forcedLossExit.maxAveragesPerPosition || 0),
      requireAdverseMarketConfirmation: !!forcedLossExit.requireAdverseMarketConfirmation,
      actionMode: ['warn', 'block_averaging', 'partial_reduce', 'force_close'].includes(forcedLossExit.actionMode)
        ? forcedLossExit.actionMode
        : 'warn',
      partialReduceShare: Number(forcedLossExit.partialReduceShare || 0.25),
      cooldownMinutesAfterForcedExit: Number(forcedLossExit.cooldownMinutesAfterForcedExit || 0),
      enablePostEntryObservation: !!forcedLossExit.enablePostEntryObservation,
      postEntryGraceMinutes: Number(forcedLossExit.postEntryGraceMinutes || 0),
      postEntryObservationMinutes: Number(forcedLossExit.postEntryObservationMinutes || 0),
      maxTimeUnderEntryWithoutRecovery: Number(forcedLossExit.maxTimeUnderEntryWithoutRecovery || 0),
      earlyInvalidationLossPercent: Number(forcedLossExit.earlyInvalidationLossPercent || 0),
      requirePersistentAdverseTrend: forcedLossExit.requirePersistentAdverseTrend !== false,
      adverseTrendConfirmationBars: Number(forcedLossExit.adverseTrendConfirmationBars || 0),
      adverseTrendSlopeThreshold: Number(forcedLossExit.adverseTrendSlopeThreshold || 0),
      actionOnEarlyInvalidation: ['partial_reduce', 'force_close'].includes(forcedLossExit.actionOnEarlyInvalidation)
        ? forcedLossExit.actionOnEarlyInvalidation
        : 'force_close',
      useForecastProtectiveHints: !!forcedLossExit.useForecastProtectiveHints,
      regimeTightening: {
        enabled: !!regimeTightening.enabled,
        byCapitalRegime: typeof regimeTightening.byCapitalRegime === 'object' && regimeTightening.byCapitalRegime
          ? regimeTightening.byCapitalRegime
          : {},
      },
      forecastInfluence: {
        enabled: !!forecastInfluence.enabled,
        requireStressSignal: !!forecastInfluence.requireStressSignal,
        stressSignals: Array.isArray(forecastInfluence.stressSignals) ? forecastInfluence.stressSignals : [],
        lossMultiplierOnStress: Number(forecastInfluence.lossMultiplierOnStress || 1),
        holdMinutesMultiplierOnStress: Number(forecastInfluence.holdMinutesMultiplierOnStress || 1),
      },
    },

    higherTimeframeBiasEngine: {
      enabled: !!higherTimeframeBiasEngine.enabled,
      higherTimeframe: higherTimeframeBiasEngine.higherTimeframe || '4h',
      lookbackBars: Number(higherTimeframeBiasEngine.lookbackBars || 120),
      swingWindow: Number(higherTimeframeBiasEngine.swingWindow || 2),
      minimumStructurePoints: Number(higherTimeframeBiasEngine.minimumStructurePoints || 4),
      breakOfStructureThresholdPercent: Number(higherTimeframeBiasEngine.breakOfStructureThresholdPercent || 0.12),
      shiftConfirmationBars: Number(higherTimeframeBiasEngine.shiftConfirmationBars || 2),
      trendWeights: {
        hhhl: Number(htfTrendWeights.hhhl || 0.45),
        lhll: Number(htfTrendWeights.lhll || 0.45),
        bos: Number(htfTrendWeights.bos || 0.35),
        choch: Number(htfTrendWeights.choch || 0.25),
      },
      rangeWeights: {
        premiumZoneUpper: Number(htfRangeWeights.premiumZoneUpper || 0.7),
        discountZoneLower: Number(htfRangeWeights.discountZoneLower || 0.3),
        neutralBandLow: Number(htfRangeWeights.neutralBandLow || 0.4),
        neutralBandHigh: Number(htfRangeWeights.neutralBandHigh || 0.6),
      },
      confidence: {
        min: Number(htfConfidence.min || 0.2),
        max: Number(htfConfidence.max || 0.95),
        degradeOnLimitedData: Number(htfConfidence.degradeOnLimitedData || 0.65),
        degradeOnCachedData: Number(htfConfidence.degradeOnCachedData || 0.8),
      },
      alignmentPenalties: {
        counterTrendSoftPenalty: Number(htfAlignmentPenalties.counterTrendSoftPenalty || 0.22),
        weakAlignmentPenalty: Number(htfAlignmentPenalties.weakAlignmentPenalty || 0.1),
        strongAlignmentBoost: Number(htfAlignmentPenalties.strongAlignmentBoost || 0.08),
      },
      slowerRefresh: {
        enabled: htfSlowerRefresh.enabled !== false,
        minBarsBetweenRefresh: Number(htfSlowerRefresh.minBarsBetweenRefresh || 1),
        forceRefreshEveryCycles: Number(htfSlowerRefresh.forceRefreshEveryCycles || 0),
        useFeatureStoreCache: htfSlowerRefresh.useFeatureStoreCache !== false,
      },
    },

    confluenceEntryEngine: {
      enabled: !!confluenceEntryEngine.enabled,
      mode: confluenceEntryEngine.mode === 'confluence' ? 'confluence' : 'legacy_fallback',
      allowWeakEntry: confluenceEntryEngine.allowWeakEntry !== false,
      enforceRegimeSetupCompatibility: confluenceEntryEngine.enforceRegimeSetupCompatibility !== false,
      blockWeights: {
        entryPermission: Number(confluenceBlockWeights.entryPermission || 0.28),
        marketContext: Number(confluenceBlockWeights.marketContext || 0.2),
        primarySignal: Number(confluenceBlockWeights.primarySignal || 0.32),
        confirmation: Number(confluenceBlockWeights.confirmation || 0.2),
        marketLevel: Number(confluenceBlockWeights.marketLevel || 0),
        volumeContext: Number(confluenceBlockWeights.volumeContext || 0),
        bounceDetection: Number(confluenceBlockWeights.bounceDetection || 0),
        breakdownDetection: Number(confluenceBlockWeights.breakdownDetection || 0),
        derivativesContext: Number(confluenceBlockWeights.derivativesContext || 0),
      },
      thresholds: {
        fullEntryScore: Number(confluenceThresholds.fullEntryScore || 0.68),
        weakEntryScore: Number(confluenceThresholds.weakEntryScore || 0.45),
        minConfidence: Number(confluenceThresholds.minConfidence || 0.35),
        hardVetoConfidenceByCapital: Number(confluenceThresholds.hardVetoConfidenceByCapital || 0),
      },
      marketContext: {
        noTradeSoftPenalty: Number(confluenceMarketContext.noTradeSoftPenalty || 0.45),
        degradedDataSoftPenalty: Number(confluenceMarketContext.degradedDataSoftPenalty || 0.12),
      },
      primarySignal: {
        fallbackConfidence: Number(confluencePrimarySignal.fallbackConfidence || 0.42),
        fallbackScore: Number(confluencePrimarySignal.fallbackScore || 0.4),
      },
      confirmation: {
        minSignalsForFull: Number(confluenceConfirmation.minSignalsForFull || 2),
        minSignalsForWeak: Number(confluenceConfirmation.minSignalsForWeak || 1),
        htfBiasBoost: Number(confluenceConfirmation.htfBiasBoost || 0.08),
        htfCounterTrendPenalty: Number(confluenceConfirmation.htfCounterTrendPenalty || 0.18),
      },
      marketLevel: {
        enabled: !!confluenceMarketLevel.enabled,
        priceSource: confluenceMarketLevel.priceSource === 'close' ? 'close' : 'wick',
        lookbackBars: Number(confluenceMarketLevel.lookbackBars || 120),
        rangeLookbackBars: Number(confluenceMarketLevel.rangeLookbackBars || 40),
        swingWindow: Number(confluenceMarketLevel.swingWindow || 2),
        minSwingPoints: Number(confluenceMarketLevel.minSwingPoints || 3),
        zoneWidthPercent: Number(confluenceMarketLevel.zoneWidthPercent || 0.2),
        proximityThresholdPercent: Number(confluenceMarketLevel.proximityThresholdPercent || 0.35),
        breakoutTolerancePercent: Number(confluenceMarketLevel.breakoutTolerancePercent || 0.16),
        retestWindowBars: Number(confluenceMarketLevel.retestWindowBars || 6),
        falseBreakoutWindowBars: Number(confluenceMarketLevel.falseBreakoutWindowBars || 3),
        minBreakoutBodyPercent: Number(confluenceMarketLevel.minBreakoutBodyPercent || 0.12),
        scoring: {
          proximityScore: Number(confluenceMarketLevelScoring.proximityScore || 0.33),
          retestScore: Number(confluenceMarketLevelScoring.retestScore || 0.24),
          falseBreakoutScore: Number(confluenceMarketLevelScoring.falseBreakoutScore || 0.24),
          breakoutContextScore: Number(confluenceMarketLevelScoring.breakoutContextScore || 0.19),
          rangePenalty: Number(confluenceMarketLevelScoring.rangePenalty || 0.12),
          degradedPenalty: Number(confluenceMarketLevelScoring.degradedPenalty || 0.08),
        },
        detection: {
          requireBreakoutForRetest: confluenceMarketLevelDetection.requireBreakoutForRetest !== false,
        },
      },
      volumeContext: {
        enabled: !!confluenceVolumeContext.enabled,
        preferSharedFeatures: confluenceVolumeContext.preferSharedFeatures !== false,
        degradeOnMissingVolume: confluenceVolumeContext.degradeOnMissingVolume !== false,
        vwapWindowBars: Number(confluenceVolumeContext.vwapWindowBars || 80),
        anchoredVwap: {
          enabled: confluenceVolumeContextAnchoredVwap.enabled !== false,
          lookbackBars: Number(confluenceVolumeContextAnchoredVwap.lookbackBars || 120),
          swingWindow: Number(confluenceVolumeContextAnchoredVwap.swingWindow || 3),
          fallbackToSessionAnchor: confluenceVolumeContextAnchoredVwap.fallbackToSessionAnchor !== false,
        },
        valueArea: {
          enabled: confluenceVolumeContextValueArea.enabled !== false,
          valueAreaPercent: Number(confluenceVolumeContextValueArea.valueAreaPercent || 0.7),
        },
        volumeProfile: {
          enabled: confluenceVolumeContextVolumeProfile.enabled !== false,
          bins: Number(confluenceVolumeContextVolumeProfile.bins || 24),
          hvnPercentile: Number(confluenceVolumeContextVolumeProfile.hvnPercentile || 0.82),
          lvnPercentile: Number(confluenceVolumeContextVolumeProfile.lvnPercentile || 0.18),
        },
        lazyEvaluation: {
          enabled: confluenceVolumeContextLazyEvaluation.enabled !== false,
          requireShortlistCandidate: confluenceVolumeContextLazyEvaluation.requireShortlistCandidate !== false,
          requirePrimaryDirection: confluenceVolumeContextLazyEvaluation.requirePrimaryDirection !== false,
          minPrimaryScore: Number(confluenceVolumeContextLazyEvaluation.minPrimaryScore || 0.4),
          skipWhenBudgetExceeded: confluenceVolumeContextLazyEvaluation.skipWhenBudgetExceeded !== false,
        },
        refreshPolicy: {
          minBarsBetweenFullRecalc: Number(confluenceVolumeContextRefreshPolicy.minBarsBetweenFullRecalc || 3),
          allowCachedReuse: confluenceVolumeContextRefreshPolicy.allowCachedReuse !== false,
          forceFullRecalcEveryCycles: Number(confluenceVolumeContextRefreshPolicy.forceFullRecalcEveryCycles || 0),
        },
        scoring: {
          vwapAlignmentWeight: Number(confluenceVolumeContextScoring.vwapAlignmentWeight || 0.32),
          anchoredVwapAlignmentWeight: Number(confluenceVolumeContextScoring.anchoredVwapAlignmentWeight || 0.22),
          valueAreaWeight: Number(confluenceVolumeContextScoring.valueAreaWeight || 0.24),
          hvnLvnReactionWeight: Number(confluenceVolumeContextScoring.hvnLvnReactionWeight || 0.22),
          distancePenaltyFactor: Number(confluenceVolumeContextScoring.distancePenaltyFactor || 1.15),
          degradedPenalty: Number(confluenceVolumeContextScoring.degradedPenalty || 0.12),
        },
      },
      bounceDetection: {
        enabled: !!confluenceBounceDetection.enabled,
        allowedRegimes: Array.isArray(confluenceBounceDetection.allowedRegimes) ? confluenceBounceDetection.allowedRegimes : ['trend', 'range', 'pullback'],
        noTradeRegimes: Array.isArray(confluenceBounceDetection.noTradeRegimes) ? confluenceBounceDetection.noTradeRegimes : ['no_trade_flat'],
        lookbackBars: Number(confluenceBounceDetection.lookbackBars || 80),
        swingWindow: Number(confluenceBounceDetection.swingWindow || 2),
        zoneProximityPercent: Number(confluenceBounceDetection.zoneProximityPercent || 0.25),
        falseBreakoutTolerancePercent: Number(confluenceBounceDetection.falseBreakoutTolerancePercent || 0.18),
        momentumLookbackBars: Number(confluenceBounceDetection.momentumLookbackBars || 6),
        minCandlesForAnalysis: Number(confluenceBounceDetection.minCandlesForAnalysis || 24),
        thresholds: {
          scoreForSetupTag: Number(confluenceBounceThresholds.scoreForSetupTag || 0.56),
          strongScore: Number(confluenceBounceThresholds.strongScore || 0.72),
          minConfidence: Number(confluenceBounceThresholds.minConfidence || 0.3),
          minimumDataCoverage: Number(confluenceBounceThresholds.minimumDataCoverage || 0.45),
          microstructureActivationScore: Number(confluenceBounceThresholds.microstructureActivationScore || 0.58),
        },
        setupTypes: {
          zone_rejection: confluenceBounceSetupTypes.zone_rejection !== false,
          liquidity_grab_reversal: confluenceBounceSetupTypes.liquidity_grab_reversal !== false,
          momentum_exhaustion: confluenceBounceSetupTypes.momentum_exhaustion !== false,
          divergence_rebound: confluenceBounceSetupTypes.divergence_rebound !== false,
          volume_absorption_bounce: confluenceBounceSetupTypes.volume_absorption_bounce !== false,
          microstructure_snapback: confluenceBounceSetupTypes.microstructure_snapback !== false,
        },
        weights: {
          proximity: Number(confluenceBounceWeights.proximity || 0.18),
          swingContext: Number(confluenceBounceWeights.swingContext || 0.12),
          falseBreakout: Number(confluenceBounceWeights.falseBreakout || 0.14),
          momentumSlowdown: Number(confluenceBounceWeights.momentumSlowdown || 0.12),
          exhaustionOscillators: Number(confluenceBounceWeights.exhaustionOscillators || 0.14),
          divergence: Number(confluenceBounceWeights.divergence || 0.1),
          volumeAbsorption: Number(confluenceBounceWeights.volumeAbsorption || 0.14),
          microstructure: Number(confluenceBounceWeights.microstructure || 0.06),
        },
        microstructure: {
          enabled: confluenceBounceMicrostructure.enabled !== false,
          requireStrongCandidate: confluenceBounceMicrostructure.requireStrongCandidate !== false,
          skipWhenBudgetExceeded: confluenceBounceMicrostructure.skipWhenBudgetExceeded !== false,
          maxSpreadPercent: Number(confluenceBounceMicrostructure.maxSpreadPercent || 0.12),
          minImbalance: Number(confluenceBounceMicrostructure.minImbalance || 0.08),
        },
        capitalRegimePenalties: typeof confluenceBounceDetection.capitalRegimePenalties === 'object' && confluenceBounceDetection.capitalRegimePenalties
          ? confluenceBounceDetection.capitalRegimePenalties
          : {
            CAUTION: 0.05,
            DEFENSIVE: 0.12,
            CAPITAL_PRESERVATION: 0.2,
            HALT_NEW_ENTRIES: 0.35,
          },
      },
      breakdownDetection: {
        enabled: !!confluenceBreakdownDetection.enabled,
        allowedRegimes: Array.isArray(confluenceBreakdownDetection.allowedRegimes) ? confluenceBreakdownDetection.allowedRegimes : ['trend', 'pullback', 'volatile_breakout'],
        noTradeRegimes: Array.isArray(confluenceBreakdownDetection.noTradeRegimes) ? confluenceBreakdownDetection.noTradeRegimes : ['no_trade_flat'],
        lookbackBars: Number(confluenceBreakdownDetection.lookbackBars || 96),
        minCandlesForAnalysis: Number(confluenceBreakdownDetection.minCandlesForAnalysis || 30),
        supportLookbackBars: Number(confluenceBreakdownDetection.supportLookbackBars || 28),
        supportProximityPercent: Number(confluenceBreakdownDetection.supportProximityPercent || 0.35),
        pressureLookbackBars: Number(confluenceBreakdownDetection.pressureLookbackBars || 8),
        momentumLookbackBars: Number(confluenceBreakdownDetection.momentumLookbackBars || 6),
        repeatedTestsWindowBars: Number(confluenceBreakdownDetection.repeatedTestsWindowBars || 20),
        repeatedTestsTolerancePercent: Number(confluenceBreakdownDetection.repeatedTestsTolerancePercent || 0.2),
        breakdownConfirmationBars: Number(confluenceBreakdownDetection.breakdownConfirmationBars || 2),
        reclaimTolerancePercent: Number(confluenceBreakdownDetection.reclaimTolerancePercent || 0.12),
        thresholds: {
          scoreForSetupTag: Number(confluenceBreakdownThresholds.scoreForSetupTag || 0.58),
          strongScore: Number(confluenceBreakdownThresholds.strongScore || 0.74),
          minConfidence: Number(confluenceBreakdownThresholds.minConfidence || 0.34),
          minimumDataCoverage: Number(confluenceBreakdownThresholds.minimumDataCoverage || 0.5),
          microstructureActivationScore: Number(confluenceBreakdownThresholds.microstructureActivationScore || 0.62),
        },
        setupTypes: {
          pre_breakdown_pressure: confluenceBreakdownSetupTypes.pre_breakdown_pressure !== false,
          confirmed_breakdown_continuation: confluenceBreakdownSetupTypes.confirmed_breakdown_continuation !== false,
          weak_retest_failure: confluenceBreakdownSetupTypes.weak_retest_failure !== false,
          momentum_expansion_breakdown: confluenceBreakdownSetupTypes.momentum_expansion_breakdown !== false,
          volume_confirmed_breakdown: confluenceBreakdownSetupTypes.volume_confirmed_breakdown !== false,
          orderbook_ask_pressure: confluenceBreakdownSetupTypes.orderbook_ask_pressure !== false,
        },
        weights: {
          proximityToSupport: Number(confluenceBreakdownWeights.proximityToSupport || 0.14),
          supportPressure: Number(confluenceBreakdownWeights.supportPressure || 0.14),
          repeatedTests: Number(confluenceBreakdownWeights.repeatedTests || 0.12),
          downsideMomentumExpansion: Number(confluenceBreakdownWeights.downsideMomentumExpansion || 0.14),
          volumeSpikeOnBreakdown: Number(confluenceBreakdownWeights.volumeSpikeOnBreakdown || 0.12),
          weakReboundRetest: Number(confluenceBreakdownWeights.weakReboundRetest || 0.12),
          reclaimFailure: Number(confluenceBreakdownWeights.reclaimFailure || 0.1),
          microstructure: Number(confluenceBreakdownWeights.microstructure || 0.12),
        },
        microstructure: {
          enabled: confluenceBreakdownMicrostructure.enabled !== false,
          requireStrongCandidate: confluenceBreakdownMicrostructure.requireStrongCandidate !== false,
          skipWhenBudgetExceeded: confluenceBreakdownMicrostructure.skipWhenBudgetExceeded !== false,
          minAskBidImbalance: Number(confluenceBreakdownMicrostructure.minAskBidImbalance || 0.1),
          maxSpreadPercent: Number(confluenceBreakdownMicrostructure.maxSpreadPercent || 0.14),
        },
        capitalRegimePenalties: typeof confluenceBreakdownDetection.capitalRegimePenalties === 'object' && confluenceBreakdownDetection.capitalRegimePenalties
          ? confluenceBreakdownDetection.capitalRegimePenalties
          : {
            CAUTION: 0.04,
            DEFENSIVE: 0.1,
            CAPITAL_PRESERVATION: 0.16,
            HALT_NEW_ENTRIES: 0.28,
          },
      },
      derivativesContext: {
        enabled: !!confluenceDerivativesContext.enabled,
        preferSharedSnapshot: confluenceDerivativesContext.preferSharedSnapshot !== false,
        skipWhenBudgetExceeded: confluenceDerivativesContext.skipWhenBudgetExceeded !== false,
        allowNoTradeOnExtremeCrowding: !!confluenceDerivativesContext.allowNoTradeOnExtremeCrowding,
        thresholds: {
          oiStrongIncrease: Number(confluenceDerivativesThresholds.oiStrongIncrease || 0.05),
          oiStrongDecrease: Number(confluenceDerivativesThresholds.oiStrongDecrease || -0.05),
          fundingExtreme: Number(confluenceDerivativesThresholds.fundingExtreme || 0.0009),
          fundingElevated: Number(confluenceDerivativesThresholds.fundingElevated || 0.00045),
          liquidationImbalanceStrong: Number(confluenceDerivativesThresholds.liquidationImbalanceStrong || 1.8),
          minimumConfidence: Number(confluenceDerivativesThresholds.minimumConfidence || 0.35),
          maxSoftPenalty: Number(confluenceDerivativesThresholds.maxSoftPenalty || 0.45),
        },
        weights: {
          oiDynamics: Number(confluenceDerivativesWeights.oiDynamics || 0.34),
          fundingState: Number(confluenceDerivativesWeights.fundingState || 0.32),
          liquidationContext: Number(confluenceDerivativesWeights.liquidationContext || 0.2),
          crowding: Number(confluenceDerivativesWeights.crowding || 0.14),
        },
        crowding: {
          oiZscoreSpike: Number(confluenceDerivativesCrowding.oiZscoreSpike || 2.4),
          fundingAbsSpike: Number(confluenceDerivativesCrowding.fundingAbsSpike || 0.0012),
          liquidationClusterUsd: Number(confluenceDerivativesCrowding.liquidationClusterUsd || 2500000),
          penaltyOnExtreme: Number(confluenceDerivativesCrowding.penaltyOnExtreme || 0.26),
          penaltyOnElevated: Number(confluenceDerivativesCrowding.penaltyOnElevated || 0.12),
        },
        liquidation: {
          useIfAvailable: confluenceDerivativesLiquidation.useIfAvailable !== false,
          dominanceSupportWeight: Number(confluenceDerivativesLiquidation.dominanceSupportWeight || 0.22),
          dominanceRiskPenalty: Number(confluenceDerivativesLiquidation.dominanceRiskPenalty || 0.2),
        },
        refreshPolicy: {
          minCyclesBetweenRefresh: Number(confluenceDerivativesRefresh.minCyclesBetweenRefresh || 3),
          forceRefreshEveryCycles: Number(confluenceDerivativesRefresh.forceRefreshEveryCycles || 0),
          allowCachedReuse: confluenceDerivativesRefresh.allowCachedReuse !== false,
          cacheKey: confluenceDerivativesRefresh.cacheKey || 'derivatives_context_engine',
        },
        capitalRegimePenalties: typeof confluenceDerivativesContext.capitalRegimePenalties === 'object' && confluenceDerivativesContext.capitalRegimePenalties
          ? confluenceDerivativesContext.capitalRegimePenalties
          : {
            NORMAL: 0,
            CAUTION: 0.04,
            DEFENSIVE: 0.1,
            CAPITAL_PRESERVATION: 0.16,
            HALT_NEW_ENTRIES: 0.26,
          },
      },
    },

    paperTrading: {
      enabled: !!paperTrading.enabled,
      mode: paperTrading.mode === 'shadow' ? 'shadow' : 'paper',
      initialBalance: Number(paperTrading.initialBalance || 10000),
      slippageBps: Number(paperTrading.slippageBps || 0),
      feeBps: Number(paperTrading.feeBps || 0),
    },
    tradeAnalytics: {
      enabled: tradeAnalytics.enabled !== false,
      storage: tradeAnalytics.storage || 'csv',
      dataDir: tradeAnalytics.dataDir || './data/analytics',
      tradesCsv: tradeAnalytics.tradesCsv || 'trades_journal.csv',
      openStateJson: tradeAnalytics.openStateJson || 'open_trades_state.json',
      reportOnCycleEnd: tradeAnalytics.reportOnCycleEnd !== false,
    },
    mlDatasetBuilder: {
      enabled: !!mlDatasetBuilder.enabled,
      storage: mlDatasetBuilder.storage === 'sqlite' ? 'sqlite' : 'csv',
      dataDir: mlDatasetBuilder.dataDir || './data/ml_dataset',
      featuresCsv: mlDatasetBuilder.featuresCsv || 'entry_features.csv',
      labelsCsv: mlDatasetBuilder.labelsCsv || 'entry_labels.csv',
      pendingStateJson: mlDatasetBuilder.pendingStateJson || 'entry_pending_state.json',
      flushIntervalMs: Number(mlDatasetBuilder.flushIntervalMs || 1200),
      includePaperMode: mlDatasetBuilder.includePaperMode !== false,
      includeLiveMode: mlDatasetBuilder.includeLiveMode !== false,
      capture: {
        potentialEntries: datasetCapture.potentialEntries !== false,
        actualEntries: datasetCapture.actualEntries !== false,
      },
      labeling: {
        defaultHoldTimeoutMinutes: Number(datasetLabeling.defaultHoldTimeoutMinutes || 180),
        positivePnlPercent: Number(datasetLabeling.positivePnlPercent || 0.2),
        negativePnlPercent: Number(datasetLabeling.negativePnlPercent || -0.2),
        neutralBandAbsPercent: Number(datasetLabeling.neutralBandAbsPercent || 0.2),
      },
    },
    observabilityReporting: {
      enabled: !!observabilityReporting.enabled,
      flushIntervalMs: Number(observabilityReporting.flushIntervalMs || 1500),
      maxBufferSize: Number(observabilityReporting.maxBufferSize || 250),
      aggregateWindowCycles: Number(observabilityReporting.aggregateWindowCycles || 200),
      includePaperMode: observabilityReporting.includePaperMode !== false,
      includeLiveMode: observabilityReporting.includeLiveMode !== false,
      sampling: {
        decisionEventsRate: Number(observabilitySampling.decisionEventsRate || 1),
        diagnosticEventsRate: Number(observabilitySampling.diagnosticEventsRate || 0.25),
        alwaysKeepCritical: observabilitySampling.alwaysKeepCritical !== false,
      },
      auditTrail: {
        enabled: observabilityAuditTrail.enabled !== false,
        keepPayload: observabilityAuditTrail.keepPayload !== false,
        maxEntries: Number(observabilityAuditTrail.maxEntries || 3000),
      },
      storage: {
        enabled: !!observabilityStorage.enabled,
        dataDir: observabilityStorage.dataDir || './data/analytics',
        eventsFile: observabilityStorage.eventsFile || 'observability_events.ndjson',
      },
    },
    performanceDiagnostics: {
      enabled: !!performanceDiagnostics.enabled,
      loggerEnabled: !!performanceDiagnostics.loggerEnabled,
      logEveryNCalls: Number(performanceDiagnostics.logEveryNCalls || 200),
      readOnlyCache: {
        enabled: perfReadOnlyCache.enabled !== false,
        ttlMs: Number(perfReadOnlyCache.ttlMs || 1200),
        markPriceTtlMs: Number(perfReadOnlyCache.markPriceTtlMs || perfReadOnlyCache.ttlMs || 1200),
        klineTtlMs: Number(perfReadOnlyCache.klineTtlMs || perfReadOnlyCache.ttlMs || 2500),
        accountReadTtlMs: Number(perfReadOnlyCache.accountReadTtlMs || perfReadOnlyCache.ttlMs || 900),
        maxEntries: Number(perfReadOnlyCache.maxEntries || 1000),
        methods: Array.isArray(perfReadOnlyCache.methods) ? perfReadOnlyCache.methods : [],
      },
      hotState: {
        enabled: perfHotState.enabled !== false,
        maxTickers: Number(perfHotState.maxTickers || 300),
        staleReuseGraceMs: Number(perfHotState.staleReuseGraceMs || 350),
      },
      invalidation: {
        onError: perfInvalidation.onError !== false,
        onExecutionTickers: perfInvalidation.onExecutionTickers !== false,
        fullFlushOnCycleStart: !!perfInvalidation.fullFlushOnCycleStart,
      },
      derivedFeatureCache: {
        enabled: perfDerivedFeatureCache.enabled !== false,
        featureVersion: perfDerivedFeatureCache.featureVersion || 'v1',
        ttl: {
          ultraShortMs: Number(perfDerivedTtl.ultraShortMs || 800),
          perCycleMs: Number(perfDerivedTtl.perCycleMs || 4500),
          contextMs: Number(perfDerivedTtl.contextMs || 25000),
        },
        forcedRefresh: {
          indicatorsEveryCycles: Number(perfDerivedForcedRefresh.indicatorsEveryCycles || 0),
          htfStructureEveryCycles: Number(perfDerivedForcedRefresh.htfStructureEveryCycles || 0),
        },
      },
      metrics: {
        enabled: perfMetrics.enabled !== false,
        slowCallMs: Number(perfMetrics.slowCallMs || 250),
      },
      requestScheduler: {
        enabled: !!perfRequestScheduler.enabled,
        maxConcurrency: Number(perfRequestScheduler.maxConcurrency || 6),
        maxRequestsPerWindow: Number(perfRequestScheduler.maxRequestsPerWindow || 20),
        windowMs: Number(perfRequestScheduler.windowMs || 1000),
        backoffBaseMs: Number(perfRequestScheduler.backoffBaseMs || 250),
        backoffMaxMs: Number(perfRequestScheduler.backoffMaxMs || 3000),
        priorities: {
          coreMarketData: Number(perfSchedulerPriorities.coreMarketData || 100),
          optionalMicrostructure: Number(perfSchedulerPriorities.optionalMicrostructure || 40),
          derivativesContext: Number(perfSchedulerPriorities.derivativesContext || 30),
          analyticsRefresh: Number(perfSchedulerPriorities.analyticsRefresh || 20),
        },
        optionalBudget: {
          enabled: perfSchedulerOptionalBudget.enabled !== false,
          maxOptionalPerCycle: Number(perfSchedulerOptionalBudget.maxOptionalPerCycle || 300),
        },
      },
    },
    performanceGovernor: {
      enabled: !!performanceGovernor.enabled,
      mode: ['monitor_only', 'enforce'].includes(performanceGovernor.mode) ? performanceGovernor.mode : 'monitor_only',
      cycle: {
        targetMs: Number(perfGovernorCycle.targetMs || 1200),
        hardLimitMs: Number(perfGovernorCycle.hardLimitMs || 1600),
      },
      budgets: {
        reserveForExecutionMs: Number(perfGovernorBudgets.reserveForExecutionMs || 180),
        optionalContextShare: Number(perfGovernorBudgets.optionalContextShare || 0.35),
        byLayerMs: {
          regimeRouter: Number(perfGovernorLayerBudgets.regimeRouter || 35),
          htfStructure: Number(perfGovernorLayerBudgets.htfStructure || 70),
          zones: Number(perfGovernorLayerBudgets.zones || 65),
          vwapProfile: Number(perfGovernorLayerBudgets.vwapProfile || 55),
          bounceBreakdown: Number(perfGovernorLayerBudgets.bounceBreakdown || 60),
          derivativesContext: Number(perfGovernorLayerBudgets.derivativesContext || 45),
          confirmations: Number(perfGovernorLayerBudgets.confirmations || 75),
          mlInference: Number(perfGovernorLayerBudgets.mlInference || 90),
        },
      },
      tickerLimits: {
        maxExpensiveTickersPerCycle: Number(perfGovernorTickerLimits.maxExpensiveTickersPerCycle || 12),
        maxMlTickersPerCycle: Number(perfGovernorTickerLimits.maxMlTickersPerCycle || 6),
      },
      refreshCadence: {
        enabled: perfGovernorRefreshCadence.enabled !== false,
        rareFeatureMinIntervalMs: Number(perfGovernorRefreshCadence.rareFeatureMinIntervalMs || 4000),
        derivativesContextMinIntervalMs: Number(perfGovernorRefreshCadence.derivativesContextMinIntervalMs || 2000),
        mlMinIntervalMs: Number(perfGovernorRefreshCadence.mlMinIntervalMs || 8000),
      },
      observability: {
        maxSyncEventsPerCycle: Number(perfGovernorObservability.maxSyncEventsPerCycle || 120),
      },
      memory: {
        maxHotStateTickers: Number(perfGovernorMemory.maxHotStateTickers || 300),
        maxDerivedFeatureEntries: Number(perfGovernorMemory.maxDerivedFeatureEntries || 2000),
      },
      cache: {
        preferCachedModeOnBudgetPressure: perfGovernorCache.preferCachedModeOnBudgetPressure !== false,
        degradeToCachedBeforeSkip: perfGovernorCache.degradeToCachedBeforeSkip !== false,
      },
      loopClasses: {
        executionCriticalHz: Number(perfGovernorLoopClasses.executionCriticalHz || 1),
        signalCoreHz: Number(perfGovernorLoopClasses.signalCoreHz || 1),
        optionalContextHz: Number(perfGovernorLoopClasses.optionalContextHz || 1),
        analyticsHz: Number(perfGovernorLoopClasses.analyticsHz || 1),
      },
      parallelism: {
        maxHeavyLayerConcurrency: Number(perfGovernorParallelism.maxHeavyLayerConcurrency || 2),
        maxAnalyticsConcurrency: Number(perfGovernorParallelism.maxAnalyticsConcurrency || 1),
      },
      priorities: {
        executionCritical: Number(perfGovernorPriorities.executionCritical || 100),
        riskProtection: Number(perfGovernorPriorities.riskProtection || 95),
        regimeRouter: Number(perfGovernorPriorities.regimeRouter || 80),
        cheapContext: Number(perfGovernorPriorities.cheapContext || 70),
        expensiveConfirmations: Number(perfGovernorPriorities.expensiveConfirmations || 55),
        mlInference: Number(perfGovernorPriorities.mlInference || 45),
        analytics: Number(perfGovernorPriorities.analytics || 25),
      },
      degradation: {
        enabled: perfGovernorDegradation.enabled !== false,
        pressureThresholdPercent: Number(perfGovernorDegradation.pressureThresholdPercent || 0.82),
        hardPressureThresholdPercent: Number(perfGovernorDegradation.hardPressureThresholdPercent || 0.95),
      },
      optionalLayers: Array.isArray(performanceGovernor.optionalLayers) ? performanceGovernor.optionalLayers : [
        'zones',
        'vwapProfile',
        'bounceBreakdown',
        'confirmations',
        'mlInference',
        'analytics',
      ],
      stagedEvaluation: {
        enabled: !performanceGovernor.stagedEvaluation || performanceGovernor.stagedEvaluation.enabled !== false,
        sequence: performanceGovernor.stagedEvaluation && Array.isArray(performanceGovernor.stagedEvaluation.sequence)
          ? performanceGovernor.stagedEvaluation.sequence
          : ['shortlist', 'cheap_context', 'expensive_confirmations', 'final_decision'],
      },
    },

    serverStopLoss: {
      enabled: !!serverStopLoss.enabled,
      provider: serverStopLoss.provider || 'bingx_reduce_only_v2',
      fallbackToForcedLossExit: serverStopLoss.fallbackToForcedLossExit !== false,
      refreshOnAveraging: serverStopLoss.refreshOnAveraging !== false,
      reconcileOnLoop: serverStopLoss.reconcileOnLoop !== false,
      triggerBy: serverStopLoss.triggerBy || 'MARK_PRICE',
      conservativeMode: {
        enabled: !!slConservativeMode.enabled,
        onlyForCapitalRegimes: Array.isArray(slConservativeMode.onlyForCapitalRegimes)
          ? slConservativeMode.onlyForCapitalRegimes
          : ['DEFENSIVE', 'HALT_NEW_ENTRIES'],
        lossMultiplier: Number(slConservativeMode.lossMultiplier || 0.85),
      },
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
