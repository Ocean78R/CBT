# Exchange capability matrix и unified abstraction contract (шаг 40 / подэтап 1)

## Цель подэтапа
Зафиксировать безопасную основу мультибиржевого слоя **без поломки BingX baseline** и без takeover ownership-path у execution/lifecycle/protective managers.

## 1) Явная capability matrix
Источник: `dist/runtime/exchange/exchangeCapabilityMatrix.js`.

Матрица в явном машиночитаемом виде фиксирует минимум такие домены:
- `serverTpSupport`;
- `serverSlSupport`;
- `reduceOnlySemantics`;
- `orderLifecycleSpecifics`;
- `reconciliationSupport`;
- `positionModeSideModeSpecifics`;
- `signalDataAvailability`;
- `executionRestrictions`.

Состояния capability стандартизованы: `supported | partial | unsupported | unknown`.

## 2) Unified exchange abstraction contract
Введён единый контракт `createUnifiedExchangeContract(exchange)` с 4 ключевыми секциями:
- `executionFacingCapabilities`;
- `protectiveOrderCapabilities`;
- `reconciliationCapabilities`;
- `marketDataAvailabilityMetadata`.

Дополнительно в контракте зафиксированы:
- `ownershipSafety` (гарантия, что exchange-layer не становится decision/execution owner);
- `decisionLayerInvariant` (слои 24–39 остаются exchange-agnostic);
- `forbiddenAssumptions` (запрещённые предположения);
- `safeFallback` (поведение при unknown/partial/unavailable capability).

## 3) Разделение ответственности

### Exchange-agnostic
- decision stack (шаги 24–39) не кодирует BingX-specific условия;
- hard-risk/capitalRegime/forecast restrictions/final decision ownership остаются выше exchange-layer;
- lifecycle/signal читают только capability contract, а не детали биржи напрямую.

### Exchange-specific
- конкретные отличия биржи живут в `EXCHANGE_CAPABILITY_MATRIX`;
- lifecycle/execution ограничения приходят через capability/restriction flags.

### Forbidden assumptions
- unknown capability нельзя трактовать как supported;
- нельзя «по умолчанию» считать universal reduce-only;
- нельзя размывать ownership path через exchange-specific ветвление внутри decision слоёв.

## 4) Safe fallback semantics
- unknown exchange/profile -> `safe_noop_and_log` + conservative block risky actions;
- partially supported -> block risky path и оставить только безопасный owner-routed маршрут;
- unavailable protective feature -> fallback на локальный protective close path.

## 5) Что НЕ входит в этот подэтап
- полный runtime onboarding новой биржи;
- миграция/рефактор всех legacy exchange adapters;
- изменение decision логики шагов 24–39.

Этот подэтап только готовит контрактный слой для следующих итераций.

## 6) Подэтап 2: safe runtime/config integration (rollout-ready)
Источник: `dist/runtime/exchange/exchangeRuntimeIntegration.js`, `dist/runtime/config/runtimeConfigValidator.js`.

Добавлены обязательные config semantics:
- `activeExchange`;
- `exchangeCapabilitiesSource`;
- `enableExchangeCapabilityChecks`;
- `safeUnsupportedFeatureMode`;
- `exchangeRestrictionPolicy`.

Runtime wiring capability layer:
- execution layers получают `executionContext` (feature gates + restriction context);
- protective managers получают `protectiveContext` (TP/SL gates + lifecycle restrictions);
- lifecycle/reconciliation получают `lifecycleContext/reconciliationContext`;
- decision layers получают только минимальные входные flags (`requiresExplicitPositionSide`, `hasServerTakeProfitSupport`, `hasServerStopLossSupport`).

Безопасность unsupported/partial features:
- explicit fallback (`fallback`);
- explicit disable (`disable`);
- explicit block (`block`);
- обязательные structured events без silent degradation.

События для наблюдаемости:
- `activeExchange`;
- `capabilityCheckPassed`;
- `capabilityCheckFailed`;
- `unsupportedFeatureFallbackUsed`;
- `exchangeRestrictionApplied`.

## 7) Подэтап 3: documentation/tests/onboarding integration package
Цель подэтапа 3 — зафиксировать production-like операционный контур для будущих бирж **без пересборки capability matrix и runtime wiring**.

### Роль capability matrix
- единый источник exchange-specific ограничений и возможностей;
- формальный stop-point для hidden assumptions (никаких «неявно поддерживается»);
- основа для regression/sanity проверок completeness.

### Роль exchange abstraction contract
- нормализует matrix в единый runtime-контракт для execution/protective/lifecycle;
- сохраняет exchange-agnostic интерфейс для decision stack;
- несёт инварианты ownership safety и forbidden assumptions.

### Что остаётся exchange-agnostic
- decision layers 24–39;
- dynamic sizing ownership path;
- hard-risk / capital regime / forecast restriction ownership.

### Что использует exchange-specific restrictions
- execution/protective/lifecycle ветки, где требуется explicit reduce-only/position-side/order-lifecycle semantics;
- restriction policy (`enforce | warn_only | off`) для безопасного применения конкретных ограничений биржи.

### Почему BingX остаётся baseline
- текущий production baseline профиля и контрактов в проекте;
- эталонный reference для сравнения поведения candidate exchange;
- защита от регрессий: любые onboarding-изменения проходят проверки «BingX baseline remains unchanged».

### Как безопасно подключать новую биржу по шагам
1. Заполнить capability matrix без пропусков доменов.
2. Пройти contract validation и ownership-safety инварианты.
3. Включить explicit unsupported-feature behavior (`fallback/disable/block`) и проверить события.
4. Запускать candidate exchange только в restricted runtime mode.
5. Включать production usage только после полного набора regression/docs/sanity тестов.

Подробный операционный чек-лист вынесен в: `docs/user/EXCHANGE_ONBOARDING_FLOW_RU.md`.
