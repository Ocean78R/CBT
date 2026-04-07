'use strict';

/**
 * Русский комментарий:
 * Формирует структурированный startup-report для flat-start gate.
 */
function buildStartupReport({ contractResult, startupMode }) {
  const mode = startupMode || 'paper';

  return {
    startupMode: mode,
    flatStartStatus: contractResult.passed ? 'passed' : 'failed',
    runtimeMode: contractResult.runtimeMode,
    reasonCodes: contractResult.blockers.map((b) => b.code),
    blockers: contractResult.blockers,
    cleanupChecklist: contractResult.cleanupActions,
    safeToTrade: contractResult.passed && mode !== 'shadow_observe_only',
    summary: contractResult.passed
      ? 'Flat-start contract пройден. Торговый контур может быть включён в выбранном режиме.'
      : 'Flat-start contract нарушен. Новый робот переведён в safe_mode до очистки состояния.',
  };
}

module.exports = {
  buildStartupReport,
};
