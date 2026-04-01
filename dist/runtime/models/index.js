'use strict';

const { createDecisionContext } = require('../shared/decisionContract');
const { createFeatureSnapshot, createMarketSnapshot } = require('../shared/featureStore');

// Русский комментарий: единые фабрики DTO для поэтапного выноса runtime-контрактов из index.js.
function createTickerContext(data) { return { ...data }; }
function createPositionState(data) { return { ...data }; }
function createSignalDecision(data) { return { ...data }; }
function createRiskDecision(data) { return { ...data }; }
function createExecutionTask(data) { return { ...data }; }
function createTradeResult(data) { return { ...data }; }

module.exports = {
  createTickerContext,
  createPositionState,
  createSignalDecision,
  createRiskDecision,
  createExecutionTask,
  createTradeResult,
  createMarketSnapshot,
  createFeatureSnapshot,
  createDecisionContext,
};
