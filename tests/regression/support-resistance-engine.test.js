const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateSupportResistance,
  normalizeSupportResistanceConfig,
} = require('../../dist/runtime/engines/supportResistanceEngine');

function makeCandle(ts, open, high, low, close) {
  return { timestamp: ts, open, high, low, close };
}

test('supportResistanceEngine: возвращает fallback при выключенном config', () => {
  const result = evaluateSupportResistance({ sharedSnapshot: { candles: [] } }, { enabled: false });
  assert.equal(result.layerName, 'supportResistanceEngine');
  assert.equal(result.dataQualityState, 'fallback');
  assert.ok((result.reasonCodes || []).includes('feature_disabled'));
});

test('supportResistanceEngine: строит зоны и контекст breakout/retest в совместимом контракте', () => {
  const candles = [
    makeCandle(1, 100, 102, 98, 101),
    makeCandle(2, 101, 104, 99, 103),
    makeCandle(3, 103, 105, 100, 101),
    makeCandle(4, 101, 103, 97, 99),
    makeCandle(5, 99, 101, 95, 100),
    makeCandle(6, 100, 106, 99, 105),
    makeCandle(7, 105, 108, 103, 107),
    makeCandle(8, 107, 109, 104, 105),
    makeCandle(9, 105, 106, 100, 101),
    makeCandle(10, 101, 103, 98, 102),
    makeCandle(11, 102, 107, 101, 106),
    makeCandle(12, 106, 110, 105, 109),
  ];

  const config = normalizeSupportResistanceConfig({
    enabled: true,
    lookbackBars: 12,
    rangeLookbackBars: 8,
    swingWindow: 1,
    minSwingPoints: 2,
    zoneWidthPercent: 0.5,
  });

  const result = evaluateSupportResistance({
    context: { marketRegime: 'trend', capitalRegime: 'NORMAL' },
    sharedSnapshot: { candles },
  }, config);

  assert.equal(result.layerName, 'supportResistanceEngine');
  assert.ok(['long', 'short', 'none'].includes(result.direction));
  assert.ok(Number.isFinite(result.score));
  assert.ok(result.explanation && result.explanation.zones);
  assert.ok(result.explanation.range && Number.isFinite(result.explanation.range.rangeHigh));
});
