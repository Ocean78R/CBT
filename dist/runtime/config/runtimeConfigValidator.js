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
