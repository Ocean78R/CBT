'use strict';

/**
 * Русский комментарий:
 * Проверяет flat-start contract перед запуском нового runtime.
 * При нарушении контракта запуск торговли запрещается.
 */
function evaluateFlatStartContract(state) {
  const diagnostics = [];

  if (state.hasOpenPositions) diagnostics.push('open_positions_detected');
  if (state.hasOrphanOrders) diagnostics.push('orphan_orders_detected');
  if (state.hasLegacyProtectiveState) diagnostics.push('legacy_protective_state_detected');
  if (state.hasLegacyRestrictedState) diagnostics.push('legacy_restricted_state_detected');

  const passed = diagnostics.length === 0;
  return {
    passed,
    runtimeMode: passed ? 'trading_enabled' : 'safe_mode',
    diagnostics,
  };
}

module.exports = {
  evaluateFlatStartContract,
};
