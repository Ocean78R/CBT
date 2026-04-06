const test = require('node:test');
const assert = require('node:assert/strict');

const { createUnifiedExchangeContract } = require('../../dist/runtime/exchange/exchangeCapabilityMatrix');
const { createExchangeRuntimeIntegration } = require('../../dist/runtime/exchange/exchangeRuntimeIntegration');

test('onboarding contract validation: candidate exchange проходит только через explicit safe fallback', () => {
  const events = [];
  const integration = createExchangeRuntimeIntegration({
    activeExchange: 'candidate_exchange',
    enableExchangeCapabilityChecks: true,
    safeUnsupportedFeatureMode: 'fallback',
    exchangeRestrictionPolicy: 'enforce',
  }, {
    emitStructuredEvent: (...args) => events.push(args),
  });

  const gate = integration.protectiveContext.featureGates.serverTpSupport;
  const unsupportedDecision = integration.resolveUnsupportedFeature('serverTpSupport', gate);

  assert.equal(integration.contract.profileFound, false);
  assert.equal(unsupportedDecision.mode, 'fallback');
  assert.equal(unsupportedDecision.fallbackUsed, true);
  assert.equal(events.some((event) => event[1] === 'capabilityCheckFailed'), true);
  assert.equal(events.some((event) => event[1] === 'unsupportedFeatureFallbackUsed'), true);
});

test('BingX baseline remains unchanged: onboarding checks не меняют baseline ownership и capability gates', () => {
  const contract = createUnifiedExchangeContract('bingx');
  const integration = createExchangeRuntimeIntegration({
    activeExchange: 'bingx',
    enableExchangeCapabilityChecks: true,
    safeUnsupportedFeatureMode: 'fallback',
    exchangeRestrictionPolicy: 'enforce',
    bingxBaselineReference: true,
  });

  assert.equal(contract.profileFound, true);
  assert.equal(contract.profileCompleteness.isComplete, true);
  assert.equal(integration.ownershipSafety.canBecomeDecisionOwner, false);
  assert.equal(integration.decisionInputFlags.hasServerTakeProfitSupport, true);
  assert.equal(integration.decisionInputFlags.hasServerStopLossSupport, true);
});

test('traceability: runtime публикует минимальный capability decision trace без отдельной competing schema', () => {
  const events = [];
  const integration = createExchangeRuntimeIntegration({
    activeExchange: 'candidate_exchange',
    enableExchangeCapabilityChecks: true,
    safeUnsupportedFeatureMode: 'block',
  }, {
    emitStructuredEvent: (...args) => events.push(args),
  });

  assert.equal(integration.capabilityDecisionTrace.traceSchema, 'exchange_capability_decision_trace.v1');
  assert.equal(integration.capabilityDecisionTrace.activeExchange, 'candidate_exchange');
  assert.equal(integration.capabilityDecisionTrace.profileFound, false);
  assert.equal(integration.capabilityDecisionTrace.safeUnsupportedFeatureMode, 'block');
  assert.equal(
    events.some((event) => {
      const payload = event[5] || {};
      return payload.capabilityDecisionTrace && payload.capabilityDecisionTrace.traceSchema === 'exchange_capability_decision_trace.v1';
    }),
    true,
  );
});

