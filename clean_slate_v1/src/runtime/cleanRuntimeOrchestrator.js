'use strict';

const { evaluateFlatStartContract } = require('../bootstrap/flatStartGuard');
const { buildStartupReport } = require('../bootstrap/startupReport');

/**
 * Русский комментарий:
 * Оркестратор clean-slate runtime.
 * Управляет входом через EntryOwner и сопровождением через PositionOwner.
 */
class CleanRuntimeOrchestrator {
  constructor({ entryOwner, positionOwner, stateGateway, startupMode = 'paper' }) {
    this.entryOwner = entryOwner;
    this.positionOwner = positionOwner;
    this.stateGateway = stateGateway;
    this.startupMode = startupMode;
  }

  async boot() {
    const flatStartState = await this.stateGateway.readFlatStartState();
    const contract = evaluateFlatStartContract(flatStartState);
    const startupReport = buildStartupReport({
      contractResult: contract,
      startupMode: this.startupMode,
    });

    if (!contract.passed) {
      return {
        ready: false,
        runtimeMode: 'safe_mode',
        startupReport,
      };
    }

    return {
      ready: true,
      runtimeMode: this.startupMode === 'shadow' ? 'shadow_observe_only' : 'trading_enabled',
      startupReport,
    };
  }

  async runEntryCycle(decisionContext) {
    return this.entryOwner.openNewPosition(decisionContext);
  }

  async runPositionCycle(positionContext) {
    return this.positionOwner.processExistingPosition(positionContext);
  }
}

module.exports = {
  CleanRuntimeOrchestrator,
};
