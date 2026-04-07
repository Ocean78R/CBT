'use strict';

/**
 * Русский комментарий:
 * Дедупликация execution-действий:
 * - active: действие в процессе;
 * - completed: действие уже завершено и не должно дублироваться.
 */
function createActionDedup() {
  const active = new Set();
  const completed = new Set();

  function tryStart(actionKey) {
    if (completed.has(actionKey)) {
      return { allowed: false, reason: 'already_completed' };
    }

    if (active.has(actionKey)) {
      return { allowed: false, reason: 'already_in_progress' };
    }

    active.add(actionKey);
    return { allowed: true, reason: null };
  }

  function finish(actionKey, { markCompleted = true } = {}) {
    active.delete(actionKey);
    if (markCompleted) {
      completed.add(actionKey);
    }
  }

  function clearCompleted() {
    completed.clear();
  }

  return {
    tryStart,
    finish,
    clearCompleted,
  };
}

module.exports = {
  createActionDedup,
};
