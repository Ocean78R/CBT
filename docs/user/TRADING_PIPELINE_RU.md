# Торговый пайплайн и слои логики

## Runtime-позиция слоёв (операторское представление)
Порядок принятия решений в системе:
1. Hard-risk / hard-safety / биржевые ограничения.
2. CapitalRegimeEngine + unload mode (ограничения новых входов, safe basket, лимиты).
3. Universe filters и отбор активов.
4. Market regime router (разрешённые сетапы).
5. Confluence/final entry logic (full/weak/no entry).
6. Dynamic sizing (только после approved entry).
7. Execution + серверные ордера.
8. Lifecycle позиции (сопровождение и закрытие).

## Зависимости слоёв
- Каждый поздний слой зависит от результата предыдущих.
- Если верхний риск-слой выдал запрет, вход не выполняется.
- Если данные неполные, применяется безопасный fallback без неявной смены торгового поведения.
- Unload mode зависит от account balance, riskSignals и текущего статуса позиций.
- Если riskSignals от forecast-слоя отсутствуют, unload mode использует только minBalance/warningThresholdAboveMinBalance (без поломки legacy-flow).

## Антикризисный режим разгрузки (unload mode)
- `unloadMode` — операционный слой, который включается **до entry decision и до sizing**.
- Сопровождение уже открытых позиций не отключается: ограничения касаются только **новых входов**.
- `capitalRegimeEngine` является primary current-state layer и вычисляет режимы: `NORMAL`, `CAUTION`, `DEFENSIVE`, `CAPITAL_PRESERVATION`, `HALT_NEW_ENTRIES`.
- `portfolioForecastEngine` может добавлять `forecastRegimeShiftRisk`, но не имеет права ослаблять текущий `capitalRegime`.
- `safeEntryAssets` ограничивает список тикеров для новых входов, но не мешает сопровождать старые позиции в любых тикерах.

## Как работает открытие позиции
1. Сбор market/account данных.
2. Проверка ограничений (capital/risk/exchange).
3. Расчёт сигнала и итогового решения входа.
4. При `approved entry` — расчёт размера позиции.
5. Постановка ордера через единый execution path.

## Как работает закрытие позиции
Позиция сопровождается строго по иерархии:
1. Server stop-loss.
2. Forced loss exit / stuck protection.
3. Server take-profit.
4. Partial close / breakeven / trailing.
5. Local polling fallback close.
6. Averaging (если разрешено политикой и контекстом).

## Типы торговых решений
- `hard veto` — жёсткий запрет действия.
- `soft penalty` — ухудшение оценки без полного запрета.
- `no-trade regime` — режим «не торговать».
- `capital prohibition` — запрет входа по капиталу/марже.

## Runtime-позиция execution contour
- Место в пайплайне: **после approved entry/sizing и до прямого вызова connector**.
- Зависимости: готовое решение от risk/entry/sizing слоёв; сам execution contour не принимает торговых решений.
- Ownership path: `openNewPosition/averagePosition/closePosition -> executeOrderIntent -> enqueueExecutionIntent/runExecutionIntent -> connector`.
- Для BingX server TP теперь обслуживается отдельным manager-слоем `serverTakeProfitManager` внутри lifecycle-контура:
  - создание после открытия позиции,
  - обновление после averaging,
  - cleanup при закрытии и при reconciliation без активной позиции.
- Локальный `closePositionPnl` остаётся fallback и не конкурирует с manager-слоем server TP.
- Fallback: при `executionContour.enabled=false` используется прежний flow исполнения.

Важно: execution contour — это технический слой надёжности (queue/retry/dedup/reconciliation), а не decision-layer.

## Server stop-loss manager (BingX)
- Runtime-позиция слоя: `execution -> serverStopLossManager -> serverTakeProfitManager -> lifecycle`.
- Зависимости: активная позиция из `positionProvider`, результат execution owner-path, `capitalRegime` из unload mode.
- После `openNewPosition` manager создаёт серверный `STOP_MARKET` ордер с reduce-only/close-only семантикой.
- После averaging manager пересоздаёт SL для whole-position (v1), чтобы объём защиты соответствовал новой позиции.
- При закрытии позиции и при `position_absent_reconcile` выполняется cleanup сиротских SL только через manager-слой.
- Fallback: если BingX server SL недоступен, остаются forcedLossExit/local polling close (без изменения legacy логики).

## ForcedLossExit / StuckPositionProtection (runtime-слой)
- Runtime-позиция: строго **после server SL и до averaging**.
- Зависимости: `serverStopLoss` статус, контекст `capitalRegime`, market-regime, position-metrics, optional `portfolioForecastEngine` hints.
- Ownership: модуль только формирует `ownershipAction` (`position_reduce_request` / `position_force_close_request`), а фактическое действие делает `execution_lifecycle_manager` + reconciliation.
- Fallback: если слой выключен (`forcedLossExit.enabled=false`) или нет достаточных данных, поведение остаётся legacy (без неявного закрытия).
- Приоритет: выше averaging, но не заменяет primary server stop-loss.


## Special position states в execution/reconciliation
- Runtime-позиция слоя: внутри `execution contour` на шаге reconciliation до entry/position processing.
- Зависимости: `positionProvider` (фактическая позиция), `marketDataProvider.getMarginMode` (mode), runtime leverage из config.
- Поддерживаемые состояния: `NORMAL_POSITION`, `LEVERAGE_MISMATCH_POSITION`, `LEGACY_RESTRICTED_POSITION`.
- Для `LEVERAGE_MISMATCH_POSITION` allowed actions: `reduce_only_close`, `profit_close`, `protective_forced_close`, `cleanup_reconciliation`, `partial_reduce_safe`.
- Для `LEVERAGE_MISMATCH_POSITION` blocked actions: `averaging`, `leverage_sensitive_sizing_updates`, `normal_compatibility_required_actions`.
- Fallback: при отключении `executionContour.leverageMismatchRestrictionEnabled` поведение возвращается к legacy guard без capability-state маршрутизации.

## Portfolio Risk Contour (уровень портфеля/счёта)
- Runtime-позиция: **самый верх decision-пайплайна перед всеми entry/signal слоями**.
- Primary control layer: контур является главным текущим контролем состояния капитала и не может быть ослаблен нижележащими слоями.
- Порядок: `portfolioRiskContour -> portfolioForecastEngine -> entryPermissionLayer -> marketRegimeRouter -> dynamicAssetSelection -> dynamicPositionSizing`.
- Передача контекста: `telemetry.downstreamContext` включает `unloadMode`, `dynamicAssetSelection`, `marketRegimeRouter`, `confluenceEntry`, `finalEntryDecision`, `dynamicPositionSizing`, `mlFeatureContext`, `mlMetaController`.
- Зависимости: account/balance snapshot, агрегаты по открытым позициям, дневная статистика сделок/циклов, состояние cooldown.
- Если часть данных недоступна, применяется безопасный fallback: сохраняется текущий режим и включается более защитная трактовка (без ослабления hard-ограничений).
- Forecast-слой может только дополнять forward-looking оценкой и **не имеет права** ослаблять текущие ограничения risk contour.

### Что вычисляет слой
- hard-ограничения новых входов:
  - дневной лимит убытка,
  - лимит новых входов за день,
  - лимит одновременно открытых позиций,
  - лимит суммарной используемой маржи,
  - пауза после серии плохих циклов/закрытий.
- `balanceState.capitalRegime`: `NORMAL | CAUTION | DEFENSIVE | CAPITAL_PRESERVATION | HALT_NEW_ENTRIES`.
- `hardVeto` типа `capital_prohibition`, если вход должен быть заблокирован на уровне портфеля.

## Runtime-позиция слоя trade analytics
- Позиция в пайплайне: после execution/lifecycle действий (`position_opened`, `position_averaged`, `position_closed`) и при `cycle-summary`.
- Зависимости: `execution owner-path`, `position state`, `runtime capital context`, `forecast hints` (если уже присутствуют в runtime-контексте).
- Кто главный: ownership path исполнения ордеров и risk-слои остаются primary; аналитика только наблюдает и журналирует.
- Fallback: при отсутствии forecast-данных слой пишет `null/[]`, без остановки цикла и без изменения торгового поведения.

## Runtime-позиция единого observability/reporting слоя
- Позиция в пайплайне: после формирования структурированных событий в decision/risk/execution/lifecycle слоях, как неблокирующий subscriber.
- Зависимости (более ранние слои): `DecisionContext` + `score` + `veto` контракты, события execution owner-path, capital/forecast context, lifecycle события позиции.
- Восстановимая audit-цепочка: `capital state -> forecast stress -> universe -> regime -> confluence -> veto -> sizing -> execution -> lifecycle`.
- Кто главный:
  - primary: hard-risk/hard-safety/exchange constraints/universe/regime/confluence/sizing/execution ownership;
  - observability: только наблюдение, отчёты, audit trail.
- Fallback:
  - если слой выключен (`observabilityReporting.enabled=false`) — поведение полностью legacy;
  - если отсутствуют данные ранних слоёв — заполняются безопасные `null/unknown`, цикл не блокируется.
- Производительность:
  - запись в отчёты буферизирована и отложена (`flushIntervalMs`, `maxBufferSize`);
  - high-volume decision events поддерживают sampling;
  - critical execution/protective/lifecycle события сохраняются полностью без sampling-потерь.

## Runtime-позиция performance diagnostics (без изменения торговой логики)
- Место в пайплайне: `connector -> providers(performanceDiagnostics) -> signal/read-only layers`.
- Зависимости: exchange connector, runtime config, существующий flow получения market/account/position данных.
- Кто главный:
  - primary: risk/entry/execution/lifecycle слои;
  - performance diagnostics: только измерение и техническая read-only оптимизация (TTL-кэш + in-flight dedup).
- Runtime-позиция request scheduler:
  - место: внутри `providers`, сразу перед вызовом read-only методов connector;
  - зависимости: runtime tags (`cycleId/exchange`), read-only cache/in-flight dedup, config `performanceDiagnostics.requestScheduler.*`;
  - scheduler управляет только чтением (`signalReadOnly`), не подменяет execution owner-layer и не отправляет ордера.
- Что остаётся fallback:
  - при выключенном флаге `performanceDiagnostics.enabled` весь слой отключён;
  - если кэш пуст/просрочен, выполняется обычный запрос в connector.
  - при `requestScheduler.enabled=false` read-only вызовы идут по прежнему пути без очередей/лимитов.
- Переключение режима:
  - `performanceDiagnostics.enabled` — master-флаг;
  - `performanceDiagnostics.readOnlyCache.*` — управление safe cache;
  - `performanceDiagnostics.metrics.*` — параметры метрик.

Разделение узких мест:
- signal/read-only: последовательные и повторные запросы market/account данных, избыточные дубли на один и тот же тикер;
- execution/protection: задержки lifecycle/protective событий и нагрузка на owner-path (измеряется в observability performance);
- analytics/reporting: стоимость ingest/flush/getReports/getAuditTrail и рост буфера событий.

Декомпозиция expensive read-only источников:
- для всех тикеров: `getTickerInfo`, `getMarkPrice` (core market data queue);
- только для shortlist/финальных кандидатов: `getLeverage`, `getMarginMode`, `getFuturesPositionsForTicker` (derivatives context queue);
- только для финальных кандидатов/аналитики: тяжёлые optional microstructure и analytics refresh (optional очереди, budget режется первыми).


### Runtime-позиция hot-state и cache tiers
- Место в пайплайне: `connector -> providers(readOnlyCache + hotState + derivedFeatureCache) -> signal/read-only layers -> risk/entry -> execution`.
- Зависимости ранних слоёв:
  - exchange connector (источник live данных),
  - cycle context (`cycleId`) для per-cycle invalidation,
  - runtime config `performanceDiagnostics.*`.
- Кто главный / fallback:
  - главный: risk + execution lifecycle + protection owner-path;
  - fallback: при `performanceDiagnostics.enabled=false` используется legacy live-flow без кэша;
  - при miss/stale-limit-exceeded выполняется live refresh из connector.

Cache tiers и чтение слоями:
- **ultra-short TTL**: markPrice, regime inputs, быстрые indicators.
- **per-cycle cache**: HTF structure, support/resistance, VWAP/profile контекст внутри одного цикла.
- **slower-refresh context cache**: ticker analytics aggregates и derivatives context snapshots.

Ключи derived feature cache:
- формат: `ticker + timeframe + featureVersion + featureType + cycleContext`.
- это позволяет безопасно переиспользовать признаки между несколькими сигнальными слоями в рамках цикла.

Что можно брать из cache mode:
- безопасно: indicators/regime inputs/HTF/support-resistance/VWAP-profile/analytics aggregates/derivatives snapshots (по TTL).
- требует live refresh: execution-critical state и подтверждение действий, меняющих позицию/серверные ордера.
