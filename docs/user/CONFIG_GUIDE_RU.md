# Конфиг и параметры оператора

## Где настраивается бот
Основной runtime-конфиг: `dist/_config/config.json`.

## Как работать с конфигом
1. Меняйте параметры только в целевом конфиге окружения.
2. Применяйте изменения малыми партиями.
3. После каждого изменения прогоняйте проверки и фиксируйте изменения в документации.

## Какие параметры обычно можно менять оператору
- список тикеров/инструментов,
- режимы логирования,
- параметры частоты/интервалов цикла,
- риск-лимиты в согласованных границах,
- флаги наблюдаемости/отчётности.

## Новый блок антикризисного режима разгрузки
Пример в `dist/_config/config.json`:

- `warningThresholdAboveMinBalance`: буфер над `minBalance`; при попадании в буфер бот переходит в `CAUTION`.
- `unloadMode.enabled`: включает ограничения новых входов без отключения сопровождения.
- `unloadMode.safeEntryAssets`: разрешённые активы для **новых** сделок.
- `unloadMode.entryLimits.maxNewEntriesPerCycle`: лимит новых входов за цикл.
- `unloadMode.entryLimits.maxNewEntriesPerDay`: лимит новых входов за сутки (UTC).
- `unloadMode.entryLimits.haltNewEntries`: полный запрет новых входов (старые позиции продолжают сопровождаться).
- `unloadMode.capitalRegime.*RiskSignals`: группы risk-signal подсказок (например, от forecast слоя) для ужесточения режима.
- `riskSignals`: текущие внешние risk-signal hints в runtime-контексте.

## Какие параметры опасно менять без понимания логики
- hard-risk/hard-safety ограничения,
- параметры stop-loss/forced-exit политики,
- server-side lifecycle правила,
- параметры, влияющие на ownership path ордеров,
- любые флаги, которые меняют итоговый entry-veto flow.

## Правило безопасного изменения
Если параметр может изменить торговое поведение:
- он должен быть явно включаемым через config,
- старое поведение должно оставаться fallback,
- документация и changelog должны быть обновлены в том же изменении.

## Execution contour (устойчивый контур исполнения)
Новый слой **не меняет decision/risk/entry логику** и включается только через config:

- `executionContour.enabled`: включает очередь/ретраи/dedup/reconciliation в execution owner-path.
- `executionContour.queueLimit`: лимит отложенных заявок в памяти.
- `executionContour.retryAttempts`: число попыток для временных API-ошибок.
- `executionContour.retryBackoffMs`: базовая пауза между попытками (линейный backoff).
- `executionContour.dedupWindowMs`: окно защиты от дублей по dedup-ключу.
- `executionContour.reconcileOnLoopStart`: включать технический reconciliation перед обработкой тикера.
- `executionContour.leverageMismatchRestrictionEnabled`: включает restricted-state для позиций с несовпадением фактического и ожидаемого leverage (safe close разрешён, averaging блокируется).
- `serverTakeProfit.enabled`: включает manager-слой серверного TP (только BingX в текущей версии).
- `serverTakeProfit.fallbackToLocalClose`: оставляет локальный `closePositionPnl` как fallback, если серверный TP недоступен.
- `serverTakeProfit.refreshOnAveraging`: обновлять серверный TP после усреднения позиции.
- `serverTakeProfit.reconcileOnLoop`: очищать сиротские серверные TP при отсутствии позиции.
- `serverTakeProfit.conservativeMode.*`: опционально снижает цель фиксации прибыли в защитных capital regime (строго через config).

Fallback-режим: если `executionContour.enabled=false`, исполнение идёт по прежней legacy-схеме без очереди.

## Конфиг server stop-loss (BingX)
- `serverStopLoss.enabled`: включает manager серверного SL.
- `serverStopLoss.provider`: провайдер API (по умолчанию `bingx_reduce_only_v2`).
- `serverStopLoss.fallbackToForcedLossExit`: оставляет forcedLossExit как secondary protection, если server SL не выставлен.
- `serverStopLoss.refreshOnAveraging`: обновлять SL после усреднения.
- `serverStopLoss.reconcileOnLoop`: включать cleanup/reconciliation сиротских SL в цикле.
- `serverStopLoss.triggerBy`: тип цены триггера (`MARK_PRICE`).
- `serverStopLoss.conservativeMode.enabled`: ужесточение SL в защитных режимах капитала.
- `serverStopLoss.conservativeMode.onlyForCapitalRegimes`: для каких режимов капитала применять ужесточение.
- `serverStopLoss.conservativeMode.lossMultiplier`: множитель дистанции SL в защитном режиме.


## Конфиг forcedLossExit / stuckPositionProtection
- `forcedLossExit.enabled`: включает слой контролируемого признания сценария ошибочным.
- `forcedLossExit.maxNegativeHoldMinutes`: максимум минут удержания позиции в отрицательном PnL.
- `forcedLossExit.maxPostAveragingNegativeHoldMinutes`: максимум минут в минусе после последнего averaging.
- `forcedLossExit.maxLossPercentOnPosition`: лимит убытка по позиции (в %), после которого сценарий признаётся опасным.
- `forcedLossExit.maxAveragesPerPosition`: лимит количества усреднений на одну позицию.
- `forcedLossExit.requireAdverseMarketConfirmation`: требовать подтверждение неблагоприятного рынка перед реакцией.
- `forcedLossExit.actionMode`: режим реакции `warn | block_averaging | partial_reduce | force_close`.
- `forcedLossExit.partialReduceShare`: доля частичного сокращения в `partial_reduce`.
- `forcedLossExit.cooldownMinutesAfterForcedExit`: защитный cooldown после forced action.
- `forcedLossExit.regimeTightening.*`: явное ужесточение порогов для `capitalRegime` (например `DEFENSIVE`, `CAPITAL_PRESERVATION`).
- `forcedLossExit.forecastInfluence.*`: отдельный вход influence от forecast-слоя (без прямого закрытия позиций forecast-слоем).

Важно: старый flow остаётся fallback, пока `forcedLossExit.enabled=false`.

## Конфиг portfolio risk contour
Новый слой включается **только через config**; при `enabled=false` сохраняется legacy-fallback поведения по входам.

- `portfolioRiskContour.enabled`: включает верхнеуровневый риск-контур портфеля.
- `portfolioRiskContour.dailyLossLimitPercent`: дневной лимит убытка в процентах от дневной базы.
- `portfolioRiskContour.maxNewEntriesPerDay`: лимит новых входов за сутки (UTC).
- `portfolioRiskContour.maxOpenPositions`: максимум одновременно открытых позиций.
- `portfolioRiskContour.maxUsedMarginPercent`: потолок суммарно используемой маржи.
- `portfolioRiskContour.cooldownAfterBadStreak.enabled`: включает паузу после плохих серий.
- `portfolioRiskContour.cooldownAfterBadStreak.consecutiveBadCycles`: число подряд плохих циклов для паузы.
- `portfolioRiskContour.cooldownAfterBadStreak.consecutiveLosingClosures`: число подряд убыточных закрытий для паузы.
- `portfolioRiskContour.cooldownAfterBadStreak.pauseMinutes`: длительность паузы.
- `portfolioRiskContour.capitalRegimeThresholds.*`: пороги переходов в `CAUTION/DEFENSIVE/CAPITAL_PRESERVATION/HALT_NEW_ENTRIES` по loss/margin.
- `portfolioRiskContour.capitalRegimeEngine.enabled`: включает отдельный current-state слой расчёта режима капитала.
- `portfolioRiskContour.capitalRegimeEngine.escalationOnly`: запрещает авто-ослабление режима внутри одного цикла/контекста.
- `portfolioRiskContour.capitalRegimeEngine.*BalanceDrawdownPercent`: пороги ужесточения по просадке баланса (дополнительно к loss/margin).

Важно: слой `portfolioForecastEngine` должен подключаться только **после** `portfolioRiskContour` и не может ослаблять его hard-ограничения.

<<<<<<< codex/add-analytics-layer-for-trading-results
## Базовый слой trade analytics
Новый слой аналитики не меняет торговые решения и включается через config:

- `tradeAnalytics.enabled`: включает запись журнала сделок и отчётов.
- `tradeAnalytics.storage`: тип хранилища (`csv` в текущем боевом минимуме).
- `tradeAnalytics.dataDir`: папка с файлами аналитики (по умолчанию `./data/analytics`).
- `tradeAnalytics.tradesCsv`: CSV-журнал закрытых сделок.
- `tradeAnalytics.openStateJson`: состояние открытых сделок/усреднений для восстановления после рестарта.
- `tradeAnalytics.reportOnCycleEnd`: включать сводный отчёт в конце цикла.

Fallback: если `tradeAnalytics.enabled=false`, торговый flow полностью legacy, слой аналитики отключён.
=======

## Конфиг portfolioForecastEngine / capitalStressForecastEngine
Блок находится в `portfolioRiskContour.portfolioForecastEngine` и включается только через config.

- `enabled`: включает forward-looking прогноз риска портфеля.
- `minConfidenceForSignals`: минимальная уверенность прогноза для передачи restriction hints.
- `scenarioWeights.baseline/adverse/severe`: веса сценариев агрегированного прогноза.
- `thresholds.*`: пороги fragility и вероятности ухудшения режима капитала.
- `restrictions.enableRestrictionHints`: поставлять soft/hard restriction hints в entry owner-слои.
- `restrictions.enableHardRestrictionHints`: формировать кандидаты `capital_prohibition` через совместимый veto-contract.
- `restrictions.applyHardRestrictionHintsAsVeto`: (опционально) применить hard candidate как veto в risk contour.
- `protectiveTightening.*`: подсказки на ужесточение сопровождения (forcedLossExit/TP-SL conservative policy) без прямого управления ордерами.
- `sizingHints.*`: рекомендуемые множители для dynamic sizing после approved entry.

Безопасность: по умолчанию блок не ослабляет текущий risk contour и не ломает legacy поведение.
>>>>>>> main
