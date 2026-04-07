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

## Минимальная безопасная диагностика для runtime

Для подтверждения в боевом логе достаточно трёх trace-точек:
1. В начале цикла логировать активный path: `legacy` или `new`.
2. Перед `processExistingPositionLegacy` логировать marker `legacy_position_flow_entered=true`.
3. При входе в `predictPriceDirection` логировать `confluence.enabled`, `confluence.mode`, `result.mode`, `result.decision.finalDecision`.

