'use strict';

/**
 * Русский комментарий:
 * Единый owner-path контракт канонической clean-slate v2 версии.
 * Защищает runtime от случайного возврата к legacy owner-цепочке.
 */
const OWNER_PATH_CONTRACT = {
  forbiddenLegacyOwners: ['openNewPositionLegacy', 'processExistingPositionLegacy'],
  requiredOwners: {
    entryOwner: 'entryExecutionOwner.submitApprovedEntry',
    positionOwner: 'closeExecutionOwner.submitCloseRequest',
    lifecycleOwner: 'positionLifecycleManager',
    sizingOwner: 'dynamicPositionSizing',
    decisionOwner: 'finalEntryDecisionEngine',
  },
};

module.exports = {
  OWNER_PATH_CONTRACT,
};
