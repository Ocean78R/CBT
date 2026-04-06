# Audit decision stack (шаги 23-35) — после полной реализации сигналов и контекстных слоёв

Дата: 2026-04-06.

## Scope
Проверены слои:
- 23 dynamic asset selection
- 24 market regime router
- 25 higher timeframe bias
- 27 zones / support-resistance
- 28 VWAP / volume profile
- 29 bounce detection
- 30 breakdown / bearish continuation
- 31 derivatives context
- 32 confirmations
- 33 time/session filter
- 34 shock veto
- 35 finalEntryDecisionEngine

## Контракт по слоям

### 23) dynamic asset selection
- Роль: runtime-shortlist только для новых входов внутри allowedUniverse/safeEntry scope.
- Входы: allowedUniverse, safeEntryAssets, capitalRegime/balanceState, snapshot/liquidity/journal.
- Выходы: dynamicShortlist + explanation (без execution side-effects).
- Не должен: расширять allowedUniverse, обходить unload/safeEntry gates.

### 24) market regime router
- Роль: owner контекста marketRegime + allowedSetups/no-trade semantics.
- Входы: regime признаки рынка + upstream risk-context.
- Выходы: marketRegime, allowedSetups, no-trade/veto hints, score/confidence.
- Не должен: исполнять вход, пересчитывать HTF структуру, override capital hard restrictions.

### 25) higher timeframe bias
- Роль: directional HTF context/penalty layer (quality context), не owner режима.
- Входы: HTF candles/structure + local direction.
- Выходы: htfBias, structure state, softPenalty/boost, reasonCodes.
- Не должен: менять allowedSetups/no-trade regime-router ownership.

### 27) zones / support-resistance
- Роль: уровень/зона контекст (proximity/retest/false-breakout).
- Входы: candles, swing/range params.
- Выходы: zone-context score/confidence/penalty + explanation.
- Не должен: заменять volume context или финально разрешать вход.

### 28) VWAP / volume profile
- Роль: volume-context усилитель (VWAP/value area/HVN-LVN).
- Входы: candles+volume, shortlist/primaryDirection/budget cache policy.
- Выходы: volumeContextLayer score/confidence/penalty + diagnostics.
- Не должен: подменять zones ownership или открывать позицию.

### 29) bounce detection
- Роль: bullish/mean-reversion hypothesis detector.
- Входы: candles + regime allowlist + primary direction + optional microstructure.
- Выходы: setup tags/score/confidence/penalty/veto hints.
- Не должен: единолично открывать вход или конфликтно усиливать противоположную primary hypothesis без arbitration.

### 30) breakdown / bearish continuation
- Роль: downside continuation hypothesis detector.
- Входы: candles/support pressure/reclaim failure + regime allowlist + optional microstructure.
- Выходы: setup tags/score/confidence/penalty/veto hints.
- Не должен: единолично блокировать/открывать вход вне final interpreter.

### 31) derivatives context
- Роль: crowding/funding/OI/liquidation context modifier (advisory/penalty).
- Входы: derivatives snapshot (shared/cache/input), direction, capitalRegime.
- Выходы: score/confidence/softPenalty (+ optional no-trade veto on extreme crowding).
- Не должен: заменять technical confirmations или исполнять сделки.

### 32) confirmations
- Роль: technical+microstructure confirmation quality layer.
- Входы: candles, order book, direction, HTF context, budget.
- Выходы: confirmation score/confidence/penalties + signal approvals.
- Не должен: быть final veto owner или дублировать derivatives ownership.

### 33) time/session filter
- Роль: time-based context/restriction provider.
- Входы: timestamp/timezone windows + capital regime influence.
- Выходы: timeContextScore/sessionState/time-based veto candidates.
- Не должен: обходить final decision ownership.

### 34) shock veto
- Роль: event risk analyzer (ATR/spread/chaos/event movement) + shock veto candidates.
- Входы: candles/spread/orderbook + capital regime multiplier.
- Выходы: shockRiskScore/eventRiskState/softPenalty/hard veto hints.
- Не должен: напрямую переводить execution в skip, только предоставить veto contract.

### 35) finalEntryDecisionEngine
- Роль: единственный интерпретатор final veto/new-entry decision.
- Входы: block outputs (scores/penalties/veto candidates) + capital/forecast/ml hooks.
- Выходы: финальный decision mode (full/weak/no), vetoSummary, explanation.
- Не должен: пересчитывать market data / signal generators.

## Проверка конфликтов

1. **Double counting**
   - Проверен overlap между directional hypotheses (bounce и breakdown).
   - Добавлен arbitration penalty в final layer confluence, чтобы убрать хаотичное двойное усиление противоположных setup-гипотез.

2. **Bounce vs Breakdown**
   - Подтверждена потенциальная конкуренция (одновременные high-score opposite hypotheses).
   - Добавлен explicit conflict resolver (`resolveCompetingHypotheses`) и reasonCodes `competing_hypotheses_detected:*`.

3. **24 vs 25 (regime router vs HTF bias)**
   - Ownership разделён: regime-router остаётся strict owner `allowedSetups/no-trade`, HTF влияет только через confirmation penalties/boost.

4. **31 vs 32 (derivatives vs confirmations)**
   - Верифицировано, что оба слоя дают soft context; hard veto эскалируется только через final layer.

5. **33/34 vs 35 (bypass final interpreter)**
   - Верифицировано, что session/eventRisk формируют только veto candidates.
   - Final veto ownership остаётся за `finalEntryDecisionLayer`.

## Изменения по коду
- Добавлен минимальный и безопасный arbitration в `confluenceEntryEngine`:
  - penalize opposing high-confidence hypotheses;
  - telemetry/reason-codes в финальном слое;
  - без пересборки всего stack и без изменения ownership других слоёв.

## Добавленные regression/contract tests
- competing hypotheses arbitration (bounce vs breakdown).
- non-duplication ownership for regime router vs HTF bias.
- simultaneous derivatives + confirmations without hard-veto takeover.
- session + shock veto do not bypass final interpreter ownership.

## Как теперь разрешается конфликт competing hypotheses
- Если bounce и breakdown одновременно сильные и противоположные:
  - final layer фиксирует conflict,
  - применяет arbitration penalty,
  - публикует winner/loser и reasonCodes в `finalEntryDecisionLayer.explanation.hypothesisResolution`,
  - final decision остаётся централизованным (single interpreter).
