# Журнал изменений пользовательской документации

## Формат записи
- Дата: YYYY-MM-DD
- Изменение: что добавлено/изменено
- Связанные файлы кода: список файлов
- Связанные разделы docs: список файлов

---

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
