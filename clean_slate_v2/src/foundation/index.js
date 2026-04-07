'use strict';

const {
  DECISION_CONTEXT_CONTRACT_VERSION,
  createDecisionContext,
  assertDecisionContextIntegrity,
} = require('./decisionContext');
const {
  createMarketSnapshot,
  createFeatureSnapshot,
  createSharedDataPlane,
} = require('./sharedDataPlane');
const {
  createStructuredRuntimeContext,
  assertNoAdHocContextFork,
} = require('./runtimeContext');

module.exports = {
  DECISION_CONTEXT_CONTRACT_VERSION,
  createDecisionContext,
  assertDecisionContextIntegrity,
  createMarketSnapshot,
  createFeatureSnapshot,
  createSharedDataPlane,
  createStructuredRuntimeContext,
  assertNoAdHocContextFork,
};
