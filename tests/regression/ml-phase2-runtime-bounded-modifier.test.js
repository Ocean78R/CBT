const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateFinalEntryDecision } = require('../../dist/runtime/engines/finalEntryDecisionEngine');
const { evaluateConfluenceEntry } = require('../../dist/runtime/engines/confluenceEntryEngine');
const { evaluateDynamicPositionSizing } = require('../../dist/runtime/sizing/dynamicPositionSizing');

function createFinalInput(overrides = {}) {
  return {
    context: { cycleId: 'c-39-2', ticker: 'BTC-USDT' },
    componentScores: {
      entryPermission: { score: 0.8, confidence: 0.8, weight: 1, dataQualityState: 'ok' },
      marketContext: { score: 0.75, confidence: 0.75, weight: 1, dataQualityState: 'ok' },
      primarySignal: { score: 0.7, confidence: 0.7, weight: 1, dataQualityState: 'ok' },
    },
    balanceState: { capitalRegime: 'NORMAL', unloadMode: false },
    capitalRegime: 'NORMAL',
    mlMetaControllerOutput: {
      metaAdjustmentSet: {
        entryThresholdModifier: 0,
        weakEntryBoundaryModifier: 0,
        fullEntryBoundaryModifier: 0,
      },
      allowedAdjustmentBounds: {
        entryThresholdModifier: { min: -0.05, max: 0.05 },
        weakEntryBoundaryModifier: { min: -0.05, max: 0.05 },
        fullEntryBoundaryModifier: { min: -0.05, max: 0.05 },
      },
    },
    ...overrides,
  };
}

test('meta runtime: threshold modifier branch для finalEntryDecisionEngine', () => {
  const output = evaluateFinalEntryDecision(createFinalInput({
    mlMetaControllerOutput: {
      metaAdjustmentSet: {
        entryThresholdModifier: -0.04,
      },
      allowedAdjustmentBounds: {
        entryThresholdModifier: { min: -0.05, max: 0.05 },
      },
    },
  }));

  assert.equal(output.thresholdsApplied.fullEntry, 0.64);
  const appliedEvent = output.explanation.metaRuntimeInfluence.events.find((e) => e.reasonCode === 'metaAdjustmentApplied');
  assert.ok(appliedEvent);
  assert.equal(appliedEvent.affectedLayer, 'finalEntryDecisionEngine.thresholds');
  assert.equal(appliedEvent.metaFallbackState, 'none');
  assert.equal(appliedEvent.capitalRegimeImpact, 'none');
  assert.equal(appliedEvent.forecastImpact, 'none');
  assert.equal(output.decisionModeMetadata.decisionOwner, 'finalEntryDecisionEngine');
});

test('meta runtime: weak/full boundary modifier branch применяет границы weak/full', () => {
  const output = evaluateFinalEntryDecision(createFinalInput({
    mlMetaControllerOutput: {
      metaAdjustmentSet: {
        weakEntryBoundaryModifier: 0.03,
        fullEntryBoundaryModifier: -0.02,
      },
      allowedAdjustmentBounds: {
        weakEntryBoundaryModifier: { min: -0.05, max: 0.05 },
        fullEntryBoundaryModifier: { min: -0.05, max: 0.05 },
      },
    },
  }));

  assert.equal(output.thresholdsApplied.weakEntry, 0.47);
  assert.equal(output.thresholdsApplied.weakEntryRange.min, 0.47);
  assert.equal(output.thresholdsApplied.weakEntryRange.max, 0.66);
});

function createConfluenceInput(overrides = {}) {
  return {
    context: {
      cycleId: 'c-39-confluence',
      ticker: 'ETH-USDT',
      marketRegime: 'trend',
      capitalRegime: 'NORMAL',
      balanceState: { capitalRegime: 'NORMAL', unloadMode: false },
    },
    regimeRouterDecision: {
      layerName: 'marketRegimeRouter',
      marketRegime: 'trend',
      allowedSetups: ['pullback'],
      selectedPredictType: 'pullback',
      score: 0.62,
      confidence: 0.7,
      softPenalty: 0,
    },
    primarySignal: {
      layerName: 'legacy',
      direction: 'long',
      score: 0.63,
      confidence: 0.68,
      setupType: 'pullback',
      dataQualityState: 'ok',
    },
    sharedSnapshot: {
      candles: Array.from({ length: 80 }, (_, i) => ({ open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1000 + i })),
    },
    mlMetaControllerOutput: {
      metaAdjustmentSet: {
        shortlistRankingModifier: 0,
        regimePreferenceWeights: { trend: 0, meanReversion: 0, breakoutRejection: 0, noTradeFlat: 0 },
      },
      allowedAdjustmentBounds: {
        shortlistRankingModifier: { min: -0.15, max: 0.15 },
        regimePreferenceWeights: {
          trend: { min: -0.2, max: 0.2 },
        },
      },
    },
    ...overrides,
  };
}

test('meta runtime: shortlist ranking modifier branch в confluence', () => {
  const base = evaluateConfluenceEntry(createConfluenceInput(), { enabled: true, mode: 'confluence' });
  const adjusted = evaluateConfluenceEntry(createConfluenceInput({
    mlMetaControllerOutput: {
      metaAdjustmentSet: {
        shortlistRankingModifier: 0.08,
        regimePreferenceWeights: { trend: 0, meanReversion: 0, breakoutRejection: 0, noTradeFlat: 0 },
      },
      allowedAdjustmentBounds: {
        shortlistRankingModifier: { min: -0.15, max: 0.15 },
      },
    },
  }), { enabled: true, mode: 'confluence' });

  assert.ok(adjusted.layers.finalEntryDecisionLayer.score > base.layers.finalEntryDecisionLayer.score);
  assert.ok(adjusted.layers.finalEntryDecisionLayer.explanation.metaRuntimeInfluence.events.some((e) => e.adjustmentKey === 'shortlistRankingModifier'));
});

test('meta runtime: regime preference modifier branch в confluence', () => {
  const base = evaluateConfluenceEntry(createConfluenceInput(), { enabled: true, mode: 'confluence' });
  const adjusted = evaluateConfluenceEntry(createConfluenceInput({
    mlMetaControllerOutput: {
      metaAdjustmentSet: {
        shortlistRankingModifier: 0,
        regimePreferenceWeights: { trend: 0.12, meanReversion: 0, breakoutRejection: 0, noTradeFlat: 0 },
      },
      allowedAdjustmentBounds: {
        regimePreferenceWeights: {
          trend: { min: -0.2, max: 0.2 },
        },
      },
    },
  }), { enabled: true, mode: 'confluence' });

  assert.ok(adjusted.layers.finalEntryDecisionLayer.score > base.layers.finalEntryDecisionLayer.score);
  assert.ok(adjusted.layers.finalEntryDecisionLayer.explanation.metaRuntimeInfluence.events.some((e) => e.adjustmentKey === 'regimePreferenceWeights'));
});

function createSizingInput(overrides = {}) {
  return {
    context: { cycleId: 'c-39-sizing', ticker: 'SOL-USDT', mode: 'live' },
    approvedEntryResult: { decisionMode: 'full_entry', entryScore: 0.72, confidence: 0.7, vetoSummary: { blocked: false } },
    balanceState: { capitalRegime: 'NORMAL', unloadMode: false },
    capitalRegime: 'NORMAL',
    tickerRisk: { riskScore: 0.3 },
    mlMetaControllerOutput: {
      metaAdjustmentSet: { sizingAggressivenessModifier: 0 },
      allowedAdjustmentBounds: { sizingAggressivenessModifier: { min: -0.15, max: 0.15 } },
    },
    ...overrides,
  };
}

test('meta runtime: sizing aggressiveness modifier branch в dynamicPositionSizing', () => {
  const base = evaluateDynamicPositionSizing(createSizingInput(), {});
  const adjusted = evaluateDynamicPositionSizing(createSizingInput({
    mlMetaControllerOutput: {
      metaAdjustmentSet: { sizingAggressivenessModifier: 0.1 },
      allowedAdjustmentBounds: { sizingAggressivenessModifier: { min: -0.15, max: 0.15 } },
    },
  }), {});

  assert.ok(adjusted.sizeMultiplier > base.sizeMultiplier);
  assert.ok(adjusted.sizingReasonCodes.includes('ml_phase2_sizing_aggressiveness_modifier'));
});

test('meta runtime: adjustment blocked by capitalRegime', () => {
  const output = evaluateFinalEntryDecision(createFinalInput({
    capitalRegime: 'HALT_NEW_ENTRIES',
    balanceState: { capitalRegime: 'HALT_NEW_ENTRIES', unloadMode: false },
    mlMetaControllerOutput: {
      metaAdjustmentSet: {
        entryThresholdModifier: -0.04,
      },
      allowedAdjustmentBounds: {
        entryThresholdModifier: { min: -0.05, max: 0.05 },
      },
    },
  }));

  const blocked = output.explanation.metaRuntimeInfluence.events.find((e) => e.reasonCode === 'metaAdjustmentBlocked');
  assert.ok(blocked);
  assert.equal(blocked.blockedReason, 'blockedByCapitalRegime');
  assert.ok(blocked.blockedReasons.includes('blockedByCapitalRegime'));
  assert.equal(blocked.capitalRegimeImpact, 'blocked');
});

test('meta runtime: adjustment blocked by forecast restrictions', () => {
  const output = evaluateFinalEntryDecision(createFinalInput({
    portfolioForecast: {
      enabled: true,
      restrictionHints: ['restrict_new_entries_hard_candidate'],
    },
    mlMetaControllerOutput: {
      metaAdjustmentSet: {
        entryThresholdModifier: -0.03,
      },
      allowedAdjustmentBounds: {
        entryThresholdModifier: { min: -0.05, max: 0.05 },
      },
    },
  }));

  const blocked = output.explanation.metaRuntimeInfluence.events.find((e) => e.reasonCode === 'metaAdjustmentBlocked');
  assert.ok(blocked);
  assert.equal(blocked.blockedReason, 'blockedByForecast');
  assert.ok(blocked.blockedReasons.includes('blockedByForecast'));
  assert.equal(blocked.forecastImpact, 'blocked');
});

test('meta runtime: adjustment blocked by hard-risk veto', () => {
  const output = evaluateFinalEntryDecision(createFinalInput({
    balanceState: { capitalRegime: 'NORMAL', unloadMode: true },
    mlMetaControllerOutput: {
      metaAdjustmentSet: {
        entryThresholdModifier: -0.03,
      },
      allowedAdjustmentBounds: {
        entryThresholdModifier: { min: -0.05, max: 0.05 },
      },
    },
  }));

  const blocked = output.explanation.metaRuntimeInfluence.events.find((e) => e.reasonCode === 'metaAdjustmentBlocked');
  assert.ok(blocked);
  assert.equal(blocked.blockedReason, 'blockedByHardRisk');
  assert.ok(blocked.blockedReasons.includes('blockedByHardRisk'));
  assert.equal(output.decisionMode, 'no_entry');
  assert.equal(output.vetoSummary.finalVeto.type, 'unload_mode');
});

test('meta runtime (sizing): adjustment blocked by hard-risk', () => {
  const output = evaluateDynamicPositionSizing(createSizingInput({
    runtimeGuards: { hardRiskBlocked: true, allowNewEntries: false, unloadMode: true },
    mlMetaControllerOutput: {
      metaAdjustmentSet: { sizingAggressivenessModifier: 0.1 },
      allowedAdjustmentBounds: { sizingAggressivenessModifier: { min: -0.15, max: 0.15 } },
    },
  }), {});

  const blocked = output.explanation.structured.metaRuntimeInfluence.events.find((e) => e.reasonCode === 'metaAdjustmentBlocked');
  assert.ok(blocked);
  assert.equal(blocked.blockedReason, 'blockedByHardRisk');
  assert.ok(blocked.blockedReasons.includes('blockedByHardRisk'));
  assert.equal(output.sizeMultiplier, 0);
  assert.equal(output.leverageCap, 0);
});

test('meta runtime: no ownership takeover by meta-controller', () => {
  const finalOutput = evaluateFinalEntryDecision(createFinalInput({
    mlMetaControllerOutput: {
      metaAdjustmentSet: {
        entryThresholdModifier: 0.01,
      },
      allowedAdjustmentBounds: {
        entryThresholdModifier: { min: -0.05, max: 0.05 },
      },
    },
  }));
  const sizingOutput = evaluateDynamicPositionSizing(createSizingInput({
    mlMetaControllerOutput: {
      metaAdjustmentSet: { sizingAggressivenessModifier: 0.05 },
      allowedAdjustmentBounds: { sizingAggressivenessModifier: { min: -0.15, max: 0.15 } },
    },
  }), {});

  assert.equal(finalOutput.decisionModeMetadata.decisionOwner, 'finalEntryDecisionEngine');
  assert.equal(finalOutput.explanation.ownership.isFinalVetoOwnerForNewEntries, true);
  assert.equal(sizingOutput.explanation.ownership.isFinalDecisionOwner, false);
  assert.equal(sizingOutput.explanation.ownership.isExecutionOwner, false);
});

test('meta runtime: audit/event completeness и exchange-agnostic контракт', () => {
  const finalOutput = evaluateFinalEntryDecision(createFinalInput({
    context: { cycleId: 'c-39-audit', ticker: 'BTC-USDT', exchange: 'kraken' },
    mlMetaControllerOutput: {
      metaControllerFallbackState: 'none',
      metaAdjustmentSet: {
        entryThresholdModifier: -0.01,
      },
      allowedAdjustmentBounds: {
        entryThresholdModifier: { min: -0.05, max: 0.05 },
      },
    },
  }));

  const event = finalOutput.explanation.metaRuntimeInfluence.events.find((e) => e.reasonCode === 'metaAdjustmentApplied');
  assert.ok(event);
  assert.ok(Object.prototype.hasOwnProperty.call(event, 'appliedBounds'));
  assert.ok(Object.prototype.hasOwnProperty.call(event, 'affectedLayer'));
  assert.ok(Object.prototype.hasOwnProperty.call(event, 'metaFallbackState'));
  assert.equal(finalOutput.explanation.downstreamHints.multiExchangeAdaptationReady, true);
});

test('meta runtime: paper/live consistency for bounded adjustments', () => {
  const liveOutput = evaluateFinalEntryDecision(createFinalInput({
    context: { cycleId: 'c-39-paper-live-live', ticker: 'BTC-USDT', mode: 'live' },
    mlMetaControllerOutput: {
      metaAdjustmentSet: {
        entryThresholdModifier: -0.02,
        weakEntryBoundaryModifier: 0.01,
      },
      allowedAdjustmentBounds: {
        entryThresholdModifier: { min: -0.05, max: 0.05 },
        weakEntryBoundaryModifier: { min: -0.05, max: 0.05 },
      },
    },
  }));

  const paperOutput = evaluateFinalEntryDecision(createFinalInput({
    context: { cycleId: 'c-39-paper-live-paper', ticker: 'BTC-USDT', mode: 'paper' },
    mlMetaControllerOutput: {
      metaAdjustmentSet: {
        entryThresholdModifier: -0.02,
        weakEntryBoundaryModifier: 0.01,
      },
      allowedAdjustmentBounds: {
        entryThresholdModifier: { min: -0.05, max: 0.05 },
        weakEntryBoundaryModifier: { min: -0.05, max: 0.05 },
      },
    },
  }));

  assert.equal(liveOutput.decisionMode, paperOutput.decisionMode);
  assert.equal(liveOutput.thresholdsApplied.fullEntry, paperOutput.thresholdsApplied.fullEntry);
  assert.equal(liveOutput.thresholdsApplied.weakEntry, paperOutput.thresholdsApplied.weakEntry);
});
