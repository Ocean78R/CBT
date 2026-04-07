'use strict';

/**
 * Русский комментарий:
 * Контракт owner-path для clean-slate runtime.
 * Здесь явно запрещены вызовы legacy owner-методов.
 */
const OWNER_PATH_CONTRACT = {
  forbiddenLegacyOwners: ['openNewPositionLegacy', 'processExistingPositionLegacy'],
  requiredOwners: {
    entryOwner: 'EntryOwner.openNewPosition',
    positionOwner: 'PositionOwner.processExistingPosition',
    lifecycleOwner: 'PositionOwner.applyLifecycleActions',
    sizingOwner: 'dynamicPositionSizing',
    decisionOwner: 'finalEntryDecisionEngine',
  },
};

module.exports = {
  OWNER_PATH_CONTRACT,
};
