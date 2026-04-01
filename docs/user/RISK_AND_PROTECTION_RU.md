# Защитные механизмы и риск-контур

## Главный принцип
Защитные механизмы всегда выше сигналов входа. Если защита сработала, вход/действие блокируется независимо от «красивого» сигнала.

## Основные защитные механизмы
- Проверки ограничений биржи и допустимости ордера.
- Контроль капитала/маржи перед входом.
- Hard-veto на опасные сценарии.
- Защита сопровождения открытой позиции:
  - server stop-loss,
  - forced exit,
  - take-profit,
  - trailing / partial close / breakeven,
  - локальный fallback-close при недоступности серверных сигналов.

## TP / SL / Forced Exit / Trailing
- **Stop-loss**: первичный серверный защитный контур при движении против позиции.
- **Take-profit**: серверная фиксация прибыли по целевым условиям.
- **Forced exit**: аварийное закрытие при критическом риске/застревании.
- **Trailing**: динамическая защита накопленной прибыли при движении цены в нужную сторону.

## Что важно оператору
- Не отключайте hard-risk и server SL без обязательной причины.
- Forced exit — аварийный механизм, не заменяет базовую risk-настройку.
- При сомнениях снижайте агрессию входа и размер позиции, а не ослабляйте защиту.

## Server Stop-Loss для BingX (whole-position v1)
- Главный защитный слой по убытку: server stop-loss на бирже.
- Secondary fallback: forcedLossExit/local polling close.
- Ownership path: только `serverStopLossManager` управляет созданием/обновлением/удалением server SL.
- Для partial/averaging изменений позиции используется пересоздание SL через manager.
- В `capitalRegime` (DEFENSIVE/HALT_NEW_ENTRIES) можно включить более жёсткий SL через `conservativeMode`.

## ForcedLossExit / StuckPositionProtection (конфигурируемый слой)
- Слой активируется только через `forcedLossExit.enabled`.
- Позиция считается затянувшейся/опасной, если выполнено хотя бы одно условие: лимит времени в минусе, лимит времени после усреднения, лимит убытка по позиции, лимит числа усреднений.
- Дополнительный gate: `requireAdverseMarketConfirmation` (подтверждение неблагоприятного рынка).
- Реакция (`actionMode`): `warn`, `block_averaging`, `partial_reduce`, `force_close`.
- Все действия по позиции идут через ownership path execution/lifecycle; forcedLossExit не управляет TP/SL напрямую.
- Влияние `capitalRegime` и forecast-stress на ужесточение порогов возможно только через явный config (`regimeTightening`, `forecastInfluence`).

## Portfolio risk contour (уровень счёта)
- Это верхний hard-risk слой для **новых входов**, работающий до всех signal/entry модулей.
- Слой вычисляет `balanceState/capitalRegime` и транслирует его вниз по цепочке: entryPermissionLayer, marketRegimeRouter, dynamicAssetSelection, dynamicPositionSizing.
- Поддерживаемые режимы: `NORMAL`, `CAUTION`, `DEFENSIVE`, `CAPITAL_PRESERVATION`, `HALT_NEW_ENTRIES`.
- Переходы между режимами логируются и попадают в structured event `portfolio_risk_contour_decision`.
- Ни один forecast-based слой не может ослабить решения risk contour; допускается только дополнительное ужесточение или предупреждение.

### Ограничения, которые контролируются слоем
1. Дневной лимит убытка (блок новых входов).
2. Лимит новых входов за день.
3. Лимит одновременно открытых позиций.
4. Лимит суммарной используемой маржи.
5. Пауза (cooldown) после серии плохих циклов или убыточных закрытий.


## Portfolio balance forecast / capital stress forecast engine
- Это дополнительный forward-looking слой, который дополняет current-state `portfolioRiskContour` и `capitalRegimeEngine`, но не заменяет их.
- Сценарии прогноза: `baseline_stabilization`, `adverse_margin_expansion`, `severe_drawdown_spike`.
- Для каждого сценария рассчитываются:
  - `expectedFreeBalancePressure`,
  - `expectedMarginPressure`,
  - `expectedDrawdownPressure`,
  - `probabilityOfRegimeDeterioration`,
  - `portfolioFragilityScore`.
- Выходы: `restrictionHints`, `protectiveTighteningHints`, `sizingHints`, `forecastSignals`, `vetoCandidates` (только как hints по контракту).
- Если данных недостаточно, слой помечает `dataQualityState=degraded/insufficient`, снижает `confidence` и не выдаёт ложную уверенность.
