'use strict';

const {
  CAPABILITY_FALLBACK_DECISIONS,
  createUnifiedExchangeContract,
  resolveFeatureGate,
} = require('./exchangeCapabilityMatrix');

const UNSUPPORTED_FEATURE_MODES = ['fallback', 'disable', 'block'];
const EXCHANGE_RESTRICTION_POLICIES = ['enforce', 'warn_only', 'off'];
const EXCHANGE_CAPABILITIES_SOURCES = ['matrix_step40a', 'static_matrix', 'manual_override'];

function createNullLogger() {
  return {
    log: () => {},
    warn: () => {},
  };
}

function normalizeExchangeRuntimeConfig(runtimeConfig = {}) {
  const exchangeLayer = runtimeConfig.exchangeLayer || {};
  const source = exchangeLayer.exchangeCapabilitiesSource || runtimeConfig.exchangeCapabilitiesSource || 'matrix_step40a';
  const restrictionPolicy = exchangeLayer.exchangeRestrictionPolicy || runtimeConfig.exchangeRestrictionPolicy || 'enforce';
  const unsupportedFeatureMode = exchangeLayer.safeUnsupportedFeatureMode || runtimeConfig.safeUnsupportedFeatureMode || 'fallback';
  const activeExchange = exchangeLayer.activeExchange || runtimeConfig.activeExchange || runtimeConfig.exchange || 'bingx';

  return {
    activeExchange: String(activeExchange || 'bingx').trim(),
    exchangeCapabilitiesSource: EXCHANGE_CAPABILITIES_SOURCES.includes(source) ? source : 'matrix_step40a',
    enableExchangeCapabilityChecks: (exchangeLayer.enableExchangeCapabilityChecks ?? runtimeConfig.enableExchangeCapabilityChecks) !== false,
    safeUnsupportedFeatureMode: UNSUPPORTED_FEATURE_MODES.includes(unsupportedFeatureMode) ? unsupportedFeatureMode : 'fallback',
    exchangeRestrictionPolicy: EXCHANGE_RESTRICTION_POLICIES.includes(restrictionPolicy) ? restrictionPolicy : 'enforce',
    bingxBaselineReference: (exchangeLayer.bingxBaselineReference ?? runtimeConfig.bingxBaselineReference) !== false,
  };
}

function createExchangeRuntimeIntegration(runtimeConfig = {}, options = {}) {
  const logger = options.logger || createNullLogger();
  const emitStructuredEvent = typeof options.emitStructuredEvent === 'function' ? options.emitStructuredEvent : () => {};
  const normalizedConfig = normalizeExchangeRuntimeConfig(runtimeConfig);
  const contract = createUnifiedExchangeContract(normalizedConfig.activeExchange, { logger });
  const capabilityDecisionTrace = {
    traceSchema: 'exchange_capability_decision_trace.v1',
    activeExchange: normalizedConfig.activeExchange,
    exchangeCapabilitiesSource: normalizedConfig.exchangeCapabilitiesSource,
    profileFound: contract.profileFound === true,
    profileCompleteness: contract.profileCompleteness || { isComplete: false, missingDomains: [] },
    safeUnsupportedFeatureMode: normalizedConfig.safeUnsupportedFeatureMode,
    exchangeRestrictionPolicy: normalizedConfig.exchangeRestrictionPolicy,
    bingxBaselineReference: normalizedConfig.bingxBaselineReference === true,
  };

  const emitEvent = (phase, details) => {
    emitStructuredEvent('exchange_capability', phase, normalizedConfig.activeExchange, details.status || 'info', details.reason || phase, {
      activeExchange: normalizedConfig.activeExchange,
      exchangeCapabilitiesSource: normalizedConfig.exchangeCapabilitiesSource,
      enableExchangeCapabilityChecks: normalizedConfig.enableExchangeCapabilityChecks,
      safeUnsupportedFeatureMode: normalizedConfig.safeUnsupportedFeatureMode,
      exchangeRestrictionPolicy: normalizedConfig.exchangeRestrictionPolicy,
      capabilityDecisionTrace,
      ...details.payload,
    });
  };

  emitEvent('activeExchange', {
    status: normalizedConfig.activeExchange === 'bingx' ? 'baseline' : 'candidate',
    reason: normalizedConfig.activeExchange === 'bingx'
      ? 'bingx_baseline_reference_implementation'
      : 'non_bingx_exchange_selected',
    payload: {
      bingxBaselineReference: normalizedConfig.bingxBaselineReference,
      profileFound: contract.profileFound,
    },
  });

  const reduceOnlyGate = resolveFeatureGate(contract, 'executionFacingCapabilities', 'reduceOnlySemantics');
  const serverTpGate = resolveFeatureGate(contract, 'protectiveOrderCapabilities', 'serverTpSupport');
  const serverSlGate = resolveFeatureGate(contract, 'protectiveOrderCapabilities', 'serverSlSupport');
  const reconciliationGate = contract.reconciliationCapabilities || {};

  const gatingErrors = [];
  if (normalizedConfig.enableExchangeCapabilityChecks) {
    if (!reduceOnlyGate.isAvailable) gatingErrors.push('reduceOnlySemantics');
    if (!contract.profileFound) gatingErrors.push('exchangeProfile');
  }

  if (gatingErrors.length === 0) {
    emitEvent('capabilityCheckPassed', {
      status: 'passed',
      reason: 'runtime_capability_checks_passed',
      payload: {
        reduceOnlySemantics: reduceOnlyGate.status,
        serverTpSupport: serverTpGate.status,
        serverSlSupport: serverSlGate.status,
      },
    });
  } else {
    emitEvent('capabilityCheckFailed', {
      status: 'failed',
      reason: 'runtime_capability_checks_failed',
      payload: {
        failedChecks: gatingErrors,
      },
    });
  }

  function resolveUnsupportedFeature(featureName, featureGate = {}) {
    const gate = featureGate && typeof featureGate === 'object' ? featureGate : {};
    if (gate.isAvailable === true || normalizedConfig.enableExchangeCapabilityChecks === false) {
      return { mode: 'allow', allowed: true, blocked: false, fallbackUsed: false, featureName };
    }

    if (normalizedConfig.safeUnsupportedFeatureMode === 'disable') {
      emitEvent('unsupportedFeatureFallbackUsed', {
        status: 'restricted',
        reason: `unsupported_feature_disabled:${featureName}`,
        payload: { featureName, action: 'explicit_disable', fallbackAction: gate.fallbackAction || 'none' },
      });
      return { mode: 'disable', allowed: false, blocked: false, fallbackUsed: false, featureName };
    }
    if (normalizedConfig.safeUnsupportedFeatureMode === 'block') {
      emitEvent('unsupportedFeatureFallbackUsed', {
        status: 'blocked',
        reason: `unsupported_feature_blocked:${featureName}`,
        payload: { featureName, action: 'hard_block', fallbackAction: gate.fallbackAction || 'none' },
      });
      return { mode: 'block', allowed: false, blocked: true, fallbackUsed: false, featureName };
    }

    emitEvent('unsupportedFeatureFallbackUsed', {
      status: 'fallback',
      reason: `unsupported_feature_fallback:${featureName}`,
      payload: { featureName, action: 'explicit_fallback', fallbackAction: gate.fallbackAction || 'none' },
    });
    return { mode: 'fallback', allowed: true, blocked: false, fallbackUsed: true, featureName };
  }

  function applyRestrictionPolicy(restrictionName, restricted, payload = {}) {
    if (!restricted || normalizedConfig.exchangeRestrictionPolicy === 'off') return { restricted: false, mode: 'off' };
    if (normalizedConfig.exchangeRestrictionPolicy === 'warn_only') {
      emitEvent('exchangeRestrictionApplied', {
        status: 'warning',
        reason: `restriction_warning_only:${restrictionName}`,
        payload: { restrictionName, restrictionMode: 'warn_only', ...payload },
      });
      return { restricted: false, mode: 'warn_only' };
    }
    emitEvent('exchangeRestrictionApplied', {
      status: 'restricted',
      reason: `restriction_enforced:${restrictionName}`,
      payload: { restrictionName, restrictionMode: 'enforce', ...payload },
    });
    return { restricted: true, mode: 'enforce' };
  }

  const executionContext = {
    activeExchange: normalizedConfig.activeExchange,
    capabilityContract: contract,
    featureGates: {
      reduceOnlySemantics: reduceOnlyGate,
      reconciliationSupport: reconciliationGate,
    },
    restrictionContext: contract.executionFacingCapabilities.exchangeSpecificRestrictions,
  };

  const protectiveContext = {
    activeExchange: normalizedConfig.activeExchange,
    capabilityContract: contract,
    featureGates: {
      serverTpSupport: serverTpGate,
      serverSlSupport: serverSlGate,
    },
    restrictionContext: contract.executionFacingCapabilities.orderLifecycleSpecifics,
  };

  const lifecycleContext = {
    activeExchange: normalizedConfig.activeExchange,
    capabilityContract: contract,
    restrictionContext: contract.executionFacingCapabilities.positionModeSideModeSpecifics,
    featureGates: {
      reconciliationSupport: reconciliationGate,
    },
  };

  const decisionInputFlags = {
    requiresExplicitPositionSide: !!(((contract.executionFacingCapabilities || {}).positionModeSideModeSpecifics || {}).details || {}).requiresExplicitPositionSide,
    hasServerTakeProfitSupport: serverTpGate.isAvailable === true,
    hasServerStopLossSupport: serverSlGate.isAvailable === true,
  };

  logger.log(
    `[exchangeRuntimeIntegration] activeExchange=${normalizedConfig.activeExchange} checks=${normalizedConfig.enableExchangeCapabilityChecks} safeUnsupportedFeatureMode=${normalizedConfig.safeUnsupportedFeatureMode} restrictionPolicy=${normalizedConfig.exchangeRestrictionPolicy} profileFound=${contract.profileFound} bingxBaseline=${normalizedConfig.bingxBaselineReference}`,
  );

  return {
    config: normalizedConfig,
    contract,
    capabilityDecisionTrace,
    executionContext,
    protectiveContext,
    lifecycleContext,
    reconciliationContext: lifecycleContext,
    decisionInputFlags,
    resolveUnsupportedFeature,
    applyRestrictionPolicy,
    ownershipSafety: { ...(contract.ownershipSafety || {}) },
  };
}

module.exports = {
  normalizeExchangeRuntimeConfig,
  createExchangeRuntimeIntegration,
};
