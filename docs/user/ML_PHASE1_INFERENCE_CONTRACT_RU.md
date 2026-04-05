# ML phase 1: контракт `mlInferenceLayer` (шаг 37, подэтап 1)

> Дополнение по интеграционным режимам/ownership/future compatibility (шаг 37C): см. `docs/user/ML_PHASE1_INTEGRATION_CONTRACT_RU.md`.

## Назначение
- `mlInferenceLayer` — отдельный advisory-слой поверх rule-based архитектуры.
- Слой не заменяет и не обходит risk/final-decision/sizing/execution ownership.
- Использует только уже готовый shared runtime context и block outputs.

## Входной контракт (минимум)
```js
{
  context: { cycleId, ticker, ... },
  sharedRuntimeBlockOutputs: { [blockName]: { score, confidence, dataQualityState, ... } },
  approvedRuleDecisionContext: { score, confidence, dataQualityState, ... } | null,
  balanceState: { capitalRegime, drawdownPct, equityUtilizationPct, unloadMode, ... } | null,
  capitalRegime: 'NORMAL' | 'REDUCE_RISK' | 'CONSERVE_CAPITAL' | ...,
  dataQualityState: 'ok' | 'degraded' | 'cached' | 'missing' | 'unknown',
  portfolioForecastState: { confidence, ... } | null,               // optional
  capitalStressForecastScore: number | null,                        // optional
  forecastRegimeShiftRisk: number | null,                           // optional
  portfolioFragilityScore: number | null                            // optional
}
```

## Выходной контракт (минимум)
```js
{
  mlScore: number,                     // 0..1
  mlConfidence: number,                // 0..1
  mlDirectionSupport: 'long' | 'short' | 'neutral',
  mlDecisionHint: string,              // confirm_long_candidate / hold_neutral / ...
  mlDataQualityState: 'ok' | 'degraded' | 'missing' | 'unknown',
  mlReasonCodes: string[],
  mlFallbackState: 'none' | 'disabled' | 'model_unavailable' | 'missing_feature_fallback' | 'budget_degraded',
  metadata: {
    ownership: {
      isFinalDecisionOwner: false,
      isSizingOwner: false,
      isExecutionOwner: false,
      recalculatesMarketData: false,
      recalculatesHeavyFeatures: false
    },
    ...
  }
}
```

## Feature discipline
- Нет повторного heavy feature pipeline.
- Нет рыночных запросов из ML слоя.
- Берутся только уже рассчитанные данные из `sharedRuntimeBlockOutputs`, `approvedRuleDecisionContext`, `balanceState`, forecast-полей.

## Безопасный fallback
- Если артефакт модели отсутствует/битый: `mlFallbackState = model_unavailable`.
- Если недостаточно фич: `mlFallbackState = missing_feature_fallback`.
- Если превышен бюджет feature preparation/inference: `mlFallbackState = budget_degraded`.
- Во всех fallback-ветках runtime не падает, возвращается нейтральный advisory output.
