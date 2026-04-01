const test = require('node:test');
const assert = require('node:assert/strict');

const { createPaperTradingExecutor } = require('../../dist/runtime/execution/paperTrading');
const { createObservabilityLayer } = require('../../dist/runtime/observability/reportingLayer');

test('paper executor симулирует open/average/close без реального execution и сохраняет метрики', async () => {
  const events = [];
  const strategy = {
    config: { paperTrading: { enabled: true, mode: 'shadow', initialBalance: 1000 } },
    currentRuntimeContext: {
      cycleId: 'cycle-1',
      exchange: 'bingx',
      marketRegime: 'range',
      capitalRegime: 'DEFENSIVE',
      forecastRegimeShiftRisk: 'high',
      setupType: 'breakout',
      score: 0.66,
      confidence: 0.55,
      sizingDecision: 'scaled_0.5',
    },
    emitStructuredEvent: (...args) => events.push(args),
    log: () => {},
  };

  const executor = createPaperTradingExecutor(strategy, strategy.config);

  const openResult = await executor.openNewPosition('BTC-USDT', async () => ({ real: true }));
  await executor.averagePosition('BTC-USDT', { side: 'LONG' }, 125, async () => ({ real: true }));
  const closeResult = await executor.closePosition('BTC-USDT', { side: 'LONG' }, 22.5, async () => ({ real: true }));

  assert.equal(openResult.simulated, true);
  assert.equal(closeResult.virtualBalance, 1022.5);

  const report = executor.getReport();
  assert.equal(report.enabled, true);
  assert.equal(report.mode, 'shadow');
  assert.equal(report.metrics.virtualEntries, 1);
  assert.equal(report.metrics.virtualAverages, 1);
  assert.equal(report.metrics.virtualCloses, 1);
  assert.equal(report.metrics.realizedPnl, 22.5);

  assert.equal(events.length, 3);
  assert.equal(events[0][0], 'paper_execution');
  assert.equal(events[0][1], 'virtual_entry_opened');
});

test('observability учитывает includePaperMode/includeLiveMode фильтры', () => {
  const layer = createObservabilityLayer({
    enabled: true,
    includePaperMode: false,
    includeLiveMode: true,
    sampling: { decisionEventsRate: 1 },
    storage: { enabled: false },
  });

  const paper = layer.ingestEvent({
    eventType: 'execution_event',
    mode: 'paper',
    cycleId: 'c-paper',
    ticker: 'BTC-USDT',
    module: 'paperExecutionEngine',
    finalDecision: 'allow',
  });
  const live = layer.ingestEvent({
    eventType: 'execution_event',
    mode: 'live',
    cycleId: 'c-live',
    ticker: 'ETH-USDT',
    module: 'executionManager',
    finalDecision: 'allow',
  });

  assert.equal(paper.accepted, false);
  assert.equal(live.accepted, true);
});
