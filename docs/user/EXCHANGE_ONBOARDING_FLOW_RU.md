# Safe onboarding flow для новой биржи (шаг 40 / подэтап 3)

## Цель
Зафиксировать безопасный, поэтапный и проверяемый путь подключения новой биржи **без поломки BingX baseline** и без скрытого включения неподдержанных режимов.

## Обязательные принципы
- BingX остаётся baseline-reference реализацией до полного прохождения onboarding для новой биржи.
- Decision/sizing/capital/forecast ownership не переходит в exchange-layer.
- Любая unsupported capability обрабатывается только явно (`fallback | disable | block`), без silent degradation.
- До прохождения всех проверок новая биржа работает только в restricted runtime mode.

## Пошаговый onboarding flow

### 1) Capability matrix (обязательный шаг)
1. Добавить exchange-профиль в `EXCHANGE_CAPABILITY_MATRIX`.
2. Заполнить все обязательные capability domains:
   - server TP/SL support;
   - reduce-only semantics;
   - order lifecycle specifics;
   - reconciliation support;
   - position/side mode specifics;
   - signal data availability;
   - execution restrictions.
3. Прогнать проверку completeness (`ensureDomainCompleteness`) — отсутствующие домены запрещены.

### 2) Contract validation (обязательный шаг)
1. Построить unified contract через `createUnifiedExchangeContract(<exchange>)`.
2. Убедиться в инвариантах:
   - `ownershipSafety.canBecomeDecisionOwner === false`;
   - `decisionLayers24To39MustBeExchangeAgnostic === true`;
   - unknown capability не трактуется как supported.
3. Проверить fallback semantics для unknown/partial случаев.

### 3) Safe unsupported-feature behavior (обязательный шаг)
1. Для каждой рискованной capability явно проверить ветки:
   - `fallback` (разрешён безопасный fallback path),
   - `disable` (feature отключается),
   - `block` (жёсткая блокировка действия).
2. Убедиться, что события `unsupportedFeatureFallbackUsed` публикуются для аудита.

### 4) Restricted runtime mode (обязательный шаг)
До production-этапа для новой биржи должны быть заданы ограничения:
- `enableExchangeCapabilityChecks = true`;
- `safeUnsupportedFeatureMode = block` (или `disable` при консервативной миграции);
- `exchangeRestrictionPolicy = enforce`;
- `bingxBaselineReference = true` сохраняется до финального rollout.

### 5) Tests before enabling production usage (обязательный шаг)
Перед включением production usage необходимо иметь зелёные проверки:
- regression tests на capability/contract/runtime integration;
- docs/config/runtime consistency tests;
- sanity checks:
  - capability completeness check,
  - unsupported feature exposure check,
  - exchange contract validation check.

## Минимальный чек-лист готовности
- [ ] Матрица capability заполнена полностью.
- [ ] Unified contract валиден и ownership-safe.
- [ ] Unsupported feature path явный и проверен во всех режимах.
- [ ] Restricted runtime mode включён.
- [ ] Все тесты и sanity checks прошли.
- [ ] BingX baseline остаётся неизменным по тестам.

## Что остаётся вне этого подэтапа
- Полный runtime-refactor и пересборка wiring.
- Передача final decision ownership в exchange-layer.
- Включение production-режима новой биржи до прохождения чек-листа.

