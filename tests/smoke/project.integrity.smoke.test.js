const test = require('node:test');
const assert = require('node:assert/strict');

// Русский комментарий: минимальный smoke-тест для проверки базовой целостности bootstrap/config/wiring.
test('smoke/integrity: bootstrap, config loading и wiring ключевых модулей не падают', () => {
  process.env.CBT_SKIP_AUTOSTART = '1';

  const entry = require('../../dist/index.js');
  assert.ok(entry.__testkit, 'Ожидается экспорт тестового контура __testkit');

  const runtimeConfig = require('../../dist/_config/config.json');
  assert.equal(typeof runtimeConfig, 'object');
  assert.equal(runtimeConfig.finalEntryDecisionEngine.enabled, true);
  assert.equal(runtimeConfig.dynamicPositionSizing.enableDynamicPositionSizing, true);
  assert.equal(runtimeConfig.mlPhase1Integration.enableMlFilter, true);
  assert.equal(runtimeConfig.mlMetaController.enableMlMetaController, true);

  const exchangeRuntimeIntegration = require('../../dist/runtime/exchange/exchangeRuntimeIntegration');
  const capabilityMatrix = require('../../dist/runtime/exchange/exchangeCapabilityMatrix');
  const finalEntryDecisionEngine = require('../../dist/runtime/engines/finalEntryDecisionEngine');
  const mlPhase1DecisionModifier = require('../../dist/runtime/ml/mlPhase1DecisionModifier');
  const mlMetaController = require('../../dist/runtime/ml/mlMetaController');

  assert.equal(typeof exchangeRuntimeIntegration.createExchangeRuntimeIntegration, 'function');
  assert.equal(typeof capabilityMatrix.createUnifiedExchangeContract, 'function');
  assert.equal(typeof finalEntryDecisionEngine.evaluateFinalEntryDecision, 'function');
  assert.equal(typeof mlPhase1DecisionModifier.createMlPhase1DecisionModifier, 'function');
  assert.equal(typeof mlMetaController.createMlMetaController, 'function');
});

// Русский комментарий: проверяем отсутствие явных wiring-конфликтов шага 40 по exchangeLayer во всех биржевых конфигах.
test('smoke/integrity: exchangeLayer-конфигурация для всех бирж консистентна', () => {
  const runtimeConfig = require('../../dist/_config/config.json');
  const exchanges = runtimeConfig.exchanges || {};

  for (const [exchangeName, exchangeConfig] of Object.entries(exchanges)) {
    const layer = exchangeConfig.exchangeLayer;
    assert.ok(layer, `У биржи ${exchangeName} отсутствует exchangeLayer`);
    assert.equal(layer.activeExchange, exchangeName);
    assert.equal(layer.exchangeCapabilitiesSource, exchangeConfig.exchangeCapabilitiesSource);
    assert.equal(layer.enableExchangeCapabilityChecks, exchangeConfig.enableExchangeCapabilityChecks);
    assert.equal(layer.safeUnsupportedFeatureMode, exchangeConfig.safeUnsupportedFeatureMode);
    assert.equal(layer.exchangeRestrictionPolicy, exchangeConfig.exchangeRestrictionPolicy);
  }
});
