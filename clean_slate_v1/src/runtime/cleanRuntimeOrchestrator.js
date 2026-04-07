'use strict';

const { evaluateFlatStartContract } = require('../bootstrap/flatStartGuard');

/**
 * Русский комментарий:
 * Оркестратор clean-slate runtime.
 * Управляет входом через EntryOwner и сопровождением через PositionOwner.
 */
class CleanRuntimeOrchestrator {
  constructor({ entryOwner, positionOwner, stateGateway }) {
    this.entryOwner = entryOwner;
    this.positionOwner = positionOwner;
    this.stateGateway = stateGateway;
  }

  async boot() {
    const flatStartState = await this.stateGateway.readFlatStartState();
    const contract = evaluateFlatStartContract(flatStartState);

    if (!contract.passed) {
      return {
        ready: false,
        runtimeMode: 'safe_mode',
        diagnostics: contract.diagnostics,
      };
    }

    return {
      ready: true,
      runtimeMode: 'trading_enabled',
      diagnostics: [],
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
