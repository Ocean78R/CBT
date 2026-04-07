# Clean-slate v2 (этапы foundation + runtime-base)

Этот каталог содержит **новую чистую версию runtime-основы**, полностью изолированную от legacy ownership-chain.

## Что входит

### Foundation (предыдущий этап)

- `src/foundation/decisionContext.js` — единый immutable-контракт `DecisionContext`.
- `src/foundation/sharedDataPlane.js` — shared `MarketSnapshot` / `FeatureSnapshot` и reuse already-computed outputs.
- `src/foundation/runtimeContext.js` — structured runtime context без ad-hoc fork.

### Runtime-base (текущий этап)

- `src/runtime_base/cacheTiers.js` — cache tiers (`cycle`, `warm`, `degradedFallback`) + режимы `full/cached/degraded`.
- `src/runtime_base/requestScheduler.js` — scheduler safety (cycle/window budget, cooldown, dedup).
- `src/runtime_base/performanceGuardrails.js` — performance governor и budget control.
- `src/runtime_base/structuredLogger.js` — базовая structured logging схема.
- `src/runtime_base/runtimeServices.js` — единая оркестрация guardrails + cache fallback.

## Принципы clean-slate v2

- Нет вызовов `openNewPositionLegacy`/`processExistingPositionLegacy`.
- Нет thin-wrapper путей над legacy ownership chain.
- Нет BingX-specific assumptions в контрактах runtime-base.
- Нет повторного heavy computation при cache hit.
- При риске по производительности включается performance-safe fallback (`cached/degraded`).

## Быстрая проверка

```bash
npm run test:clean-slate
```
