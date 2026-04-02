# Короткая проверка согласованности после corrective patch: allowedUniverse / safeEntryAssets / dynamicShortlist (2026-04-02)

Проверка выполнена по runtime-коду (`dist/index.js`), архитектурному контракту и регрессиям `tests/regression/single-strategy.regression.test.js`.

## Результат по пунктам

1. **`allowedUniverse` остаётся верхней границей universe — подтверждено.**
   - Gate `evaluateNewEntryAllowance(...)` сначала проверяет принадлежность `ticker` к `allowedUniverseTickers`.
   - Вне `allowedUniverse` тикер отклоняется до `safeEntryAssets`/`dynamicShortlist` проверок.

2. **`safeEntryAssets` может только сужать new-entry scope, но не расширяет `allowedUniverse` — подтверждено.**
   - `safeEntryUniverse` строится фильтрацией `allowedUniverse` по base-asset.
   - Есть явный контрактный флаг `safeEntryAssetsDoesNotExpandAllowedUniverse` и регрессия, фиксирующая invariant.

3. **`dynamicShortlist` строится только внутри уже разрешённого new-entry universe — подтверждено.**
   - `refreshDynamicEntryShortlist(allowedUniverseTickers, ...)` итерируется только по переданному `allowedUniverseTickers`.
   - При unload/safe режиме shortlist не обходит `safeEntryAssets` и не расширяет `newEntryEligibleUniverse`.

4. **`unload mode` и `capitalRegime` не ломают lifecycle already-open positions — подтверждено.**
   - Lifecycle ветка (`processExistingPosition`) исполняется отдельно от new-entry фильтров.
   - Для позиции вне shortlist/safe-list используется `lifecycle_shortlist_override`, сопровождение сохраняется.

5. **Шаги 24–27 используют только downstream input scope и не перехватывают ownership отбора тикеров — подтверждено.**
   - Downstream читает `newEntryEligibleUniverse` как входной контекст.
   - Канонический owner universe остаётся в `allowedUniverseTickers`; это зафиксировано отдельной регрессией на read-only контракт.

6. **Special/restricted positions не выпадают из lifecycle из-за отсутствия тикера в shortlist/safeEntryAssets — подтверждено.**
   - Restricted-state (`LEVERAGE_MISMATCH_POSITION`/`LEGACY_RESTRICTED_POSITION`) живёт в execution/lifecycle owner-path.
   - Даже при restricted-state сохраняется safe close path, а lifecycle не зависит от new-entry shortlist фильтров.

## Короткий итог

- **Что согласовано:** все 6 пунктов подтверждены кодом и регрессиями.
- **Где ещё есть ограничения:** значимая часть ownership/gate-логики остаётся в `dist/index.js`; для снижения риска регрессий полезна дальнейшая модульная декомпозиция (universe gate, safe-entry gate, lifecycle gate).
- **Можно ли безопасно идти к шагу 28:** **да**, при сохранении текущих инвариантов (`allowedUniverse` owner, `safeEntryAssets` only-narrowing, `dynamicShortlist` only-inside-eligible-scope, lifecycle ownership отдельно от new-entry scope).
