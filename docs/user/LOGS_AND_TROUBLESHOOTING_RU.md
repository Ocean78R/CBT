# Логи и типовые сбои

## Как читать основные логи
Смотрите на последовательность событий торгового цикла:
1. Получение market/account данных.
2. Решение risk-gate (есть ли veto).
3. Решение по входу (full/weak/no entry).
4. Исполнение ордера.
5. Сопровождение/закрытие позиции.

При включённом `logger.runtime` отслеживайте корреляцию по `cycleId`, `ticker`, `positionId`, `orderId`.

### Server Take-Profit (BingX) события
- `protection/server_tp_upsert`: серверный TP (reduce-only) установлен или обновлён.
- `protection/server_tp_cleanup`: сиротский TP удалён через manager ownership path.
- `protection/server_tp_skip`: TP пропущен (legacy mismatch, неподдерживаемый коннектор или недостаток данных).
- `protection/server_tp_after_open_error`, `protection/server_tp_after_averaging_error`: fallback на локальный `closePositionPnl`.

## Типовые сбои и действия оператора
### 1) Ошибки коннектора / неполные данные биржи
- Признак: `undefined/null` в рыночных полях, пропуски в ответах.
- Действие: проверить доступность API и лимиты; убедиться, что сработал fallback (пропуск опасного шага без падения цикла).

### 2) Частые hard-veto и отсутствие входов
- Признак: бот стабильно не открывает позиции.
- Действие: проверить ограничения капитала, risk-пороги и no-trade режимы.

### 3) Ордеры не исполняются или закрытие запаздывает
- Признак: решение есть, но execution-события отсутствуют/ошибочны.
- Действие: проверить биржевые ограничения, доступность торговых методов и server-order состояние.

### 4) Подозрительное изменение поведения после доработки
- Признак: вход/выходы изменились без явного флага.
- Действие: проверить changelog документации и policy обновления; убедиться, что не произошло неявного переключения режима.

## Новые execution-события для audit trail
Добавлены структурированные runtime-события слоя `execution_contour`:
- `queue_enqueued`, `queue_dequeued`, `queue_overflow`;
- `order_attempt`, `order_retry`, `order_confirmed`, `order_failed`;
- `dedup_inflight`, `dedup_skip`;
- `reconciliation`.

Минимальные поля для анализа: `cycleId`, `ticker`, `module/layer`, `decision`, `reason`, `action`, `dedupKey`, `attempt`, `queueSize`, `итог`.

Практика диагностики:
1. Сначала ищите `order_attempt` и количество `order_retry`.
2. Проверяйте `dedup_*` при подозрении на дубль.
3. После рестарта проверяйте `reconciliation` и расхождения `activePositions/queueDepth`.

## События server stop-loss
Добавлены структурированные события слоя `server_stop_loss`:
- `server_sl_upsert`, `server_sl_skip`, `server_sl_cancel_error`.
- `server_sl_after_open_error`, `server_sl_after_averaging_error`.
- `server_sl_cleanup`, `server_sl_cleanup_error`.

Минимальные поля событий: `cycleId`, `ticker`, `exchange`, `module/layer`, `capitalRegime`, `decision`, `reason`, `fallback`.


## События forcedLossExit / stuckPositionProtection
Добавлено структурированное событие `forced_loss_exit_decision` (layer `risk.positionProtection`).

Минимальные поля события:
- `cycleId`, `ticker`, `exchange`;
- `module/layer`, `marketRegime`, `capitalRegime`, `setupType`;
- `score`, `confidence`;
- `vetoReason` (если trigger), `sizingDecision`;
- `executionAction`/`fallbackAction`;
- `finalDecision`;
- `triggerStage` (`early_invalidation_exit | forced_loss_exit_fallback | none`);
- `positionCapabilityState`;
- `earlyInvalidationReason` (причина ранней инвалидации).
- `protectiveActionOwner` (`server_stop_loss_manager | execution_lifecycle_manager`);
- `protectiveActionToken` (dedup/ownership correlation id);
- `duplicateClosePrevented` (зафиксирован безопасный no-op повторного close);
- `closeSource` (`server_sl | early_invalidation | forced_loss_exit | lifecycle_close`).

Диагностика:
1. Проверяйте, что при `actionMode=warn` событие есть, но `executionAction=none`.
2. Для `block_averaging|partial_reduce|force_close` смотрите `sizingDecision/executionAction` и дальнейшие lifecycle события owner-layer.
3. Если включён `forecastInfluence.requireStressSignal`, отсутствие stress-signal должно давать `finalDecision=no_action`.
4. Для early-level смотрите диагностику: `timeSinceEntryMin`, `deviationPct`, `adverseZoneMin`, `adverseTrendConfirmed`, `scenarioBroken`.
5. Если `duplicateClosePrevented=true`, проверяйте chain по `protectiveActionToken`: server SL/state -> lifecycle reconcile -> отсутствие повторного close-ордера.
6. Роли в protective path фиксированы в docs/runtime-контракте: owner = `server_stop_loss_manager|execution_lifecycle_manager`, fallback = legacy forced/stuck/local polling close, decision-layer = `forcedLossExit` (только решение и событие).


## Логи restricted-state по leverage mismatch
Для событий `reconciliation`, `position_capability_state`, `blocked_action` теперь логируются поля:
`expectedLeverage`, `actualLeverage`, `leverageMismatchDetected`, `positionCapabilityState`, `allowedActions`, `blockedActions`.
Это же попадает в audit trail/cycle journal через `emitStructuredEvent` в слоях `execution_contour` и `risk_decision`.
Для `LEVERAGE_MISMATCH_POSITION` dedup-owner path тот же: token/owner пишутся в protective + reconciliation trace, а risky actions остаются заблокированы.

## События portfolio risk contour
Добавлено структурированное событие `portfolio_risk_contour_decision` (layer `risk.portfolioContour`).

Обязательные поля для audit trail/trade journal:
- `cycleId`, `ticker`, `exchange`;
- `module/layer`, `marketRegime`, `capitalRegime`, `setupType`;
- `score/confidence`;
- `vetoReason` (если блок), `sizingDecision`;
- `executionAction/fallbackAction`, `finalDecision`.

Практика диагностики:
1. Если `finalDecision=block`, первым делом смотрите `vetoReason` и `payload.telemetry.limitsBreached`.
2. Для проверок regime-transition сверяйте `payload.balanceState.previousCapitalRegime` и `payload.balanceState.regimeChanged`.
3. При активной паузе проверяйте `payload.limits.cooldownActive` и `payload.limits.cooldownUntilMs`.

## События trade analytics и журнал сделок
Добавлены структурированные события:
- `analytics/trade_open_registered`
- `analytics/trade_averaging_registered`
- `analytics/trade_close_registered`
- `analytics/trade_report`

Минимальные поля audit trail для нового слоя:
`cycleId`, `ticker`, `exchange`, `module/layer`, `marketRegime`, `capitalRegime`, `setupType`, `score`, `confidence`, `vetoReason`, `sizingDecision`, `executionAction`, `fallbackAction`, `finalDecision`.

Журнал сделок сохраняется в CSV и используется для метрик: `winRate`, `avgWin`, `avgLoss`, `expectancy`, статистика усреднений, распределение по времени суток, дню недели и типу сигнала.

## Логи market regime router
Новые фазы событий `entry_decision`:
- `danger_gate` — вход заблокирован на этапе safety-диапазона свечей;
- `route_selected` — режим классифицирован, выбран допустимый сетап.

Новый runtime-лог:
- префикс `[marketRegimeRouter]` с полями `cycle/ticker/exchange/module/layer/regime/capital/setup/score/confidence/veto/sizing/execution/fallback/final`.

Что важно проверить в диагностике:
1. `marketRegime` и `selectedPredictType` соответствуют текущей волатильности/структуре свечей.
2. `capitalRegime` отражён в `allowedSetups` (защитные режимы должны сжимать доступные сетапы).
3. При `no_trade_flat` итог должен быть `final=reject`, если `allowFallbackInFlatRegime=false`.

## Единый observability/reporting и audit trail
Добавлен единый слой агрегированных отчётов и audit trail поверх структурированных событий runtime-контрактов.

Доступные типы сводок:
- по торговому циклу (`byCycle`);
- по тикеру (`byTicker`);
- по позиции (`byPosition`);
- по дню (`byDay`);
- по типу итогового решения (`byDecisionType`);
- по причинам отказа входа (`vetoReasons`);
- по execution событиям (`executionEvents`);
- по protective событиям (`protectiveEvents`);
- по сменам режимов (`regimeChanges`);
- по ML-решениям (`mlDecisions`, если модуль отмечен как ML);
- по режимам paper/live (`modeSplit`).

Отдельные forecast-категории:
- `forecast_events`,
- `forecast_restrictions`,
- `forecast_protective_hints`.

Как читать audit trail:
1. Берите ключ `cycleId + ticker (+ positionId, если есть)`.
2. Проверяйте обязательный путь:
   `capital -> forecast -> universe -> regime -> confluence -> veto -> sizing -> execution -> lifecycle`.
3. Для стресс-сценариев проверяйте связку:
   `capital state -> forecast stress -> entry restriction / sizing adjustment / protective tightening`.


## Диагностика cache/hot-state
Новая read-only оптимизация пишет технические события и метрики без влияния на ownership торговых решений.

Минимальные события cache-слоя:
- `cache_hit`,
- `cache_miss`,
- `cache_stale_reuse`,
- `cache_forced_refresh`.

Рекомендуемые поля audit trail для cache-диагностики:
- `cycleId`, `ticker`, `exchange`,
- `module` (`providers.read_only_cache` / `providers.derived_feature_cache`),
- `layer` (`signalReadOnly`),
- `method`,
- итог cache-решения (`hit/miss/stale/forced_refresh`).

Как измерять эффективность:
- hit ratio: `cacheHits / (cacheHits + cacheMisses)`;
- stale reuse ratio: `staleReuseHits / totalCalls`;
- in-flight dedup ratio: `inFlightHits / totalCalls`;
- latency-эффект: сравнение slow-calls до/после (`slowCalls`, `byMethod.*.avgMs`).

## Логи и события performance governor
Новые события (совместимы с текущим observability/audit trail форматом):
- `performance_governor_cycle_start`
- `performance_governor_cycle_end`
- `performance_governor_layer_skip`

Минимальные поля, которые пишутся для управляющих решений governor:
- `cycleId`, `ticker`, `exchange`, `module/layer`, `marketRegime`, `capitalRegime`,
- `setupType`, `score/confidence`, `vetoReason` (если есть),
- `sizingDecision`, `executionAction`, `finalDecision`.

Диагностика деградации:
- `mode=full` — слой выполняется полностью,
- `mode=cached` — слой принудительно переводится в cache reuse,
- `mode=degraded` — слой работает в упрощённом режиме,
- `mode=skip` — слой пропускается по budget rules.

Проверки при перегрузке:
1. Проверить `performanceGovernor.mode` и `degradation` thresholds.
2. Проверить `budgets.byLayerMs` для самых тяжёлых слоёв.
3. Проверить `tickerLimits` и `refreshCadence`.
4. Проверить, что execution-critical path не деградировал.

## Логи и отчётность paper/shadow режима
Добавлены отдельные события execution-слоя paper-mode:
- `paper_execution/virtual_entry_opened`
- `paper_execution/virtual_position_averaged`
- `paper_execution/virtual_position_closed`

Минимальные поля в событии:
- `cycleId`, `ticker`, `exchange`;
- `module/layer` (`paperExecutionEngine` / `execution.paperShadow`);
- `market regime`, `capital regime`, `setup type`;
- `score/confidence`, `veto reason` (если есть), `sizing decision`;
- `executionAction` и `fallbackAction`;
- итоговое решение.

Дополнительно для paper-режима логируются:
- `current capital state`;
- `forecast capital stress`;
- `forecast restriction hints`;
- `virtualBalance` и агрегированные метрики симуляции.

## Логи и журналирование ML dataset builder
Новые runtime-логи:
- `[mlDatasetBuilder] ... final=feature_captured sampleId=...`
- `[mlDatasetBuilder] ... final=POSITIVE|NEGATIVE|NEUTRAL|TIMEOUT|NO_TRADE sampleId=...`

Новые структурированные события для observability/audit trail:
- `ml_dataset_feature_captured`
- `ml_dataset_label_resolved`

Минимальные поля в событиях:
- `cycleId`, `ticker`, `exchange`, `module/layer`;
- `marketRegime`, `capitalRegime`, `setupType`;
- `score`, `confidence`, `vetoReason`;
- `sizingDecision`, `executionAction`, `fallbackAction`;
- итоговое решение (`decision` для feature, `label` для outcome).

Диагностика:
1. Проверить `mlDatasetBuilder.enabled=true`.
2. Проверить появление файлов `entry_features.csv`, `entry_labels.csv`, `entry_pending_state.json`.
3. Проверить, что при закрытии paper-позиции создаётся запись label.
4. Проверить, что при рестарте pending-состояние поднимается из `entry_pending_state.json`.

## Логи и события higherTimeframeBiasEngine
Новые runtime-логи:
- префикс `[higherTimeframeBias]` с полями:
  `cycle/ticker/exchange/module/layer/regime/capital/setup/score/confidence/veto/sizing/execution/fallback/final/structure/trendAlignment/dataQuality/mode`.

Новое structured событие:
- `higher_timeframe_bias_decision` (`module=higherTimeframeBiasEngine`, `layer=signal.htfStructure`).

Минимальные поля для audit trail / trade journal:
- `cycleId`, `ticker`, `exchange`,
- `module/layer`, `marketRegime`, `capitalRegime`, `setupType`,
- `score`, `confidence`, `vetoReason`,
- `sizingDecision`, `executionAction`, `fallbackAction`, `finalDecision`,
- `payload.htfBias`, `payload.marketStructureState`, `payload.structureConfidence`, `payload.trendAlignmentScore`, `payload.dataQualityState`.

Диагностика degraded/cached режима:
1. Если `dataQuality=degraded`, проверьте наличие `sharedSnapshot.htfCandles` и минимум структурных точек.
2. Если `mode=cached_mode`, проверьте `slowerRefresh` настройки и факт появления нового HTF-бара.
3. Проверяйте, что даже при `htfBias=bullish|bearish` итоговый вход остаётся под контролем risk/capital/veto слоёв.

