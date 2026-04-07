# Контракт foundation/runtime-base (clean-slate v2)

## 1) Foundation-контракты

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

## 2) Runtime-base контракты

### Cache tiers

`createCacheTiers()` реализует три уровня cache:

- `cycle` — быстрый cache в рамках текущего цикла;
- `warm` — reuse между циклами;
- `degradedFallback` — безопасный fallback при деградации.

`getOrCompute(...)` поддерживает режимы:

- `full` — разрешён heavy compute;
- `cached` — heavy compute не обязателен, приоритет reuse cache;
- `degraded` — heavy compute запрещён, используются warm/fallback данные.

### Request scheduler

`createRequestScheduler()` даёт safety-гарантии:

- лимит запросов на цикл,
- лимит запросов в rolling window,
- cooldown по активу,
- dedup `requestKey` в рамках цикла.

### Performance guardrails

`createPerformanceGuardrails()` вводит budget-контроль:

- ограничение heavy операций на цикл,
- ограничение суммарного времени цикла,
- ограничение времени single heavy операции,
- forced mode escalation: `full -> cached -> degraded`.

### Structured logging

`createStructuredLogger()` пишет единый JSON-формат:

- `ts`, `level`, `event`, `cycleId`, `mode`, `asset`, `reasonCodes`, `details`.

`validateLogRecord(...)` проверяет консистентность схемы.

### Runtime services orchestration

`createRuntimeServices()` связывает cache/scheduler/performance/logging и даёт единый метод:

- `computeWithGuardrails(...)` — предотвращает повтор heavy computation и включает performance-safe fallback.

## 3) Границы этапа

В этап **не входят**:

- signal stack и стратегия сигналов;
- execution/open/position ownership runtime chain;
- legacy runtime branches для historical tail сопровождения.

## 4) Проверки/гарантии этапа

Тесты подтверждают:

- cache reuse;
- scheduler behavior;
- degraded fallback;
- logging consistency;
- no repeated heavy computation.
