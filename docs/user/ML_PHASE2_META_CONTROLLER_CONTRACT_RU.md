# ML phase 2 meta-controller: контракт каркаса (шаг 39, подэтап 1)

## 1) Назначение
`mlMetaController` — это **только bounded modifier layer** для ML phase 2.

Он:
- получает уже готовый runtime-контекст,
- читает готовые outputs rule-based/ML phase 1 слоёв,
- возвращает только ограниченные (`bounded`) adjustment-подсказки.

Он **не**:
- пересчитывает market data/heavy features,
- не подменяет `finalEntryDecisionEngine`, dynamic sizing owner, execution/lifecycle owners,
- не обходит hard-risk, unload mode, safeEntryAssets restrictions, portfolio risk contour, hard veto, capitalRegime и forecast restrictions.

## 2) Входной контракт (`ml_phase2_meta_controller_input.v1`)
Минимально ожидаемые поля:
- `decisionContext` — текущий общий DecisionContext;
- `sharedRuntimeBlockOutputs` — уже вычисленные outputs общих блоков;
- `finalEntryDecisionOutput` — результат `finalEntryDecisionEngine`;
- `dynamicPositionSizingOutput` **или** `sizingBaselineMetadata`;
- `mlPhase1Output` (если доступен);
- `balanceState` и/или `capitalRegime`;
- `forecastState` (если доступен);
- `runtimeDataQualityState`.

Дополнительно для каркаса:
- `modelState.available`;
- `metaSuggestions` — кандидаты bounded-коррекций.

## 3) Выходной контракт (`ml_phase2_meta_controller_output.v1`)
`mlMetaController.evaluate(...)` возвращает:
- `metaAdjustmentSet`;
- `allowedAdjustmentBounds`;
- `appliedAdjustmentReasons`;
- `blockedAdjustmentReasons`;
- `metaControllerDataQualityState`;
- `metaControllerFallbackState`;
- `allowedParameters` / `forbiddenParameters`;
- `ownershipGuards`;
- `telemetry.featureComputation.recomputedMarketData=false` и `recomputedHeavyFeatures=false`.

## 4) Разрешённые параметры (allowed) и жёсткие bounds
Разрешены только следующие bounded-параметры:

1. `entryThresholdModifier`: `[-0.05, +0.05]`
2. `weakEntryBoundaryModifier`: `[-0.05, +0.05]`
3. `fullEntryBoundaryModifier`: `[-0.05, +0.05]`
4. `shortlistRankingModifier`: `[-0.15, +0.15]`
5. `sizingAggressivenessModifier`: `[-0.15, +0.15]`
6. `regimePreferenceWeights` (по каждому режиму отдельно): `[-0.2, +0.2]`
   - `trend`
   - `meanReversion`
   - `breakoutRejection`
   - `noTradeFlat`

Все значения жёстко clamp-ятся в bounds.

## 5) Запрещённые параметры (forbidden)
Запрещены прямые override/ownership-поля:
- `directHardRiskOverride`
- `directCapitalRegimeOverride`
- `directForecastRestrictionOverride`
- `directExecutionOwnership`
- `directLifecycleOwnership`
- `directServerTpSlControl`

Если такие поля встречаются во входе, они попадают в `blockedAdjustmentReasons` и игнорируются.

## 6) Safe fallback
Каркас возвращает noop-adjustments при:
- `disabled` (выключен config),
- `model_unavailable` (нет model state),
- `input_quality_insufficient` (контракт/качество входа не проходит минимум).

Во fallback:
- `metaAdjustmentSet` = нулевые корректировки,
- ownership guards остаются жёстко запретительными,
- hard constraints остаются выше meta-controller.

## 7) Ownership path гарантии
Контракт явно фиксирует:
- `ownershipPathChanged=false`,
- `canBecomeDecisionOwner=false`,
- `canBypassHardConstraints=false`,
- `isSizingOwner=false`,
- `isExecutionOwner=false`,
- `isLifecycleOwner=false`.

Это сохраняет существующую архитектуру шагов 1–38 без takeover со стороны ML phase 2.
