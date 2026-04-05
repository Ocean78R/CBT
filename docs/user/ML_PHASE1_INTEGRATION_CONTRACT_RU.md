# ML phase 1: интеграционный контракт (шаг 37C, финальный подэтап)

## 1) Роль слоя ML phase 1
- `ML phase 1` остаётся **дополнительным bounded-слоем** поверх rule-based стека.
- Ownership торгового решения остаётся у rule-based контура:
  - final interpreter/veto owner: `finalEntryDecisionEngine`;
  - sizing owner: `dynamicPositionSizing` (после approved entry);
  - execution/lifecycle owner: execution + lifecycle path.
- `ML phase 1` не становится owner для sizing/execution/lifecycle и не перехватывает veto ownership.

## 2) Режимы работы `mlPhase1Integration.mlMode`

### `advisory_only`
- ML пишет advisory-оценку и reason-codes.
- Rule-based решение не модифицируется.

### `confirm_only`
- ML может **только ужесточить** already-approved rule-based вход.
- Если правило уже `no_entry`, ML не может «повысить» решение до entry.

### `veto_mode`
- ML может ветировать уже одобренный weak/full entry при слабом ML сигнале.
- ML не может ослаблять hard-veto и не может разрешать rule-rejected вход.

### `confidence_sizing`
- ML не меняет approve/veto решение.
- ML отдаёт только bounded sizing hint (`aggressivenessMultiplier`) для downstream sizing-hook.
- Ownership sizing остаётся у rule-based sizing owner.

## 3) Ограничения (обязательные guardrails)
- `ML phase 1` не может обходить:
  - `capitalRegime` запреты (`HALT_NEW_ENTRIES` / `PROHIBIT_NEW_ENTRIES`),
  - hard-risk/unload блокировки,
  - forecast hard restrictions (`forecast_restriction_veto`, hard restriction hints).
- Даже при высоком `mlScore/mlConfidence` rule-based `no_entry` остаётся первичным итогом.
- `finalEntryDecisionEngine` остаётся final interpreter veto для новых входов.

## 4) Fallback
- При disabled/invalid config или недоступной модели включается безопасный fallback без падения runtime.
- В fallback-ветках ML не переводит `no_entry` в entry и не ломает ownership path.
- Интеграционный флаг `allowFallbackWithoutModel=false` переводит фильтр в safe-disabled состояние при non-`none` fallback inference.

## 5) Отношение к rule-based stack
- Rule-based решение считается baseline (`baseRuleDecision`).
- ML phase 1 работает только поверх baseline и only-bounded:
  - не пересчитывает heavy market features,
  - не пересчитывает block ownership,
  - не переопределяет owner-слои.

## 6) Отношение к `capitalRegime`
- `capitalRegime` ограничения имеют приоритет над ML.
- При `HALT_NEW_ENTRIES`/`PROHIBIT_NEW_ENTRIES` итог всегда `no_entry` независимо от режима ML.
- ML не может уменьшать защитную жёсткость режима капитала.

## 7) Отношение к forecast restrictions
- Forecast hard restrictions интерпретируются в rule-based veto path.
- ML не может снять/смягчить forecast veto и не может превратить forecast-blocked решение в entry.

## 8) Future compatibility contract для шага 39 (bounded, без передачи ownership)

### Что ML phase 1 передаёт дальше (разрешённый контракт)
`mlInferenceOutput`:
- `mlScore`, `mlConfidence`,
- `mlDirectionSupport`, `mlDecisionHint`,
- `mlFallbackState`, `mlDataQualityState`, `mlReasonCodes`,
- `metadata.modelVersion`, `metadata.featureCount`, `metadata.runtimeLayer`,
- `metadata.ownership.*` (все owner-флаги остаются `false`).

`mlPhase1Decision`:
- `baseRuleDecision`, `effectiveDecisionMode`, `effectiveApproved`,
- `mlMode`, `mlDecisionEffect`, `reasonCodes`,
- `confidenceSizingHookApplied`,
- `sizingHook.enabled`, `sizingHook.aggressivenessMultiplier`, `sizingHook.owner`,
- `capitalRegimeImpact`, `forecastImpact`,
- `ownership.baselineDecisionOwner`, `ownership.isFinalVetoOwnerForNewEntries`, `ownership.isSizingOwner`, `ownership.isExecutionOwner`.

### Что может читать будущий meta-controller (шаг 39)
- Только read-only поля из ML output/decision telemetry:
  - confidence/score/quality/fallback markers,
  - effect markers (`mlDecisionEffect`, `confidenceSizingHookApplied`),
  - bounded sizing hint,
  - ownership flags как защитный контракт.
- Meta-controller не должен:
  - менять final veto owner,
  - становиться execution/lifecycle owner,
  - ослаблять `capitalRegime` и forecast hard restrictions.

### Явная фиксация ownership boundary
- Передаваемые поля шага 39 — **signals/hints/telemetry only**.
- Передача ownership не допускается: owner-контуры остаются rule-based.
