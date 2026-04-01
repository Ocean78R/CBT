const test = require('node:test');
const assert = require('node:assert/strict');

const { runDocumentationChecks } = require('../../scripts/docs/check-documentation');

test('документационная политика и обязательные пользовательские разделы соблюдены', () => {
  assert.doesNotThrow(() => runDocumentationChecks());
});
