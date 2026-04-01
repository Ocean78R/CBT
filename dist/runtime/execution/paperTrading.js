'use strict';

function normalizePaperTradingConfig(config = {}) {
  const paperTrading = config.paperTrading || {};
  return {
    enabled: !!paperTrading.enabled,
    mode: paperTrading.mode === 'shadow' ? 'shadow' : 'paper',
    initialBalance: Number.isFinite(Number(paperTrading.initialBalance)) ? Number(paperTrading.initialBalance) : 10000,
    slippageBps: Number.isFinite(Number(paperTrading.slippageBps)) ? Number(paperTrading.slippageBps) : 0,
    feeBps: Number.isFinite(Number(paperTrading.feeBps)) ? Number(paperTrading.feeBps) : 0,
  };
}

function createPaperTradingExecutor(strategy, runtimeConfig = {}) {
  const config = normalizePaperTradingConfig(runtimeConfig);
  const state = {
    virtualBalance: config.initialBalance,
    positions: new Map(),
    metrics: {
      virtualEntries: 0,
      virtualAverages: 0,
      virtualCloses: 0,
      realizedPnl: 0,
    },
  };

  function emitPaperEvent(ticker, phase, details = {}) {
    if (typeof strategy.emitStructuredEvent !== 'function') return;

    const runtimeContext = strategy.currentRuntimeContext || {};
    strategy.emitStructuredEvent('paper_execution', phase, ticker, details.decision || 'approved', details.reason || 'paper_execution_event', {
      executionAction: details.executionAction || 'paper_simulation',
      fallbackAction: details.fallbackAction || 'real_execution_disabled',
      capitalRegime: runtimeContext.capitalRegime || 'NORMAL',
      balanceState: runtimeContext.balanceState || null,
      forecastCapitalStress: runtimeContext.forecastRegimeShiftRisk || null,
      forecastRestrictionHints: runtimeContext.forecastRestrictionHints || [],
      sizingDecision: details.sizingDecision || 'not_evaluated',
      mode: config.mode,
      virtualBalance: state.virtualBalance,
      ...details.payload,
    }, {
      ticker,
      module: 'paperExecutionEngine',
      layer: 'execution.paperShadow',
      mode: 'paper',
    });
  }

  // Русский комментарий: paper/shadow слой живёт на месте execution ownership path и не пересчитывает signal/risk pipeline.
  async function openNewPosition(ticker, liveExecutor) {
    if (!config.enabled) return liveExecutor(ticker);

    const entryPrice = typeof strategy.getCurrentMarkPriceForSimulation === 'function'
      ? await strategy.getCurrentMarkPriceForSimulation(ticker)
      : null;
    const positionId = `paper:${ticker}:${Date.now()}`;
    state.positions.set(ticker, {
      positionId,
      ticker,
      side: 'unknown',
      openedAt: Date.now(),
      entryPrice,
      averages: 0,
    });
    state.metrics.virtualEntries += 1;

    emitPaperEvent(ticker, 'virtual_entry_opened', {
      executionAction: 'paper_open_position',
      reason: 'paper_mode_no_real_order',
      payload: { positionId, entryPrice },
    });

    if (typeof strategy.log === 'function') {
      const rc = strategy.currentRuntimeContext || {};
      strategy.log(`[paperExecution] cycle=${rc.cycleId || 'n/a'} ticker=${ticker} exchange=${rc.exchange || 'n/a'} module=paperExecutionEngine layer=execution.paperShadow regime=${rc.marketRegime || 'unknown'} capital=${rc.capitalRegime || 'NORMAL'} setup=${rc.setupType || 'unknown'} score=${Number.isFinite(rc.score) ? rc.score : 0} confidence=${Number.isFinite(rc.confidence) ? rc.confidence : 0} veto=${rc.vetoReason || 'none'} sizing=${rc.sizingDecision || 'not_evaluated'} execution=paper_open_position fallback=no_real_order final=paper_open`);
    }

    return { simulated: true, mode: config.mode, positionId, entryPrice };
  }

  async function averagePosition(ticker, activePosition, amountUsdt, liveExecutor) {
    if (!config.enabled) return liveExecutor(ticker, activePosition, amountUsdt);
    const existing = state.positions.get(ticker) || {
      positionId: `paper:${ticker}:${Date.now()}`,
      ticker,
      openedAt: Date.now(),
      entryPrice: null,
      averages: 0,
    };
    existing.averages += 1;
    existing.lastAverageAmountUsdt = amountUsdt;
    state.positions.set(ticker, existing);
    state.metrics.virtualAverages += 1;

    emitPaperEvent(ticker, 'virtual_position_averaged', {
      executionAction: 'paper_average_position',
      reason: 'paper_mode_no_real_order',
      sizingDecision: Number.isFinite(amountUsdt) ? `virtual_average:${amountUsdt}` : 'virtual_average:unknown',
      payload: { positionId: existing.positionId, amountUsdt, averages: existing.averages },
    });

    return { simulated: true, mode: config.mode, positionId: existing.positionId, amountUsdt };
  }

  async function closePosition(ticker, activePosition, profit, liveExecutor) {
    if (!config.enabled) return liveExecutor(ticker, activePosition, profit);
    const existing = state.positions.get(ticker);
    if (existing) state.positions.delete(ticker);
    const realizedPnl = Number.isFinite(profit) ? Number(profit) : 0;
    state.virtualBalance += realizedPnl;
    state.metrics.realizedPnl += realizedPnl;
    state.metrics.virtualCloses += 1;

    emitPaperEvent(ticker, 'virtual_position_closed', {
      executionAction: 'paper_close_position',
      reason: 'paper_mode_no_real_order',
      payload: {
        positionId: existing ? existing.positionId : null,
        realizedPnl,
        virtualBalance: state.virtualBalance,
      },
    });

    return {
      simulated: true,
      mode: config.mode,
      positionId: existing ? existing.positionId : null,
      realizedPnl,
      virtualBalance: state.virtualBalance,
    };
  }

  function getReport() {
    return {
      mode: config.mode,
      enabled: config.enabled,
      virtualBalance: state.virtualBalance,
      openVirtualPositions: state.positions.size,
      metrics: { ...state.metrics },
    };
  }

  return {
    isEnabled: () => config.enabled,
    mode: config.mode,
    openNewPosition,
    averagePosition,
    closePosition,
    getReport,
  };
}

module.exports = {
  normalizePaperTradingConfig,
  createPaperTradingExecutor,
};
