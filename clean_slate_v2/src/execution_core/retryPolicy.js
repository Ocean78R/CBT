'use strict';

/**
 * Русский комментарий:
 * Bounded retry policy для execution core.
 */
function createRetryPolicy({
  maxAttempts = 3,
  retryableCodes = ['network_timeout', 'rate_limited', 'temporary_exchange_error'],
} = {}) {
  const retryableSet = new Set(retryableCodes);

  function shouldRetry({ attempt, errorCode }) {
    if (attempt >= maxAttempts) {
      return { allowed: false, reason: 'max_attempts_reached' };
    }

    if (!retryableSet.has(errorCode)) {
      return { allowed: false, reason: 'non_retryable_error' };
    }

    return { allowed: true, reason: 'retryable_error' };
  }

  return {
    maxAttempts,
    shouldRetry,
  };
}

module.exports = {
  createRetryPolicy,
};
