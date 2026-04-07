'use strict';

/**
 * Русский комментарий:
 * Минимальная structured logging схема для clean-slate runtime.
 * Лог хранится как нормализованный JSON-объект со стабильными полями.
 */
function normalizeReasonCodes(reasonCodes) {
  return Array.isArray(reasonCodes) ? reasonCodes.filter(Boolean) : [];
}

function validateLogRecord(record) {
  if (!record || typeof record !== 'object') {
    return { ok: false, reason: 'record_not_object' };
  }
  if (!record.ts || typeof record.ts !== 'string') {
    return { ok: false, reason: 'ts_missing' };
  }
  if (!record.level || typeof record.level !== 'string') {
    return { ok: false, reason: 'level_missing' };
  }
  if (!record.event || typeof record.event !== 'string') {
    return { ok: false, reason: 'event_missing' };
  }
  if (!Array.isArray(record.reasonCodes)) {
    return { ok: false, reason: 'reason_codes_invalid' };
  }
  return { ok: true, reason: null };
}

function createStructuredLogger({
  writer = () => {},
  now = () => new Date().toISOString(),
} = {}) {
  function log({
    level = 'info',
    event,
    cycleId = '',
    mode = 'paper',
    asset = '',
    reasonCodes = [],
    details = {},
  }) {
    const record = {
      ts: now(),
      level,
      event: event || 'runtime_event',
      cycleId,
      mode,
      asset,
      reasonCodes: normalizeReasonCodes(reasonCodes),
      details: details && typeof details === 'object' ? details : {},
    };

    const validation = validateLogRecord(record);
    if (!validation.ok) {
      return {
        accepted: false,
        reason: validation.reason,
        record,
      };
    }

    writer(record);
    return {
      accepted: true,
      reason: null,
      record,
    };
  }

  return { log };
}

module.exports = {
  createStructuredLogger,
  validateLogRecord,
};
