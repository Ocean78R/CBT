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

## DynamicAssetSelection для новых входов
Блок находится в `singleSetts.tickers.dynamicAssetSelection`.

- `definedAssets` (или `allowedUniverse`, если задан): верхняя граница universe из config для новых входов.
- `enableDynamicAssetSelection`: alias-флаг уровня `singleSetts.tickers.*` (совместим с `dynamicAssetSelection.enabled`).
- `dynamicSelectionMode`: режим shortlist; поддерживается `whitelist_only` (shortlist только внутри allowedUniverse).

- `enabled`: включает динамический shortlist; при `false` остаётся статический fallback (`definedAssets`).
- `shortlistSize`: базовый размер shortlist на цикл.
- `lookbackBars`: глубина свечей для факторов `volatility/speed`.
- `lookbackTrades`: глубина trade-journal для факторов `tradeQuality/averaging/realizedPnl`.
- `weights.volatility`: вес волатильности.
- `weights.speed`: вес скорости цены.
- `weights.tradeQuality`: вес качества истории сделок.
- `weights.averagingPenalty`: штраф за частые усреднения.
- `weights.realizedPnl`: вес реализованного PnL по тикеру.
- `weights.liquidity`: вес ликвидности/стабильности (если метрика доступна).
- `conservativeRegimeShortlistMultiplier`: сжатие shortlist при защитных режимах капитала.
- `stressedForecastShortlistMultiplier`: дополнительное сжатие shortlist при forecast stress-сигналах.
- `forecastStressSignals`: сигналы, по которым применяется tightening shortlist как внешний контекст.

Приоритеты:
- `allowedUniverse`/`definedAssets` из config — главный owner списка разрешённых тикеров.
- `unloadMode`/`safeEntryAssets` выше dynamicAssetSelection и применяются раньше.
- `capitalRegime` может только сужать shortlist/входы, но не расширяет allowedUniverse.
- dynamic shortlist влияет только на **новые входы**; сопровождение уже открытых позиций не блокируется.
- Runtime-иерархия фильтрации новых входов фиксирована:
  `allowedUniverse -> unload/safeEntryAssets/hard safety -> capitalRegime -> dynamicShortlist -> downstream signal stack`.
- Контракты ownership:
  - `safeEntryAssets` только сужает и никогда не расширяет `allowedUniverse`;
  - `dynamicShortlist` всегда подмножество `allowedUniverse`/`safeEntryUniverse`;
  - `newEntryEligibleUniverse` используется downstream-слоями как read-only input;
  - `lifecycleScope`/`openPositionScope` уже открытых позиций живёт отдельно от new-entry фильтров.
- downstream-слои (`marketRegimeRouter`, `higherTimeframeBias`, `confluence`, `zones`) получают уже отфильтрованный вход и не расширяют universe.

## Market Regime Router в predict-блоке
Блок находится в `singleSetts.predict.regimeRouter` (и в mirror-конфиге при необходимости).

- `enabled`: master-флаг нового роутера рыночного режима.
- `fallbackPredictType`: legacy fallback (по умолчанию `byBarsPercents`).
- `trendPredictType`: сетап для режима `trend`.
- `meanReversionPredictType`: сетап для режима `mean_reversion`.
- `breakoutRejectionPredictType`: сетап для режима `breakout_rejection`.
- `allowFallbackInFlatRegime`: разрешать ли fallback-вход в `no_trade_flat` (рекомендуется `false`).
- `thresholds.trendDeltaAbsMin`: минимум суммарного импульса для тренда.
- `thresholds.flatRangePercentMax`: потолок диапазона для `no_trade_flat`.
- `thresholds.breakoutRangePercentMin`: порог расширения диапазона для `breakout_rejection`.
- `thresholds.meanReversionRangePercentMin`: порог волатильности для `mean_reversion`.

Важно:
- роутер не подменяет `finalEntryDecisionEngine` и не делает sizing;
- в режиме `enabled=false` сохраняется прежнее поведение по `predictType`;
- `byBarsPercents` сохранён как fallback и как базовый trend-сетап.

## Конфиг rebound/bounce слоя в confluenceEntryEngine
Блок находится в `confluenceEntryEngine.bounceDetection`.

- `confluenceEntryEngine.blockWeights.bounceDetection`: вес bounce-блока в финальной агрегированной оценке.
- `bounceDetection.enabled`: включает слой вероятного отскока (сам по себе вход не открывает).
- `bounceDetection.allowedRegimes`: в каких market regime слой вообще активируется.
- `bounceDetection.noTradeRegimes`: список режимов, где слой возвращает no-trade результат.
- `bounceDetection.lookbackBars/swingWindow`: глубина и окно swing-контекста.
- `bounceDetection.zoneProximityPercent`: порог близости к зоне S/R для proximity-score.
- `bounceDetection.falseBreakoutTolerancePercent`: допуск для false breakout / liquidity grab.
- `bounceDetection.momentumLookbackBars`: окно оценки slowdown импульса.
- `bounceDetection.minCandlesForAnalysis`: минимальный объём данных до включения full-mode.
- `bounceDetection.thresholds.*`: пороги confidence/coverage/активации microstructure-подслоя.
- `bounceDetection.setupTypes.*`: включение отдельных типов bounce setup.
- `bounceDetection.weights.*`: веса групп признаков в итоговом bounce-score.
- `bounceDetection.microstructure.*`: policy дорогого подслоя order-book/spread (lazy + budget-aware).
- `bounceDetection.capitalRegimePenalties.*`: как режим капитала снижает вклад bounce в confluence (без ослабления hard-risk).

Важно:
- bounce-слой работает только как контекстный блок внутри `confluenceEntryEngine`;
- при нехватке данных/бюджета слой отдаёт `degraded` результат и fallback reason-codes;
- ownership финального решения остаётся у `finalEntryDecisionLayer`.

## Конфиг breakdown / bearish continuation слоя в confluenceEntryEngine
Блок находится в `confluenceEntryEngine.breakdownDetection`.

- `confluenceEntryEngine.blockWeights.breakdownDetection`: вес breakdown-блока в общей агрегированной оценке.
- `breakdownDetection.enabled`: включает слой вероятного пробоя поддержки и bearish continuation (сам вход не открывает).
- `breakdownDetection.allowedRegimes`: в каких market regime слой активируется.
- `breakdownDetection.noTradeRegimes`: режимы, где слой отдаёт no-trade результат и veto-кандидат.
- `breakdownDetection.lookbackBars/minCandlesForAnalysis`: глубина истории и минимальный объём данных.
- `breakdownDetection.supportLookbackBars/supportProximityPercent`: параметры поиска зоны поддержки и оценки proximity.
- `breakdownDetection.pressureLookbackBars`: окно давления на поддержку.
- `breakdownDetection.repeatedTestsWindowBars/repeatedTestsTolerancePercent`: правила подсчёта повторных тестов уровня.
- `breakdownDetection.momentumLookbackBars`: окно оценки расширения нисходящего импульса.
- `breakdownDetection.breakdownConfirmationBars/reclaimTolerancePercent`: подтверждение закрепления ниже уровня и провала возврата.
- `breakdownDetection.thresholds.*`: пороги setup-tag/strong-score/confidence/coverage/microstructure-gating.
- `breakdownDetection.setupTypes.*`: включение типов bearish setup.
- `breakdownDetection.weights.*`: веса групп признаков в итоговом breakdown-score.
- `breakdownDetection.microstructure.*`: lazy/budget-aware policy для order-book проверки.
- `breakdownDetection.capitalRegimePenalties.*`: как защитные режимы капитала снижают вклад breakdown в confluence.

Важно:
- breakdown-слой не подменяет market regime router и final decision слой;
- при нехватке данных возвращает `dataQualityState=degraded` без ложной уверенности;
- конфликт breakdown vs bounce не решается внутри слоя и передаётся выше в `finalEntryDecisionLayer`.

## Конфиг derivatives context слоя в confluenceEntryEngine
Блок находится в `confluenceEntryEngine.derivativesContext`.

- `confluenceEntryEngine.blockWeights.derivativesContext`: вес derivatives-блока в агрегированной оценке входа.
- `derivativesContext.enabled`: включает отдельный futures-specific слой деривативного контекста.
- `derivativesContext.preferSharedSnapshot`: приоритет чтения OI/funding/liquidation из `sharedSnapshot` (без повторного запроса данных).
- `derivativesContext.skipWhenBudgetExceeded`: при перегрузе переводит слой в `cached/degraded` вместо тяжёлого full расчёта.
- `derivativesContext.allowNoTradeOnExtremeCrowding`: разрешает формировать `no_trade_regime` veto-кандидат при экстремальном crowding.
- `derivativesContext.thresholds.*`: пороги OI/funding/liquidation и ограничение максимального penalty.
- `derivativesContext.weights.*`: веса подблоков (`oiDynamics`, `fundingState`, `liquidationContext`, `crowding`).
- `derivativesContext.crowding.*`: параметры детектора перегрева (`oiZscoreSpike`, `fundingAbsSpike`, `liquidationClusterUsd`).
- `derivativesContext.liquidation.*`: правила интерпретации доминирования ликвидаций.
- `derivativesContext.refreshPolicy.*`: cadence и reuse (`minCyclesBetweenRefresh`, `allowCachedReuse`, `cacheKey`).
- `derivativesContext.capitalRegimePenalties.*`: защитный penalty по `capitalRegime` (слой не может ослаблять risk-контур).

Важно:
- слой не открывает сделку сам, а только усиливает/ослабляет оценку во `finalEntryDecisionLayer`;
- старое поведение остаётся fallback при выключенном флаге;
- hard-risk и capital prohibition остаются выше derivatives logic.

## Конфиг session filter / time context слоя в confluenceEntryEngine
Блок находится в `confluenceEntryEngine.sessionFilter`.

- `confluenceEntryEngine.blockWeights.sessionFilter`: вес time/session блока в итоговом confluence-score.
- `sessionFilter.enabled`: включает отдельный слой time-of-day / session-context.
- `sessionFilter.timezone`: таймзона для определения часа и активной сессии (обычно `UTC`).
- `sessionFilter.noTradeOnRestrictedWindows`: разрешает поднимать `no_trade` veto-кандидат в запрещённых окнах.
- `sessionFilter.baseScore/baseConfidence`: базовая оценка и уверенность слоя.
- `sessionFilter.sessions[]`: правила определения сессии (`sessionState`, часы, multiplier/confidence).
- `sessionFilter.goodWindows[]`: окна повышенного качества входа (boost score/confidence).
- `sessionFilter.chaoticWindows[]`: окна повышенной хаотичности (penalty/confidence down).
- `sessionFilter.restrictedWindows[]`: окна, где можно полностью запрещать вход через `timeBasedEntryRestriction`.
- `sessionFilter.capitalRegimeInfluence.*`: как `capitalRegime` усиливает time-ограничения (penalty/strict mode).
- `sessionFilter.refreshPolicy.*`: cadence и кэширование (`minCyclesBetweenRefresh`, `allowCachedReuse`, `cacheKey`).
- `timeContextScore` в downstream telemetry рассчитывается как net-оценка слоя (`score-softPenalty`) и используется как контекст для final decision/audit.
- `timeBasedEntryRestriction` может стать `true` как из `restrictedWindows`, так и из strict-режима `capitalRegimeInfluence.mode=strict`.

Важно:
- слой не заменяет `marketRegimeRouter` и не является final-decision слоем;
- слой не выполняет execution actions и не открывает позицию;
- при `enabled=false` старая торговая логика остаётся без изменений.

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
- `forcedLossExit.enablePostEntryObservation`: включает ранний подрежим `postEntryObservation/earlyInvalidationExit`.
- `forcedLossExit.postEntryGraceMinutes`: короткий grace period сразу после входа.
- `forcedLossExit.postEntryObservationMinutes`: длительность окна наблюдения после grace period.
- `forcedLossExit.maxTimeUnderEntryWithoutRecovery`: сколько минут допускается adverse-состояние без восстановления к entry.
- `forcedLossExit.earlyInvalidationLossPercent`: ранний лимит отклонения от entry для признания сценария невалидным.
- `forcedLossExit.requirePersistentAdverseTrend`: требовать подтверждённый устойчивый adverse trend.
- `forcedLossExit.adverseTrendConfirmationBars`: минимум баров для подтверждения adverse trend.
- `forcedLossExit.adverseTrendSlopeThreshold`: минимальный slope adverse trend для подтверждения.
- `forcedLossExit.actionOnEarlyInvalidation`: действие раннего уровня (`partial_reduce | force_close`) через lifecycle ownership path.
- `forcedLossExit.useForecastProtectiveHints`: опциональная точка интеграции forecast hints без жёсткой зависимости.

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

## Базовый слой trade analytics
Новый слой аналитики не меняет торговые решения и включается через config:

- `tradeAnalytics.enabled`: включает запись журнала сделок и отчётов.
- `tradeAnalytics.storage`: тип хранилища (`csv` в текущем боевом минимуме).
- `tradeAnalytics.dataDir`: папка с файлами аналитики (по умолчанию `./data/analytics`).
- `tradeAnalytics.tradesCsv`: CSV-журнал закрытых сделок.
- `tradeAnalytics.openStateJson`: состояние открытых сделок/усреднений для восстановления после рестарта.
- `tradeAnalytics.reportOnCycleEnd`: включать сводный отчёт в конце цикла.

Fallback: если `tradeAnalytics.enabled=false`, торговый flow полностью legacy, слой аналитики отключён.

## Единый observability/reporting/audit layer
Новый слой наблюдаемости не меняет торговые решения и подключается **строго через config**.

- `observabilityReporting.enabled`: включает единый сбор событий и отчётов.
- `observabilityReporting.flushIntervalMs`: период отложенной (неблокирующей) выгрузки буфера событий.
- `observabilityReporting.maxBufferSize`: размер буфера перед принудительным flush.
- `observabilityReporting.aggregateWindowCycles`: размер окна агрегации отчётов по циклам.
- `observabilityReporting.includePaperMode`: включать события paper-режима в отчёты.
- `observabilityReporting.includeLiveMode`: включать события live-режима в отчёты.
- `observabilityReporting.sampling.decisionEventsRate`: sampling для массовых decision-событий.
- `observabilityReporting.sampling.diagnosticEventsRate`: sampling для диагностических событий.
- `observabilityReporting.sampling.alwaysKeepCritical`: критические execution/protection события сохраняются полностью.
- `observabilityReporting.auditTrail.enabled`: включает хранение восстановимого audit trail.
- `observabilityReporting.auditTrail.keepPayload`: хранить payload в trail (для детального разбора).
- `observabilityReporting.auditTrail.maxEntries`: максимум записей trail в памяти.
- `observabilityReporting.storage.enabled`: включает NDJSON-персистентность событий.
- `observabilityReporting.storage.dataDir`: директория хранения событий.
- `observabilityReporting.storage.eventsFile`: имя файла событий (`*.ndjson`).

Фиксированные категории событий:
- `decision_events`,
- `execution_events`,
- `protective_events`,
- `regime_events`,
- `lifecycle_events`,
- `forecast_events` (включая `forecast_restrictions` и `forecast_protective_hints`).

Fallback: при `observabilityReporting.enabled=false` слой полностью пассивен, торговый runtime идёт по legacy flow без изменений.

## Конфиг performance diagnostics (аудит производительности без изменения стратегии)
Слой включается только через config и не меняет decision ownership.

- `performanceDiagnostics.enabled`: включает профилирование вызовов провайдеров и безопасные read-only оптимизации.
- `performanceDiagnostics.loggerEnabled`: включает периодический служебный лог производительности.
- `performanceDiagnostics.logEveryNCalls`: частота служебного лога (раз в N вызовов).
- `performanceDiagnostics.readOnlyCache.enabled`: включает TTL-кэш только для read-only запросов.
- `performanceDiagnostics.readOnlyCache.ttlMs`: общий fallback TTL (мс).
- `performanceDiagnostics.readOnlyCache.markPriceTtlMs`: короткий TTL для `markPrice` (рекомендуется ultra-short).
- `performanceDiagnostics.readOnlyCache.klineTtlMs`: TTL для свечей `kline` по таймфреймам.
- `performanceDiagnostics.readOnlyCache.accountReadTtlMs`: TTL для read-only account-данных (`balance/leverage/margin mode`).
- `performanceDiagnostics.readOnlyCache.maxEntries`: ограничение размера кэша для контроля памяти.
- `performanceDiagnostics.readOnlyCache.methods`: список read-only методов, к которым применяются дедупликация/кэш.
- `performanceDiagnostics.hotState.enabled`: включает in-memory hot-state по тикерам.
- `performanceDiagnostics.hotState.maxTickers`: лимит тикеров в hot-state.
- `performanceDiagnostics.hotState.staleReuseGraceMs`: допустимое окно stale-but-allowed reuse.
- `performanceDiagnostics.invalidation.onError`: удалять проблемный ключ кэша при ошибке read-only запроса.
- `performanceDiagnostics.invalidation.onExecutionTickers`: разрешает безопасную инвалидацию read-only кэша по тикерам после execution-активности.
- `performanceDiagnostics.invalidation.fullFlushOnCycleStart`: опциональный полный flush на старте цикла.
- `performanceDiagnostics.derivedFeatureCache.enabled`: включает кэш производных признаков (без изменения ownership решений).
- `performanceDiagnostics.derivedFeatureCache.featureVersion`: версия признаков для ключей кэша.
- `performanceDiagnostics.derivedFeatureCache.ttl.ultraShortMs`: TTL для быстро меняющихся признаков (indicators/regime inputs).
- `performanceDiagnostics.derivedFeatureCache.ttl.perCycleMs`: TTL для per-cycle признаков (HTF/support-resistance/VWAP-profile).
- `performanceDiagnostics.derivedFeatureCache.ttl.contextMs`: TTL для контекстных агрегатов (analytics/derivatives snapshots).
- `performanceDiagnostics.metrics.enabled`: включает сбор метрик latency/cache/in-flight hit.
- `performanceDiagnostics.metrics.slowCallMs`: порог медленного вызова (мс) для slow-call статистики.
- `performanceDiagnostics.requestScheduler.enabled`: включает scheduler только для read-only запросов (execution-critical не трогается).
- `performanceDiagnostics.requestScheduler.maxConcurrency`: лимит параллельных read-only задач.
- `performanceDiagnostics.requestScheduler.maxRequestsPerWindow`: лимит запусков в окне rate-limit.
- `performanceDiagnostics.requestScheduler.windowMs`: размер окна rate-limit в миллисекундах.
- `performanceDiagnostics.requestScheduler.backoffBaseMs`: базовый backoff при 429/перегрузке.
- `performanceDiagnostics.requestScheduler.backoffMaxMs`: верхняя граница backoff.
- `performanceDiagnostics.requestScheduler.priorities.coreMarketData`: приоритет очереди core market data.
- `performanceDiagnostics.requestScheduler.priorities.optionalMicrostructure`: приоритет optional microstructure.
- `performanceDiagnostics.requestScheduler.priorities.derivativesContext`: приоритет derivatives context.
- `performanceDiagnostics.requestScheduler.priorities.analyticsRefresh`: приоритет analytics refresh.
- `performanceDiagnostics.requestScheduler.optionalBudget.enabled`: включает budget-control optional очередей.
- `performanceDiagnostics.requestScheduler.optionalBudget.maxOptionalPerCycle`: максимум optional задач на один цикл.

Runtime-позиция слоя:
- слой расположен в `providers` (market/account/position/exchange capabilities) и работает до signal/read-only вычислений;
- зависимости: готовый connector и текущая конфигурация;
- ownership path ордеров не затрагивается.

Fallback и безопасность:
- при `performanceDiagnostics.enabled=false` поведение полностью legacy;
- при отсутствии данных кэша/метрик вызывается исходный метод connector без изменения решения входа/выхода;
- execution/protection-решения остаются в прежних слоях (`risk + execution_lifecycle_manager`).

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

## Конфиг dynamicPositionSizing (шаг 36, подэтап 2)
Блок находится в `dynamicPositionSizing` и применяется только после `finalEntryDecisionEngine`.

- `enableDynamicPositionSizing`: включает dynamic sizing формулу.
- `baseSizingRules.baseTargetMarginSize/baseLeverageCap/riskPenaltyWeight`: базовый профиль до tightening.
- `weakEntrySizeMultiplier`: отдельный multiplier для `weak_entry`.
- `capitalRegimeSizingRules.<REGIME>`: tightening по капитал-режимам (`sizeMultiplier`, `leverageCap`, `disallowFullSizeProfile`).
- `leverageCapsByRegime.<REGIME>`: верхняя граница плеча по режиму капитала.
- `fallbackFixedSizingConfig`: fallback-профиль при disabled/insufficient runtime context.
- `forecastSizingHooks.aggressionCaps/exposureReductionHints/conservativeMultiplierCap`: hooks для forecast-подсказок (только ужесточение).
- `mlCompatibilityHooks.*`: контракт совместимости для future ML phase 1/2 без смены owner-логики.

Дополнение по ML phase 1 integration (шаг 37C):
- режимы `mlPhase1Integration.mlMode`: `advisory_only`, `confirm_only`, `veto_mode`, `confidence_sizing`;
- `finalEntryDecisionEngine` остаётся final interpreter veto, ML не получает ownership решения;
- ML не может override `capitalRegime` запреты и forecast hard restrictions;
- `confidence_sizing` отдаёт только bounded sizing hint, ownership sizing не передаётся.

Ограничения ownership:
- dynamic sizing не пересчитывает market data и block scores;
- не разрешает вход без approved entry;
- hard-risk / unload / capital prohibition / portfolio contour остаются выше sizing;
- `HALT_NEW_ENTRIES`/`PROHIBIT_NEW_ENTRIES` блокируют sizing новых входов.

Практический минимум отчётов в `tradeAnalytics`:
- `overall`, `byTicker`, `byRegime`, `bySignalType`, `bySetupType`, `byHourUtc`, `byWeekDayUtc`;
- метрики: `winRate`, `avgWin`, `avgLoss`, `expectancy`;
- статистика усреднений: `avgAveragingCount`, `averagingUsageRate`, `avgPnlWithAveraging`, `avgPnlWithoutAveraging`.


Разделение read-only cache и execution-critical live data:
- Кэшируются только read-only вызовы (`getMarkPrice`, `getKLine`, `getTickerInfo`, `getBalance`, `getLeverage`, `getMarginMode`).
- Execution-critical методы (`updateTickerLeverage`, `setMarginMode`, любые order actions) остаются live-only и не получают агрессивного TTL-кэша.
- При необходимости принудительного обновления используются `cacheControl.forceRefreshReadOnly(...)` и/или `cacheControl.onExecutionActivity([...])`.

## Performance governor / control plane (новый конфиг)
Новый слой включается только через config и не меняет ownership торговых решений.

Ключи:
- `performanceGovernor.enabled` — включает слой.
- `performanceGovernor.mode`:
  - `monitor_only` — только диагностика,
  - `enforce` — применяет budgets/degradation.
- `performanceGovernor.cycle.targetMs/hardLimitMs` — целевой и жёсткий лимиты цикла.
- `performanceGovernor.budgets.reserveForExecutionMs` — резерв времени для execution-critical path.
- `performanceGovernor.budgets.byLayerMs.*` — бюджеты для тяжёлых слоёв:
  - `regimeRouter`, `htfStructure`, `zones`, `vwapProfile`, `bounceBreakdown`, `derivativesContext`, `confirmations`, `mlInference`.
- `performanceGovernor.tickerLimits.maxExpensiveTickersPerCycle` — лимит тикеров для дорогих слоёв.
- `performanceGovernor.tickerLimits.maxMlTickersPerCycle` — лимит тикеров для ML слоя.
- `performanceGovernor.refreshCadence.*` — частоты редких признаков.
- `performanceGovernor.loopClasses.*` — классы частот циклов (`executionCriticalHz`, `signalCoreHz`, `optionalContextHz`, `analyticsHz`).
- `performanceGovernor.parallelism.*` — лимиты параллелизма тяжёлых/аналитических задач.
- `performanceGovernor.observability.maxSyncEventsPerCycle` — ограничение синхронной отчётности на цикл.
- `performanceGovernor.cache.*` — политика перехода в cached/degraded режим.

Безопасность по умолчанию:
- default: `enabled=false`, `mode=monitor_only`;
- старое поведение остаётся fallback до явного включения.

## Конфиг paper/shadow trading
Новый слой включается через config и не ломает legacy/live fallback.

- `paperTrading.enabled`: включает paper/shadow execution-режим.
- `paperTrading.mode`: `paper` или `shadow` (метка режима в логах/событиях).
- `paperTrading.initialBalance`: стартовый виртуальный баланс для отчётов paper-режима.
- `paperTrading.slippageBps`: параметр для будущей модели проскальзывания (без влияния на live).
- `paperTrading.feeBps`: параметр для будущей модели комиссий (без влияния на live).

Runtime-позиция слоя:
- Новый слой вызывается в execution ownership path после approved entry/exit решений.
- Зависимости ранних слоёв: `portfolioRiskContour`, `capitalRegimeEngine`, `portfolioForecastEngine` (если включён), veto/sizing решения.
- При отсутствии некоторых данных fallback безопасный: сохраняется виртуальное событие и не ломается торговый цикл.

## ML dataset builder (сбор датасета для обучения модели входа)
Новый слой не меняет торговые решения и включается отдельно.

```json
"mlDatasetBuilder": {
  "enabled": false,
  "storage": "csv",
  "dataDir": "./data/ml_dataset",
  "featuresCsv": "entry_features.csv",
  "labelsCsv": "entry_labels.csv",
  "pendingStateJson": "entry_pending_state.json",
  "flushIntervalMs": 1200,
  "includePaperMode": true,
  "includeLiveMode": true,
  "capture": {
    "potentialEntries": true,
    "actualEntries": true
  },
  "labeling": {
    "defaultHoldTimeoutMinutes": 180,
    "positivePnlPercent": 0.2,
    "negativePnlPercent": -0.2,
    "neutralBandAbsPercent": 0.2
  }
}
```

Пояснения:
- `enabled`: master-флаг слоя сбора датасета.
- `storage`: сейчас боевой лёгкий режим `csv`; значение `sqlite` зарезервировано для следующего этапа без смены контракта.
- `dataDir`: корневая папка датасета.
- `featuresCsv`: файл признаков на момент решения.
- `labelsCsv`: файл меток исхода сделки.
- `pendingStateJson`: персистентное состояние незавершённых примеров, чтобы переживать рестарты.
- `capture.potentialEntries`: писать потенциальные входы (включая отклонённые/неисполненные).
- `capture.actualEntries`: писать фактически исполненные входы.
- `labeling.*`: пороги генерации label на основе итога.

## Offline ML training pipeline (первый практичный контур)
Этот контур **не меняет боевую торговлю** и используется только для обучения/оценки модели качества входа на собранном датасете.

Запуск:
- `npm run ml:train:entry-quality` — путь по умолчанию (`./data/ml_dataset/entry_features.csv`, `./data/ml_dataset/entry_labels.csv`).
- Можно переопределить пути:
  - `--features <path>`
  - `--labels <path>`
  - `--outDir <path>`
  - `--validationShare <0..1>`
  - `--minSamples <N>`

Пример:
- `node scripts/ml/train-entry-quality.js --features ./data/ml_dataset/entry_features.csv --labels ./data/ml_dataset/entry_labels.csv --outDir ./data/ml_models/entry_quality --validationShare 0.2 --minSamples 80`

Артефакты обучения:
- `entry_quality_model.json` — веса модели, контракт признаков, метрики по двум целям.
- `training_report.json` — итог обучения/пропуска и статистика датасета.

Защиты:
- если выборка меньше `minSamples`, обучение пропускается безопасно;
- если после split недостаточно train/validation, обучение пропускается безопасно.

## Конфиг higherTimeframeBiasEngine / marketStructureEngine
Блок находится на уровне exchange-конфига: `higherTimeframeBiasEngine`.

- `enabled`: включает HTF-context слой; при `false` полностью сохраняется legacy fallback.
- `higherTimeframe`: старший ТФ для структуры (например, `4h`, `1d`).
- `lookbackBars`: глубина свечей старшего ТФ.
- `swingWindow`: окно поиска swing high/low для HH/HL/LH/LL.
- `minimumStructurePoints`: минимум валидных точек структуры.
- `breakOfStructureThresholdPercent`: порог BOS в процентах.
- `shiftConfirmationBars`: подтверждение CHoCH/shift структуры.
- `trendWeights.*`: веса вклада признаков структуры в общий `trendAlignmentScore`.
- `rangeWeights.*`: зоны старшего диапазона (`premium/discount/neutral`).
- `confidence.*`: границы confidence + деградация в limited/cached режиме.
- `alignmentPenalties.*`: penalty/boost, который применяется только в confluence/final decision.
- `slowerRefresh.enabled`: включить редкий пересчёт HTF-структуры.
- `slowerRefresh.minBarsBetweenRefresh`: минимум новых HTF-баров между полными пересчётами.
- `slowerRefresh.forceRefreshEveryCycles`: принудительный refresh раз в N циклов.
- `slowerRefresh.useFeatureStoreCache`: кэшировать HTF-выходы в `FeatureStore.slowerRefreshContextCache`.

Важно:
- слой не подменяет `marketRegimeRouter` и не определяет setup type;
- слой не может ослаблять `capitalRegime`/risk contour;
- влияние ограничено только контекстным score-adjustment перед `finalEntryDecision`.


## Конфиг confluenceEntryEngine / entryScoringEngine
Блок находится на уровне exchange-конфига: `confluenceEntryEngine`.

- `enabled`: master-флаг нового confluence-входа.
- `mode`: `confluence` (новый режим) или `legacy_fallback` (старое поведение).
- `allowWeakEntry`: разрешить промежуточный класс `WEAK_ENTRY`.
- `enforceRegimeSetupCompatibility`: запрет входа, если setup не разрешён regime-router.
- `blockWeights.*`: веса блоков `entryPermission/marketContext/primarySignal/confirmation`.
- `thresholds.fullEntryScore`: порог `FULL_ENTRY`.
- `thresholds.weakEntryScore`: порог `WEAK_ENTRY`.
- `thresholds.minConfidence`: минимальная уверенность финального слоя.
- `marketContext.*`: штрафы за `no-trade` и degraded контекст режима.
- `primarySignal.*`: fallback score/confidence для legacy-адаптера.
- `confirmation.*`: требования к подтверждениям и влияние HTF alignment.

Пример включения:
```json
"confluenceEntryEngine": {
  "enabled": true,
  "mode": "confluence",
  "allowWeakEntry": true
}
```

Важно:
- confluence-слой не рассчитывает размер позиции и не отправляет ордера;
- ограничения `capitalRegime`/`balanceState` имеют приоритет и не ослабляются;
- при отключении слоя поведение возвращается в legacy fallback.

### Конфиг marketLevel (support/resistance zones) внутри confluenceEntryEngine
Блок находится в `confluenceEntryEngine.marketLevel`.

- `enabled`: master-флаг слоя зон.
- `blockWeights.marketLevel`: вес слоя зон в агрегированном confluence-score (для строгой обратной совместимости оставляйте `0`).
- `lookbackBars`: окно свечей для поиска swing-точек.
- `rangeLookbackBars`: окно для диапазона `high/low`.
- `swingWindow`: ширина окна локального экстремума.
- `minSwingPoints`: минимум swing high/low для валидного построения зон.
- `zoneWidthPercent`: ширина зоны вокруг уровня (в % от цены уровня).
- `proximityThresholdPercent`: порог близости цены к зоне.
- `breakoutTolerancePercent`: допуск для пробоя зоны/границы диапазона.
- `retestWindowBars`: окно баров, в котором ищется retest после breakout.
- `falseBreakoutWindowBars`: окно баров для сценария false breakout/liquidity grab.
- `minBreakoutBodyPercent`: минимальный размер тела свечи для подтверждения breakout-контекста.
- `scoring.*`: веса для proximity/retest/false-breakout/breakout-context и штрафов.

Важно:
- слой зон отвечает только за ценовую геометрию и не смешивается с VWAP/volume profile;
- final-entry ownership остаётся у `finalEntryDecisionLayer`, а zones выступает context/block-score слоем.

## Конфиг VWAP / Volume Profile контекста
Новый слой настраивается в `confluenceEntryEngine.volumeContext` и по умолчанию не меняет legacy поведение (выключен).

```json
{
  "confluenceEntryEngine": {
    "blockWeights": {
      "volumeContext": 0
    },
    "volumeContext": {
      "enabled": false,
      "preferSharedFeatures": true,
      "degradeOnMissingVolume": true,
      "vwapWindowBars": 80,
      "anchoredVwap": {
        "enabled": true,
        "lookbackBars": 120,
        "swingWindow": 3,
        "fallbackToSessionAnchor": true
      },
      "valueArea": {
        "enabled": true,
        "valueAreaPercent": 0.7
      },
      "volumeProfile": {
        "enabled": true,
        "bins": 24,
        "hvnPercentile": 0.82,
        "lvnPercentile": 0.18
      },
      "lazyEvaluation": {
        "enabled": true,
        "requireShortlistCandidate": true,
        "requirePrimaryDirection": true,
        "minPrimaryScore": 0.4,
        "skipWhenBudgetExceeded": true
      },
      "refreshPolicy": {
        "minBarsBetweenFullRecalc": 3,
        "allowCachedReuse": true,
        "forceFullRecalcEveryCycles": 0
      },
      "scoring": {
        "vwapAlignmentWeight": 0.32,
        "anchoredVwapAlignmentWeight": 0.22,
        "valueAreaWeight": 0.24,
        "hvnLvnReactionWeight": 0.22,
        "distancePenaltyFactor": 1.15,
        "degradedPenalty": 0.12
      }
    }
  }
}
```

Примечание: `blockWeights.volumeContext` задаёт вклад только volume-контекста и не смешивает его с `marketLevel` (zones engine).

## Конфиг confirmationEngine (technical + microstructure confirmations)
Блок находится в `confluenceEntryEngine.confirmationEngine`.

- `enabled`: включает новый слой подтверждений confluence; при `false` сохраняется legacy-confirmation fallback на основе `confirmationSignals`.
- `weights.technical / weights.microstructure`: веса дешёвого и дорогого подслоя в итоговом `confirmationLayer.score`.
- `costSplit.minCheapScoreForMicro`: порог cheap-stage (technical), после которого разрешается expensive-stage (order book / microstructure).
- `costSplit.skipMicroWhenBudgetExceeded`: при ограничении budget переводит microstructure в `degraded/cached` режим без падения цикла.
- `technical.*`: технические подтверждения (`volume spike`, `volume vs average`, `RSI`, `Stochastic RSI`, `MFI`, `CCI`, `basic divergence`).
- `microstructure.*`: микроструктурные подтверждения (`order book imbalance`, `spread quality`, `book pressure`, `liquidity wall`).
- `capitalRegimePenalties.*`: защитный penalty по `capitalRegime`; слой подтверждений не имеет права ослаблять hard-risk/capital-prohibition.

### Что важно по архитектуре
- `confirmationEngine` **не может** принять final decision и не может открыть позицию сам.
- ownership final entry остаётся у `confluenceEntryEngine.finalEntryDecisionLayer`.
- при отсутствии части данных (`volume`, `orderBook`, индикаторы) слой возвращает валидный `dataQualityState` и продолжает цикл в `degraded/missing` режиме.

## Новый блок `confluenceEntryEngine.eventRisk`
Блок управляет слоем event-risk/shock-veto и включается только через config.

Ключевые параметры:
- `enabled` — master-флаг слоя.
- `highPriority` — приоритет слоя как risk/veto provider.
- `minCandles`, `atrPeriod`, `spreadLookback`, `eventWindow` — окна расчёта.
- `weights.*` — веса признаков (`atrSpike`, `spreadWidening`, `oversizedCandles`, `chaoticRangeExpansion`, `eventMovement`).
- `thresholds.*` — пороги soft/hard event-risk.
- `degradedMode.softPenalty` — защитный штраф при неполных данных.
- `degradedMode.failSafeOnInsufficientData` — опциональный fail-safe hard veto, если данных недостаточно.
- `capitalRegimeAdjustments.*` — ужесточение чувствительности слоя в режимах `CAUTION/DEFENSIVE/CAPITAL_PRESERVATION/HALT_NEW_ENTRIES`.
- `blockWeights.eventRisk` — вес слоя в aggregate score confluence (по умолчанию 0 для обратной совместимости).

Важно:
- слой не заменяет `finalEntryDecisionLayer`, а только поставляет veto/penalty в общий контракт;
- при `enabled=false` сохраняется старое поведение.

## Новый блок `finalEntryDecisionEngine` (шаг 35, подэтап 3)
Назначение: production-like финальная интерпретация новых входов на базе уже готовых `DecisionContext/shared block outputs`.

Ключевые поля config:
- `entryScoreThreshold` — порог для `full_entry`;
- `allowWeakEntryMode` — master-флаг weak-mode;
- `weakEntryThreshold` — базовый порог `weak_entry`;
- `weakEntryRange.min/max` — допустимый коридор score для weak-entry;
- `minimumRequiredScorePerBlock.*` — минимальный score по mandatory-блокам;
- `vetoRules.*`:
  - `hardVetoTypes`,
  - `interpretForecastRestrictionHints`,
  - `forecastHardHints`,
  - `mlCannotOverrideHardVeto`.

Интеграционные ограничения:
- `finalEntryDecisionEngine` не пересчитывает market data / block scores;
- интерпретация `portfolioForecastEngine.restrictionHints` делается только внутри `finalEntryDecisionEngine`;
- ML hooks подключаются как advisory (`scoreDelta/advisoryPenalty`) и не становятся final decision owner;
- одинаковая decision-логика для `live` и `paper/shadow`, отличие только на execution-слое.
