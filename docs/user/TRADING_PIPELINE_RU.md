# Торговый пайплайн и слои логики

## Runtime-позиция слоёв (операторское представление)
Порядок принятия решений в системе:
1. Hard-risk / hard-safety / биржевые ограничения.
2. Unload mode + capitalRegime (ограничения новых входов, safe basket, лимиты).
3. Universe filters и отбор активов.
4. Market regime router (разрешённые сетапы).
5. Confluence/final entry logic (full/weak/no entry).
6. Dynamic sizing (только после approved entry).
7. Execution + серверные ордера.
8. Lifecycle позиции (сопровождение и закрытие).

## Зависимости слоёв
- Каждый поздний слой зависит от результата предыдущих.
- Если верхний риск-слой выдал запрет, вход не выполняется.
- Если данные неполные, применяется безопасный fallback без неявной смены торгового поведения.
- Unload mode зависит от account balance, riskSignals и текущего статуса позиций.
- Если riskSignals от forecast-слоя отсутствуют, unload mode использует только minBalance/warningThresholdAboveMinBalance (без поломки legacy-flow).

## Антикризисный режим разгрузки (unload mode)
- `unloadMode` — операционный слой, который включается **до entry decision и до sizing**.
- Сопровождение уже открытых позиций не отключается: ограничения касаются только **новых входов**.
- `capitalRegime` вычисляется в режимах: `NORMAL`, `CAUTION`, `DEFENSIVE`, `HALT_NEW_ENTRIES`.
- `safeEntryAssets` ограничивает список тикеров для новых входов, но не мешает сопровождать старые позиции в любых тикерах.

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
