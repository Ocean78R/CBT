const test = require('node:test');
const assert = require('node:assert/strict');

const { runExchangeOnboardingSanityChecks } = require('../../scripts/sanity/check-exchange-onboarding');

test('sanity checks: onboarding exchange capability контракт остаётся безопасным и полным', () => {
  assert.doesNotThrow(() => runExchangeOnboardingSanityChecks());
});

