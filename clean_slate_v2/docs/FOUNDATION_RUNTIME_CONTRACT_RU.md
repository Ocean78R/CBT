# Контракт foundation runtime (clean-slate v2)

## 1) Технические контракты

### DecisionContext

`DecisionContext` обязателен для новых decision/lifecycle/sizing слоёв и содержит:

- `contractVersion` — версия контракта;
- `cycle` — идентификатор и режим цикла;
- `asset` — тикер/таймфрейм/биржа (exchange-agnostic);
- `marketSnapshot` — ссылка на shared market snapshot;
- `featureSnapshot` — ссылка на shared feature snapshot;
- `sharedOutputs` — уже рассчитанные upstream outputs (`regime`, `forecasts`, `riskGuards`);
- `score`, `confidence`, `reasonCodes`, `metadata`.

Контекст создаётся immutable (deep-freeze), чтобы исключить скрытые мутации между слоями.

### Structured runtime context

`createStructuredRuntimeContext(...)`:

- поднимает cycle snapshots из shared data-plane,
- формирует единый `DecisionContext`,
- валидирует его через `assertDecisionContextIntegrity(...)`.

### Запрет ad-hoc context forks

`assertNoAdHocContextFork(...)` блокирует сценарий, когда внутри одного `cycleId` + `ticker`
создаётся альтернативный ad-hoc контекст вместо повторного использования базового.

## 2) Shared data-plane

`createSharedDataPlane()` включает:

- `setCycleSnapshots(cycleId, { marketSnapshot, featureSnapshot })`,
- `getCycleSnapshots(cycleId)`,
- `getOrComputeOutput({ cycleId, blockKey, compute })`,
- `clearCycle(cycleId)`.

`getOrComputeOutput` реализует reuse already-computed outputs через cache key `cycleId:blockKey`.
Это фиксирует правило: heavy computation выполняется один раз на цикл/блок и далее переиспользуется.

## 3) Границы этапа

В этап **не входят**:

- scheduler/governor/logging пакеты,
- execution/open/position ownership path,
- legacy runtime flow.

Foundation создаёт только data-contract и data-plane, на которые затем сядут
`finalEntryDecisionEngine`, `dynamicPositionSizing`, lifecycle owners и capitalRegime-слои.
