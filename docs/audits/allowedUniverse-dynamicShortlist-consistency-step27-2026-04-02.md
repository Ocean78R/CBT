# Короткая проверка согласованности: allowedUniverse + dynamicShortlist после corrective patch (2026-04-02)

Проверка выполнена по runtime-коду (`dist/index.js`), архитектурному контракту и регрессиям `single-strategy`.

## Результат по пунктам

1. **Config whitelist остаётся верхней границей universe — подтверждено.**
   - Новый вход сначала проходит `allowedUniverse`-gate, и тикер вне `allowedUniverseTickers` отклоняется до любых shortlist-гейтов.
   - Dynamic shortlist формируется из `allowedUniverseTickers`, а не из внешнего набора.

2. **Dynamic shortlist строится только внутри config universe — подтверждено.**
   - `refreshDynamicEntryShortlist(allowedUniverseTickers, ...)` итерируется исключительно по переданному `allowedUniverseTickers`.
   - Регрессия явно фиксирует контракт: shortlist не выходит за `allowedUniverse`.

3. **`capitalRegime` может только сужать shortlist, но не расширять universe — подтверждено.**
   - `resolveShortlistSizeByRisk(...)` применяет только понижающие мультипликаторы (`Math.min(..., multiplier)`), после чего shortlist режется `slice(0, shortlistSize)`.
   - Проверка `allowedUniverse` выполняется отдельным и более ранним gate; `capitalRegime` не меняет список `allowedUniverseTickers`.

4. **Already-open positions продолжают lifecycle независимо от shortlist — подтверждено.**
   - Для активной позиции выполняется ветка lifecycle (`processExistingPosition`) и допускается сопровождение даже при отсутствии тикера в shortlist.
   - Есть отдельный event/guard на lifecycle-override вне shortlist.

5. **Шаги 24–27 используют shortlist только как input-context и не перехватывают ownership universe — подтверждено.**
   - Контракт read-only для downstream закреплён тестом: даже при ручной мутации контекстных полей ownership/канонический state восстанавливается execution/lifecycle слоями.
   - Архитектурный контракт фиксирует staged-пайплайн и запрет смены ownership в downstream/performance-контуре.

## Краткий вывод

- **Что согласовано:** все 5 пунктов проверки подтверждены кодом и регрессиями.
- **Где ещё есть ограничения:** логика по-прежнему сконцентрирована в `dist/index.js`; для снижения регрессионного риска желательно дальнейшее выносение selection/universe/lifecycle-гейтов в профильные runtime-модули.
- **Можно ли безопасно идти к шагу 28:** **да, можно**, при сохранении текущего контракта: shortlist — только input-context, ownership universe/lifecycle — только у соответствующих primary слоёв.
