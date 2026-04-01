'use strict';

// Русский комментарий: движки пока выступают как адаптеры к существующим методам стратегии (fallback без изменения поведения).
function createEngines(strategy) {
  return {
    signalEngine: {
      predictPriceDirection: (ticker) => strategy.predictPriceDirectionLegacy(ticker),
    },
    riskEngine: {
      processExistingPosition: (ticker, freeBalance, activePosition, checkLeverage) => strategy.processExistingPositionLegacy(ticker, freeBalance, activePosition, checkLeverage),
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
