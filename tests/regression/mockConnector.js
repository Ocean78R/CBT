// Русский комментарий: детерминированный мок коннектора для регрессионных сценариев торгового цикла.
class MockConnector {
  constructor(types, options = {}) {
    this.types = types;
    this.options = options;
    this.orders = [];
    this.positionsByTicker = new Map(Object.entries(options.positionsByTicker || {}));
    this.leverageByTicker = new Map(Object.entries(options.leverageByTicker || {}));
  }

  connect() {
    return true;
  }

  async getTickerInfo(ticker) {
    if (this.options.missingTickers && this.options.missingTickers.includes(ticker)) {
      return null;
    }
    return { symbol: ticker };
  }

  async getBalance() {
    return {
      availableMargin: this.options.availableMargin ?? 10_000,
      usedMargin: this.options.usedMargin ?? 0,
    };
  }

  async getMaxLeverageForTicker() {
    return this.options.maxLeverage ?? 50;
  }

  async getLeverage(ticker) {
    return this.leverageByTicker.get(ticker) ?? (this.options.defaultLeverage ?? 25);
  }

  async getMarginMode() {
    return this.types.MarginType.cross;
  }

  async setMarginMode() {
    return true;
  }

  async updateTickerLeverage(ticker, leverage) {
    this.leverageByTicker.set(ticker, leverage);
    return true;
  }

  async getFuturesPositionsForTicker(ticker) {
    return this.positionsByTicker.get(ticker) || [];
  }

  async getFuturesActivePositions() {
    const all = [];
    for (const positions of this.positionsByTicker.values()) {
      all.push(...positions);
    }
    return all.filter((x) => x && x.entryPrice && x.initialMargin);
  }

  async getMarkPrice() {
    return this.options.markPrice ?? 100;
  }

  async getKLine(ticker, interval) {
    const byInterval = (this.options.klineByInterval || {})[interval];
    if (byInterval) return byInterval;
    return [
      { openPrice: 100, closePrice: 102, lowPrice: 99, highPrice: 103, deltaOpenClose: 2, percentsLowHigh: 4 },
      { openPrice: 102, closePrice: 104, lowPrice: 101, highPrice: 105, deltaOpenClose: 2, percentsLowHigh: 4 },
      { openPrice: 104, closePrice: 106, lowPrice: 103, highPrice: 107, deltaOpenClose: 2, percentsLowHigh: 4 },
      { openPrice: 106, closePrice: 108, lowPrice: 105, highPrice: 109, deltaOpenClose: 2, percentsLowHigh: 4 },
    ];
  }

  async openPositionWithMarketOrder(ticker, side, amount, leverage) {
    this.orders.push({ type: 'open', ticker, side, amount, leverage });
    return { orderId: `open-${this.orders.length}` };
  }

  async closePositionWithMarketOrder(ticker, position) {
    this.orders.push({ type: 'close', ticker, side: position.side, amount: Math.abs(position.contracts || 1) });
    return { orderId: `close-${this.orders.length}` };
  }
}

module.exports = { MockConnector };
