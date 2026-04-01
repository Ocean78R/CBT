'use strict';

const { evaluateForcedLossExit, toForcedLossExitEvent } = require('../risk/forcedLossExit');
const { evaluatePortfolioRiskContour, toPortfolioRiskContourEvent } = require('../risk/portfolioRiskContour');
const { toCapitalStressForecastEvent } = require('../risk/capitalStressForecastEngine');
const { createObservabilityLayer } = require('../observability/reportingLayer');

function emitObservabilityEvent(strategy, event) {
  const layer = strategy && strategy.observabilityLayer;
  if (layer && typeof layer.ingestEvent === 'function') {
    layer.ingestEvent(event);
  }
}

// Русский комментарий: движки пока выступают как адаптеры к существующим методам стратегии (fallback без изменения поведения).
function createEngines(strategy) {
  return {
    signalEngine: {
      predictPriceDirection: (ticker) => strategy.predictPriceDirectionLegacy(ticker),
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
          strategy.log(`[forcedLossExit] cycle=${ctx.cycleId || 'n/a'} ticker=${ctx.ticker || 'n/a'} exchange=${ctx.exchange || 'n/a'} regime=${ctx.marketRegime || 'unknown'} capital=${ctx.capitalRegime || 'unknown'} action=${decision.actionMode} triggered=${decision.triggered} reasons=${(decision.reasons || []).join(',') || 'none'}`);
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
      openNewPosition: (ticker) => strategy.openNewPositionLegacy(ticker),
      averagePosition: (ticker, activePosition, amountUsdt) => strategy.averagePositionLegacy(ticker, activePosition, amountUsdt),
      closePosition: (ticker, activePosition, profit) => strategy.closePositionLegacy(ticker, activePosition, profit),
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
      ingestObservabilityEvent: (event) => {
        emitObservabilityEvent(strategy, event);
      },
      getObservabilityReports: () => (strategy.observabilityLayer && strategy.observabilityLayer.getReports
        ? strategy.observabilityLayer.getReports()
        : {}),
      getObservabilityAuditTrail: (filters) => (strategy.observabilityLayer && strategy.observabilityLayer.getAuditTrail
        ? strategy.observabilityLayer.getAuditTrail(filters)
        : []),
    },
  };
}

module.exports = { createEngines };
