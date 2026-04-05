'use strict';

const { evaluateForcedLossExit, toForcedLossExitEvent } = require('../risk/forcedLossExit');
const { evaluatePortfolioRiskContour, toPortfolioRiskContourEvent } = require('../risk/portfolioRiskContour');
const { toCapitalStressForecastEvent } = require('../risk/capitalStressForecastEngine');
const { createObservabilityLayer } = require('../observability/reportingLayer');
const { createPaperTradingExecutor } = require('../execution/paperTrading');
const { createMlDatasetBuilder } = require('../analytics/mlDatasetBuilder');
const { createMlInferenceLayer, normalizeMlInferenceConfig } = require('../ml/mlInferenceLayer');
const { createMlPhase1DecisionModifier, normalizeMlPhase1DecisionModifierConfig } = require('../ml/mlPhase1DecisionModifier');
const {
  evaluateHigherTimeframeBiasWithCache,
  applyHtfBiasToEntryDecision,
  toHigherTimeframeBiasEvent,
} = require('./higherTimeframeBiasEngine');
const {
  evaluateConfluenceEntry,
  toConfluenceEntryEvent,
} = require('./confluenceEntryEngine');
const {
  evaluateFinalEntryDecision,
  normalizeFinalEntryDecisionConfig,
  toFinalEntryDecisionEvent,
} = require('./finalEntryDecisionEngine');
const {
  evaluateDynamicPositionSizing,
  normalizeDynamicPositionSizingConfig,
  toDynamicPositionSizingEvent,
} = require('../sizing/dynamicPositionSizing');

function emitObservabilityEvent(strategy, event) {
  const layer = strategy && strategy.observabilityLayer;
  if (layer && typeof layer.ingestEvent === 'function') {
    layer.ingestEvent(event);
  }
}

// Русский комментарий: движки пока выступают как адаптеры к существующим методам стратегии (fallback без изменения поведения).
function createEngines(strategy) {
  const paperExecutor = createPaperTradingExecutor(strategy, strategy && strategy.config ? strategy.config : {});
  const mlInferenceLayer = createMlInferenceLayer({}, {
    log: (message) => {
      if (strategy && typeof strategy.log === 'function') strategy.log(message);
    },
  });

  return {
    signalEngine: {
      // Русский комментарий: standalone finalEntryDecisionEngine доступен для runtime wiring как агрегатор shared block outputs.
      evaluateFinalEntryDecision: (input, runtimeConfig) => {
        const finalEntryConfig = runtimeConfig && runtimeConfig.finalEntryDecisionEngine
          ? runtimeConfig.finalEntryDecisionEngine
          : {};
        const result = evaluateFinalEntryDecision(input, normalizeFinalEntryDecisionConfig(finalEntryConfig), {
          log: (message) => {
            if (typeof strategy.log === 'function') strategy.log(message);
          },
        });

        if (strategy.emitStructuredEvent) {
          const event = toFinalEntryDecisionEvent({
            context: input && input.context ? input.context : {},
            decision: result,
          });
          strategy.emitStructuredEvent(event);
          emitObservabilityEvent(strategy, event);
        }

        return result;
      },
      // Русский комментарий: sizing запускается только после approved entry и не имеет права разрешать вход самостоятельно.
      evaluateDynamicPositionSizing: (input, runtimeConfig) => {
        const sizingConfig = runtimeConfig && runtimeConfig.dynamicPositionSizing
          ? runtimeConfig.dynamicPositionSizing
          : {};
        const decision = evaluateDynamicPositionSizing(input, normalizeDynamicPositionSizingConfig(sizingConfig), {
          log: (message) => {
            if (typeof strategy.log === 'function') strategy.log(message);
          },
        });
        if (strategy.emitStructuredEvent) {
          const event = toDynamicPositionSizingEvent({
            context: input && input.context ? input.context : {},
            decision,
          });
          strategy.emitStructuredEvent(event);
          emitObservabilityEvent(strategy, event);
        }
        return decision;
      },
      // Русский комментарий: ML phase 1 modifier работает после finalEntryDecisionEngine и до sizing как ограниченный filter/hint слой.
      evaluateMlPhase1DecisionModifier: (input, runtimeConfig = {}) => {
        const phase1Config = runtimeConfig && runtimeConfig.mlPhase1DecisionModifier
          ? runtimeConfig.mlPhase1DecisionModifier
          : (runtimeConfig && runtimeConfig.mlPhase1 ? runtimeConfig.mlPhase1 : {});
        const modifier = createMlPhase1DecisionModifier(normalizeMlPhase1DecisionModifierConfig(phase1Config), {
          log: (message) => {
            if (strategy && typeof strategy.log === 'function') strategy.log(message);
          },
        });
        return modifier.evaluate(input);
      },
      // Русский комментарий: ML phase 1 работает только как advisory-слой и не перехватывает final decision/sizing/execution ownership.
      evaluateMlInferencePhase1: (input, runtimeConfig = {}, runtime = {}) => {
        const mlConfig = runtimeConfig && runtimeConfig.mlInferenceLayer
          ? runtimeConfig.mlInferenceLayer
          : (runtimeConfig && runtimeConfig.mlPhase1Inference ? runtimeConfig.mlPhase1Inference : {});
        const normalizedMlConfig = normalizeMlInferenceConfig(mlConfig);
        const localLayer = createMlInferenceLayer(normalizedMlConfig, {
          log: (message) => {
            if (strategy && typeof strategy.log === 'function') strategy.log(message);
          },
        });

        const governor = runtime && runtime.performanceGovernor && typeof runtime.performanceGovernor.registerLayerExecution === 'function'
          ? runtime.performanceGovernor
          : null;

        return localLayer.evaluate(input, {
          registerLayerExecution: governor
            ? (layerName, durationMs, mode) => governor.registerLayerExecution(layerName, durationMs, mode)
            : null,
        });
      },
      // Русский комментарий: confluence режим стоит после regime-router и до sizing/execution; legacy остаётся fallback.
      predictPriceDirection: async (ticker) => {
        const legacyResult = await strategy.predictPriceDirectionLegacy(ticker);
        const [legacySide, legacyWarning] = Array.isArray(legacyResult)
          ? legacyResult
          : ['none', 'legacy_predictor_result_invalid'];

        const confluenceConfig = (
          (strategy && strategy.config && strategy.config.confluenceEntryEngine)
          || (((strategy || {}).setts || {}).predict || {}).confluenceEntryEngine
          || {}
        );

        const context = {
          cycleId: strategy.currentCycleId || 'n/a',
          ticker,
          exchange: strategy.connectorName || 'n/a',
          marketRegime: (((strategy.currentRuntimeContext || {}).decisionContext || {}).metadata || {}).marketRegime || 'unknown',
          capitalRegime: (strategy.currentRuntimeContext || {}).capitalRegime || 'NORMAL',
          balanceState: (strategy.currentRuntimeContext || {}).balanceState || null,
          forecastRegimeShiftRisk: ((strategy.currentRuntimeContext || {}).balanceState || {}).forecastRegimeShiftRisk || null,
          setupType: ((((strategy || {}).setts || {}).predict || {}).predictType) || 'unknown',
          mode: strategy.runtimeEngines && strategy.runtimeEngines.executionEngine && strategy.runtimeEngines.executionEngine.isPaperMode && strategy.runtimeEngines.executionEngine.isPaperMode()
            ? 'paper'
            : 'live',
        };

        const runtimeSharedSnapshot = ((strategy.currentRuntimeContext || {}).sharedSnapshot) || {};
        const confluenceInput = {
          context,
          sharedSnapshot: {
            ...runtimeSharedSnapshot,
            candles: runtimeSharedSnapshot.candles
              || (((strategy.currentRuntimeContext || {}).decisionContext || {}).metadata || {}).candles
              || [],
            derivatives: runtimeSharedSnapshot.derivatives
              || ((((strategy.currentRuntimeContext || {}).decisionContext || {}).metadata || {}).derivatives)
              || null,
          },
          regimeRouterDecision: (((strategy.currentRuntimeContext || {}).decisionContext || {}).metadata || {}).marketRegimeRouter || {},
          primarySignal: {
            layerName: 'legacyPrimarySignalAdapter',
            direction: legacySide,
            score: legacySide === 'none' ? 0 : 0.62,
            confidence: legacySide === 'none' ? 0.54 : 0.66,
            setupType: context.setupType,
            dataQualityState: 'cached',
          },
          confirmationSignals: [],
          htfBiasDecision: ((strategy.currentRuntimeContext || {}).htfBiasDecision) || {},
        };

        const confluenceResult = evaluateConfluenceEntry(confluenceInput, confluenceConfig);
        if (strategy.currentRuntimeContext) {
          strategy.currentRuntimeContext.confluenceEntry = confluenceResult;
          if (strategy.currentRuntimeContext.decisionContext && confluenceResult && confluenceResult.decisionContext) {
            strategy.currentRuntimeContext.decisionContext.metadata = {
              ...(strategy.currentRuntimeContext.decisionContext.metadata || {}),
              confluenceEntry: confluenceResult.decision,
              confluenceLayers: confluenceResult.layers,
            };
          }
        }

        if (strategy.emitStructuredEvent && confluenceResult.enabled) {
          const event = toConfluenceEntryEvent({ context, result: confluenceResult });
          strategy.emitStructuredEvent(event);
          emitObservabilityEvent(strategy, event);
        }

        if (strategy.log && typeof strategy.log === 'function') {
          const decision = (confluenceResult && confluenceResult.decision) || {};
          const zoneLayer = ((confluenceResult || {}).layers || {}).marketLevelLayer || {};
          const volumeLayer = ((confluenceResult || {}).layers || {}).volumeContextLayer || {};
          const bounceLayer = ((confluenceResult || {}).layers || {}).bounceDetectionLayer || {};
          const breakdownLayer = ((confluenceResult || {}).layers || {}).breakdownDetectionLayer || {};
          const derivativesLayer = ((confluenceResult || {}).layers || {}).derivativesContextLayer || {};
          const sessionLayer = ((confluenceResult || {}).layers || {}).sessionFilterLayer || {};
          const eventRiskLayer = ((confluenceResult || {}).layers || {}).eventRiskLayer || {};
          const confirmationLayer = ((confluenceResult || {}).layers || {}).confirmationLayer || {};
          const zoneReason = Array.isArray(zoneLayer.reasonCodes) ? zoneLayer.reasonCodes.join('|') : 'none';
          const volumeReason = Array.isArray(volumeLayer.reasonCodes) ? volumeLayer.reasonCodes.join('|') : 'none';
          const bounceReason = Array.isArray(bounceLayer.reasonCodes) ? bounceLayer.reasonCodes.join('|') : 'none';
          const breakdownReason = Array.isArray(breakdownLayer.reasonCodes) ? breakdownLayer.reasonCodes.join('|') : 'none';
          const sessionReason = Array.isArray(sessionLayer.reasonCodes) ? sessionLayer.reasonCodes.join('|') : 'none';
          const confirmationReason = Array.isArray(confirmationLayer.reasonCodes) ? confirmationLayer.reasonCodes.join('|') : 'none';
          const eventRiskReason = Array.isArray(eventRiskLayer.reasonCodes) ? eventRiskLayer.reasonCodes.join('|') : 'none';
          const eventRiskScore = Number.isFinite(Number((eventRiskLayer.explanation || {}).shockRiskScore))
            ? Number((eventRiskLayer.explanation || {}).shockRiskScore)
            : 0;
          const eventRiskState = (eventRiskLayer.explanation || {}).eventRiskState || 'unknown';
          const shockVetoTriggered = (eventRiskLayer.explanation || {}).shockVetoTriggered === true;
          const sessionTimeContextScore = Number.isFinite(Number((sessionLayer.explanation || {}).timeContextScore))
            ? Number((sessionLayer.explanation || {}).timeContextScore)
            : (Number.isFinite(Number(sessionLayer.score)) && Number.isFinite(Number(sessionLayer.softPenalty))
              ? Math.max(0, Math.min(1, Number(sessionLayer.score) - Number(sessionLayer.softPenalty)))
              : 0);
          const sessionRestriction = (sessionLayer.explanation || {}).timeBasedEntryRestriction === true
            || (Array.isArray(sessionLayer.vetoCandidates)
              ? sessionLayer.vetoCandidates.some((x) => x && (x.type === 'no_trade_regime' || x.type === 'capital_prohibition'))
              : false);
          strategy.log(`[confluenceEntry] cycle=${context.cycleId || 'n/a'} ticker=${ticker || 'n/a'} exchange=${context.exchange || 'n/a'} module=confluenceEntryEngine layer=entry.confluence regime=${context.marketRegime || 'unknown'} capital=${context.capitalRegime || 'NORMAL'} setup=${context.setupType || 'unknown'} score=${Number.isFinite(decision.score) ? decision.score : 0} confidence=${Number.isFinite(decision.confidence) ? decision.confidence : 0} veto=${decision.veto ? decision.veto.reason : 'none'} sizing=not_evaluated execution=${decision.entryAllowed ? 'forward_to_execution' : 'skip_entry'} fallback=${decision.entryAllowed ? 'none' : 'legacy_entry_flow'} final=${decision.finalDecision || 'LEGACY_FALLBACK'} mode=${confluenceResult.mode || 'legacy_fallback'} runtime=${confluenceResult.decisionContext && confluenceResult.decisionContext.metadata ? confluenceResult.decisionContext.metadata.runtimeMode || 'unknown' : 'unknown'} zonesScore=${Number.isFinite(zoneLayer.score) ? zoneLayer.score : 0} zonesConfidence=${Number.isFinite(zoneLayer.confidence) ? zoneLayer.confidence : 0} zonesDataQuality=${zoneLayer.dataQualityState || 'unknown'} zonesReason=${zoneReason} volumeScore=${Number.isFinite(volumeLayer.score) ? volumeLayer.score : 0} volumeConfidence=${Number.isFinite(volumeLayer.confidence) ? volumeLayer.confidence : 0} volumeDataQuality=${volumeLayer.dataQualityState || 'unknown'} volumeReason=${volumeReason} volumeRefresh=${(volumeLayer.explanation || {}).refreshMode || 'unknown'} bounceScore=${Number.isFinite(bounceLayer.score) ? bounceLayer.score : 0} bounceConfidence=${Number.isFinite(bounceLayer.confidence) ? bounceLayer.confidence : 0} bounceDataQuality=${bounceLayer.dataQualityState || 'unknown'} bounceReason=${bounceReason} bounceSetups=${Array.isArray((bounceLayer.explanation || {}).setupTypes) ? bounceLayer.explanation.setupTypes.join('|') : 'none'} bounceMode=${(bounceLayer.explanation || {}).microstructureMode || 'unknown'} breakdownScore=${Number.isFinite(breakdownLayer.score) ? breakdownLayer.score : 0} breakdownConfidence=${Number.isFinite(breakdownLayer.confidence) ? breakdownLayer.confidence : 0} breakdownDataQuality=${breakdownLayer.dataQualityState || 'unknown'} breakdownReason=${breakdownReason} breakdownSetups=${Array.isArray((breakdownLayer.explanation || {}).setupTypes) ? breakdownLayer.explanation.setupTypes.join('|') : 'none'} breakdownMode=${(breakdownLayer.explanation || {}).microstructureMode || 'unknown'} derivativesScore=${Number.isFinite(derivativesLayer.score) ? derivativesLayer.score : 0} derivativesConfidence=${Number.isFinite(derivativesLayer.confidence) ? derivativesLayer.confidence : 0} derivativesDataQuality=${derivativesLayer.dataQualityState || 'unknown'} derivativesReason=${Array.isArray(derivativesLayer.reasonCodes) ? derivativesLayer.reasonCodes.join('|') : 'none'} derivativesMode=${(derivativesLayer.explanation || {}).mode || 'unknown'} sessionScore=${Number.isFinite(sessionLayer.score) ? sessionLayer.score : 0} sessionTimeContextScore=${sessionTimeContextScore} sessionConfidence=${Number.isFinite(sessionLayer.confidence) ? sessionLayer.confidence : 0} sessionDataQuality=${sessionLayer.dataQualityState || 'unknown'} sessionState=${(sessionLayer.explanation || {}).sessionState || 'OFF_HOURS'} sessionRestriction=${sessionRestriction} sessionReason=${sessionReason} sessionMode=${(sessionLayer.explanation || {}).runtimeMode || 'unknown'} eventRiskScore=${eventRiskScore} eventRiskState=${eventRiskState} eventRiskVeto=${shockVetoTriggered} eventRiskDataQuality=${eventRiskLayer.dataQualityState || 'unknown'} eventRiskReason=${eventRiskReason} confirmationsScore=${Number.isFinite(confirmationLayer.score) ? confirmationLayer.score : 0} confirmationsConfidence=${Number.isFinite(confirmationLayer.confidence) ? confirmationLayer.confidence : 0} confirmationsDataQuality=${confirmationLayer.dataQualityState || 'unknown'} confirmationsReason=${confirmationReason} confirmationsMode=${(confirmationLayer.explanation || {}).confirmationEngineMode || 'legacy_fallback'} confirmationsCapitalInfluence=${(confirmationLayer.explanation || {}).capitalRegime || context.capitalRegime || 'NORMAL'} capitalInfluence=${(derivativesLayer.explanation || {}).capitalRegime || context.capitalRegime || 'NORMAL'}`);
        }

        if (confluenceResult && confluenceResult.enabled && confluenceResult.decision && confluenceResult.decision.entryAllowed) {
          return [legacySide, legacyWarning];
        }

        if (confluenceResult && confluenceResult.enabled && confluenceResult.decision && !confluenceResult.decision.entryAllowed) {
          return ['none', `Confluence blocked entry: ${(confluenceResult.decision.reasonCodes || []).join(',') || 'final_decision_no_entry'}`];
        }

        return legacyResult;
      },
    },
    riskEngine: {
      processExistingPosition: (ticker, freeBalance, activePosition, checkLeverage) => strategy.processExistingPositionLegacy(ticker, freeBalance, activePosition, checkLeverage),

      // Русский комментарий: риск-контур портфеля является primary current-state control layer выше entry/signal слоёв.
      evaluatePortfolioRiskContour: (input, runtimeConfig) => {
        const contourConfig = runtimeConfig && runtimeConfig.portfolioRiskContour ? runtimeConfig.portfolioRiskContour : {};
        const decision = evaluatePortfolioRiskContour(input, contourConfig);
        if (strategy.emitStructuredEvent) {
          const eventContext = input && input.context ? input.context : {};
          const contourEvent = toPortfolioRiskContourEvent({
            context: eventContext,
            decision,
          });
          strategy.emitStructuredEvent(contourEvent);
          emitObservabilityEvent(strategy, contourEvent);
          const forecastEvent = toCapitalStressForecastEvent({
            context: {
              ...eventContext,
              capitalRegime: decision && decision.balanceState ? decision.balanceState.capitalRegime : 'NORMAL',
            },
            decision: decision && decision.telemetry ? (decision.telemetry.forecast || {}) : {},
          });
          strategy.emitStructuredEvent(forecastEvent);
          emitObservabilityEvent(strategy, forecastEvent);
        }
        if (strategy.log && typeof strategy.log === 'function') {
          const ctx = input && input.context ? input.context : {};
          const limitsBreached = decision.telemetry && Array.isArray(decision.telemetry.limitsBreached)
            ? decision.telemetry.limitsBreached.join(',')
            : 'none';
          strategy.log(`[portfolioRiskContour] cycle=${ctx.cycleId || 'n/a'} ticker=${ctx.ticker || 'PORTFOLIO'} exchange=${ctx.exchange || 'n/a'} module=portfolioRiskContour layer=risk.portfolioContour regime=${ctx.marketRegime || 'unknown'} capital=${decision.balanceState ? decision.balanceState.capitalRegime : 'NORMAL'} forecastRisk=${ctx.forecastRegimeShiftRisk || 'none'} setup=${ctx.setupType || 'portfolio'} score=${Number.isFinite(ctx.score) ? ctx.score : 0} confidence=${Number.isFinite(ctx.confidence) ? ctx.confidence : 0} allowNewEntries=${decision.allowNewEntries} veto=${decision.hardVeto ? decision.hardVeto.reason : 'none'} sizing=${ctx.sizingDecision || 'not_evaluated'} execution=${decision.allowNewEntries ? 'allow_new_entries' : 'block_new_entries'} final=${decision.allowNewEntries ? 'allow' : 'block'} breaches=${limitsBreached}`);
          const forecastTelemetry = decision && decision.telemetry && decision.telemetry.forecast ? decision.telemetry.forecast : {};
          const forecastHints = forecastTelemetry.outputHints || {};
          strategy.log(`[capitalStressForecast] cycle=${ctx.cycleId || 'n/a'} ticker=${ctx.ticker || 'PORTFOLIO'} exchange=${ctx.exchange || 'n/a'} module=capitalStressForecastEngine layer=risk.portfolioForecast regime=${ctx.marketRegime || 'unknown'} capital=${decision.balanceState ? decision.balanceState.capitalRegime : 'NORMAL'} forecastRisk=${decision.balanceState ? decision.balanceState.forecastRegimeShiftRisk || 'none' : 'none'} setup=${ctx.setupType || 'portfolio'} score=${Number.isFinite(forecastTelemetry.score) ? forecastTelemetry.score : 0} confidence=${Number.isFinite(forecastTelemetry.confidence) ? forecastTelemetry.confidence : 0} veto=${decision.hardVeto ? decision.hardVeto.reason : 'none'} sizing=${forecastHints.sizingHints ? forecastHints.sizingHints.reason : 'not_evaluated'} execution=hints_only final=${decision.allowNewEntries ? 'allow' : 'block'}`);
        }
        return decision;
      },
      // Русский комментарий: forcedLossExit живёт после server SL и до averaging; действие отдаётся только через ownership path.
      evaluateForcedLossExit: (input, runtimeConfig) => {
        const decision = evaluateForcedLossExit(input, runtimeConfig && runtimeConfig.forcedLossExit ? runtimeConfig.forcedLossExit : {});
        if (strategy.emitStructuredEvent) {
          const forcedLossEvent = toForcedLossExitEvent({
            context: input && input.context ? input.context : {},
            decision,
          });
          strategy.emitStructuredEvent(forcedLossEvent);
          emitObservabilityEvent(strategy, forcedLossEvent);
        }
        if (strategy.log && typeof strategy.log === 'function') {
          const ctx = input && input.context ? input.context : {};
          const early = decision && decision.earlyInvalidation ? decision.earlyInvalidation : {};
          const diagnostics = early.diagnostics || {};
          strategy.log(`[forcedLossExit] cycle=${ctx.cycleId || 'n/a'} ticker=${ctx.ticker || 'n/a'} exchange=${ctx.exchange || 'n/a'} module=forcedLossExit layer=risk.positionProtection regime=${ctx.marketRegime || 'unknown'} capital=${ctx.capitalRegime || 'unknown'} positionCapabilityState=${ctx.positionCapabilityState || 'unknown'} stage=${decision.triggerStage || 'none'} action=${decision.actionMode} triggered=${decision.triggered} final=${decision.triggered ? decision.actionMode : 'no_action'} earlyReason=${early.triggered ? (early.reasons || []).join(',') || 'none' : 'none'} reasons=${(decision.reasons || []).join(',') || 'none'} timeSinceEntryMin=${Number.isFinite(diagnostics.minutesSinceEntry) ? diagnostics.minutesSinceEntry.toFixed(2) : 'n/a'} deviationPct=${Number.isFinite(diagnostics.entryDeviationPercent) ? diagnostics.entryDeviationPercent.toFixed(4) : 'n/a'} adverseZoneMin=${Number.isFinite(diagnostics.timeUnderEntryWithoutRecoveryMinutes) ? diagnostics.timeUnderEntryWithoutRecoveryMinutes.toFixed(2) : 'n/a'} adverseTrendConfirmed=${diagnostics.adverseTrendConfirmed === true} scenarioBroken=${diagnostics.scenarioBroken === true} protectiveActionOwner=${decision.protectiveActionOwner || 'n/a'} protectiveActionToken=${decision.protectiveActionToken || 'n/a'} duplicateClosePrevented=${decision.duplicateClosePrevented === true} closeSource=${decision.closeSource || 'n/a'} ownershipAction=${decision.ownershipAction ? decision.ownershipAction.type : 'none'}`);
        }
        return decision;
      },
    },
    positionEngine: {
      getActiveTickers: () => strategy.getActiveTickersLegacy(),
      processExistingPosition: (ticker, freeBalance, activePosition, checkLeverage) => strategy.processExistingPositionLegacy(ticker, freeBalance, activePosition, checkLeverage),

      // Русский комментарий: риск-контур портфеля является primary current-state control layer выше entry/signal слоёв.
      evaluatePortfolioRiskContour: (input, runtimeConfig) => {
        const contourConfig = runtimeConfig && runtimeConfig.portfolioRiskContour ? runtimeConfig.portfolioRiskContour : {};
        const decision = evaluatePortfolioRiskContour(input, contourConfig);
        if (strategy.emitStructuredEvent) {
          const eventContext = input && input.context ? input.context : {};
          const contourEvent = toPortfolioRiskContourEvent({
            context: eventContext,
            decision,
          });
          strategy.emitStructuredEvent(contourEvent);
          emitObservabilityEvent(strategy, contourEvent);
          const forecastEvent = toCapitalStressForecastEvent({
            context: {
              ...eventContext,
              capitalRegime: decision && decision.balanceState ? decision.balanceState.capitalRegime : 'NORMAL',
            },
            decision: decision && decision.telemetry ? (decision.telemetry.forecast || {}) : {},
          });
          strategy.emitStructuredEvent(forecastEvent);
          emitObservabilityEvent(strategy, forecastEvent);
        }
        if (strategy.log && typeof strategy.log === 'function') {
          const ctx = input && input.context ? input.context : {};
          const limitsBreached = decision.telemetry && Array.isArray(decision.telemetry.limitsBreached)
            ? decision.telemetry.limitsBreached.join(',')
            : 'none';
          strategy.log(`[portfolioRiskContour] cycle=${ctx.cycleId || 'n/a'} ticker=${ctx.ticker || 'PORTFOLIO'} exchange=${ctx.exchange || 'n/a'} module=portfolioRiskContour layer=risk.portfolioContour regime=${ctx.marketRegime || 'unknown'} capital=${decision.balanceState ? decision.balanceState.capitalRegime : 'NORMAL'} forecastRisk=${ctx.forecastRegimeShiftRisk || 'none'} setup=${ctx.setupType || 'portfolio'} score=${Number.isFinite(ctx.score) ? ctx.score : 0} confidence=${Number.isFinite(ctx.confidence) ? ctx.confidence : 0} allowNewEntries=${decision.allowNewEntries} veto=${decision.hardVeto ? decision.hardVeto.reason : 'none'} sizing=${ctx.sizingDecision || 'not_evaluated'} execution=${decision.allowNewEntries ? 'allow_new_entries' : 'block_new_entries'} final=${decision.allowNewEntries ? 'allow' : 'block'} breaches=${limitsBreached}`);
          const forecastTelemetry = decision && decision.telemetry && decision.telemetry.forecast ? decision.telemetry.forecast : {};
          const forecastHints = forecastTelemetry.outputHints || {};
          strategy.log(`[capitalStressForecast] cycle=${ctx.cycleId || 'n/a'} ticker=${ctx.ticker || 'PORTFOLIO'} exchange=${ctx.exchange || 'n/a'} module=capitalStressForecastEngine layer=risk.portfolioForecast regime=${ctx.marketRegime || 'unknown'} capital=${decision.balanceState ? decision.balanceState.capitalRegime : 'NORMAL'} forecastRisk=${decision.balanceState ? decision.balanceState.forecastRegimeShiftRisk || 'none' : 'none'} setup=${ctx.setupType || 'portfolio'} score=${Number.isFinite(forecastTelemetry.score) ? forecastTelemetry.score : 0} confidence=${Number.isFinite(forecastTelemetry.confidence) ? forecastTelemetry.confidence : 0} veto=${decision.hardVeto ? decision.hardVeto.reason : 'none'} sizing=${forecastHints.sizingHints ? forecastHints.sizingHints.reason : 'not_evaluated'} execution=hints_only final=${decision.allowNewEntries ? 'allow' : 'block'}`);
        }
        return decision;
      },
      averagePosition: (ticker, activePosition, amountUsdt) => strategy.averagePositionLegacy(ticker, activePosition, amountUsdt),
      closePosition: (ticker, activePosition, profit) => strategy.closePositionLegacy(ticker, activePosition, profit),
    },
    executionEngine: {
      // Русский комментарий: execution ownership path общий; в paper/shadow режиме меняется только исполнение, а не decision/risk flow.
      openNewPosition: (ticker) => paperExecutor.openNewPosition(ticker, (argTicker) => strategy.openNewPositionLegacy(argTicker)),
      averagePosition: (ticker, activePosition, amountUsdt) => paperExecutor.averagePosition(ticker, activePosition, amountUsdt, (argTicker, argPosition, argAmount) => strategy.averagePositionLegacy(argTicker, argPosition, argAmount)),
      closePosition: (ticker, activePosition, profit) => paperExecutor.closePosition(ticker, activePosition, profit, (argTicker, argPosition, argProfit) => strategy.closePositionLegacy(argTicker, argPosition, argProfit)),
      getPaperReport: () => paperExecutor.getReport(),
      isPaperMode: () => paperExecutor.isEnabled(),
    },
    htfBiasEngine: {
      // Русский комментарий: слой HTF-bias даёт только контекст до finalEntryDecision и не может единолично разрешать вход.
      evaluate: (input, runtimeConfig, runtime = {}) => {
        const htfConfig = runtimeConfig && runtimeConfig.higherTimeframeBiasEngine
          ? runtimeConfig.higherTimeframeBiasEngine
          : {};
        const decision = evaluateHigherTimeframeBiasWithCache(input, htfConfig, runtime);

        if (strategy.emitStructuredEvent) {
          const event = toHigherTimeframeBiasEvent({
            context: input && input.context ? input.context : {},
            decision,
          });
          strategy.emitStructuredEvent(event);
          emitObservabilityEvent(strategy, event);
        }

        if (strategy.log && typeof strategy.log === 'function') {
          const ctx = input && input.context ? input.context : {};
          strategy.log(`[higherTimeframeBias] cycle=${ctx.cycleId || 'n/a'} ticker=${ctx.ticker || 'n/a'} exchange=${ctx.exchange || 'n/a'} module=higherTimeframeBiasEngine layer=signal.htfStructure regime=${ctx.marketRegime || 'unknown'} capital=${ctx.capitalRegime || 'NORMAL'} setup=${ctx.setupType || 'unknown_setup'} score=${Number.isFinite(decision.score) ? decision.score : 0} confidence=${Number.isFinite(decision.confidence) ? decision.confidence : 0} veto=none sizing=${ctx.sizingDecision || 'not_evaluated'} execution=context_only fallback=${decision.mode === 'degraded_mode' ? 'legacy_entry_flow' : 'none'} final=${decision.htfBias || 'neutral'} structure=${decision.marketStructureState || 'unknown'} trendAlignment=${Number.isFinite(decision.trendAlignmentScore) ? decision.trendAlignmentScore : 0} dataQuality=${decision.dataQualityState || 'degraded'} mode=${decision.mode || 'unknown'}`);
        }

        return decision;
      },

      // Русский комментарий: интеграция через soft penalty/boost в confluence/final decision, без hard-veto и без bypass risk-слоёв.
      enrichEntryDecision: (entryDecision, biasDecision, runtimeConfig) => {
        const htfConfig = runtimeConfig && runtimeConfig.higherTimeframeBiasEngine
          ? runtimeConfig.higherTimeframeBiasEngine
          : {};
        return applyHtfBiasToEntryDecision({ entryDecision }, biasDecision, htfConfig);
      },
    },
    analyticsEngine: {
      emitStructuredEvent: (...args) => strategy.emitStructuredEvent(...args),
      emitCycleSummary: () => strategy.emitCycleSummary(),
      // Русский комментарий: observability-слой инициализируется отдельно и работает как неблокирующий слушатель событий.
      initObservabilityLayer: (runtimeConfig) => {
        const observabilityConfig = runtimeConfig && runtimeConfig.observabilityReporting ? runtimeConfig.observabilityReporting : {};
        strategy.observabilityLayer = createObservabilityLayer(observabilityConfig);
        return strategy.observabilityLayer;
      },
      // Русский комментарий: dataset-builder включается как пассивный analytics-слой после decision/risk и не меняет execution decisions.
      initMlDatasetBuilder: (runtimeConfig) => {
        const datasetConfig = runtimeConfig && runtimeConfig.mlDatasetBuilder ? runtimeConfig.mlDatasetBuilder : {};
        strategy.mlDatasetBuilder = createMlDatasetBuilder({ mlDatasetBuilder: datasetConfig }, {
          log: (message) => {
            if (typeof strategy.log === 'function') strategy.log(message);
          },
          emitStructuredEvent: (event) => {
            if (typeof strategy.emitStructuredEvent === 'function') strategy.emitStructuredEvent(event);
          },
          ingestObservabilityEvent: (event) => {
            emitObservabilityEvent(strategy, event);
          },
        });
        return strategy.mlDatasetBuilder;
      },
      getMlInferenceLayerStatus: () => (mlInferenceLayer && typeof mlInferenceLayer.getStatus === 'function'
        ? mlInferenceLayer.getStatus()
        : { enabled: false }),
      ingestObservabilityEvent: (event) => {
        emitObservabilityEvent(strategy, event);
      },
      getObservabilityReports: () => (strategy.observabilityLayer && strategy.observabilityLayer.getReports
        ? strategy.observabilityLayer.getReports()
        : {}),
      getObservabilityAuditTrail: (filters) => (strategy.observabilityLayer && strategy.observabilityLayer.getAuditTrail
        ? strategy.observabilityLayer.getAuditTrail(filters)
        : []),

      getMlDatasetStatus: () => (strategy.mlDatasetBuilder && strategy.mlDatasetBuilder.getStatus
        ? strategy.mlDatasetBuilder.getStatus()
        : { enabled: false }),
      captureMlDatasetEntry: (entry) => (strategy.mlDatasetBuilder && strategy.mlDatasetBuilder.capturePotentialEntry
        ? strategy.mlDatasetBuilder.capturePotentialEntry(entry)
        : null),
      resolveMlDatasetLabel: (label) => (strategy.mlDatasetBuilder && strategy.mlDatasetBuilder.resolveLabel
        ? strategy.mlDatasetBuilder.resolveLabel(label)
        : null),
      flushMlDataset: () => {
        if (strategy.mlDatasetBuilder && strategy.mlDatasetBuilder.flush) strategy.mlDatasetBuilder.flush();
      },
    },
  };
}

module.exports = { createEngines };
