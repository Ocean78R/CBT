# Position Lifecycle (шаг 38 / подэтап 3): production-like интеграция modifiers/logging/audit

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
- При `positionLifecycle.enableAdvancedLifecycle=false` (или `enabled=false`) возвращает fallback-интент на старое `legacy close` поведение.
- `capitalRegime` и `forecast` могут только модифицировать lifecycle-пороги/параметры в разрешённых пределах.
- Forecast-слой передаёт только hints (`earlyBreakevenHint`, `reduceExposureHint`, `protectiveTighteningHint`) и не выполняет lifecycle actions напрямую.
- Hard-risk / server stop-loss / protective close ownership остаются выше обычного profit lifecycle.

## Входной контракт (минимум)
- `positionState`: текущая позиция (`side`, `entryPrice`, `markPrice`, `contracts`, `unrealizedPnl`, `percentage`, `isClosed`).
- `lifecycleState`: текущий lifecycle state (`stage`, `partialCloseDone`, `breakevenMoved`, `trailingActive`, `trailingStopPrice`).
- `profitability`: `unrealizedPnl`, `unrealizedPnlPercent`.
- `config`: lifecycle-правила (`enableAdvancedLifecycle`, `partialTakeProfitRules`, `breakevenRules`, `trailingRules`, `capitalRegimeLifecycleModifiers`, `restrictedLifecycleRules`, `forecastLifecycleModifiers`).
- `ownershipMetadata`: metadata ownership path (передаётся сквозным образом, без takeover).
- `context`: runtime context (`cycleId`, `ticker`, `capitalRegime`, optional mode/hints и т.д.).

## Выходной контракт (минимум)
- `lifecycleActionIntent`.
- `lifecycleStateTransition`.
- `breakevenIntent`.
- `partialCloseIntent`.
- `trailingIntent`.
- `lifecycleReasonCodes`.
- `lifecycleState` (next state).
- `lifecycleEvents` (structured audit trail).

## Реализованные lifecycle states
- `initial_position_state`.
- `partial_profit_state`.
- `moved_to_breakeven_state`.
- `trailing_active_state`.
- `fully_closed_terminal_state`.

## Базовые lifecycle-правила
1. **Partial close**: при достижении `partialClose.triggerProfitPercent` создаётся `partialCloseIntent` с `closeShare`.
2. **Breakeven**: при достижении `breakeven.triggerProfitPercent` создаётся `breakevenIntent` с целевым `targetStopPrice`.
3. **Trailing**: при достижении `trailing.triggerProfitPercent` (и при выполнении `requireBreakevenBeforeTrailing`) создаётся `trailingIntent`.

## Restricted lifecycle mode
- При `positionCapabilityState` из restricted-набора включается `restrictedLifecycleMode`.
- Для restricted-позиций остаётся доступным safe close path и разрешённый partial close (если это явно не отключено в `restrictedLifecycleRules`).
- Leverage-sensitive действия (`move_to_breakeven`, `activate_trailing`) блокируются по capability-контракту, ownership-path не меняется.

## Влияние capitalRegime на lifecycle
- `CAUTION`: более ранний breakeven.
- `DEFENSIVE`: более ранняя частичная фиксация прибыли и увеличение доли partial close.
- `CAPITAL_PRESERVATION`: более защитный профиль (раньше partial profit-taking + более консервативный trailing).
- `HALT_NEW_ENTRIES`: не ломает lifecycle already-open positions.

## Влияние forecast hints на lifecycle
- `earlyBreakevenHint`: только ужесточает порог breakeven.
- `reduceExposureHint`: только ужесточает partial profit-taking (раньше и/или большим share).
- `protectiveTighteningHint`: только ужесточает trailing (раньше и/или tighter).
- Все forecast hints применяются только как modifiers; lifecycle ownership остаётся у lifecycle-layer.

## Logging / audit fields (structured events)
- `lifecycleBaseState`,
- `lifecycleActionIntent`,
- `capitalRegimeLifecycleAdjustment`,
- `forecastLifecycleAdjustment`,
- `restrictedLifecycleMode`,
- `finalLifecycleAction`,
- `lifecycleReasonCodes`.

## Совместимость режимов исполнения
- Decision/lifecycle semantics одинаковы для `live` и `paper/shadow`.
- Различия между режимами остаются только на execution-уровне.
