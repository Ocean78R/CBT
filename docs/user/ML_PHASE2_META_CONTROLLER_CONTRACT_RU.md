# ML phase 2 meta-controller: production-like интеграция (шаг 39, подэтапы 39A/39B/39C)

## 1) Роль слоя в архитектуре
`mlMetaController` остаётся **bounded modifier layer** для ML phase 2.

Он:
- читает уже вычисленные upstream/downstream outputs;
- выдаёт только ограниченные (`bounded`) modifiers;
- не владеет final decision, sizing, execution и lifecycle.

Критично:
- `finalEntryDecisionEngine` остаётся **final decision owner**;
- `dynamicPositionSizing` остаётся **sizing owner**;
- hard-risk, `capitalRegime` и forecast restrictions остаются **выше meta-controller**;
- ownership execution/lifecycle не передаётся в ML phase 2.

## 2) Config-контракт (39C)
Минимальные поля production-like конфигурации:

- `enableMlMetaController` — включение слоя;
- `metaControllerMode` — режим (`bounded_modifier` / `manual_policy_fallback`);
- `allowedMetaAdjustments` — whitelist разрешённых bounded-полей;
- `boundsByAdjustmentType` — жёсткие границы по каждому типу корректировки;
- `allowMetaFallbackWithoutModel` — разрешать ли noop-fallback при недоступной модели;
- `metaControllerBudget` — soft budget для будущего runtime-governor контроля;
- `exchangeAgnosticMode=true`;
- `capabilityMatrixHandling='downstream_only'`.

Эти поля нормализуются в `runtimeConfigValidator` и доступны без изменения ownership-path.

## 3) Allowed vs forbidden adjustments
Разрешённые типы корректировок (bounded):
- `entryThresholdModifier`
- `weakEntryBoundaryModifier`
- `fullEntryBoundaryModifier`
- `shortlistRankingModifier`
- `sizingAggressivenessModifier`
- `regimePreferenceWeights`

Запрещённые (игнорируются + попадают в block reasons):
- `directHardRiskOverride`
- `directCapitalRegimeOverride`
- `directForecastRestrictionOverride`
- `directExecutionOwnership`
- `directLifecycleOwnership`
- `directServerTpSlControl`

## 4) Structured logging и runtime semantics
Для интеграции 39C фиксируются события:
- `metaAdjustmentRequested`
- `metaAdjustmentApplied`
- `metaAdjustmentBlocked`

Минимальные поля событий:
- `affectedLayer`
- `appliedBounds`
- `blockedReason` (+ `blockedReasons`)
- `capitalRegimeImpact`
- `forecastImpact`
- `metaFallbackState`

События передаются в существующие `metaRuntimeInfluence` структуры у:
- `finalEntryDecisionEngine`
- `confluenceEntryEngine`
- `dynamicPositionSizing`

без создания параллельной schema.

## 5) Analytics / audit trail
Meta-controller output встраивается в уже существующие payload-контракты:
- в `final_entry_decision.payload.telemetry.downstreamContext.finalEntryDecision`;
- в `dynamic_position_sizing.metaRuntimeInfluence`;
- в `confluence_entry_decision.payload.telemetry.downstreamContext.confluenceEntry.metaRuntimeInfluence`.

Это сохраняет совместимость с текущим observability/audit контуром.

## 6) Связь с rule-based stack, capitalRegime и forecast
- Rule-based stack остаётся primary owner-path.
- `capitalRegime` может блокировать meta-adjustments, но не наоборот.
- Forecast hard restrictions могут блокировать meta-adjustments, но не наоборот.
- ML phase 1 и ML phase 2 работают как modifiers/hints, без передачи final veto ownership.

## 7) Future compatibility для шага 40
Meta-controller подготовлен к step 40 следующим контрактом:
- exchange-agnostic логика остаётся внутри meta-controller;
- различия бирж учитываются downstream через capability matrix;
- `capabilityMatrixHandling='downstream_only'` фиксирует, что exchange-specific ограничения не зашиваются в meta-controller.

## 8) Ограничения текущего шага 39C
- `metaControllerBudget` пока soft-ограничение (без жёсткого runtime-throttling);
- слой работает только с уже доступными `metaSuggestions` (без обучения/инференса внутри);
- расширение capability matrix выполнится на шаге 40, а не внутри 39C.
