# Final readiness regression audit (step 40)

Дата аудита: **2026-04-06**.

## 1) Итоговая карта покрытия

| Область | Статус | Ключевые тесты |
|---|---|---|
| startup/build/smoke | **Хорошо покрыто** | `tests/smoke/project.integrity.smoke.test.js`, `tests/architecture/architecture.smoke.test.js`, `tests/regression/final-readiness-regression-suite.test.js` |
| decision stack | **Хорошо покрыто** | `tests/regression/confluence-entry-engine.test.js`, `tests/regression/final-entry-decision-engine.test.js`, `tests/regression/single-strategy.regression.test.js`, `tests/regression/final-readiness-regression-suite.test.js` |
| risk/capital | **Хорошо покрыто** | `tests/regression/capital-regime-engine.test.js`, `tests/regression/capital-stress-forecast-engine.test.js`, `tests/regression/portfolio-risk-contour.test.js`, `tests/regression/risk-chain-capital-regime-hard-guards.test.js`, `tests/regression/final-readiness-regression-suite.test.js` |
| protective/lifecycle | **Хорошо покрыто** | `tests/regression/forced-loss-exit-early-invalidation.test.js`, `tests/regression/position-lifecycle-manager.test.js`, `tests/regression/final-readiness-regression-suite.test.js` |
| restricted positions | **Хорошо покрыто** | `tests/regression/position-lifecycle-manager.test.js`, `tests/regression/single-strategy.regression.test.js`, `tests/regression/final-readiness-regression-suite.test.js` |
| ML phase 1 | **Хорошо покрыто** | `tests/regression/ml-phase1-decision-modifier.test.js`, `tests/regression/ml-inference-layer.test.js`, `tests/regression/ml-phase1-integration-step37c.test.js`, `tests/regression/ml-phase1-step37c-final-contract.test.js`, `tests/regression/final-readiness-regression-suite.test.js` |
| ML meta-controller | **Хорошо покрыто** | `tests/regression/ml-meta-controller-contract.test.js`, `tests/regression/ml-phase2-runtime-bounded-modifier.test.js`, `tests/regression/ml-phase2-step39c-integration.test.js`, `tests/regression/final-readiness-regression-suite.test.js` |
| exchange capability layer | **Хорошо покрыто** | `tests/regression/exchange-capability-matrix-contract.test.js`, `tests/regression/exchange-runtime-integration.test.js`, `tests/regression/exchange-onboarding-flow.test.js`, `tests/architecture/exchange-onboarding-sanity.smoke.test.js`, `tests/regression/final-readiness-regression-suite.test.js` |
| performance-sensitive branches | **Покрыто умеренно** | `tests/regression/providers-performance-diagnostics.test.js`, `tests/regression/performance-audit.focused.test.js`, `tests/regression/final-readiness-regression-suite.test.js` |

## 2) Что покрыто хорошо / слабо / не покрыто

### Хорошо покрыто
- Контрактные инварианты ownership/path между decision, sizing, lifecycle, exchange capability.
- Risk/capital guards и hard-veto ветки.
- ML phase 1 + meta-controller bounded semantics и отсутствие ownership takeover.
- Restricted position flow с блоком leverage-sensitive действий и разрешением safe-close.

### Слабо покрыто
- Performance under sustained load: нет длительных soak-тестов на несколько минут/циклов с распределением по множеству тикеров.
- Exchange candidate stress-сценарии: нет «почти-реальных» сценариев с серией mixed-capabilities (особенно TP/SL/reduceOnly race conditions) в одном длинном e2e run.

### Не покрыто (в рамках текущего репозитория)
- Реальные сетевые/биржевые e2e на sandbox-аккаунтах (осознанно отсутствуют в офлайн-regression контуре).
- Chaos/fault-injection на уровне инфраструктуры (packet loss/timeout storms/process restarts).

## 3) Добавленный минимальный финальный regression suite

Добавлен целевой файл: `tests/regression/final-readiness-regression-suite.test.js`.

Он покрывает 5 сквозных критичных цепочек без «шумовых» дубликатов:
1. Startup readiness smoke (bootstrap + runtime config normalization).
2. Core chain: portfolio risk -> final decision -> ML phase 1 -> ML meta-controller -> dynamic sizing.
3. Protective/lifecycle + restricted positions: forced close owner path и safe-close-only действия.
4. Exchange capability fallback path для candidate exchange + restriction policy.
5. Performance governor деградация optional-layer при budget pressure.

## 4) Readiness вывод (controlled production usage)

**Общая готовность: 8/10 (готов к controlled production usage).**

Условия, при которых запуск оправдан:
- Использовать staged rollout (ограниченный список тикеров, bounded exposure, strict monitoring).
- Держать exchange capability checks в `enforce` и safe unsupported features в explicit fallback/disable.
- Перед каждым релизом прогонять полный regression набор + focused final readiness suite.

Оставшиеся ключевые риски:
- Поведенческие регрессии под длительным нагрузочным профилем (не полностью имитируются short test runs).
- Разница между офлайн mock-branch behavior и реальными сетевыми условиями биржи.

## 5) Набор команд перед каждым новым релизом

Минимальный обязательный pre-release набор:

```bash
npm run test:smoke
npm run test:architecture
npm run test:docs
npm run test:regression
node --test tests/regression/final-readiness-regression-suite.test.js
```

Рекомендуемый (одной командой):

```bash
npm test && node --test tests/regression/final-readiness-regression-suite.test.js
```
