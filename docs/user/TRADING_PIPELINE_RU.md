# Торговый пайплайн и слои логики

## Runtime-позиция слоёв (операторское представление)
Порядок принятия решений в системе:
1. Hard-risk / hard-safety / биржевые ограничения.
2. Universe filters и отбор активов.
3. Market regime router (разрешённые сетапы).
4. Confluence/final entry logic (full/weak/no entry).
5. Dynamic sizing (только после approved entry).
6. Execution + серверные ордера.
7. Lifecycle позиции (сопровождение и закрытие).

## Зависимости слоёв
- Каждый поздний слой зависит от результата предыдущих.
- Если верхний риск-слой выдал запрет, вход не выполняется.
- Если данные неполные, применяется безопасный fallback без неявной смены торгового поведения.

## Как работает открытие позиции
1. Сбор market/account данных.
2. Проверка ограничений (capital/risk/exchange).
3. Расчёт сигнала и итогового решения входа.
4. При `approved entry` — расчёт размера позиции.
5. Постановка ордера через единый execution path.

## Как работает закрытие позиции
Позиция сопровождается строго по иерархии:
1. Server stop-loss.
2. Forced loss exit / stuck protection.
3. Server take-profit.
4. Partial close / breakeven / trailing.
5. Local polling fallback close.
6. Averaging (если разрешено политикой и контекстом).

## Типы торговых решений
- `hard veto` — жёсткий запрет действия.
- `soft penalty` — ухудшение оценки без полного запрета.
- `no-trade regime` — режим «не торговать».
- `capital prohibition` — запрет входа по капиталу/марже.
