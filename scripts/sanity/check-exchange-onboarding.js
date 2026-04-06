'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  EXCHANGE_CAPABILITY_MATRIX,
  ensureDomainCompleteness,
  createUnifiedExchangeContract,
  CAPABILITY_FALLBACK_DECISIONS,
} = require('../../dist/runtime/exchange/exchangeCapabilityMatrix');
const { createExchangeRuntimeIntegration } = require('../../dist/runtime/exchange/exchangeRuntimeIntegration');

const repoRoot = path.resolve(__dirname, '..', '..');
const onboardingDocPath = path.join(repoRoot, 'docs', 'user', 'EXCHANGE_ONBOARDING_FLOW_RU.md');
const capabilityDocPath = path.join(repoRoot, 'docs', 'user', 'EXCHANGE_CAPABILITY_MATRIX_CONTRACT_RU.md');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function checkCapabilityCompleteness() {
  const exchanges = Object.keys(EXCHANGE_CAPABILITY_MATRIX);
  assert(exchanges.length > 0, 'Матрица capability пуста: нет ни одного exchange-профиля.');
  assert(exchanges.includes('bingx'), 'В матрице отсутствует baseline-профиль bingx.');

  exchanges.forEach((exchangeName) => {
    const profile = EXCHANGE_CAPABILITY_MATRIX[exchangeName];
    const completeness = ensureDomainCompleteness(profile);
    assert(
      completeness.isComplete,
      `Профиль ${exchangeName} неполный: отсутствуют домены ${completeness.missingDomains.join(', ')}`,
    );
  });
}

function checkUnsupportedFeatureExposure() {
  const integrationFallback = createExchangeRuntimeIntegration({
    activeExchange: 'unknown_exchange',
    enableExchangeCapabilityChecks: true,
    safeUnsupportedFeatureMode: 'fallback',
  });
  const integrationDisable = createExchangeRuntimeIntegration({
    activeExchange: 'unknown_exchange',
    enableExchangeCapabilityChecks: true,
    safeUnsupportedFeatureMode: 'disable',
  });
  const integrationBlock = createExchangeRuntimeIntegration({
    activeExchange: 'unknown_exchange',
    enableExchangeCapabilityChecks: true,
    safeUnsupportedFeatureMode: 'block',
  });

  const gate = integrationFallback.protectiveContext.featureGates.serverTpSupport;
  const fallbackResult = integrationFallback.resolveUnsupportedFeature('serverTpSupport', gate);
  const disableResult = integrationDisable.resolveUnsupportedFeature('serverTpSupport', gate);
  const blockResult = integrationBlock.resolveUnsupportedFeature('serverTpSupport', gate);

  assert(fallbackResult.mode === 'fallback' && fallbackResult.fallbackUsed === true, 'Fallback-ветка unsupported feature не сработала явно.');
  assert(disableResult.mode === 'disable' && disableResult.allowed === false, 'Disable-ветка unsupported feature не сработала явно.');
  assert(blockResult.mode === 'block' && blockResult.blocked === true, 'Block-ветка unsupported feature не сработала явно.');
}

function checkContractValidation() {
  const bingxContract = createUnifiedExchangeContract('bingx');
  const unknownContract = createUnifiedExchangeContract('unknown_exchange');

  assert(bingxContract.profileFound === true, 'BingX baseline должен оставаться валидным профилем.');
  assert(
    bingxContract.ownershipSafety && bingxContract.ownershipSafety.canBecomeDecisionOwner === false,
    'Exchange-layer не должен становиться decision owner для BingX baseline.',
  );

  assert(unknownContract.profileFound === false, 'Unknown exchange должен явно помечаться как profileFound=false.');
  assert(
    unknownContract.safeFallback.unknownCapabilityMode === CAPABILITY_FALLBACK_DECISIONS.SAFE_NOOP_AND_LOG,
    'Unknown exchange должен уходить в safe_noop_and_log.',
  );
}

function checkOnboardingDocsPresence() {
  assert(fs.existsSync(onboardingDocPath), 'Не найден onboarding-документ docs/user/EXCHANGE_ONBOARDING_FLOW_RU.md');
  assert(fs.existsSync(capabilityDocPath), 'Не найден capability-документ docs/user/EXCHANGE_CAPABILITY_MATRIX_CONTRACT_RU.md');

  const onboardingText = fs.readFileSync(onboardingDocPath, 'utf8').toLowerCase();
  const requiredFragments = [
    'capability matrix',
    'contract validation',
    'unsupported',
    'restricted runtime mode',
    'tests before enabling production usage',
    'bingx',
  ];
  requiredFragments.forEach((fragment) => {
    assert(onboardingText.includes(fragment), `В onboarding-документе отсутствует обязательный фрагмент: ${fragment}`);
  });
}

function runExchangeOnboardingSanityChecks() {
  checkCapabilityCompleteness();
  checkUnsupportedFeatureExposure();
  checkContractValidation();
  checkOnboardingDocsPresence();
}

module.exports = {
  runExchangeOnboardingSanityChecks,
};

