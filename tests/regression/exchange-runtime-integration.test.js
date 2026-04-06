const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createExchangeRuntimeIntegration,
  normalizeExchangeRuntimeConfig,
} = require('../../dist/runtime/exchange/exchangeRuntimeIntegration');
const { buildRuntimeConfig } = require('../../dist/runtime/config/runtimeConfigValidator');

test('BingX baseline unchanged: runtime integration сохраняет baseline и ownership-invariants', () => {
  const events = [];
  const integration = createExchangeRuntimeIntegration({
    activeExchange: 'bingx',
    exchangeCapabilitiesSource: 'matrix_step40a',
    enableExchangeCapabilityChecks: true,
    safeUnsupportedFeatureMode: 'fallback',
    exchangeRestrictionPolicy: 'enforce',
  }, {
    emitStructuredEvent: (...args) => events.push(args),
  });

  assert.equal(integration.config.activeExchange, 'bingx');
  assert.equal(integration.contract.profileFound, true);
  assert.equal(integration.ownershipSafety.canBecomeDecisionOwner, false);
  assert.equal(integration.ownershipSafety.canOverrideHardRisk, false);
  assert.equal(integration.decisionInputFlags.hasServerTakeProfitSupport, true);
  assert.equal(integration.decisionInputFlags.hasServerStopLossSupport, true);
  assert.equal(events.some((event) => event[1] === 'activeExchange'), true);
  assert.equal(events.some((event) => event[1] === 'capabilityCheckPassed'), true);
});

test('unsupported feature fallback branch: unsupported capability обрабатывается явно без silent degradation', () => {
  const events = [];
  const integration = createExchangeRuntimeIntegration({
    activeExchange: 'unknown_exchange',
    safeUnsupportedFeatureMode: 'fallback',
    enableExchangeCapabilityChecks: true,
  }, {
    emitStructuredEvent: (...args) => events.push(args),
  });

  const result = integration.resolveUnsupportedFeature('serverTpSupport', integration.protectiveContext.featureGates.serverTpSupport);
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.allowed, true);
  assert.equal(result.blocked, false);
  assert.equal(events.some((event) => event[1] === 'capabilityCheckFailed'), true);
  assert.equal(events.some((event) => event[1] === 'unsupportedFeatureFallbackUsed'), true);
});

test('exchange restriction propagation branch: restriction policy корректно распространяется в execution/lifecycle path', () => {
  const events = [];
  const integration = createExchangeRuntimeIntegration({
    activeExchange: 'bingx',
    exchangeRestrictionPolicy: 'enforce',
  }, {
    emitStructuredEvent: (...args) => events.push(args),
  });

  const restrictionResult = integration.applyRestrictionPolicy('forbidAssumeUniversalReduceOnly', true, {
    layer: 'execution',
  });
  assert.equal(restrictionResult.restricted, true);
  assert.equal(restrictionResult.mode, 'enforce');
  assert.equal(events.some((event) => event[1] === 'exchangeRestrictionApplied'), true);
});

test('no ownership takeover by exchange capability layer: decision/sizing ownership не передаётся', () => {
  const integration = createExchangeRuntimeIntegration({
    activeExchange: 'bingx',
  });

  assert.equal(integration.ownershipSafety.ownershipPathChanged, false);
  assert.equal(integration.ownershipSafety.canBecomeDecisionOwner, false);
  assert.equal(integration.ownershipSafety.canOverrideCapitalRegime, false);
  assert.equal(integration.ownershipSafety.canOverrideForecastRestrictions, false);
});

test('config/runtime consistency: validator нормализует exchange semantics и сохраняет обратную совместимость', () => {
  const normalizedInput = normalizeExchangeRuntimeConfig({
    exchange: 'bingx',
    exchangeLayer: {
      activeExchange: 'bingx',
      exchangeCapabilitiesSource: 'matrix_step40a',
      enableExchangeCapabilityChecks: true,
      safeUnsupportedFeatureMode: 'fallback',
      exchangeRestrictionPolicy: 'enforce',
    },
  });
  assert.equal(normalizedInput.activeExchange, 'bingx');

  const runtimeConfig = buildRuntimeConfig({
    getCoreConfig: () => ({ enabled: true }),
    getExchangeConfig: (cfg) => cfg,
    merge: (base, ext) => ({ ...base, ...ext }),
  }, {
    loopsLength: 2,
    intervalSeconds: 1,
  }, {
    exchange: 'bingx',
    exchangeLayer: normalizedInput,
  });

  assert.equal(runtimeConfig.activeExchange, 'bingx');
  assert.equal(runtimeConfig.exchangeCapabilitiesSource, 'matrix_step40a');
  assert.equal(runtimeConfig.enableExchangeCapabilityChecks, true);
  assert.equal(runtimeConfig.safeUnsupportedFeatureMode, 'fallback');
  assert.equal(runtimeConfig.exchangeRestrictionPolicy, 'enforce');
  assert.equal(runtimeConfig.exchangeLayer.activeExchange, 'bingx');
});
