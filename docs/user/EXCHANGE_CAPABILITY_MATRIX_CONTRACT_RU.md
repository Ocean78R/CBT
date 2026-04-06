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
