const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('docs/config/runtime consistency для onboarding новой биржи зафиксирована явно', () => {
  const onboardingDoc = read('docs/user/EXCHANGE_ONBOARDING_FLOW_RU.md').toLowerCase();
  const capabilityDoc = read('docs/user/EXCHANGE_CAPABILITY_MATRIX_CONTRACT_RU.md').toLowerCase();
  const configGuide = read('docs/user/CONFIG_GUIDE_RU.md').toLowerCase();

  [
    'capability matrix',
    'contract validation',
    'safe unsupported-feature behavior',
    'restricted runtime mode',
    'tests before enabling production usage',
  ].forEach((section) => {
    assert.equal(onboardingDoc.includes(section), true, `В onboarding-doc отсутствует раздел: ${section}`);
  });

  [
    'exchange-agnostic',
    'exchange-specific',
    'bingx',
  ].forEach((fragment) => {
    assert.equal(capabilityDoc.includes(fragment), true, `В capability-doc отсутствует обязательный фрагмент: ${fragment}`);
  });

  [
    'activeexchange',
    'safeunsupportedfeaturemode',
    'exchangerestrictionpolicy',
    'bingx',
  ].forEach((fragment) => {
    assert.equal(configGuide.includes(fragment), true, `В config guide отсутствует обязательный onboarding-фрагмент: ${fragment}`);
  });
});

