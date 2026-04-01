'use strict';

const { evaluateForcedLossExit, toForcedLossExitEvent } = require('../risk/forcedLossExit');

// Русский комментарий: движки пока выступают как адаптеры к существующим методам стратегии (fallback без изменения поведения).
function createEngines(strategy) {
  return {
    signalEngine: {
      predictPriceDirection: (ticker) => strategy.predictPriceDirectionLegacy(ticker),
    },
    riskEngine: {
      processExistingPosition: (ticker, freeBalance, activePosition, checkLeverage) => strategy.processExistingPositionLegacy(ticker, freeBalance, activePosition, checkLeverage),
      // Русский комментарий: forcedLossExit живёт после server SL и до averaging; действие отдаётся только через ownership path.
      evaluateForcedLossExit: (input, runtimeConfig) => {
        const decision = evaluateForcedLossExit(input, runtimeConfig && runtimeConfig.forcedLossExit ? runtimeConfig.forcedLossExit : {});
        if (strategy.emitStructuredEvent) {
          strategy.emitStructuredEvent(toForcedLossExitEvent({
            context: input && input.context ? input.context : {},
            decision,
          }));
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
    },
  };
}

module.exports = { createEngines };
