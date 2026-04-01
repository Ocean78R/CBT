# CBT

## Обновление устойчивости обработки тикеров (BingX)

В проект добавлены защитные проверки от `undefined/null` и отсутствующих ключей в ответах биржи, чтобы цикл обработки тикеров не падал на ошибках вида `Cannot read properties of undefined`.

### Что изменено
- Добавлены безопасные проверки в коннекторе BingX для:
  - баланса,
  - плеча и margin mode,
  - тикера и mark price,
  - списка позиций и свечей.
- Добавлен fallback на пустые массивы для позиций/свечей при некорректном ответе API.
- Добавлена защита от запуска `processSingleTicker` с пустым тикером при выборе random-ticker.
- Ошибки не замаскированы: причины продолжают логироваться через существующие логгеры/статистику.

### Runtime-позиция исправлений
- Слой проверок стоит на границе `exchange connector -> strategy loop`.
- Это ранний защитный слой перед entry/averaging/close логикой.
- Старое торговое поведение сохранено как fallback: если данные корректны, логика открытия/усреднения/закрытия работает по прежнему сценарию.

---

## Расширенное журналирование торгового цикла (структурированные события)

В проект добавлен централизованный слой **структурированных runtime-событий** для диагностики торговых решений без изменения архитектурной торговой логики.

### Что добавлено
- Единый формат событий с полями корреляции:
  - `cycleId`,
  - `ticker`,
  - `positionId` (если есть активная позиция),
  - `orderId` / `exchangeOrderId` (если доступны из ответа биржи),
  - `strategyMode`, `regime`, `entryMode`.
- Категории событий:
  - `system`,
  - `market_data`,
  - `signal`,
  - `entry_decision`,
  - `risk_decision`,
  - `sizing`,
  - `execution`,
  - `position_lifecycle`,
  - `protection`,
  - `analytics`,
  - `ml` (зарезервировано под будущие слои),
  - `config/runtime`.
- Детальные события по текущим этапам:
  - вход в новую позицию,
  - пропуск входа,
  - усреднение,
  - запрет усреднения,
  - закрытие позиции,
  - qualityControl-hook (без изменения торгового поведения, как безопасный fallback-слой).
- Сводка по циклу:
  - по тикерам,
  - по решениям,
  - по ключевым veto/отказам,
  - по execution-событиям.

### Runtime-позиция слоя и зависимости
- **Позиция в пайплайне:** поверх существующих точек принятия решений в `SingleStrategy`:
  - `processOneLoop` → `processSingleTicker` → `openNewPosition` / `processExistingPosition` → `averagePosition` / `closePosition`.
- **Зависимости от более ранних слоёв:**
  - connector market-data (цены/позиции/плечо),
  - текущие risk-gate проверки,
  - existing entry/averaging/close flow.
- **Fallback-поведение:**
  - торговая логика не изменена;
  - если структурированный лог выключен, остаются обычные текстовые логи;
  - для ещё не реализованных слоёв (forcedLossExit, server TP/SL, ML и т.д.) добавлены совместимые поля и категории без изменения исполнения.

### Конфигурация
В `dist/_config/config.json` добавлен блок:

```json
"logger": {
  "useFile": false,
  "runtime": {
    "enabled": true,
    "emitCycleSummary": true
  }
}
```

- `enabled` — включает/выключает структурированные runtime-события.
- `emitCycleSummary` — включает/выключает итоговую сводку по циклу.

---

## Минимальный регрессионный тестовый контур

Добавлен минимальный, но практичный контур регрессионных тестов для критичных сценариев торгового цикла.

### Место слоя в runtime-пайплайне
- Позиция слоя: **вне runtime execution**, как pre-merge/CI контур проверки стабильности.
- Точка проверки: сценарии вокруг `SingleStrategy.processSingleTicker` и `PricePredictor.predict`.
- Влияние на прод-исполнение: отсутствует, кроме безопасного тестового hook `CBT_SKIP_AUTOSTART=1` для отключения автозапуска при импортировании `dist/index.js` в тестах.

### Зависимости от более ранних слоёв
- exchange connector API (получение баланса, позиций, цены, свечей, ордеров),
- predict layer (`PricePredictor`),
- decision layer `SingleStrategy` (entry/averaging/close).

Если реальный connector или внешние API недоступны, используется детерминированный mock connector (fallback), чтобы тесты не зависели от сети и случайности.

### Что покрыто
- обработка нового тикера без падения,
- сценарии: нет позиции / одна позиция / несколько позиций,
- запрет входа при недостаточном балансе,
- корректная работа predict logic (`byBarsPercents`),
- корректная работа speedFilter в текущем fallback-режиме (как config-hook, без блокировки входа),
- корректная работа averagingProtection в текущем fallback-режиме (как config-hook, без блокировки валидного усреднения),
- qualityControl enabled в текущем fallback-режиме (тикер не отключается),
- базовый flow открытия и закрытия позиции.

### Запуск
```bash
npm run test:regression
```

### Ограничения текущего покрытия
- Не покрыты интеграционные сценарии реальных биржевых ошибок сети/таймаутов.
- Не покрыты серверные lifecycle-слои TP/SL и forced-loss protections.
- speedFilter/averagingProtection/qualityControl в текущей кодовой базе выступают как hook/fallback-поля конфигурации и журналирования; отдельная торговая блокирующая логика для них пока не реализована.

---

## Поэтапный реинжиниринг `index.js` в модульную структуру (без изменения торговой логики)

### Что сделано

Выполнен безопасный этап реинжиниринга runtime-структуры с сохранением полного fallback-поведения текущего торгового цикла.

Введены отдельные слои:
- **модели данных** (`TickerContext`, `PositionState`, `SignalDecision`, `RiskDecision`, `ExecutionTask`, `TradeResult`, `MarketSnapshot`),
- **движки** (`signalEngine`, `riskEngine`, `positionEngine`, `executionEngine`, `analyticsEngine`),
- **поставщики данных** (`marketDataProvider`, `accountDataProvider`, `positionProvider`, `exchangeCapabilitiesProvider`),
- **валидатор runtime-конфига** (merge global+exchange, нормализация числовых полей).

### Runtime-позиция нового слоя

Порядок вызова в пайплайне:
1. `runtimeConfigValidator` (инициализация `Launcher`),
2. `providers` (доступ к данным биржи/аккаунта/позиций),
3. `engines` (маршрутизация сигналов/риска/позиции/исполнения),
4. orchestration в `SingleStrategy` и `Launcher`.

### Зависимости от более ранних слоёв

Новые слои зависят от:
- существующих connector-методов (`getTickerInfo`, `getBalance`, `getLeverage`, `getMarginMode`, `getFuturesPositionsForTicker`, `updateTickerLeverage` и др.),
- текущих risk/entry/averaging/close методов `SingleStrategy`.

Если зависимость отсутствует или даёт нестабильный ответ, сохраняется безопасный fallback:
- пустые массивы для позиций,
- прежние проверки `hard_veto/capital_prohibition/no_trade_regime`,
- выполнение legacy-методов движков через адаптеры.

### Кто главный и что fallback

- **Главный orchestration слой**: `Launcher` + `SingleStrategy` (как и раньше).
- **Главные точки принятия решений**: текущие legacy-методы стратегии (`open/processExisting/average/close/predict`) через engine-адаптеры.
- **Fallback-режим**: legacy-логика остаётся источником торговых решений; новые модули выступают безопасной прослойкой и не меняют сигналы, risk-rules и execution flow.

Переключение режима на новую реализацию не включалось отдельным флагом, чтобы не менять торговое поведение в этом этапе.

---

## Архитектурный контракт после этапа реинжиниринга

Для закрепления модульной структуры и правил подключения новых слоёв добавлен отдельный документ:

- `docs/ARCHITECTURE_CONTRACT_RU.md`

Что зафиксировано:
- целевая файловая структура,
- правила импортов между слоями,
- единый контракт `DecisionContext (score/confidence/veto)`,
- shared слой `MarketSnapshot / FeatureSnapshot / FeatureStore`,
- staged evaluation pipeline,
- lifecycle ownership path,
- таблица соответствия будущих шагов плана модулям,
- запрет на разрастание бизнес-логики в `index.js`.

Автоматическая проверка архитектуры:

```bash
node --test tests/architecture/architecture.smoke.test.js
```

