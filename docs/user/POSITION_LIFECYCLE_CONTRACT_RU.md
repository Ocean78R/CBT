# Position Lifecycle (шаг 38 / подэтап 1): базовый контракт

## Цель слоя
`positionLifecycleManager` управляет уже открытой прибыльной позицией через **intents-only** контракт:
- partial close,
- перевод в breakeven,
- trailing остатка позиции.

Слой не пересчитывает market data/signal stack и не подменяет execution owner.

## Границы ответственности
- Использует уже существующий runtime context и текущее состояние позиции.
- Не отправляет ордера напрямую и не владеет transport/execution.
- Не владеет server TP/SL напрямую.
- Формирует только lifecycle intents и переходы state.
- При `positionLifecycle.enabled=false` возвращает fallback-интент на старое `legacy close` поведение.

## Входной контракт (минимум)
- `positionState`: текущая позиция (`side`, `entryPrice`, `markPrice`, `contracts`, `unrealizedPnl`, `percentage`, `isClosed`).
- `lifecycleState`: текущий lifecycle state (`stage`, `partialCloseDone`, `breakevenMoved`, `trailingActive`, `trailingStopPrice`).
- `profitability`: `unrealizedPnl`, `unrealizedPnlPercent`.
- `config`: базовые lifecycle правила (`partialClose`, `breakeven`, `trailing`, `enabled`).
- `ownershipMetadata`: metadata ownership path (передаётся сквозным образом, без takeover).
- `context`: runtime context (`cycleId`, `ticker` и т.д.).

## Выходной контракт (минимум)
- `lifecycleActionIntent`.
- `lifecycleStateTransition`.
- `breakevenIntent`.
- `partialCloseIntent`.
- `trailingIntent`.
- `lifecycleReasonCodes`.
- `lifecycleState` (next state).

## Реализованные lifecycle states
- `initial_position_state`.
- `partial_profit_state`.
- `moved_to_breakeven_state`.
- `trailing_active_state`.
- `fully_closed_terminal_state`.

## Базовые правила (подэтап 1)
1. **Partial close**: при достижении `partialClose.triggerProfitPercent` создаётся `partialCloseIntent` с `closeShare`.
2. **Breakeven**: при достижении `breakeven.triggerProfitPercent` создаётся `breakevenIntent` с целевым `targetStopPrice`.
3. **Trailing**: при достижении `trailing.triggerProfitPercent` (и при выполнении `requireBreakevenBeforeTrailing`) создаётся `trailingIntent`.

## Что НЕ входит в этот подэтап
- restricted lifecycle mode,
- сложные capitalRegime/forecast modifiers для lifecycle,
- полная ownership-интеграция с restricted positions.
