'use strict';

const CAPABILITY_STATES = {
  SUPPORTED: 'supported',
  UNSUPPORTED: 'unsupported',
  PARTIAL: 'partial',
  UNKNOWN: 'unknown',
};

const CAPABILITY_FALLBACK_DECISIONS = {
  USE_LOCAL_PROTECTIVE_FALLBACK: 'use_local_protective_fallback',
  SAFE_NOOP_AND_LOG: 'safe_noop_and_log',
  BLOCK_RISKY_ACTION: 'block_risky_action',
  RECONCILIATION_MINIMAL: 'reconciliation_minimal',
  MARKET_DATA_DEGRADED: 'market_data_degraded',
};

const CAPABILITY_DOMAINS = {
  SERVER_TP_SUPPORT: 'serverTpSupport',
  SERVER_SL_SUPPORT: 'serverSlSupport',
  REDUCE_ONLY_SEMANTICS: 'reduceOnlySemantics',
  ORDER_LIFECYCLE_SPECIFICS: 'orderLifecycleSpecifics',
  RECONCILIATION_SUPPORT: 'reconciliationSupport',
  POSITION_MODE_SPECIFICS: 'positionModeSideModeSpecifics',
  SIGNAL_DATA_AVAILABILITY: 'signalDataAvailability',
  EXECUTION_RESTRICTIONS: 'executionRestrictions',
};

const REQUIRED_CAPABILITY_DOMAINS = Object.values(CAPABILITY_DOMAINS);

// Русский комментарий: capability matrix должна быть явной и машиночитаемой, без скрытых if-веток по коду.
const EXCHANGE_CAPABILITY_MATRIX = {
  bingx: {
    exchange: 'bingx',
    baselineProfile: 'BINGX_STEP39_BASELINE',
    executionFacing: {
      marketOrder: CAPABILITY_STATES.SUPPORTED,
      limitOrder: CAPABILITY_STATES.SUPPORTED,
      reduceOnlySemantics: CAPABILITY_STATES.SUPPORTED,
      hedgeMode: CAPABILITY_STATES.PARTIAL,
      oneWayMode: CAPABILITY_STATES.SUPPORTED,
      allowedPositionSides: ['LONG', 'SHORT'],
    },
    protectiveOrders: {
      serverTpSupport: CAPABILITY_STATES.SUPPORTED,
      serverSlSupport: CAPABILITY_STATES.SUPPORTED,
      closeOnlySemantics: CAPABILITY_STATES.SUPPORTED,
      requiresReduceOnlyFlag: true,
      fallbackWhenUnavailable: CAPABILITY_FALLBACK_DECISIONS.USE_LOCAL_PROTECTIVE_FALLBACK,
    },
    reconciliation: {
      snapshotSync: CAPABILITY_STATES.SUPPORTED,
      orphanProtectiveCleanup: CAPABILITY_STATES.SUPPORTED,
      positionCapabilityStateSupport: CAPABILITY_STATES.SUPPORTED,
      leverageMismatchDetection: CAPABILITY_STATES.SUPPORTED,
    },
    marketDataAvailability: {
      markPrice: CAPABILITY_STATES.SUPPORTED,
      kline: CAPABILITY_STATES.SUPPORTED,
      orderBook: CAPABILITY_STATES.PARTIAL,
      fundingRate: CAPABILITY_STATES.PARTIAL,
      oiHistory: CAPABILITY_STATES.UNKNOWN,
      signalLayerDataQualityDefault: 'ok',
    },
    restrictionContracts: {
      orderLifecycleSpecifics: {
        cancelBeforeReplaceProtective: true,
        requiresPositionContextForProtectiveOrders: true,
      },
      positionModeSideModeSpecifics: {
        requiresExplicitPositionSide: true,
        sideMode: 'long_short_explicit',
      },
      executionRestrictions: {
        forbidAssumeUniversalReduceOnly: true,
        forbidAssumeUniformOrderIds: true,
      },
    },
  },
};

const FORBIDDEN_ASSUMPTIONS = [
  'decision_layers_24_39_must_not_embed_bingx_specific_conditions',
  'signal_and_lifecycle_layers_must_not_infer_exchange_behavior_without_capability_contract',
  'hard_risk_capital_forecast_and_final_decision_ownership_cannot_be_overridden_by_exchange_specific_flags',
  'unknown_capability_must_not_be_interpreted_as_supported',
];

function createNullLogger() {
  return {
    log: () => {},
    warn: () => {},
  };
}

function normalizeExchangeName(exchangeName) {
  return String(exchangeName || '').trim().toLowerCase();
}

function createDomainFallback(domain, reasonCode) {
  const base = {
    status: CAPABILITY_STATES.UNKNOWN,
    isAvailable: false,
    reasonCode,
    fallbackAction: CAPABILITY_FALLBACK_DECISIONS.SAFE_NOOP_AND_LOG,
  };

  if (domain === CAPABILITY_DOMAINS.SERVER_TP_SUPPORT || domain === CAPABILITY_DOMAINS.SERVER_SL_SUPPORT) {
    return {
      ...base,
      fallbackAction: CAPABILITY_FALLBACK_DECISIONS.USE_LOCAL_PROTECTIVE_FALLBACK,
    };
  }
  if (domain === CAPABILITY_DOMAINS.RECONCILIATION_SUPPORT) {
    return {
      ...base,
      fallbackAction: CAPABILITY_FALLBACK_DECISIONS.RECONCILIATION_MINIMAL,
    };
  }
  if (domain === CAPABILITY_DOMAINS.SIGNAL_DATA_AVAILABILITY) {
    return {
      ...base,
      fallbackAction: CAPABILITY_FALLBACK_DECISIONS.MARKET_DATA_DEGRADED,
    };
  }

  return base;
}

function ensureDomainCompleteness(capabilityProfile = {}) {
  const availableDomains = {
    [CAPABILITY_DOMAINS.SERVER_TP_SUPPORT]: capabilityProfile.protectiveOrders
      ? capabilityProfile.protectiveOrders.serverTpSupport
      : undefined,
    [CAPABILITY_DOMAINS.SERVER_SL_SUPPORT]: capabilityProfile.protectiveOrders
      ? capabilityProfile.protectiveOrders.serverSlSupport
      : undefined,
    [CAPABILITY_DOMAINS.REDUCE_ONLY_SEMANTICS]: capabilityProfile.executionFacing
      ? capabilityProfile.executionFacing.reduceOnlySemantics
      : undefined,
    [CAPABILITY_DOMAINS.ORDER_LIFECYCLE_SPECIFICS]: capabilityProfile.restrictionContracts
      ? capabilityProfile.restrictionContracts.orderLifecycleSpecifics
      : undefined,
    [CAPABILITY_DOMAINS.RECONCILIATION_SUPPORT]: capabilityProfile.reconciliation,
    [CAPABILITY_DOMAINS.POSITION_MODE_SPECIFICS]: capabilityProfile.restrictionContracts
      ? capabilityProfile.restrictionContracts.positionModeSideModeSpecifics
      : undefined,
    [CAPABILITY_DOMAINS.SIGNAL_DATA_AVAILABILITY]: capabilityProfile.marketDataAvailability,
    [CAPABILITY_DOMAINS.EXECUTION_RESTRICTIONS]: capabilityProfile.restrictionContracts
      ? capabilityProfile.restrictionContracts.executionRestrictions
      : undefined,
  };

  const missingDomains = REQUIRED_CAPABILITY_DOMAINS.filter((domain) => availableDomains[domain] === undefined);
  return {
    isComplete: missingDomains.length === 0,
    missingDomains,
  };
}

function resolveCapabilityAvailability(value) {
  if (value === CAPABILITY_STATES.SUPPORTED) {
    return { status: CAPABILITY_STATES.SUPPORTED, isAvailable: true };
  }
  if (value === CAPABILITY_STATES.PARTIAL) {
    return { status: CAPABILITY_STATES.PARTIAL, isAvailable: true };
  }
  if (value === CAPABILITY_STATES.UNSUPPORTED) {
    return { status: CAPABILITY_STATES.UNSUPPORTED, isAvailable: false };
  }
  return { status: CAPABILITY_STATES.UNKNOWN, isAvailable: false };
}

function createUnifiedExchangeContract(exchangeName, options = {}) {
  const normalizedExchange = normalizeExchangeName(exchangeName);
  const logger = options.logger || createNullLogger();
  const profile = EXCHANGE_CAPABILITY_MATRIX[normalizedExchange] || null;

  if (!profile) {
    logger.warn(`[exchangeCapabilities] exchange=${normalizedExchange || 'unknown'} event=profile_missing fallback=safe_contract`);
    return {
      exchange: normalizedExchange || 'unknown',
      profileFound: false,
      profileCompleteness: { isComplete: false, missingDomains: [...REQUIRED_CAPABILITY_DOMAINS] },
      executionFacingCapabilities: {
        reduceOnlySemantics: createDomainFallback(CAPABILITY_DOMAINS.REDUCE_ONLY_SEMANTICS, 'profile_missing'),
        orderLifecycleSpecifics: createDomainFallback(CAPABILITY_DOMAINS.ORDER_LIFECYCLE_SPECIFICS, 'profile_missing'),
        positionModeSideModeSpecifics: createDomainFallback(CAPABILITY_DOMAINS.POSITION_MODE_SPECIFICS, 'profile_missing'),
        exchangeSpecificRestrictions: createDomainFallback(CAPABILITY_DOMAINS.EXECUTION_RESTRICTIONS, 'profile_missing'),
      },
      protectiveOrderCapabilities: {
        serverTpSupport: createDomainFallback(CAPABILITY_DOMAINS.SERVER_TP_SUPPORT, 'profile_missing'),
        serverSlSupport: createDomainFallback(CAPABILITY_DOMAINS.SERVER_SL_SUPPORT, 'profile_missing'),
      },
      reconciliationCapabilities: createDomainFallback(CAPABILITY_DOMAINS.RECONCILIATION_SUPPORT, 'profile_missing'),
      marketDataAvailabilityMetadata: createDomainFallback(CAPABILITY_DOMAINS.SIGNAL_DATA_AVAILABILITY, 'profile_missing'),
      ownershipSafety: {
        ownershipPathChanged: false,
        canBecomeDecisionOwner: false,
        canOverrideHardRisk: false,
        canOverrideCapitalRegime: false,
        canOverrideForecastRestrictions: false,
      },
      forbiddenAssumptions: [...FORBIDDEN_ASSUMPTIONS],
      decisionLayerInvariant: {
        decisionLayers24To39MustBeExchangeAgnostic: true,
        exchangeDifferencesOnlyThroughCapabilityLayer: true,
      },
      safeFallback: {
        unknownCapabilityMode: CAPABILITY_FALLBACK_DECISIONS.SAFE_NOOP_AND_LOG,
        partiallySupportedExchangeMode: CAPABILITY_FALLBACK_DECISIONS.BLOCK_RISKY_ACTION,
        unavailableFeatureMode: CAPABILITY_FALLBACK_DECISIONS.USE_LOCAL_PROTECTIVE_FALLBACK,
      },
    };
  }

  const completeness = ensureDomainCompleteness(profile);
  if (!completeness.isComplete) {
    logger.warn(`[exchangeCapabilities] exchange=${normalizedExchange} event=profile_incomplete missing=${completeness.missingDomains.join(',')}`);
  }

  const reduceOnlySemantics = resolveCapabilityAvailability(profile.executionFacing.reduceOnlySemantics);
  const serverTpSupport = resolveCapabilityAvailability(profile.protectiveOrders.serverTpSupport);
  const serverSlSupport = resolveCapabilityAvailability(profile.protectiveOrders.serverSlSupport);

  const contract = {
    exchange: normalizedExchange,
    profileFound: true,
    profileCompleteness: completeness,
    executionFacingCapabilities: {
      reduceOnlySemantics: {
        ...reduceOnlySemantics,
        fallbackAction: reduceOnlySemantics.isAvailable
          ? 'none'
          : CAPABILITY_FALLBACK_DECISIONS.BLOCK_RISKY_ACTION,
      },
      orderLifecycleSpecifics: {
        status: CAPABILITY_STATES.SUPPORTED,
        isAvailable: true,
        details: profile.restrictionContracts.orderLifecycleSpecifics,
      },
      positionModeSideModeSpecifics: {
        status: CAPABILITY_STATES.SUPPORTED,
        isAvailable: true,
        details: profile.restrictionContracts.positionModeSideModeSpecifics,
      },
      exchangeSpecificRestrictions: {
        status: CAPABILITY_STATES.SUPPORTED,
        isAvailable: true,
        details: profile.restrictionContracts.executionRestrictions,
      },
    },
    protectiveOrderCapabilities: {
      serverTpSupport: {
        ...serverTpSupport,
        fallbackAction: serverTpSupport.isAvailable
          ? 'none'
          : CAPABILITY_FALLBACK_DECISIONS.USE_LOCAL_PROTECTIVE_FALLBACK,
      },
      serverSlSupport: {
        ...serverSlSupport,
        fallbackAction: serverSlSupport.isAvailable
          ? 'none'
          : CAPABILITY_FALLBACK_DECISIONS.USE_LOCAL_PROTECTIVE_FALLBACK,
      },
      closeOnlySemantics: resolveCapabilityAvailability(profile.protectiveOrders.closeOnlySemantics),
    },
    reconciliationCapabilities: {
      status: CAPABILITY_STATES.SUPPORTED,
      isAvailable: true,
      details: profile.reconciliation,
      fallbackAction: 'none',
    },
    marketDataAvailabilityMetadata: {
      status: CAPABILITY_STATES.SUPPORTED,
      isAvailable: true,
      details: profile.marketDataAvailability,
      fallbackAction: 'none',
    },
    ownershipSafety: {
      ownershipPathChanged: false,
      canBecomeDecisionOwner: false,
      canOverrideHardRisk: false,
      canOverrideCapitalRegime: false,
      canOverrideForecastRestrictions: false,
    },
    forbiddenAssumptions: [...FORBIDDEN_ASSUMPTIONS],
    decisionLayerInvariant: {
      decisionLayers24To39MustBeExchangeAgnostic: true,
      exchangeDifferencesOnlyThroughCapabilityLayer: true,
    },
    safeFallback: {
      unknownCapabilityMode: CAPABILITY_FALLBACK_DECISIONS.SAFE_NOOP_AND_LOG,
      partiallySupportedExchangeMode: CAPABILITY_FALLBACK_DECISIONS.BLOCK_RISKY_ACTION,
      unavailableFeatureMode: CAPABILITY_FALLBACK_DECISIONS.USE_LOCAL_PROTECTIVE_FALLBACK,
    },
  };

  logger.log(`[exchangeCapabilities] exchange=${normalizedExchange} event=contract_resolved profile=${profile.baselineProfile} complete=${completeness.isComplete}`);
  return contract;
}

function resolveFeatureGate(contract = {}, section, capabilityName) {
  const sectionData = contract[section] || {};
  const capability = sectionData[capabilityName] || createDomainFallback(capabilityName, 'missing_contract_capability');
  const isAvailable = capability.isAvailable === true;
  const fallbackAction = capability.fallbackAction || CAPABILITY_FALLBACK_DECISIONS.SAFE_NOOP_AND_LOG;

  return {
    isAvailable,
    status: capability.status || CAPABILITY_STATES.UNKNOWN,
    fallbackAction,
    reasonCode: isAvailable ? 'capability_available' : `capability_unavailable:${capabilityName}`,
  };
}

module.exports = {
  CAPABILITY_STATES,
  CAPABILITY_DOMAINS,
  CAPABILITY_FALLBACK_DECISIONS,
  REQUIRED_CAPABILITY_DOMAINS,
  EXCHANGE_CAPABILITY_MATRIX,
  FORBIDDEN_ASSUMPTIONS,
  ensureDomainCompleteness,
  createUnifiedExchangeContract,
  resolveFeatureGate,
};
