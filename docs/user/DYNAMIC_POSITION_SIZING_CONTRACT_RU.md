# Dynamic Position Sizing (шаг 36, подэтап 1)

## Назначение

`dynamicPositionSizing` — отдельный exchange-agnostic модуль базового расчёта размера позиции после `finalEntryDecisionEngine`.

Ключевые ограничения ownership:
- не пересчитывает market data и block scores;
- не является final decision owner;
- не разрешает вход без approved entry;
- не является execution/lifecycle owner.

## Входной контракт (v1)

Минимальные поля входа:
- `approvedEntryResult` — результат шага 35 (`finalEntryDecisionEngine`), включая `decisionMode`/`entryScore`;
- `decisionMode` (`full_entry | weak_entry | no_entry`) — допускается явно или из `approvedEntryResult`;
- `entryScore`/`confidence` — если уже доступны;
- `balanceState`/`capitalRegime` как внешний runtime context;
- `tickerRisk` (`riskScore` или `coinRiskScore`) — если уже есть в runtime;
- `metadata`/`dataQualityState`/`sizingDataQualityState` — состояние качества данных;
- `runtimeGuards` (`hardRiskBlocked`, `capitalProhibition`, `allowNewEntries`, `unloadMode`) — верхнеуровневые ограничения.

## Выходной контракт (v1)

- `sizeMultiplier`;
- `targetMarginSize`;
- `leverageCap`;
- `aggressivenessMode`;
- `sizingReasonCodes`;
- `sizingDataQualityState`;
- `mode` (`dynamic_base_formula | fixed_fallback | no_entry`) и `contractVersion`.

Дополнительно возвращаются `explanation.ownership` и `explanation.downstreamHints` для интеграции со следующими шагами 37–40.

## Текущая базовая логика

- `no_entry` или отсутствие approved entry => `sizeMultiplier=0`;
- `weak_entry` получает сниженный профиль по умолчанию;
- чем выше риск тикера (`riskScore`), тем ниже multiplier и cap по плечу;
- чем жёстче `capitalRegime`/`balanceState`, тем ниже размер и aggressiveness;
- при `drawdownProtection` вводится дополнительное снижение;
- при плохом качестве данных (`cached/degraded/missing`) накладывается penalty;
- при выключенном dynamic sizing или недостаточном runtime context используется `fixed_fallback`.

## Что осознанно оставлено на следующий подэтап

- Полная интеграция forecast/ML/meta-controller modifiers;
- Расширенная адаптация профиля по биржевым ограничениям;
- Полный runtime wiring с execution/lifecycle веткой.
