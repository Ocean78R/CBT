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
