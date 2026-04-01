'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const policyPath = path.join(repoRoot, 'docs', 'DOCUMENTATION_UPDATE_POLICY_RU.md');
const changelogPath = path.join(repoRoot, 'docs', 'DOCUMENTATION_CHANGELOG_RU.md');
const userDocsRoot = path.join(repoRoot, 'docs', 'user');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function checkCoreDocsExist() {
  assert(fs.existsSync(policyPath), 'Не найден docs/DOCUMENTATION_UPDATE_POLICY_RU.md');
  assert(fs.existsSync(changelogPath), 'Не найден docs/DOCUMENTATION_CHANGELOG_RU.md');
  assert(fs.existsSync(userDocsRoot), 'Не найдена директория docs/user');

  const requiredUserDocs = [
    'README_RU.md',
    'RUN_AND_MODES_RU.md',
    'TRADING_PIPELINE_RU.md',
    'RISK_AND_PROTECTION_RU.md',
    'CONFIG_GUIDE_RU.md',
    'LOGS_AND_TROUBLESHOOTING_RU.md',
  ];

  requiredUserDocs.forEach((name) => {
    const fullPath = path.join(userDocsRoot, name);
    assert(fs.existsSync(fullPath), `Не найден обязательный пользовательский документ: docs/user/${name}`);
  });
}

function listChangedFiles() {
  // Русский комментарий: используем porcelain-статус, чтобы учитывать и модифицированные, и новые (untracked) файлы.
  const output = cp.execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(3));
}

function isCodeFile(filePath) {
  return (filePath.startsWith('dist/') || filePath.startsWith('scripts/') || filePath.startsWith('tests/'))
    && !filePath.startsWith('docs/');
}

function checkDocsUpdatedWhenCodeChanges() {
  const changedFiles = listChangedFiles();
  const hasCodeChanges = changedFiles.some(isCodeFile);
  if (!hasCodeChanges) {
    return;
  }

  const hasDocsChanges = changedFiles.some((filePath) => filePath.startsWith('docs/'));
  // Русский комментарий: если меняется код торгового проекта, обязателен синхронный апдейт документации.
  assert(hasDocsChanges, 'Обнаружены изменения кода без обновления docs/*');

  const hasPolicyOrChangelogTouch = changedFiles.includes('docs/DOCUMENTATION_CHANGELOG_RU.md')
    || changedFiles.includes('docs/DOCUMENTATION_UPDATE_POLICY_RU.md');

  assert(
    hasPolicyOrChangelogTouch,
    'При изменениях кода необходимо обновить docs/DOCUMENTATION_CHANGELOG_RU.md (или policy при изменении правил).',
  );
}

function runDocumentationChecks() {
  checkCoreDocsExist();
  checkDocsUpdatedWhenCodeChanges();
}

module.exports = { runDocumentationChecks };
