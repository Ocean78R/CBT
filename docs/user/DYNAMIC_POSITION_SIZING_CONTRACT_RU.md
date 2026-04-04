# Dynamic Position Sizing (шаг 36, подэтап 2)

## Назначение

`dynamicPositionSizing` — отдельный exchange-agnostic модуль базового расчёта размера позиции после `finalEntryDecisionEngine`.

Ключевые ограничения ownership:
- не пересчитывает market data и block scores;
- не является final decision owner;
- не разрешает вход без approved entry;
- не является execution/lifecycle owner.

## Входной контракт (v1, production-like integration)

Минимальные поля входа:
- `approvedEntryResult` — результат шага 35 (`finalEntryDecisionEngine`), включая `decisionMode`/`entryScore`;
- `decisionMode` (`full_entry | weak_entry | no_entry`) — допускается явно или из `approvedEntryResult`;
- `entryScore`/`confidence` — если уже доступны;
- `balanceState`/`capitalRegime` как внешний runtime context;
- `tickerRisk` (`riskScore` или `coinRiskScore`) — если уже есть в runtime;
- `metadata`/`dataQualityState`/`sizingDataQualityState` — состояние качества данных;
- `runtimeGuards` (`hardRiskBlocked`, `capitalProhibition`, `allowNewEntries`, `unloadMode`) — верхнеуровневые ограничения.
- `forecastSizing`/`portfolioRisk.outputHints.sizingHints` — forecast hints (только как входные ограничения, не ownership);
- `context.mode` (`live|paper|shadow`) — runtime режим для логирования/audit.

## Выходной контракт (v1)

- `sizeMultiplier`;
- `targetMarginSize`;
- `leverageCap`;
- `aggressivenessMode`;
- `sizingReasonCodes`;
- `sizingDataQualityState`;
- `mode` (`dynamic_base_formula | fixed_fallback | no_entry`) и `contractVersion`.

Дополнительно возвращаются `explanation.ownership` и `explanation.downstreamHints` для интеграции со следующими шагами 37–40.
Для audit trail добавляется `explanation.structured`:
- `approvedEntryDecisionMode`;
- `baseSizingResult`;
- `capitalRegimeAdjustment`;
- `forecastSizingAdjustment`;
- `finalSizeMultiplier`/`finalLeverageCap`;
- `sizingReasonCodes`.

## Текущая базовая логика

- `no_entry` или отсутствие approved entry => `sizeMultiplier=0`;
- `weak_entry` получает сниженный профиль по умолчанию;
- чем выше риск тикера (`riskScore`), тем ниже multiplier и cap по плечу;
- чем жёстче `capitalRegime`/`balanceState`, тем ниже размер и aggressiveness;
- `CAUTION/DEFENSIVE/CAPITAL_PRESERVATION` дополнительно уменьшают `sizeMultiplier`, ограничивают `leverageCap` и могут запретить full-size профиль;
- `HALT_NEW_ENTRIES/PROHIBIT_NEW_ENTRIES` не допускают sizing для новых входов (нулевой результат);
- при `drawdownProtection` вводится дополнительное снижение;
- при плохом качестве данных (`cached/degraded/missing`) накладывается penalty;
- forecast hooks могут только дополнительно ужесточать sizing (aggression caps / exposure reduction / conservative cap), но не разрешать вход;
- при выключенном dynamic sizing или недостаточном runtime context используется `fixed_fallback`.

## Совместимость с future ML
- ML phase 1: доступен hook-индикатор для confidence-based модификатора (`mlPhase1SizingConfidenceModifierHookEnabled`);
- ML phase 2: доступен bounded-adjust контракт (`mlPhase2SizingBoundedAdjustmentHookEnabled` + лимиты);
- ownership sizing остаётся у `dynamicPositionSizing`, ML не переводится в owner.

## Ограничения, которые остаются
- Расчёт сохраняет rule-based основу и не включает ML-регрессию/обучение внутри sizing;
- Exchange-specific ограничения (детальные per-symbol фильтры) остаются в downstream execution/adapter слоях;
- Любые hard-risk / unload / capital prohibition / portfolio contour ограничения по-прежнему выше sizing-логики и не ослабляются.
