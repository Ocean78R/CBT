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
- `allowedUniverse` (`definedAssets`/`allowedUniverse` в config) — единственный owner разрешённого universe для входов.
- `dynamicAssetSelection` формирует runtime-`dynamicShortlist` **внутри allowedUniverse** и только для новых входов; слой использует shared market snapshot + trade journal и не владеет execution side-effects.
- `dynamicAssetSelection` учитывает `balanceState/capitalRegime` и forecast stress-hints как внешний контекст: при ухудшении режима shortlist сжимается.
- Приоритеты жёстко фиксированы: `allowedUniverse -> hard restrictions/safeEntryAssets/unload -> capitalRegime -> dynamicShortlist -> regime/router/confluence/zones -> sizing/execution`.
- Формальные runtime-области ownership:
  - `allowedUniverse` — верхняя граница тикеров, которые вообще могут попасть в pipeline новых входов;
  - `safeEntryUniverse`/`safeEntryFilterResult` — сужение `allowedUniverse` только для safe/unload режима;
  - `dynamicShortlist` — runtime shortlist только внутри уже суженного scope;
  - `newEntryEligibleUniverse` — финальный входной набор для downstream-сигнальных слоёв (шаги 24–27 читают его как input-only);
  - `lifecycleScope/openPositionScope` — отдельный контур сопровождения уже открытых позиций, не зависящий от shortlist/new-entry фильтров.
- Правило инварианта: `safeEntryAssets` никогда не расширяет `allowedUniverse`, а `dynamicShortlist` не может обойти `safeEntryAssets` и unload-гейты.
- Structured события отказов и lifecycle override:
  - `tickerRejectedBecauseOutsideAllowedUniverse`
  - `tickerRejectedBecauseNotInSafeEntryAssets`
  - `tickerRejectedByUnloadMode`
  - `tickerRejectedByCapitalRegime`
  - `tickerRejectedByDynamicShortlist`
  - `tickerKeptForLifecycleBecausePositionAlreadyOpen`
  - `finalNewEntryEligibleUniverseSize`

## Как работает открытие позиции
1. Сбор market/account данных.
2. Проверка ограничений (capital/risk/exchange).
3. Расчёт сигнала и итогового решения входа.
4. При `approved entry` — расчёт размера позиции.
5. Постановка ордера через единый execution path.

## Как работает закрытие позиции
Позиция сопровождается строго по иерархии:
1. Server stop-loss.
2. Post-entry observation / early invalidation exit.
3. Forced loss exit / stuck protection (fallback).
4. Server take-profit.
5. Partial close / breakeven / trailing.
6. Local polling fallback close.
7. Averaging (если разрешено политикой и контекстом).

## Типы торговых решений
- `hard veto` — жёсткий запрет действия.
- `soft penalty` — ухудшение оценки без полного запрета.
- `no-trade regime` — режим «не торговать».
- `capital prohibition` — запрет входа по капиталу/марже.

## Market Regime Router (новый слой маршрутизации режимов)
- Runtime-позиция: **после universe/unload filters и до confluence/final entry logic**.
- Зависимости ранних слоёв: `MarketSnapshot` (свечи W1/D1/H4), `cycleId/exchange`, `balanceState/capitalRegime`.
- Что делает:
  1. Классифицирует режим рынка: `trend | mean_reversion | breakout_rejection | no_trade_flat`.
  2. Возвращает совместимый результат в общий контракт (`layerName/direction/score/confidence/softPenalty/vetoCandidates/dataQualityState/reasonCodes`).
  3. Разрешает/ограничивает допустимые типы сетапов (`allowedSetups`) и выбирает `selectedPredictType`.
- Что **не делает**:
  - не рассчитывает размер позиции;
  - не отправляет ордера;
  - не принимает финальный veto вместо `finalEntryDecisionEngine`.
- Fallback-поведение:
  - если `predict.regimeRouter.enabled=false`, используется legacy `predictType`;
  - `byBarsPercents` остаётся fallback-режимом (`fallbackPredictType`) и также используется как trend-сетап по умолчанию;
  - при неполных данных роутер отдаёт `dataQualityState=degraded` и безопасно возвращается к fallback.
- Разграничение понятий:
  - `marketRegimeRouter` — классифицирует **текущий режим и допустимые сетапы**;
  - `higher timeframe bias` — только направленный контекст старших ТФ, не равен режиму торговли;
  - `no-trade regime` — режим рынка, где входы по сетапам отключаются;
  - `capital prohibition` — запрет по состоянию капитала (`balanceState/capitalRegime`), который может блокировать вход даже при валидном рыночном режиме.

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
- Runtime-owner protective close: `server_stop_loss_manager` (primary owner, если server SL close уже initiated/confirmed).
- После `openNewPosition` manager создаёт серверный `STOP_MARKET` ордер с reduce-only/close-only семантикой.
- После averaging manager пересоздаёт SL для whole-position (v1), чтобы объём защиты соответствовал новой позиции.
- При закрытии позиции и при `position_absent_reconcile` выполняется cleanup сиротских SL только через manager-слой.
- Fallback: если BingX server SL недоступен, остаются forcedLossExit/local polling close (без изменения legacy логики).

## ForcedLossExit / StuckPositionProtection (runtime-слой)
- Runtime-позиция: строго **после server SL и до averaging**.
- Внутренний порядок: `postEntryObservation/earlyInvalidationExit` -> `forcedLossExit/stuckPositionProtection` (fallback).
- Зависимости: `serverStopLoss` статус, контекст `capitalRegime`, market-regime, position-metrics, optional `portfolioForecastEngine` hints.
- Ownership: модуль только формирует `ownershipAction` (`position_reduce_request` / `position_force_close_request`), а фактическое действие делает `execution_lifecycle_manager` + reconciliation.
- Runtime-owner protective close:
  - `server_stop_loss_manager` — если server-side close уже initiated/confirmed;
  - `execution_lifecycle_manager` — если действие выполняется локально через lifecycle close.
- Явное разделение ролей:
  - **Owner (primary execution owner):** `server_stop_loss_manager` при server initiated/confirmed close, иначе `execution_lifecycle_manager`.
  - **Fallback:** legacy forced/stuck + local polling close, если server SL недоступен или ранний слой отключён.
  - **Только decision-layer:** `forcedLossExit`/`postEntryObservation` принимает решение и эмитит structured event, но не отправляет ордера напрямую.
- Dedup token: `protectiveActionToken` пробрасывается между risk/execution/lifecycle/reconciliation и предотвращает повторный конфликтующий close.
- Dedup policy: при `serverStopLoss.closeInitiated|closeConfirmed` локальный `force_close` становится no-op (`duplicateClosePrevented=true`), ownership остаётся у server owner.
- Fallback: если `enablePostEntryObservation=false`, ранний уровень полностью отключён, legacy forced/stuck продолжает работать без rollback.
- Приоритет: выше averaging, но не заменяет primary server stop-loss.


## Special position states в execution/reconciliation
- Runtime-позиция слоя: внутри `execution contour` на шаге reconciliation до entry/position processing.
- Зависимости: `positionProvider` (фактическая позиция), `marketDataProvider.getMarginMode` (mode), runtime leverage из config.
- Поддерживаемые состояния: `NORMAL_POSITION`, `LEVERAGE_MISMATCH_POSITION`, `LEGACY_RESTRICTED_POSITION`.
- Детект в execution/reconciliation сравнивает минимум: `leverage`, `position mode`, `reduce-only safety assumptions`; mismatch не обрабатывается ad-hoc в signal-слоях.
- Для `LEVERAGE_MISMATCH_POSITION` allowed actions: `reduce_only_close`, `profit_close`, `protective_forced_close`, `cleanup_reconciliation`, `partial_reduce_safe`.
- Для `LEVERAGE_MISMATCH_POSITION` blocked actions: `averaging`, `leverage_sensitive_sizing_updates`, `normal_compatibility_required_actions`.
- Dedup-owner path для restricted state не меняется: protective close остаётся в том же ownership/dedup контуре (`execution_lifecycle_manager` + `protectiveActionToken` + reconciliation trace).
- Structured propagation: capability-state передаётся в `PositionState` (`position_state`), в `DecisionContext.metadata` (`executionRestrictions + positionCapabilityState`) и в `lifecycleContext`, чтобы будущие decision-слои шага 24 читали это состояние только как входной контекст.
- Fallback: при отключении `executionContour.leverageMismatchRestrictionEnabled` поведение возвращается к legacy guard без capability-state маршрутизации.

## Portfolio Risk Contour (уровень портфеля/счёта)
- Runtime-позиция: **самый верх decision-пайплайна перед всеми entry/signal слоями**.
- Primary control layer: контур является главным текущим контролем состояния капитала и не может быть ослаблен нижележащими слоями.
- Порядок: `portfolioRiskContour -> portfolioForecastEngine -> entryPermissionLayer -> marketRegimeRouter -> dynamicAssetSelection -> dynamicPositionSizing`.
- Важно: `portfolioForecastEngine` передаёт только hints/penalties; shortlist остаётся в ownership `dynamicAssetSelection`.
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

## Runtime-позиция derivativesContextEngine (perpetual futures context)
- Место в пайплайне: **после дешёвых gating-слоёв (`entryPermission/marketContext/primary/confirmation`) и перед `finalEntryDecisionLayer`**.
- Зависимости ранних слоёв:
  - `DecisionContext` (`cycleId`, `ticker`, `exchange`, `marketRegime`, `capitalRegime`, `setupType`);
  - `sharedSnapshot.derivatives` (OI/funding/liquidation), если уже рассчитан в текущем цикле;
  - `primarySignal.direction` как внешний вход для направленной интерпретации деривативного фона.
- Что делает:
  1. Оценивает `open interest dynamics`;
  2. Оценивает `funding state`;
  3. Учитывает `liquidation context` (если доступен);
  4. Вычисляет признаки crowding/перегрева;
  5. Возвращает совместимый block-result (`score/confidence/softPenalty/vetoCandidates/dataQualityState/reasonCodes`).
- Что **не делает**:
  - не открывает/закрывает позицию;
  - не отправляет ордера;
  - не переопределяет hard-risk/capital-veto.
- Кто главный и fallback:
  - главный по финальному разрешению входа: `finalEntryDecisionLayer`;
  - `derivativesContextEngine` — только контекстный усилитель/ослабитель;
  - при `confluenceEntryEngine.derivativesContext.enabled=false` поведение остаётся legacy/fallback.
- Refresh cadence и reuse:
  - OI/funding/liquidation читаются из `sharedSnapshot` и/или cache;
- full refresh выполняется реже (`minCyclesBetweenRefresh`);
- между refresh используется `cached_mode`, при нехватке данных/бюджета — `degraded_mode` без остановки цикла.

## Runtime-позиция sessionFilterEngine / timeContextEngine
- Место в пайплайне: **после `entryPermission + regimeRouter` и перед `finalEntryDecisionLayer` внутри confluence**.
- Зависимости ранних слоёв:
  - `DecisionContext` (`cycleId`, `ticker`, `exchange`, `marketRegime`, `capitalRegime`, `timestampMs`);
  - `featureStoreContext` для cached/full/degraded режима (без повторных market-data запросов).
- Что делает:
  1. Определяет час дня и активную сессию (`sessionState`);
  2. Рассчитывает `timeContextScore`;
  3. Отмечает `timeBasedEntryRestriction` в плохих окнах;
  4. Возвращает совместимый layer-result (`score/confidence/softPenalty/vetoCandidates/dataQualityState/reasonCodes`).
- Что **не делает**:
  - не заменяет `marketRegimeRouter`;
  - не открывает сделку самостоятельно;
  - не ослабляет `hard-risk` и `capitalRegime`.
- Кто главный и fallback:
  - главный по финальному разрешению входа остаётся `finalEntryDecisionLayer`;
  - `sessionFilterEngine` — только context/permission слой;
  - при `confluenceEntryEngine.sessionFilter.enabled=false` поведение полностью legacy/fallback.
- Влияние `capitalRegime`:
  - защитные режимы могут увеличивать time-penalty;
  - в strict-конфигурации фильтр может поднимать `capital_prohibition` кандидат;
  - слой не имеет права снять запрет, выставленный верхним risk-контуром.

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

## Runtime-позиция performance governor / performance control plane
- Место слоя в пайплайне: между `providers(read-only/perf)` и тяжёлыми signal layers; governor не принимает торговых решений, а управляет режимом выполнения слоёв.
- Явные зависимости от более ранних слоёв: `cycleId/exchange/marketRegime/capitalRegime`, risk-контекст, runtime tags и метрики цикла.
- Staged evaluation зафиксирован явно: `shortlist -> cheap_context -> expensive_confirmations -> final_decision`.
- Кто главный:
  - `hard-risk / hard-safety / exchange constraints / unload mode` — primary;
  - `performance governor` — только control-plane производительности;
  - execution/lifecycle ownership path не меняется.
- Что осталось fallback:
  - при `performanceGovernor.enabled=false` или `mode=monitor_only` сохраняется legacy-поведение выполнения слоёв;
  - при отсутствии части runtime-контекста governor использует безопасные `unknown/null` без остановки цикла.
- Переключение режима:
  - `performanceGovernor.enabled` — master-flag,
  - `performanceGovernor.mode` — `monitor_only | enforce`,
  - `performanceGovernor.degradation.*` — правила graceful degradation,
  - `performanceGovernor.budgets.byLayerMs.*` — per-layer budgets.

## Runtime-позиция paper/shadow execution
- Место слоя: строго в `execution ownership path` после `approved entry` и после всех risk/veto/sizing проверок.
- Зависимости ранних слоёв:
  - `portfolioRiskContour` + `balanceState/capitalRegime`;
  - `portfolioForecastEngine` (если включён) и его restriction/sizing/protective hints;
  - итоговое решение confluence/final entry.
- Кто главный:
  - в live: `executionEngine -> real connector`;
  - в paper/shadow: `executionEngine -> paperExecutionEngine` (без отправки реального ордера).
- Что остаётся fallback:
  - при `paperTrading.enabled=false` выполняется legacy live execution без изменений.
- Как переключается режим:
  - config-флаг `paperTrading.enabled`;
  - режим метки `paperTrading.mode` (`paper` или `shadow`).

Важно: paper/shadow режим не ослабляет `capitalRegime` и `portfolio risk contour`; он только подменяет физическое исполнение ордера на виртуальное.

## Runtime-позиция слоя ML dataset builder (feature logging)
- Место нового слоя в runtime-пайплайне: **после decision/risk и в execution ownership path как пассивный сборщик**.
- Зависимости от более ранних слоёв:
  - `DecisionContext` (score/confidence/veto/penalties/dataQuality),
  - `balanceState/capitalRegime`,
  - downstream block outputs из `telemetry.downstreamContext`,
  - forecast-контекст (`portfolioForecastState`, `capitalStressForecastScore`, `forecastRegimeShiftRisk`, `portfolioFragilityScore`, restriction/protective hints).
- Кто главный:
  - primary остаются hard-risk/unload/regime/confluence/sizing/execution;
  - `mlDatasetBuilder` только пишет признаки/метки и не влияет на допуск входа.
- Fallback:
  - при `mlDatasetBuilder.enabled=false` слой полностью выключен;
  - при частично отсутствующих данных пишет безопасные `null/unknown` и не блокирует цикл;
  - при ошибке записи сборщик деградирует в best-effort режим, торговля продолжается.
- Переключение режима: `mlDatasetBuilder.enabled`, а также `includePaperMode/includeLiveMode`.

## Offline runtime-позиция первого ML training pipeline (оценка качества входа)
- Место слоя: **вне боевого runtime-цикла**, отдельный offline-контур обучения на артефактах `mlDatasetBuilder`.
- Зависимости от более ранних слоёв:
  - собранный `entry_features.csv`/`entry_labels.csv` от `mlDatasetBuilder`;
  - корректный `DecisionContext`-контракт в датасете (`score/confidence/veto/penalties/metadata`);
  - заполнение полей состояния капитала и прогноза (`balance*`, `capitalRegime`, `portfolioForecastState`, `capitalStressForecastScore`, `forecastRegimeShiftRisk`, `portfolioFragilityScore`).
- Кто главный:
  - для торговых решений по-прежнему главный rule-based pipeline (risk/regime/confluence/sizing/execution);
  - ML pipeline сейчас только обучает и оценивает модель offline.
- Что fallback:
  - при нехватке данных обучение не выполняется (`skipped_insufficient_data`), торговый runtime не меняется;
  - при плохом split обучение также безопасно пропускается (`skipped_bad_split`).
- Как включается/используется:
  - запуск вручную через CLI `npm run ml:train:entry-quality`;
  - артефакты сохраняются локально в `./data/ml_models/entry_quality` (или в путь из аргумента `--outDir`).

## Runtime-позиция higherTimeframeBiasEngine / marketStructureEngine
- Место слоя в пайплайне: `marketRegimeRouter -> higherTimeframeBiasEngine -> confluenceEntry/finalEntryDecision -> dynamicPositionSizing -> execution`.
- Зависимости от более ранних слоёв:
  - `DecisionContext` (`cycleId/ticker/exchange/marketRegime/capitalRegime/setupType`),
  - shared snapshot (`sharedSnapshot.htfCandles`, `sharedSnapshot.latestPrice`),
  - `balanceState/capitalRegime` как внешний контекст ограничений.
- Кто главный:
  - primary: `hard-risk/hard-safety/exchange constraints/unload mode/marketRegimeRouter`;
  - `higherTimeframeBiasEngine` даёт только контекст (bias/penalty/boost), но не даёт hard-veto и не отправляет ордера.
- Что осталось fallback:
  - при `higherTimeframeBiasEngine.enabled=false` используется legacy entry-flow без HTF-штрафов;
  - при нехватке данных или budget-pressure слой возвращает `dataQualityState=degraded|cached` и нейтральный контекст.
- Как переключается режим:
  - `higherTimeframeBiasEngine.enabled` — master-флаг;
  - `higherTimeframeBiasEngine.slowerRefresh.*` — slower-refresh/cache режим HTF-структуры;
  - `higherTimeframeBiasEngine.alignmentPenalties.*` — влияние только в confluence/final decision.

### Что рассчитывает HTF-слой
- Структура swing-пивотов `HH/HL` и `LH/LL`.
- `Break of Structure` (BOS) по порогу `breakOfStructureThresholdPercent`.
- `Shift / Change of Character` (CHoCH) как смена доминирующей структуры.
- Направление старшего тренда (`bullish/bearish/sideways`).
- Положение цены внутри старшего диапазона (`discount/middle/premium`).

### Выходы слоя (совместимый контракт)
- `layerName`, `direction`, `score`, `confidence`, `softPenalty`, `vetoCandidates`, `dataQualityState`, `reasonCodes`.
- Специализированные поля контекста:
  - `htfBias`,
  - `marketStructureState`,
  - `structureConfidence`,
  - `trendAlignmentScore`.
- Слой обогащает `DecisionContext.metadata.higherTimeframeBias` и не создаёт ad-hoc контрактов для финального решения.

### Логика влияния на вход
- Если локальный вход согласован с `htfBias`, возможен небольшой boost к score (через config).
- Если локальный вход против `htfBias`, применяется `softPenalty`.
- Нейтральный HTF-контекст даёт мягкое ослабление уверенности, но не формирует hard-veto.
- Финальное решение всё равно остаётся за `confluence/finalEntryDecision` с приоритетом risk/capital-veto слоёв.


## Runtime-позиция confluenceEntryEngine / entryScoringEngine (многослойный вход)
- Место слоя в runtime-пайплайне:
  `hard-risk / portfolioRiskContour -> marketRegimeRouter -> confluenceEntryEngine(entryPermission -> marketContext -> primarySignal -> confirmation -> marketLevel -> volumeContext -> bounceDetection -> breakdownDetection -> finalEntryDecision) -> dynamicPositionSizing -> execution`.
- Зависимости от более ранних слоёв:
  - `DecisionContext` (cycle/ticker/regime/capital/score/confidence/veto/metadata),
  - `balanceState` и `capitalRegime` из `portfolioRiskContour`,
  - `forecastRegimeShiftRisk` и `forecastSignals` как внешний контекст,
  - `marketRegimeRouter` (допустимые сетапы/no-trade),
  - shared HTF-context (`higherTimeframeBiasEngine`) для confirmation.
- Кто главный:
  - `finalEntryDecisionLayer` внутри confluence — единственная точка итоговой интерпретации veto в confluence-стеке;
  - `marketRegimeRouter` и `capitalRegime` выше confluence и не могут быть ослаблены.
- Что fallback:
  - при `confluenceEntryEngine.enabled=false` или `mode=legacy_fallback` сохраняется старый single-signal flow;
  - при нехватке данных layer возвращает `dataQualityState=degraded` и безопасное `NO_ENTRY`/fallback.
- Как переключается режим:
  - `confluenceEntryEngine.enabled` + `confluenceEntryEngine.mode=confluence`.

### Блоки нового входа
1. `entryPermissionLayer`
   - учитывает `balanceState/capitalRegime` и forecast-риск;
   - может дать `capital_prohibition` до вычисления итогового score.
2. `marketContextLayer`
   - использует результат regime-router;
   - не может разрешить вход при `no_trade` или запрещённом setup.
3. `primarySignalLayer`
   - принимает основной сигнал (в текущей интеграции — адаптер legacy-сигнала),
   - формирует независимый partial score/confidence.
4. `confirmationLayer`
   - учитывает подтверждения и HTF bias (boost/penalty, без sizing/исполнения).
5. `finalEntryDecisionLayer`
   - агрегирует веса/штрафы, интерпретирует veto-контракт,
   - возвращает `FULL_ENTRY | WEAK_ENTRY | NO_ENTRY`.

## Bounce / Rebound Detection Engine (новый сигнальный слой)
- Runtime-позиция: `marketRegimeRouter -> confluenceEntryEngine(... -> bounceDetectionLayer -> finalEntryDecisionLayer)`.
- Зависимости ранних слоёв:
  - `DecisionContext` (`cycleId/ticker/exchange/marketRegime/capitalRegime/setupType`),
  - shared snapshot (`candles`, `orderBook`, готовые индикаторы если есть),
  - `primarySignal.direction/score` как контекст, но не как owner final decision.
- Что делает слой:
  - считает вероятность отскока/локального разворота по наборам признаков:
    - proximity к support/resistance зоне;
    - swing high/swing low контекст;
    - false breakout / liquidity grab;
    - slowdown импульса;
    - exhaustion (RSI/MFI/StochRSI, с деградирующими proxy при нехватке данных);
    - divergence;
    - volume spike + absorption;
    - optional microstructure (imbalance/spread) только после дешёвого gating.
- Что **не** делает слой:
  - не подменяет `marketRegimeRouter`;
  - не открывает сделку напрямую;
  - не снимает hard-risk/capital-veto ограничения.
- Fallback и degraded mode:
  - если `bounceDetection.enabled=false` или `blockWeights.bounceDetection=0`, поведение остаётся прежним;
  - если данных недостаточно или budget исчерпан — слой возвращает `dataQualityState=degraded` и сниженную уверенность, без остановки цикла.
- Конфликт с breakdown-логикой:
  - внутри bounce-слоя конфликт **не** финализируется;
  - конфликтные reason/veto-кандидаты передаются выше в `finalEntryDecisionLayer`.

## Breakdown / Bearish Continuation Engine (новый сигнальный слой)
- Runtime-позиция: `marketRegimeRouter -> confluenceEntryEngine(... -> breakdownDetectionLayer -> finalEntryDecisionLayer)`.
- Зависимости ранних слоёв:
  - `DecisionContext` (`cycleId/ticker/exchange/marketRegime/capitalRegime/setupType`);
  - shared snapshot (`candles`, `orderBook`, готовые признаки из feature-store при наличии);
  - `capitalRegime` как внешний ограничитель через penalties, без права ослабления risk-контуров.
- Что делает слой:
  - оценивает вероятность подтверждённого пробоя вниз и continuation по признакам:
    - proximity к support/breakdown zone;
    - pressure on support;
    - repeated tests уровня;
    - downside momentum expansion;
    - volume spike на breakdown;
    - weak rebound / weak retest снизу;
    - failure to reclaim broken level;
    - optional order book imbalance / ask pressure / weak bid support / spread quality.
- Что **не** делает слой:
  - не разрешает вход самостоятельно и не подменяет `marketRegimeRouter`;
  - не конфликтует напрямую с bounce-слоем (конфликт уходит вверх по chain);
  - не вмешивается в execution ownership path.
- Fallback/degraded mode:
  - при `breakdownDetection.enabled=false` или `blockWeights.breakdownDetection=0` поведение legacy/confluence остаётся прежним;
  - при нехватке данных или budget-limit слой возвращает валидный `degraded` result и reason codes.

### Обратная совместимость
- Старое поведение осталось fallback-режимом и не удалено.
- Новый confluence-режим включается только через config.

## Runtime-позиция supportResistanceEngine / marketLevelEngine (zones layer)
- Место слоя в пайплайне:  
  `hard-risk/portfolioRiskContour -> marketRegimeRouter -> supportResistanceEngine(zones) -> confluenceEntry/finalEntryDecision -> dynamicPositionSizing -> execution`.
- Зависимости ранних слоёв:
  - shared `MarketSnapshot/FeatureSnapshot` свечей (`sharedSnapshot.candles`);
  - `marketRegime` от regime-router;
  - `capitalRegime`/`balanceState` как внешний ограничивающий контекст.
- Что делает слой:
  - определяет `swing high / swing low`;
  - строит **зоны** поддержки/сопротивления (не тонкие линии);
  - считает диапазон `high/low` за `N` баров;
  - определяет `breakout context`, `retest` и `false breakout / liquidity grab`.
- Что не делает слой:
  - не рассчитывает объёмный контекст (VWAP/volume profile);
  - не отправляет ордера и не принимает final entry.
- Кто главный / fallback:
  - primary final decision остаётся за `confluenceEntryEngine.finalEntryDecisionLayer`;
  - если `marketLevel.enabled=false` или данных недостаточно, слой возвращает `fallback/degraded`, а confluence продолжает работу по старой схеме;
  - legacy поведение сохраняется, пока `blockWeights.marketLevel=0`.
- Формат контракта:
  - слой возвращает совместимый block output (`layerName/direction/score/confidence/softPenalty/vetoCandidates/dataQualityState/reasonCodes/explanation`);
  - enrich происходит через `DecisionContext.metadata.marketLevels` без ad-hoc форматов.
- Execution/lifecycle path позиции не изменён.

## VWAP / Volume Profile Context Engine (новый контекстный слой)
- Runtime-позиция: после дешёвых gating-слоёв (`marketRegimeRouter`, `primarySignal`, базовые confirmations) и до `finalEntryDecisionLayer`.
- Зависимости ранних слоёв: `DecisionContext` (`cycleId/ticker/exchange/marketRegime/capitalRegime`), `sharedSnapshot.candles`, `primarySignal.direction/score`, shortlist/budget-флаги.
- Кто главный:
  - `hard-risk`, `capitalRegime`, `veto` и `finalEntryDecisionLayer` остаются выше;
  - `volumeContextLayer` только добавляет отдельный block score и soft-penalty в confluence.
- Что остаётся fallback:
  - при `confluenceEntryEngine.volumeContext.enabled=false` слой отключён;
  - при нехватке данных/бюджета слой возвращает `degraded/cached` результат и не ломает legacy flow.
- Lazy evaluation:
  1. сначала проходят дешёвые фильтры/shortlist;
  2. только для shortlist-кандидатов считается VWAP/profile;
  3. при low-budget используется skip/degraded mode.
- Refresh policy:
  - `refreshPolicy.minBarsBetweenFullRecalc` — минимум баров между полным пересчётом;
  - `refreshPolicy.allowCachedReuse` — повторное использование кэша признаков;
  - `refreshPolicy.forceFullRecalcEveryCycles` — принудительное обновление через N циклов.
- Признаки слоя:
  - VWAP по окну (`vwapWindowBars`),
  - Anchored VWAP от локального якоря,
  - Value Area (low/high),
  - HVN/LVN и положение цены относительно них,
  - дистанция цены до VWAP/Anchored VWAP.
- Важное ограничение: слой не открывает сделки и не отправляет ордера; он только обогащает `DecisionContext.metadata.layerScores.volumeContextLayer`.

## Runtime-позиция confirmationEngine (technical + microstructure confluence)
- Место в пайплайне: `marketRegimeRouter -> confluenceEntry(entryPermission -> marketContext -> primarySignal -> confirmation[technical cheap -> microstructure expensive] -> finalEntryDecision) -> sizing -> execution`.
- Зависимости от более ранних слоёв:
  - `capitalRegime/balanceState` (внешний runtime-контекст, без ослабления ограничений);
  - `primarySignal.direction` (если направления нет, confirmations не могут «создать» вход);
  - `sharedSnapshot.candles` для technical-части;
  - `sharedSnapshot.orderBook` для microstructure-части.
- Fallback/безопасность:
  - при `confluenceEntryEngine.confirmationEngine.enabled=false` действует прежний `confirmationSignals` fallback;
  - при отсутствии стакана или budget-limit microstructure возвращает `missing/degraded`, а цикл продолжается;
  - expensive-stage запускается только после cheap-stage (`costSplit.minCheapScoreForMicro`) и при доступном budget.
- Роль слоя:
  - только усиление/ослабление базовой идеи (`score/confidence/softPenalty`), без final-entry ownership.
