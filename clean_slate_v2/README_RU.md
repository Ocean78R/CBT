# Clean-slate v2 (этап foundation: общий runtime data-plane)

Этот каталог содержит **новый чистый фундамент** runtime-слоёв, изолированный от legacy-путей.

## Что входит в этап

- `src/foundation/decisionContext.js` — единый контракт `DecisionContext`.
- `src/foundation/sharedDataPlane.js` — shared `MarketSnapshot` / `FeatureSnapshot` и cache already-computed outputs.
- `src/foundation/runtimeContext.js` — structured runtime context без ad-hoc fork.
- `src/foundation/index.js` — единая точка экспорта foundation-модулей.

## Принципы

- Нет вызовов `openNewPositionLegacy`/`processExistingPositionLegacy`.
- Нет scheduler/governor/logging слоя в этом этапе.
- Shared outputs используются повторно, heavy data не пересчитывается без необходимости.
- Контракт exchange-agnostic: нет жёстких BingX-specific допущений.
