# Runtime layer activation diagnostics (2026-04-07)

## Ключевой вывод

Текущий исполняемый контур (`dist/index.js`) продолжает работать через legacy ownership path для входов и сопровождения позиции:
- вход: `openNewPosition -> openNewPositionLegacy`
- сопровождение позиции: `processExistingPosition -> processExistingPositionLegacy`

В этом path не вызываются `portfolioRiskContour`, `forcedLossExit`, `advanced position lifecycle`, `dynamicPositionSizing`, `exchangeRuntimeIntegration`.

## Что фактически подключено

- `dynamicAssetSelection` реально вызывается перед обработкой тикеров (`refreshDynamicEntryShortlist`) и участвует в gate новых входов (`evaluateNewEntryAllowance`).
- `confluenceEntryEngine` вызывается как обёртка внутри `predictPriceDirection`, но при `enabled=false`/`mode!=confluence` возвращает `LEGACY_FALLBACK`.

## Что не подключено в текущем runtime-path

1. `dist/runtime/config/runtimeConfigValidator.js` (новый нормализатор) не используется launcher'ом: в `dist/index.js` создан собственный локальный `runtimeConfigValidator` с ограниченной нормализацией.
2. `safeStartupPresets` и `preLiveChecklist` нормализуются в `dist/runtime/config/runtimeConfigValidator.js`, но не применяются в исполняемом `Launcher` path.
3. `exchangeRuntimeIntegration` и capability-matrix слой присутствуют как модули, но не подключаются в `dist/index.js` execution path.
4. Risk/position engines в `dist/runtime/engines/index.js` содержат методы `evaluatePortfolioRiskContour`, `evaluateForcedLossExit`, `evaluatePositionLifecycle`, но в `SingleStrategy` используется `processExistingPositionLegacy`, где этих вызовов нет.

## Какие параметры и значения поставить в config для включения новой логики

Ниже минимальный рабочий профиль (старт с самого мягкого уровня):

```json
{
  "singleSetts": {
    "used": true,
    "tickers": {
      "enableDynamicAssetSelection": true,
      "dynamicAssetSelection": {
        "enabled": true,
        "shortlistSize": 4,
        "lookbackBars": 8,
        "lookbackTrades": 300,
        "dynamicSelectionMode": "whitelist_only"
      }
    }
  },
  "confluenceEntryEngine": {
    "enabled": true,
    "mode": "confluence",
    "allowWeakEntry": false,
    "blockWeights": {
      "entryPermission": 0.28,
      "marketContext": 0.2,
      "primarySignal": 0.32,
      "confirmation": 0.2,
      "bounceDetection": 0.05,
      "breakdownDetection": 0.05,
      "sessionFilter": 0.05,
      "eventRisk": 0.05
    },
    "bounceDetection": { "enabled": true },
    "breakdownDetection": { "enabled": true },
    "sessionFilter": { "enabled": true },
    "eventRisk": { "enabled": true }
  },
  "higherTimeframeBiasEngine": {
    "enabled": true,
    "higherTimeframe": "4h",
    "lookbackBars": 120
  },
  "portfolioRiskContour": {
    "enabled": true,
    "dailyLossLimitPercent": 3,
    "maxNewEntriesPerDay": 2,
    "maxOpenPositions": 2,
    "maxUsedMarginPercent": 35
  },
  "forcedLossExit": {
    "enabled": true,
    "actionMode": "warn",
    "enablePostEntryObservation": true,
    "postEntryGraceMinutes": 8,
    "postEntryObservationMinutes": 45
  },
  "positionLifecycle": {
    "enableAdvancedLifecycle": true
  },
  "paperTrading": {
    "enabled": true,
    "mode": "paper",
    "initialBalance": 10000
  }
}
```

### Порядок активации (рекомендуется)

1. `paperTrading.enabled=true` + `singleSetts.used=true`.
2. `confluenceEntryEngine.enabled=true`, `mode=confluence`, `allowWeakEntry=false`.
3. `higherTimeframeBiasEngine.enabled=true`.
4. `dynamicAssetSelection.enabled=true` с `shortlistSize=4`.
5. `portfolioRiskContour.enabled=true` (жёсткие лимиты как выше).
6. `forcedLossExit.enabled=true`, сначала `actionMode="warn"`, затем только после валидации перевести в `block_averaging`/`partial_reduce`.
7. `positionLifecycle.enableAdvancedLifecycle=true` последним шагом.

### Важно

Даже при этих флагах часть новой логики останется «формально включённой», но фактически неиспользуемой, пока в активный runtime-path не добавлены вызовы соответствующих engines (legacy path в `dist/index.js` сейчас доминирует).

## Минимальная безопасная диагностика для runtime

Для подтверждения в боевом логе достаточно трёх trace-точек:
1. В начале цикла логировать активный path: `legacy` или `new`.
2. Перед `processExistingPositionLegacy` логировать marker `legacy_position_flow_entered=true`.
3. При входе в `predictPriceDirection` логировать `confluence.enabled`, `confluence.mode`, `result.mode`, `result.decision.finalDecision`.
