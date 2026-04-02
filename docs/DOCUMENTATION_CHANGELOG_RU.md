# Журнал изменений пользовательской документации

## Формат записи
- Дата: YYYY-MM-DD
- Изменение: что добавлено/изменено
- Связанные файлы кода: список файлов
- Связанные разделы docs: список файлов

---


## 2026-04-02 (higher timeframe bias / market structure engine)
- Изменение: добавлен отдельный слой `higherTimeframeBiasEngine` для анализа старшего контекста (`HH/HL`, `LH/LL`, BOS, CHoCH, диапазон HTF) с выходами `htfBias`, `marketStructureState`, `structureConfidence`, `trendAlignmentScore`.
- Изменение: слой интегрирован как context-only перед `confluence/finalEntryDecision` через soft-penalty/boost и не может единолично разрешать вход; hard-risk/capital-veto остаются выше.
- Изменение: добавлен `slower-refresh` режим с кэшированием HTF-структуры в `FeatureStore.slowerRefreshContextCache` (`full/cached/degraded` режимы качества данных).
- Изменение: добавлены runtime-логи `[higherTimeframeBias]` и structured событие `higher_timeframe_bias_decision` для observability/audit trail.
- Изменение: добавлен config-блок `higherTimeframeBiasEngine` в runtime validator и `dist/_config/config.json`.
- Связанные файлы кода: `dist/runtime/engines/higherTimeframeBiasEngine.js`, `dist/runtime/engines/index.js`, `dist/runtime/config/runtimeConfigValidator.js`, `dist/_config/config.json`, `tests/regression/higher-timeframe-bias-engine.test.js`.
- Связанные разделы docs: `docs/user/TRADING_PIPELINE_RU.md`, `docs/user/CONFIG_GUIDE_RU.md`, `docs/user/LOGS_AND_TROUBLESHOOTING_RU.md`.


## 2026-04-02 (execution/reconciliation leverage mismatch corrective patch)
- Изменение: execution/reconciliation расширен для explicit special states (`NORMAL_POSITION`, `LEVERAGE_MISMATCH_POSITION`, `LEGACY_RESTRICTED_POSITION`) с проверкой `leverage + position mode + reduce-only assumptions`.
- Изменение: добавлена структурированная передача restricted-state в `PositionState`, `DecisionContext.metadata` и `lifecycleContext` без смены ownership path.
- Изменение: заблокированные действия (`averaging`, leverage-sensitive updates) теперь фиксируются отдельным structured event `execution.blocked_action` с причиной и allow/block матрицей.
- Изменение: добавлены регрессии на detection/restart recovery/propagation для mismatch-позиций.
- Связанные файлы кода: `dist/index.js`, `tests/regression/single-strategy.regression.test.js`.
- Связанные разделы docs: `docs/user/TRADING_PIPELINE_RU.md`, `docs/ARCHITECTURE_CONTRACT_RU.md`.

## 2026-04-02 (protective dedup/audit trace hardening)
- Изменение: в observability-reporting добавлены агрегированные protective-метрики отчёта (`protectiveDiagnostics.duplicateClosePrevented`, `byOwner`, `byCloseSource`) для явной проверки, что `duplicateClosePrevented=true` попадает не только в логи, но и в report events.
- Изменение: в audit/postmortem trace расширен lifecycle/reconciliation stage: сохраняются `protectiveActionOwner`, `protectiveActionToken`, `duplicateClosePrevented`, `closeSource`, включая рестартный reconciliation-кейс.
- Изменение: добавлены регрессии на restart/reconciliation token continuity и restricted `LEVERAGE_MISMATCH_POSITION` через тот же dedup-owner path.
- Изменение: в user docs явно зафиксированы роли owner/fallback/decision-layer для protective close.
- Связанные файлы кода: `dist/runtime/observability/reportingLayer.js`, `tests/regression/observability-reporting-layer.test.js`, `tests/regression/forced-loss-exit-early-invalidation.test.js`.
- Связанные разделы docs: `docs/user/TRADING_PIPELINE_RU.md`, `docs/user/LOGS_AND_TROUBLESHOOTING_RU.md`.

## 2026-04-02 (protective close runtime owner/dedup corrective step)
- Изменение: формализован runtime-owner protective close: `server_stop_loss_manager` (primary при server initiated/confirmed close) и `execution_lifecycle_manager` (локальный lifecycle owner-path).
- Изменение: добавлен dedup/correlation token `protectiveActionToken` и политика безопасного no-op (`duplicateClosePrevented`) для повторных конфликтующих close попыток.
- Изменение: расширены structured fields/logging (`protectiveActionOwner`, `protectiveActionToken`, `duplicateClosePrevented`, `closeSource`) и связаны execution/lifecycle/reconciliation ссылки в user docs.
- Изменение: добавлены интеграционные регрессии на race/order сценарии между server SL и local forced/protective close.
- Связанные файлы кода: `dist/runtime/risk/forcedLossExit.js`, `dist/runtime/engines/index.js`, `tests/regression/forced-loss-exit-early-invalidation.test.js`.
- Связанные разделы docs: `docs/user/TRADING_PIPELINE_RU.md`, `docs/user/LOGS_AND_TROUBLESHOOTING_RU.md`, `docs/audits/earlyInvalidationExit-consistency-2026-04-02.md`.

## 2026-04-02 (dynamicAssetSelection shortlist для новых входов)
- Изменение: добавлен конфиг-управляемый слой `singleSetts.tickers.dynamicAssetSelection` с whitelist=`definedAssets` и runtime-shortlist для новых входов.
- Изменение: реализовано ранжирование тикеров по факторам `volatility/speed/tradeQuality/averagingPenalty/realizedPnl/liquidity` с сохранением статического fallback-режима.
- Изменение: shortlist учитывает `balanceState/capitalRegime` и forecast stress-signal hints как внешний контекст; при ухудшении состояния капитала shortlist автоматически сжимается.
- Изменение: добавлены structured events `entry_decision.dynamic_asset_selection` и расширены audit-поля `unload_mode_gate` (`dynamicShortlist`).
- Связанные файлы кода: `dist/index.js`, `dist/_config/config.json`.
- Связанные разделы docs: `docs/user/CONFIG_GUIDE_RU.md`, `docs/user/TRADING_PIPELINE_RU.md`.

## 2026-04-01
- Изменение: создан полноценный пользовательский documentation layer для оператора, добавлена структура user-docs, добавлена политика обязательного обновления документации и автоматическая проверка документационных требований.
- Связанные файлы кода: `scripts/docs/check-documentation.js`, `scripts/architecture/check-architecture.js`, `tests/docs/documentation.policy.test.js`, `package.json`, `README.md`.
- Связанные разделы docs: `docs/user/README_RU.md`, `docs/user/RUN_AND_MODES_RU.md`, `docs/user/TRADING_PIPELINE_RU.md`, `docs/user/RISK_AND_PROTECTION_RU.md`, `docs/user/CONFIG_GUIDE_RU.md`, `docs/user/LOGS_AND_TROUBLESHOOTING_RU.md`, `docs/DOCUMENTATION_UPDATE_POLICY_RU.md`.

## 2026-04-01 (capitalRegimeEngine как отдельный слой)
- Изменение: выделен отдельный слой `capitalRegimeEngine` как primary current-state layer для расчёта режима капитала (`NORMAL/CAUTION/DEFENSIVE/CAPITAL_PRESERVATION/HALT_NEW_ENTRIES`) и интегрирован в `portfolioRiskContour` без поломки legacy fallback.
- Изменение: добавлена отдельная передача `capitalRegime` в downstream-контексты (`unloadMode`, `dynamicAssetSelection`, `marketRegimeRouter`, `confluenceEntry`, `finalEntryDecision`, `dynamicPositionSizing`, `mlFeatureContext`, `mlMetaController`) через единый `telemetry.downstreamContext`.
- Изменение: добавлены отдельные поля `forecastRegimeShiftRisk` и `forecastSignals`; прогнозный слой не смешивается с current-state `capitalRegime` и не может ослаблять уже установленную жёсткость.

## 2026-04-01 (антикризисный unload mode)
- Изменение: добавлен операционный unload mode (до entry decision/sizing) с режимами capitalRegime `NORMAL/CAUTION/DEFENSIVE/HALT_NEW_ENTRIES`, safe-basket для новых входов и лимитами новых входов за цикл/день, при этом сопровождение уже открытых позиций сохранено.
- Связанные файлы кода: `dist/index.js`, `dist/runtime/config/runtimeConfigValidator.js`, `dist/_config/config.json`.
- Связанные разделы docs: `docs/user/TRADING_PIPELINE_RU.md`, `docs/user/CONFIG_GUIDE_RU.md`.

## 2026-04-01 (устойчивый execution contour)
- Изменение: расширен контур исполнения ордеров без изменения торговой стратегии: добавлены очередь заявок, сериализация критичных операций, retry policy, deduplication и reconciliation перед обработкой тикера.
- Связанные файлы кода: `dist/index.js`, `dist/runtime/config/runtimeConfigValidator.js`, `dist/_config/config.json`.
- Связанные разделы docs: `docs/user/TRADING_PIPELINE_RU.md`, `docs/user/CONFIG_GUIDE_RU.md`, `docs/user/LOGS_AND_TROUBLESHOOTING_RU.md`.

## 2026-04-01 (server stop-loss manager BingX)
- Изменение: добавлен serverStopLoss manager-слой для BingX (reduce-only/close-only), постановка после открытия позиции, обновление после averaging, cleanup/reconciliation сиротских SL-ордеров, fallback на forcedLossExit/local polling close.
- Связанные файлы кода: `dist/index.js`, `dist/runtime/config/runtimeConfigValidator.js`, `dist/_config/config.json`.
- Связанные разделы docs: `README.md`, `docs/user/TRADING_PIPELINE_RU.md`, `docs/user/CONFIG_GUIDE_RU.md`, `docs/user/RISK_AND_PROTECTION_RU.md`, `docs/user/LOGS_AND_TROUBLESHOOTING_RU.md`.

## 2026-04-02 (postEntryObservation / earlyInvalidationExit)
- Изменение: в рамках слоя `forcedLossExit` добавлен отдельный ранний подрежим `postEntryObservation/earlyInvalidationExit` с grace-period, окном наблюдения и подтверждением устойчивого adverse-trend.
- Изменение: сохранён порядок защиты и fallback: `server stop-loss -> early invalidation -> legacy forced/stuck -> averaging`; при `enablePostEntryObservation=false` поведение возвращается к прежнему forced/stuck flow.
- Изменение: добавлены runtime-поля логирования/structured event для ранней диагностики (`triggerStage`, `earlyInvalidationReason`, время с входа, отклонение от entry, длительность adverse-зоны, подтверждение trend, scenarioBroken).
- Связанные файлы кода: `dist/runtime/risk/forcedLossExit.js`, `dist/runtime/engines/index.js`, `dist/runtime/config/runtimeConfigValidator.js`, `dist/_config/config.json`, `tests/regression/forced-loss-exit-early-invalidation.test.js`.
- Связанные разделы docs: `docs/user/TRADING_PIPELINE_RU.md`, `docs/user/RISK_AND_PROTECTION_RU.md`, `docs/user/CONFIG_GUIDE_RU.md`, `docs/user/LOGS_AND_TROUBLESHOOTING_RU.md`, `docs/ARCHITECTURE_CONTRACT_RU.md`.

## 2026-04-01 (forcedLossExit / stuckPositionProtection)
- Изменение: добавлен конфигурируемый слой forcedLossExit/stuckPositionProtection после server SL и до averaging; введены action-режимы `warn/block_averaging/partial_reduce/force_close`, влияние capitalRegime через `regimeTightening`, отдельный forecast-вход через `forecastInfluence`, и структурированное событие `forced_loss_exit_decision`.
- Связанные файлы кода: `dist/runtime/risk/forcedLossExit.js`, `dist/runtime/engines/index.js`, `dist/runtime/config/runtimeConfigValidator.js`, `dist/_config/config.json`.
- Связанные разделы docs: `docs/user/TRADING_PIPELINE_RU.md`, `docs/user/RISK_AND_PROTECTION_RU.md`, `docs/user/CONFIG_GUIDE_RU.md`, `docs/user/LOGS_AND_TROUBLESHOOTING_RU.md`.

- Изменение: в execution/reconciliation добавлен restricted state для leverage mismatch позиций с явными allowed/blocked actions; safe close path сохранён, averaging и leverage-sensitive действия блокируются через ownership path execution_lifecycle_manager.

## 2026-04-01 (portfolio/account risk contour)
- Изменение: добавлен полноценный риск-контур уровня портфеля/счёта с лимитами дневного убытка, новых входов за день, одновременно открытых позиций, суммарной маржи и cooldown после плохой серии; добавлены режимы `NORMAL/CAUTION/DEFENSIVE/CAPITAL_PRESERVATION/HALT_NEW_ENTRIES` и структурированное событие `portfolio_risk_contour_decision`.
- Связанные файлы кода: `dist/runtime/risk/portfolioRiskContour.js`, `dist/runtime/engines/index.js`, `dist/runtime/config/runtimeConfigValidator.js`, `dist/_config/config.json`, `tests/regression/portfolio-risk-contour.test.js`.
- Связанные разделы docs: `docs/user/TRADING_PIPELINE_RU.md`, `docs/user/RISK_AND_PROTECTION_RU.md`, `docs/user/CONFIG_GUIDE_RU.md`, `docs/user/LOGS_AND_TROUBLESHOOTING_RU.md`.

## 2026-04-01 (базовый слой trade analytics)
- Изменение: добавлен боевой минимум trade analytics с персистентным журналом сделок (CSV) и восстановлением состояния открытых сделок после рестарта (`open_trades_state.json`).
- Изменение: добавлены сводные отчёты по тикерам и режимам (winRate, avgWin, avgLoss, expectancy, усреднения, час/день недели, тип сигнала).
- Изменение: добавлено сохранение forecast-контекста в сделку при наличии данных в runtime-контексте (`portfolioForecastState`, `capitalStressForecastScore`, `forecastRegimeShiftRisk`, `portfolioFragilityScore`, restriction/hints).
- Связанные файлы кода: `dist/index.js`, `dist/runtime/config/runtimeConfigValidator.js`, `dist/_config/config.json`.
- Связанные разделы docs: `docs/user/CONFIG_GUIDE_RU.md`, `docs/user/TRADING_PIPELINE_RU.md`, `docs/user/LOGS_AND_TROUBLESHOOTING_RU.md`.
- Изменение: добавлены русские inline-комментарии в trade analytics расчёты (без изменения поведения).

## 2026-04-01 (trade analytics: устойчивый CSV-парсинг и расширенная статистика)
- Изменение: улучшен CSV-парсинг в trade analytics, чтобы корректно обрабатывать JSON-поля с запятыми/кавычками (`forecastHints`, `forecastRestrictionsApplied`) без искажения отчёта.
- Изменение: добавлена отдельная агрегация `bySetupType` и расширенная статистика по усреднениям (`averagingUsageRate`, `avgPnlWithAveraging`, `avgPnlWithoutAveraging`).
- Изменение: в аналитической строке `marketRegime` теперь берётся из runtime-контекста (fallback сохранён на `predictType`), что улучшает точность анализа по режимам.
- Связанные файлы кода: `dist/index.js`.
- Связанные разделы docs: `docs/user/CONFIG_GUIDE_RU.md`.

## 2026-04-01 (единый observability/reporting/audit layer)
- Изменение: добавлен единый слой наблюдаемости и отчётности с категоризацией событий (`decision/execution/protective/regime/lifecycle/forecast`), неблокирующим batching/flush и configurable sampling для high-volume decision-событий.
- Изменение: добавлен audit trail для восстановления цепочки `capital -> forecast -> universe -> regime -> confluence -> veto -> sizing -> execution -> lifecycle`, включая forecast-ветку `forecast_events/forecast_restrictions/forecast_protective_hints`.
- Изменение: добавлен конфиг `observabilityReporting` и интеграция с существующими structured events risk-слоёв без изменения legacy торгового поведения (слой выключен по умолчанию).
- Связанные файлы кода: `dist/runtime/observability/reportingLayer.js`, `dist/runtime/engines/index.js`, `dist/runtime/config/runtimeConfigValidator.js`, `dist/_config/config.json`, `tests/regression/observability-reporting-layer.test.js`.
- Связанные разделы docs: `docs/user/CONFIG_GUIDE_RU.md`, `docs/user/TRADING_PIPELINE_RU.md`, `docs/user/LOGS_AND_TROUBLESHOOTING_RU.md`.

## 2026-04-01 (request scheduler + безопасное распараллеливание read-only)
- Изменение: добавлен `requestScheduler` для read-only слоя providers с лимитом конкурентности, rate-limit awareness, очередями приоритетов и backoff при API-перегрузке.
- Изменение: scheduler интегрирован только в read-only path и явно не подменяет execution owner-layer; execution-critical операции оставлены последовательными/live-only.
- Изменение: добавлены диагностические события scheduler (`scheduler_enqueued`, `scheduler_started`, `scheduler_backoff_set`, `scheduler_optional_budget_skip`) для observability/audit trail совместимости.
- Изменение: добавлены тесты на конкурентность, приоритетную очередь и backoff при rate-limit ошибке.
- Связанные файлы кода: `dist/runtime/scheduler/requestScheduler.js`, `dist/runtime/providers/index.js`, `dist/runtime/config/runtimeConfigValidator.js`, `dist/_config/config.json`, `tests/regression/providers-performance-diagnostics.test.js`.
- Связанные разделы docs: `docs/user/CONFIG_GUIDE_RU.md`, `docs/user/TRADING_PIPELINE_RU.md`.

## 2026-04-01 (performance audit: профилирование и безопасные read-only оптимизации)
- Изменение: добавлен конфигурируемый слой `performanceDiagnostics` для аудита производительности провайдеров (latency/cache/in-flight метрики) без изменения торговой логики и ownership path.
- Изменение: в observability reporting добавлены performance-метрики `ingest/flush/analytics` и разделение потока событий на `signalReadOnly`, `executionProtection`, `analyticsReporting`.
- Изменение: внедрены минимально рискованные оптимизации read-only части: дедупликация in-flight одинаковых запросов и TTL-кэш в пределах короткого окна.
- Связанные файлы кода: `dist/runtime/providers/index.js`, `dist/runtime/observability/reportingLayer.js`, `dist/runtime/config/runtimeConfigValidator.js`, `dist/_config/config.json`, `tests/regression/providers-performance-diagnostics.test.js`, `tests/regression/observability-reporting-layer.test.js`.
- Связанные разделы docs: `docs/user/CONFIG_GUIDE_RU.md`, `docs/user/TRADING_PIPELINE_RU.md`.


## 2026-04-01 (safe cache + in-memory hot-state для market read-only)
- Изменение: расширен `performanceDiagnostics` безопасным read-only кэшированием `markPrice` и `kline` с отдельными TTL, плюс hot-state по тикерам в оперативной памяти.
- Изменение: добавлены TTL tiers для derived features (ultra-short / per-cycle / context) и ключи `ticker+timeframe+featureVersion+cycleContext` для reuse между сигнальными слоями.
- Изменение: добавлены безопасные механизмы инвалидизации (`onError`, `onExecutionTickers`, `forceRefreshReadOnly`, per-cycle clear) без изменения execution ownership.
- Изменение: добавлены метрики и события `cache_hit/cache_miss/cache_stale_reuse/cache_forced_refresh` для observability/audit-совместимости.
- Связанные файлы кода: `dist/runtime/providers/index.js`, `dist/runtime/config/runtimeConfigValidator.js`, `dist/_config/config.json`, `tests/regression/providers-performance-diagnostics.test.js`.
- Связанные документы: `docs/user/CONFIG_GUIDE_RU.md`, `docs/user/TRADING_PIPELINE_RU.md`, `docs/user/LOGS_AND_TROUBLESHOOTING_RU.md`.

## 2026-04-01 (performance governor / performance control plane)
- Изменение: добавлен отдельный runtime-слой `performanceGovernor` (`dist/runtime/performance/performanceGovernor.js`) как единый control plane производительности с per-layer budgets, staged evaluation, loop classes, лимитами по тикерам, cadence редких признаков и правилами graceful degradation.
- Изменение: governor интегрирован в providers read-only flow без изменения ownership торговых решений и без конфликта с execution/risk слоями; legacy/fallback сохранён через `enabled=false` и `mode=monitor_only`.
- Изменение: добавлены структурированные события и логи governor (`performance_governor_cycle_start`, `performance_governor_cycle_end`, `performance_governor_layer_skip`) совместимые с observability/audit trail.
- Изменение: добавлен конфиг `performanceGovernor` в runtime validator и `dist/_config/config.json`.
- Изменение: добавлены регрессионные тесты на staged evaluation/degradation и интеграцию control plane.
- Связанные файлы кода: `dist/runtime/performance/performanceGovernor.js`, `dist/runtime/providers/index.js`, `dist/runtime/config/runtimeConfigValidator.js`, `dist/_config/config.json`, `tests/regression/providers-performance-diagnostics.test.js`.
- Связанные разделы docs: `docs/user/TRADING_PIPELINE_RU.md`, `docs/user/CONFIG_GUIDE_RU.md`, `docs/user/LOGS_AND_TROUBLESHOOTING_RU.md`.

## 2026-04-01 (paper/shadow trading режим)
- Изменение: добавлен отдельный execution-слой `paperExecutionEngine` для paper/shadow режима без отправки реальных ордеров, с сохранением общего decision/risk flow.
- Изменение: добавлен config-блок `paperTrading` (`enabled`, `mode`, `initialBalance`, `slippageBps`, `feeBps`) и fallback на live execution при выключенном флаге.
- Изменение: добавлены отдельные логи и structured события paper-execution с полями capital/forecast контекста и метриками виртуального баланса.
- Изменение: observability слой получил корректную фильтрацию `includePaperMode/includeLiveMode` и дефолтный `mode=live`.
- Связанные файлы кода: `dist/runtime/execution/paperTrading.js`, `dist/runtime/engines/index.js`, `dist/runtime/config/runtimeConfigValidator.js`, `dist/runtime/observability/reportingLayer.js`, `dist/runtime/risk/portfolioRiskContour.js`, `dist/runtime/risk/forcedLossExit.js`, `dist/runtime/risk/capitalStressForecastEngine.js`, `dist/_config/config.json`, `tests/regression/paper-trading-mode.test.js`.
- Связанные разделы docs: `docs/user/RUN_AND_MODES_RU.md`, `docs/user/CONFIG_GUIDE_RU.md`, `docs/user/TRADING_PIPELINE_RU.md`, `docs/user/LOGS_AND_TROUBLESHOOTING_RU.md`.

## 2026-04-01 (ML dataset builder для обучения качества входа)
- Изменение: добавлен отдельный слой `mlDatasetBuilder` для сбора обучающего датасета без изменения торговой логики; слой пишет features в момент потенциального/фактического входа и labels при завершении сделки.
- Изменение: добавлен конфиг `mlDatasetBuilder` с master-флагом, storage-путями, режимами capture и схемой label generation.
- Изменение: добавлена интеграция с logging/observability (`ml_dataset_feature_captured`, `ml_dataset_label_resolved`) и персистентное `pendingState` для устойчивости к рестартам.
- Связанные файлы кода: `dist/runtime/analytics/mlDatasetBuilder.js`, `dist/runtime/engines/index.js`, `dist/runtime/execution/paperTrading.js`, `dist/runtime/config/runtimeConfigValidator.js`, `dist/_config/config.json`, `tests/regression/ml-dataset-builder.test.js`.
- Связанные разделы docs: `docs/user/TRADING_PIPELINE_RU.md`, `docs/user/CONFIG_GUIDE_RU.md`, `docs/user/LOGS_AND_TROUBLESHOOTING_RU.md`.

## 2026-04-01 (первый practical ML training pipeline для качества входа)
- Изменение: добавлен offline training pipeline `entryQualityTrainingPipeline` с полной цепочкой подготовки датасета (загрузка, очистка, пропуски, feature selection, split, обучение, метрики, сохранение артефактов).
- Изменение: реализованы две цели обучения: `binaryPositiveEntry` (POSITIVE vs not POSITIVE) и `multiclassEntryQuality` (NEGATIVE/NEUTRAL/POSITIVE) на базе объяснимой logistic regression (OVR).
- Изменение: добавлен CLI-скрипт для повторного обучения и безопасные защиты при недостатке данных (`skipped_insufficient_data`, `skipped_bad_split`).
- Связанные файлы кода: `dist/runtime/ml/entryQualityTrainingPipeline.js`, `scripts/ml/train-entry-quality.js`, `tests/regression/ml-entry-quality-training.test.js`, `package.json`.
- Связанные разделы docs: `docs/user/TRADING_PIPELINE_RU.md`, `docs/user/CONFIG_GUIDE_RU.md`.
## 2026-04-02 (market regime router + маршрутизация entry-сетапов)
- Изменение: добавлен классификатор рыночного режима в signal-layer с режимами `trend`, `mean_reversion`, `breakout_rejection`, `no_trade_flat`.
- Изменение: добавлен router, который сначала определяет режим рынка, затем выбирает допустимый `predictType`; `byBarsPercents` сохранён как legacy fallback и базовый trend-сетап.
- Изменение: router учитывает `balanceState/capitalRegime` как внешний runtime-контекст и формирует `capital_prohibition`/ограничения сетапов без обхода `finalEntryDecisionEngine`.
- Изменение: добавлены новые runtime/structured логи роутера (`entry_decision/danger_gate`, `entry_decision/route_selected`, `[marketRegimeRouter] ...`) в совместимом формате audit trail.
- Изменение: обновлён config-блок `singleSetts.predict.regimeRouter` с master-флагом, fallback и порогами классификации.
- Связанные файлы кода: `dist/index.js`, `dist/_config/config.json`, `tests/regression/single-strategy.regression.test.js`.
- Связанные разделы docs: `docs/user/TRADING_PIPELINE_RU.md`, `docs/user/CONFIG_GUIDE_RU.md`, `docs/user/LOGS_AND_TROUBLESHOOTING_RU.md`, `docs/ARCHITECTURE_CONTRACT_RU.md`.
