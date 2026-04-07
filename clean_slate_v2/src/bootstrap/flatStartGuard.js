'use strict';

/**
 * Русский комментарий:
 * Flat-start contract для канонического clean-slate v2 runtime.
 * Запуск разрешён только из чистого состояния без legacy-хвостов.
 */
const DEFAULT_FLAT_START_STATE = {
  openPositions: [],
  activeOrders: [],
  protectiveStateMarkers: [],
  legacyMismatchRestrictedState: [],
};

function normalizeFlatStartState(state = {}) {
  return {
    openPositions: Array.isArray(state.openPositions) ? state.openPositions : [],
    activeOrders: Array.isArray(state.activeOrders) ? state.activeOrders : [],
    protectiveStateMarkers: Array.isArray(state.protectiveStateMarkers) ? state.protectiveStateMarkers : [],
    legacyMismatchRestrictedState: Array.isArray(state.legacyMismatchRestrictedState)
      ? state.legacyMismatchRestrictedState
      : [],
  };
}

function evaluateFlatStartContract(rawState) {
  const state = normalizeFlatStartState(rawState || DEFAULT_FLAT_START_STATE);
  const blockers = [];
  const cleanupActions = [];

  if (state.openPositions.length > 0) {
    blockers.push({
      code: 'open_positions_detected',
      details: { tickers: state.openPositions.map((p) => p.ticker || p.symbol || 'UNKNOWN') },
    });
    cleanupActions.push('Закрыть все открытые позиции и подтвердить нулевую экспозицию.');
  }

  if (state.activeOrders.length > 0) {
    blockers.push({
      code: 'orphan_orders_detected',
      details: { orderIds: state.activeOrders.map((o) => o.orderId || o.id || 'UNKNOWN') },
    });
    cleanupActions.push('Отменить активные/сиротские ордера и дождаться их исчезновения из биржевого стейта.');
  }

  if (state.protectiveStateMarkers.length > 0) {
    blockers.push({
      code: 'legacy_protective_state_detected',
      details: { markers: state.protectiveStateMarkers },
    });
    cleanupActions.push('Очистить legacy protective-state markers (локально и/или на сервере).');
  }

  if (state.legacyMismatchRestrictedState.length > 0) {
    blockers.push({
      code: 'legacy_restricted_state_detected',
      details: { markers: state.legacyMismatchRestrictedState },
    });
    cleanupActions.push('Сбросить legacy mismatch/restricted state до валидного clean-slate состояния.');
  }

  const passed = blockers.length === 0;
  return {
    passed,
    runtimeMode: passed ? 'trading_enabled' : 'safe_mode',
    blockers,
    cleanupActions,
    observedState: state,
  };
}

module.exports = {
  DEFAULT_FLAT_START_STATE,
  normalizeFlatStartState,
  evaluateFlatStartContract,
};
