'use strict';

// Русский комментарий: провайдеры инкапсулируют доступ к данным биржи/аккаунта без изменения торговой логики.
function createProviders(connector, utils) {
  return {
    marketDataProvider: {
      getTickerInfo: (ticker) => connector.getTickerInfo(ticker),
      getMarkPrice: (ticker) => connector.getMarkPrice(ticker),
      getKLine: (ticker, interval) => connector.getKLine(ticker, interval),
      getSymbolsByLeverage: (leverage) => connector.getSymbolsByLeverage(leverage),
      getMaxLeverageForTicker: (ticker) => connector.getMaxLeverageForTicker(ticker),
      getLeverage: (ticker) => connector.getLeverage(ticker),
      getMarginMode: (ticker) => connector.getMarginMode(ticker),
    },
    accountDataProvider: {
      getBalance: () => connector.getBalance(),
    },
    positionProvider: {
      getFuturesActivePositions: () => connector.getFuturesActivePositions(),
      getFuturesPositionsForTicker: (ticker) => connector.getFuturesPositionsForTicker(ticker),
      filterActive: (positions) => (Array.isArray(positions) ? positions : []).filter((x) => utils.positionIsActive(x)),
    },
    exchangeCapabilitiesProvider: {
      updateTickerLeverage: (ticker, leverage) => connector.updateTickerLeverage(ticker, leverage),
      setMarginMode: (ticker, marginMode, leverage) => connector.setMarginMode(ticker, marginMode, leverage),
    },
  };
}

module.exports = { createProviders };
