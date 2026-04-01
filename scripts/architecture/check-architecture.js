'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const contractPath = path.join(repoRoot, 'docs', 'ARCHITECTURE_CONTRACT_RU.md');
const runtimeRoot = path.join(repoRoot, 'dist', 'runtime');
const indexPath = path.join(repoRoot, 'dist', 'index.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function checkContractDocument() {
  assert(fs.existsSync(contractPath), 'Не найден архитектурный контракт docs/ARCHITECTURE_CONTRACT_RU.md');
  const text = fs.readFileSync(contractPath, 'utf8').toLowerCase();
  const requiredSections = [
    'decisioncontext',
    'marketsnapshot',
    'featuresnapshot',
    'featurestore',
    'staged evaluation pipeline',
    'lifecycle ownership path',
    'таблица соответствия будущих шагов',
  ];

  requiredSections.forEach((section) => {
    assert(text.includes(section), `В архитектурном документе отсутствует обязательный раздел: ${section}`);
  });
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return [fullPath];
  });
}

function checkRuntimeImports() {
  const files = walk(runtimeRoot).filter((x) => x.endsWith('.js'));
  const forbiddenPattern = /require\((['"])\.\.\/\.\.\/index\.js\1\)/;

  files.forEach((file) => {
    const content = fs.readFileSync(file, 'utf8');
    assert(!forbiddenPattern.test(content), `Нарушение слоёв: ${path.relative(repoRoot, file)} импортирует dist/index.js`);
  });
}

function checkIndexSizeLimit() {
  const stat = fs.statSync(indexPath);
  const limitBytes = 20_000_000;
  assert(stat.size <= limitBytes, `dist/index.js превышает лимит ${limitBytes} байт`);
}


function checkDocumentationPolicy() {
  const docsPolicyPath = path.join(repoRoot, 'docs', 'DOCUMENTATION_UPDATE_POLICY_RU.md');
  const docsChangelogPath = path.join(repoRoot, 'docs', 'DOCUMENTATION_CHANGELOG_RU.md');

  // Русский комментарий: архитектурный контракт закрепляет обязательность документации как часть runtime-дисциплины проекта.
  assert(fs.existsSync(docsPolicyPath), 'Не найден docs/DOCUMENTATION_UPDATE_POLICY_RU.md');
  assert(fs.existsSync(docsChangelogPath), 'Не найден docs/DOCUMENTATION_CHANGELOG_RU.md');
}

function runArchitectureChecks() {
  checkContractDocument();
  checkDocumentationPolicy();
  checkRuntimeImports();
  checkIndexSizeLimit();
}

module.exports = { runArchitectureChecks };
