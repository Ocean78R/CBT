'use strict';

/**
 * Русский комментарий:
 * Журнал execution-событий новой clean-slate версии.
 * События сохраняются в памяти и могут отправляться во внешний writer.
 */
function createExecutionJournal({ writer = null, now = () => new Date().toISOString() } = {}) {
  const records = [];

  function record({ event, actionId = null, cycleId = null, asset = null, details = {} }) {
    const entry = {
      ts: now(),
      event,
      actionId,
      cycleId,
      asset,
      details,
    };

    records.push(entry);
    if (typeof writer === 'function') {
      writer(entry);
    }

    return entry;
  }

  function list() {
    return records.slice();
  }

  return {
    record,
    list,
  };
}

module.exports = {
  createExecutionJournal,
};
