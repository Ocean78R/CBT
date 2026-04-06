const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRuntimeConfig } = require('../../dist/runtime/config/runtimeConfigValidator');

function createUtilsConfig() {
  return {
    getCoreConfig: (globalConfig) => globalConfig || {},
    getExchangeConfig: (exchangeConfig) => exchangeConfig || {},
    merge: (base, extra) => ({ ...(base || {}), ...(extra || {}) }),
  };
}

test('safe canary preset: нормализуется в защитный профиль и не ломает runtime config flow', () => {
  const cfg = buildRuntimeConfig(createUtilsConfig(), {
    loopsLength: 1,
    intervalSeconds: 120,
    safeStartupPresets: {
      liveCanaryV1: {
        enabled: true,
        execution: {
          allowedTickers: ['BTC', 'ETH'],
          maxTickers: 2,
          minPositionMarginSize: 2,
          disableAveraging: true,
        },
        decision: {
          disableWeakEntry: true,
        },
        risk: {
          forceCapitalRegime: 'CAPITAL_PRESERVATION',
          maxNewEntriesPerCycle: 1,
          maxNewEntriesPerDay: 1,
        },
        observability: {
          fullDecisionTrace: true,
        },
        stopConditions: {
          stopAfterCompletedCycles: 1,
          maxRuntimeMinutes: 20,
        },
      },
    },
    preLiveChecklist: {
      configSanity: true,
      modelAvailability: true,
      exchangeCapabilityChecks: true,
      protectiveManagersReady: true,
      paperModeLastPassCompleted: true,
      restartSafetyConfirmed: true,
    },
  }, {});

  const preset = cfg.safeStartupPresets.liveCanaryV1;
  assert.equal(preset.enabled, true);
  assert.equal(preset.execution.allowedTickers.length, 2);
  assert.equal(preset.execution.maxTickers, 2);
  assert.equal(preset.execution.disableAveraging, true);
  assert.equal(preset.decision.disableWeakEntry, true);
  assert.equal(preset.risk.forceCapitalRegime, 'CAPITAL_PRESERVATION');
  assert.equal(preset.risk.maxNewEntriesPerCycle, 1);
  assert.equal(preset.observability.fullDecisionTrace, true);
  assert.equal(preset.stopConditions.stopAfterCompletedCycles, 1);
  assert.equal(preset.stopConditions.maxRuntimeMinutes, 20);

  assert.equal(cfg.preLiveChecklist.configSanity, true);
  assert.equal(cfg.preLiveChecklist.modelAvailability, true);
  assert.equal(cfg.preLiveChecklist.exchangeCapabilityChecks, true);
  assert.equal(cfg.preLiveChecklist.protectiveManagersReady, true);
  assert.equal(cfg.preLiveChecklist.paperModeLastPassCompleted, true);
  assert.equal(cfg.preLiveChecklist.restartSafetyConfirmed, true);
});
