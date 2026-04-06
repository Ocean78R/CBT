const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REQUIRED_CAPABILITY_DOMAINS,
  CAPABILITY_FALLBACK_DECISIONS,
  EXCHANGE_CAPABILITY_MATRIX,
  ensureDomainCompleteness,
  createUnifiedExchangeContract,
  resolveFeatureGate,
} = require('../../dist/runtime/exchange/exchangeCapabilityMatrix');

test('capability matrix: BingX baseline содержит все обязательные capability domains', () => {
  const bingxProfile = EXCHANGE_CAPABILITY_MATRIX.bingx;
  assert.ok(bingxProfile);

  const completeness = ensureDomainCompleteness(bingxProfile);
  assert.equal(completeness.isComplete, true);
  assert.deepEqual(completeness.missingDomains, []);
  assert.equal(REQUIRED_CAPABILITY_DOMAINS.length >= 8, true);
});

test('fallback: unsupported/unknown exchange capability не ломает runtime и включает safe fallback semantics', () => {
  const contract = createUnifiedExchangeContract('unknown_exchange');

  assert.equal(contract.profileFound, false);
  assert.equal(contract.safeFallback.unknownCapabilityMode, CAPABILITY_FALLBACK_DECISIONS.SAFE_NOOP_AND_LOG);
  assert.equal(contract.safeFallback.partiallySupportedExchangeMode, CAPABILITY_FALLBACK_DECISIONS.BLOCK_RISKY_ACTION);
  assert.equal(contract.protectiveOrderCapabilities.serverTpSupport.fallbackAction, CAPABILITY_FALLBACK_DECISIONS.USE_LOCAL_PROTECTIVE_FALLBACK);
  assert.equal(contract.reconciliationCapabilities.fallbackAction, CAPABILITY_FALLBACK_DECISIONS.RECONCILIATION_MINIMAL);
});

test('routing: exchange capability layer не ломает ownership-path execution/lifecycle/protective managers', () => {
  const contract = createUnifiedExchangeContract('bingx');

  assert.equal(contract.ownershipSafety.ownershipPathChanged, false);
  assert.equal(contract.ownershipSafety.canBecomeDecisionOwner, false);
  assert.equal(contract.ownershipSafety.canOverrideHardRisk, false);
  assert.equal(contract.ownershipSafety.canOverrideCapitalRegime, false);
  assert.equal(contract.ownershipSafety.canOverrideForecastRestrictions, false);
});

test('contract consistency: unified abstraction остаётся exchange-agnostic на decision-stack уровне', () => {
  const contract = createUnifiedExchangeContract('bingx');

  assert.equal(contract.decisionLayerInvariant.decisionLayers24To39MustBeExchangeAgnostic, true);
  assert.equal(contract.decisionLayerInvariant.exchangeDifferencesOnlyThroughCapabilityLayer, true);
  assert.ok(Array.isArray(contract.forbiddenAssumptions));
  assert.ok(contract.forbiddenAssumptions.includes('decision_layers_24_39_must_not_embed_bingx_specific_conditions'));

  const featureGate = resolveFeatureGate(contract, 'protectiveOrderCapabilities', 'serverTpSupport');
  assert.equal(featureGate.isAvailable, true);
  assert.equal(featureGate.fallbackAction, 'none');

  const unavailableGate = resolveFeatureGate(contract, 'protectiveOrderCapabilities', 'nonExistingCapability');
  assert.equal(unavailableGate.isAvailable, false);
  assert.equal(unavailableGate.fallbackAction, CAPABILITY_FALLBACK_DECISIONS.SAFE_NOOP_AND_LOG);
});
