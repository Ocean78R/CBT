'use strict';

const { createDecisionContext, assertDecisionContextIntegrity } = require('./decisionContext');

/**
 * Русский комментарий:
 * Structured runtime context связывает cycle-level shared data-plane
 * и DecisionContext без ad-hoc fork контекстов.
 */
function createStructuredRuntimeContext({
  cycleId,
  mode,
  asset,
  dataPlane,
  sharedOutputs = {},
  metadata = {},
}) {
  const snapshots = dataPlane.getCycleSnapshots(cycleId);

  if (!snapshots) {
    return {
      ok: false,
      reason: 'cycle_snapshots_not_found',
      decisionContext: null,
    };
  }

  const decisionContext = createDecisionContext({
    cycleId,
    mode,
    ticker: asset && asset.ticker,
    timeframe: asset && asset.timeframe,
    exchange: asset && asset.exchange,
    marketSnapshot: snapshots.marketSnapshot,
    featureSnapshot: snapshots.featureSnapshot,
    sharedOutputs,
    metadata,
  });

  const integrity = assertDecisionContextIntegrity(decisionContext);
  return {
    ok: integrity.ok,
    reason: integrity.reason,
    decisionContext,
  };
}

function assertNoAdHocContextFork({ baseContext, candidateContext }) {
  if (!baseContext || !candidateContext) {
    return { ok: false, reason: 'missing_context_for_fork_check' };
  }

  if (baseContext === candidateContext) {
    return { ok: true, reason: null };
  }

  if (baseContext.cycle && candidateContext.cycle
    && baseContext.cycle.id === candidateContext.cycle.id
    && baseContext.asset
    && candidateContext.asset
    && baseContext.asset.ticker === candidateContext.asset.ticker) {
    return { ok: false, reason: 'ad_hoc_context_fork_detected' };
  }

  return { ok: true, reason: null };
}

module.exports = {
  createStructuredRuntimeContext,
  assertNoAdHocContextFork,
};
