'use strict';

// Русский комментарий: единый контракт решения для всех будущих сигнальных/рисковых слоёв.
function createDecisionContext(data = {}) {
  return {
    cycleId: data.cycleId || '',
    ticker: data.ticker || '',
    regime: data.regime || 'unknown',
    mode: data.mode || 'fallback',
    score: Number.isFinite(data.score) ? Number(data.score) : 0,
    confidence: Number.isFinite(data.confidence) ? Number(data.confidence) : 0,
    veto: data.veto || null,
    penalties: Array.isArray(data.penalties) ? data.penalties : [],
    metadata: data.metadata || {},
  };
}

// Русский комментарий: helper для классификации финального результата без изменения legacy-логики.
function classifyDecision(decisionContext = {}) {
  if (decisionContext.veto && decisionContext.veto.type === 'hard_veto') return 'NO_ENTRY';
  if (decisionContext.veto && decisionContext.veto.type === 'capital_prohibition') return 'NO_CAPITAL';
  if ((decisionContext.score || 0) >= 0.7) return 'FULL_ENTRY';
  if ((decisionContext.score || 0) >= 0.4) return 'WEAK_ENTRY';
  return 'NO_ENTRY';
}

module.exports = { createDecisionContext, classifyDecision };
