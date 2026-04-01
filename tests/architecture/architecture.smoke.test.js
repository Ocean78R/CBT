const test = require('node:test');
const assert = require('node:assert/strict');

const { runArchitectureChecks } = require('../../scripts/architecture/check-architecture');

test('архитектурный контракт и базовые ограничения структуры соблюдены', () => {
  assert.doesNotThrow(() => runArchitectureChecks());
});
