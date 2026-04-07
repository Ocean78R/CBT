# Clean-slate v1 (этап 1: каркас + flat-start contract)

Этот каталог содержит стартовую архитектуру новой версии робота.

- Текущий рабочий legacy-runtime не изменяется.
- Новый runtime проектируется отдельно.
- На текущем этапе реализован **обязательный flat-start contract** и базовый startup-поток для `paper`/`shadow`.

## Содержимое

- `docs/ARCHITECTURE_ZERO_STAGE_RU.md` — архитектурный документ, карта миграции и разрыв legacy ownership chain.
- `config/clean_slate.config.example.json` — пример clean-slate конфигурации.
- `src/bootstrap/flatStartGuard.js` — проверка flat-start contract.
- `src/bootstrap/startupReport.js` — startup report с причинами блокировки и чек-листом очистки.
- `src/owners/*` — новые owner-path каркасы entry/position flow.
- `src/runtime/cleanRuntimeOrchestrator.js` — оркестратор v1 и baseline-старт в `paper`/`shadow`.
- `src/contracts/ownerPathContracts.js` — контракт owner-path и запрет legacy owner вызовов.

## Flat-start contract

Перед запуском торговли новый runtime проверяет:
- отсутствуют открытые позиции;
- отсутствуют активные/сиротские ордера;
- отсутствуют legacy protective-state markers;
- отсутствует legacy mismatch/restricted state.

Если найдено нарушение, робот **не начинает торговлю**, переключается в `safe_mode` и возвращает startup report с причинами и инструкциями очистки.

## Статус

Этап 1 выполнен: чистый каркас и safe startup-контракт реализованы.
