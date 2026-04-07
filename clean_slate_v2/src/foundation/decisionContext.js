'use strict';

/**
 * Русский комментарий:
 * Единый контракт DecisionContext для clean-slate v2 foundation.
 * Контракт exchange-agnostic и не зависит от legacy runtime chain.
 */
const DECISION_CONTEXT_CONTRACT_VERSION = 'clean_slate_v2.decision_context.v1';

function normalizeString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function normalizeNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function deepFreeze(obj) {
  if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) {
    return obj;
  }

  Object.freeze(obj);
  Object.getOwnPropertyNames(obj).forEach((prop) => {
    if (obj[prop] && typeof obj[prop] === 'object') {
      deepFreeze(obj[prop]);
    }
  });
  return obj;
}

function createDecisionContext(input = {}) {
  const context = {
    contractVersion: DECISION_CONTEXT_CONTRACT_VERSION,
    cycle: {
      id: normalizeString(input.cycleId),
      startedAt: normalizeString(input.startedAt),
      mode: normalizeString(input.mode, 'paper'),
    },
    asset: {
      ticker: normalizeString(input.ticker),
      timeframe: normalizeString(input.timeframe, '5m'),
      exchange: normalizeString(input.exchange, 'generic_exchange'),
    },
    marketSnapshot: input.marketSnapshot || null,
    featureSnapshot: input.featureSnapshot || null,
    sharedOutputs: {
      regime: input.sharedOutputs && typeof input.sharedOutputs.regime === 'object'
        ? input.sharedOutputs.regime
        : null,
      forecasts: input.sharedOutputs && typeof input.sharedOutputs.forecasts === 'object'
        ? input.sharedOutputs.forecasts
        : null,
      riskGuards: input.sharedOutputs && typeof input.sharedOutputs.riskGuards === 'object'
        ? input.sharedOutputs.riskGuards
        : null,
    },
    score: normalizeNumber(input.score, 0),
    confidence: normalizeNumber(input.confidence, 0),
    reasonCodes: normalizeArray(input.reasonCodes),
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
  };

  return deepFreeze(context);
}

function assertDecisionContextIntegrity(context = {}) {
  if (context.contractVersion !== DECISION_CONTEXT_CONTRACT_VERSION) {
    return { ok: false, reason: 'contract_version_mismatch' };
  }

  if (!context.marketSnapshot || context.marketSnapshot.snapshotType !== 'market') {
    return { ok: false, reason: 'market_snapshot_missing_or_invalid' };
  }

  if (!context.featureSnapshot || context.featureSnapshot.snapshotType !== 'feature') {
    return { ok: false, reason: 'feature_snapshot_missing_or_invalid' };
  }

  if (!context.asset || !context.asset.ticker) {
    return { ok: false, reason: 'asset_ticker_missing' };
  }

  return { ok: true, reason: null };
}

module.exports = {
  DECISION_CONTEXT_CONTRACT_VERSION,
  createDecisionContext,
  assertDecisionContextIntegrity,
};
