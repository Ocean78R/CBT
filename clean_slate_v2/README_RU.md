# Clean-slate v2 (этапы foundation + runtime-base)

Этот каталог содержит **новую чистую версию runtime-основы**, полностью изолированную от legacy ownership-chain.

## Что входит

### Foundation (предыдущий этап)

- `src/foundation/decisionContext.js` — единый immutable-контракт `DecisionContext`.
- `src/foundation/sharedDataPlane.js` — shared `MarketSnapshot` / `FeatureSnapshot` и reuse already-computed outputs.
- `src/foundation/runtimeContext.js` — structured runtime context без ad-hoc fork.

### Runtime-base (предыдущий этап)

- `src/runtime_base/cacheTiers.js` — cache tiers (`cycle`, `warm`, `degradedFallback`) + режимы `full/cached/degraded`.
- `src/runtime_base/requestScheduler.js` — scheduler safety (cycle/window budget, cooldown, dedup).
- `src/runtime_base/performanceGuardrails.js` — performance governor и budget control.
- `src/runtime_base/structuredLogger.js` — базовая structured logging схема.
- `src/runtime_base/runtimeServices.js` — единая оркестрация guardrails + cache fallback.


### Execution-core (новый этап)

- `src/execution_core/orderQueue.js` — последовательная очередь execution без хаотичного параллелизма.
- `src/execution_core/retryPolicy.js` — bounded retry policy.
- `src/execution_core/actionDedup.js` — dedup для entry/close действий.
- `src/execution_core/reconciliation.js` — sync позиций/ордеров + recovery только `clean_slate_v2` позиций.
- `src/execution_core/entryExecutionOwner.js` — owner-path открытия новой позиции.
- `src/execution_core/closeExecutionOwner.js` — owner-path закрытия позиции.
- `src/execution_core/executionJournal.js` — execution audit trace.
- `src/execution_core/executionOwnerPath.js` — единая execution owner orchestration.

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
