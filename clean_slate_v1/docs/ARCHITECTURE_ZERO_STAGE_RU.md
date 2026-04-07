# Clean-slate v1 — нулевой этап архитектуры

## 1) Контекст и цель

Этот документ фиксирует **проектирование новой чистой версии** торгового робота в отдельной директории `clean_slate_v1/` без изменения рабочего legacy-runtime.

Ключевая цель v1: построить новый runtime-owner path, где:
- новые входы в позиции принимаются только новым owner-слоем;
- сопровождение открытых позиций выполняется только новым lifecycle-owner слоем;
- legacy-методы (`openNewPositionLegacy` / `processExistingPositionLegacy`) не являются активным runtime core для v1.

## 2) Что обнаружено в текущем проекте (анализ)

### 2.1 Текущий owner-path в рабочем runtime

По факту в текущем runtime маршрутизация в `dist/runtime/engines/index.js` остаётся legacy-centric:
- `riskEngine.processExistingPosition -> strategy.processExistingPositionLegacy(...)`;
- `positionEngine.processExistingPosition -> strategy.processExistingPositionLegacy(...)`;
- `executionEngine.openNewPosition -> ... -> strategy.openNewPositionLegacy(...)`.

В `dist/index.js` также присутствуют методы-обёртки:
- `openNewPosition(...)` вызывает `runtimeEngines.executionEngine.openNewPosition(...)`,
- `openNewPositionLegacy(...)` — legacy owner,
- `processExistingPosition(...)` вызывает `runtimeEngines.positionEngine.processExistingPosition(...)`,
- `processExistingPositionLegacy(...)` — legacy owner.

Итог: в текущей версии новые слои (decision/sizing/risk/lifecycle) в значительной части «надстроены» поверх legacy ownership chain.

### 2.2 Ценные части для reuse

Для clean-slate v1 целесообразно переиспользовать как контракты/алгоритмические блоки:
- `finalEntryDecisionEngine` (как final veto owner новых входов);
- `dynamicPositionSizing`;
- `capitalRegimeEngine` + `portfolioRiskContour`;
- `forcedLossExit` (ранняя invalidation + forced loss-приоритет без averaging-by-default);
- `positionLifecycleManager` (как источник lifecycle intent, но без fallback на legacy close);
- `paperTrading` (только как execution-adapter режима исполнения, не как владелец решений);
- `exchangeCapabilityMatrix` / `exchangeRuntimeIntegration` как exchange-agnostic capability слой.

### 2.3 Legacy-сложность, которую не переносим в runtime core v1

Не переносить как обязательную core-функциональность v1:
- поддержка legacy lifecycle-state (`LEVERAGE_MISMATCH_POSITION` / `LEGACY_RESTRICTED`) как обязательный runtime-path;
- recovery-ветки, обслуживающие «исторический хвост» уже открытых legacy-позиций;
- fallback-ветви, нужные только для backward compatibility старого процесса;
- ownership-обёртки, которые визуально «новые», но фактически вызывают `*Legacy` как конечный path.

## 3) Flat-start contract (обязателен перед стартом торговли)

Новый робот стартует торговлю только если одновременно верно:
1. Нет открытых позиций.
2. Нет активных сиротских ордеров.
3. Нет старого protective-state (server/local), оставшегося от legacy сессий.
4. Нет legacy mismatch/restricted state.

Если хотя бы один пункт нарушен:
- вход в live-trading запрещён;
- runtime переключается в `safe_mode`;
- публикуется понятная диагностика с причинами блокировки.

## 4) Целевая архитектура v1

## 4.1 Новый entry owner-path

`CycleOrchestrator` -> `DecisionContextBuilder` -> `MarketSnapshot/FeatureSnapshot` -> `finalEntryDecisionEngine` -> `dynamicPositionSizing` -> `EntryOwner.openNewPosition` -> `ExecutionGateway`

Принципы:
- `finalEntryDecisionEngine` — финальный owner по разрешению/запрету входа;
- `dynamicPositionSizing` — owner sizing-решения;
- `EntryOwner` — owner вызова исполнения открытия;
- никакие `*Legacy` функции в цепочке отсутствуют.

## 4.2 Новый position/lifecycle owner-path

`CycleOrchestrator` -> `PositionOwner.processExistingPosition` -> `PositionLifecycleOwner.evaluateLifecycle` -> `forcedLossExit`/`lifecycle intents` -> `ExecutionGateway` protective actions

Принципы:
- уже открытые позиции управляются независимо от динамического shortlist;
- приоритет adverse-сценария: short observation -> early invalidation -> forced loss/stuck protection;
- averaging и auto-reverse по умолчанию выключены (особенно canary/safe);
- legacy lifecycle fallback path отсутствует в runtime core v1.

## 4.3 Exchange-agnostic границы

- Вся стратегия и ownership-слои работают через интерфейсы `ExchangeGateway` / `ExecutionGateway` / `StateGateway`.
- Бирже-специфичные детали (BingX/Binance и т.п.) — только в адаптерах инфраструктурного слоя.
- Capability matrix определяет возможности биржи, но не меняет owner-иерархию стратегии.

## 5) Allowed universe и shortlist

- `allowedUniverse` задаётся статически в config (whitelist).
- На каждом цикле строится динамический shortlist **только внутри** `allowedUniverse`.
- Авто-расширение до всей биржи запрещено по умолчанию.
- Уже открытые позиции не зависят от присутствия тикера в текущем shortlist.

## 6) Safe canary и paper/shadow режимы

- `safe canary`: минимальный риск-профиль, сниженный sizing, усиленные блокировки входа, повышенная диагностика.
- `paper/shadow`: execution без реальных ордеров, но с тем же owner-path решений и lifecycle-логикой.
- режимы не должны менять ownership path, только execution-поведение и лимиты.

## 7) Карта модулей: reuse / simplify / rewrite / drop

| Старый модуль | Действие | Причина |
|---|---|---|
| `dist/runtime/engines/finalEntryDecisionEngine.js` | reuse | Финальный decision-owner уже выделен и протестирован. |
| `dist/runtime/sizing/dynamicPositionSizing.js` | reuse | Готовый sizing-owner с risk-aware логикой. |
| `dist/runtime/risk/capitalRegimeEngine.js` | reuse | Нужен как верхний ограничитель капитального режима. |
| `dist/runtime/risk/portfolioRiskContour.js` | simplify | Оставить hard guards и режимы, убрать legacy-fallback семантику. |
| `dist/runtime/risk/forcedLossExit.js` | simplify | Сохранить short observation/early invalidation/forced loss, убрать legacy-dependent хвосты. |
| `dist/runtime/lifecycle/positionLifecycleManager.js` | rewrite | Использовать lifecycle intents, исключить fallback в `fallback_legacy_close_logic` как runtime core. |
| `dist/runtime/execution/paperTrading.js` | reuse | Полезен как paper/shadow execution adapter. |
| `dist/runtime/exchange/exchangeCapabilityMatrix.js` | reuse | Exchange-agnostic capability contract. |
| `dist/runtime/exchange/exchangeRuntimeIntegration.js` | simplify | Сохранить capability checks, убрать любые косвенные ownership-захваты. |
| `dist/runtime/engines/index.js` | drop (для v1 runtime) | Фактически привязан к legacy owner-path. |
| `dist/index.js` (класс `SingleStrategy`) | drop (для v1 runtime) | Содержит активные legacy owner методы для входа/позиции. |

## 8) Целевая структура новой директории

```text
clean_slate_v1/
  docs/
    ARCHITECTURE_ZERO_STAGE_RU.md
  config/
    clean_slate.config.example.json
  src/
    bootstrap/
      flatStartGuard.js
    contracts/
      ownerPathContracts.js
    runtime/
      cleanRuntimeOrchestrator.js
    owners/
      entryOwner.js
      positionOwner.js
```

## 9) Порядок последующих шагов

1. **Step 1:** реализовать `flatStartGuard` и запуск в `safe_mode` при нарушении контракта.
2. **Step 2:** подключить `DecisionContext` + `MarketSnapshot/FeatureSnapshot` в новый orchestrator.
3. **Step 3:** реализовать новый `EntryOwner` на базе `finalEntryDecisionEngine + dynamicPositionSizing`.
4. **Step 4:** реализовать новый `PositionOwner` с lifecycle/protective path без legacy fallback.
5. **Step 5:** подключить `paper/shadow` и `safe canary` как execution/risk режимы без изменения owner-path.
6. **Step 6:** добавить миграционные интеграционные тесты и запрет вызовов legacy ownership path.

## 10) Явная фиксация разрыва legacy ownership chain

Для clean-slate v1 установлено требование:
- runtime-path **не имеет права** вызывать `openNewPositionLegacy` для новых входов;
- runtime-path **не имеет права** вызывать `processExistingPositionLegacy` для сопровождения позиций;
- thin-wrapper методы над legacy ownership chain запрещены контрактом и тестами.
