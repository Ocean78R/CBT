const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateSessionFilter, normalizeSessionFilterConfig } = require('../../dist/runtime/engines/sessionFilterEngine');
const { evaluateConfluenceEntry, normalizeConfluenceEntryConfig } = require('../../dist/runtime/engines/confluenceEntryEngine');

test('sessionFilterEngine: формирует no-trade restricted окно и совместимый контракт слоя', () => {
  const config = normalizeSessionFilterConfig({
    enabled: true,
    timezone: 'UTC',
    noTradeOnRestrictedWindows: true,
    restrictedWindows: [
      { startHour: 23, endHour: 24, reasonCode: 'restricted_manual_window' },
    ],
    sessions: [
      { sessionState: 'NIGHT', startHour: 22, endHour: 24, scoreMultiplier: 0.9, confidence: 0.55, reasonCode: 'session_night' },
    ],
  });

  const result = evaluateSessionFilter({
    context: {
      cycleId: 'c-time-1',
      cycleIndex: 9,
      ticker: 'BTC-USDT',
      capitalRegime: 'NORMAL',
      timestampMs: Date.parse('2026-04-03T23:10:00.000Z'),
    },
    featureStoreContext: {},
  }, config);

  assert.equal(result.layerName, 'sessionFilterLayer');
  assert.equal(result.sessionState, 'NIGHT');
  assert.equal(result.timeBasedEntryRestriction, true);
  assert.ok(Array.isArray(result.vetoCandidates) && result.vetoCandidates.length > 0);
  assert.ok(['full', 'degraded'].includes(result.dataQualityState));
  assert.ok(Array.isArray(result.reasonCodes) && result.reasonCodes.length > 0);
});

test('confluenceEntryEngine: sessionFilterLayer влияет на вход только как context/permission слой', () => {
  const config = normalizeConfluenceEntryConfig({
    enabled: true,
    mode: 'confluence',
    blockWeights: {
      entryPermission: 0.22,
      marketContext: 0.18,
      primarySignal: 0.2,
      confirmation: 0.14,
      marketLevel: 0.08,
      volumeContext: 0.06,
      bounceDetection: 0.04,
      breakdownDetection: 0.04,
      derivativesContext: 0.02,
      sessionFilter: 0.02,
    },
    thresholds: {
      fullEntryScore: 0.6,
      weakEntryScore: 0.45,
      minConfidence: 0.3,
    },
    sessionFilter: {
      enabled: true,
      timezone: 'UTC',
      noTradeOnRestrictedWindows: true,
      restrictedWindows: [
        { startHour: 23, endHour: 24, reasonCode: 'restricted_manual_window' },
      ],
      sessions: [
        { sessionState: 'NIGHT', startHour: 22, endHour: 24, scoreMultiplier: 0.92, confidence: 0.58, reasonCode: 'session_night' },
      ],
    },
  });

  const result = evaluateConfluenceEntry({
    context: {
      cycleId: 'c-time-2',
      cycleIndex: 12,
      timestampMs: Date.parse('2026-04-03T23:30:00.000Z'),
      ticker: 'ETH-USDT',
      exchange: 'bingx',
      marketRegime: 'trend',
      capitalRegime: 'NORMAL',
      balanceState: { capitalRegime: 'NORMAL' },
      setupType: 'byBarsPercents',
    },
    regimeRouterDecision: {
      layerName: 'marketRegimeRouter',
      marketRegime: 'trend',
      allowedSetups: ['byBarsPercents'],
      selectedPredictType: 'byBarsPercents',
      score: 0.78,
      confidence: 0.72,
    },
    primarySignal: {
      layerName: 'primarySignalLayer',
      direction: 'long',
      score: 0.8,
      confidence: 0.74,
      setupType: 'byBarsPercents',
    },
  }, config);

  assert.equal(result.layers.sessionFilterLayer.layerName, 'sessionFilterLayer');
  assert.equal(result.decision.entryAllowed, false);
  assert.ok(result.decision.reasonCodes.some((x) => String(x).includes('hard_veto')));
  assert.equal(result.decisionContext.metadata.sessionState, 'NIGHT');
  assert.equal(result.decisionContext.metadata.timeBasedEntryRestriction, true);
});
