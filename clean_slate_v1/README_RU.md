# Clean-slate v1 (нулевой этап)

Этот каталог содержит стартовую архитектуру новой версии робота.

- Текущий рабочий legacy-runtime не изменяется.
- Новый runtime проектируется отдельно.
- На этом этапе создана архитектурная карта и каркас owner-path без переноса полной бизнес-логики.

## Содержимое

- `docs/ARCHITECTURE_ZERO_STAGE_RU.md` — архитектурный документ, карта миграции и разрыв legacy ownership chain.
- `config/clean_slate.config.example.json` — пример clean-slate конфигурации.
- `src/bootstrap/flatStartGuard.js` — flat-start contract guard.
- `src/owners/*` — новые owner-path каркасы entry/position flow.
- `src/runtime/cleanRuntimeOrchestrator.js` — оркестратор v1.
- `src/contracts/ownerPathContracts.js` — контракт owner-path и запрет legacy owner вызовов.

## Статус

Нулевая стадия выполнена: архитектура и контракты зафиксированы.
