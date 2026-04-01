# Архитектурный контракт торгового бота (после этапа 4)

## 1) Цель и границы

Документ фиксирует целевую модульную архитектуру, чтобы новая функциональность не накапливалась обратно в `index.js` и подключалась через предсказуемый runtime-пайплайн.

- Текущая торговая логика **не меняется** этим этапом.
- Все новые торговые изменения должны включаться через config-флаги.
- Legacy-логика остаётся fallback до миграции каждого отдельного слоя.

## 2) Runtime-позиция слоёв и зависимости (порядок сверху вниз)

1. hard-risk / hard-safety / exchange constraints / unload mode,
2. universe filters,
3. dynamic asset selection,
4. market regime router,
5. confluence + technical confirmations + support/resistance,
6. veto-signals / final entry score,
7. dynamic sizing (только после approved entry),
8. execution engine,
9. server-side TP/SL manager,
10. lifecycle / position management,
11. analytics / journal / observability.

Зависимости более поздних слоёв от ранних обязательны; обход запрещён.

## 3) Единый контракт решений: DecisionContext

`DecisionContext` — единый формат для всех entry-решений и risk-gates.

Обязательные поля:
- `cycleId`, `ticker`, `regime`, `mode`,
- `score` (0..1), `confidence` (0..1),
- `veto` (`hard_veto` / `capital_prohibition` / `no_trade_regime` / `null`),
- `penalties[]` (soft penalties),
- `metadata`.

Запрещено создавать ad-hoc форматы решений вне этого контракта.

## 4) Shared слой данных: MarketSnapshot / FeatureSnapshot / FeatureStore

### MarketSnapshot
Единый snapshot сырых рыночных данных для текущего цикла.

### FeatureSnapshot
Единый snapshot производных признаков (индикаторы, агрегаты, статистики).

### FeatureStore
Общий store/кэш для всех сигнальных слоёв:
- `raw market data cache`,
- `derived indicator cache`,
- `per-cycle feature cache`,
- `slower-refresh context cache`.

Правила:
- сигнальные/контекстные слои читают данные только через shared-слой;
- повторные прямые запросы свечей/стакана/OI/funding из каждого слоя запрещены;
- если признак уже вычислен в текущем cycle context, повторный пересчёт запрещён;
- для тяжёлых слоёв обязательна переиспользуемость shared результатов.

## 5) Staged evaluation pipeline

Обязательная последовательность:
1. shortlist / cheap filters,
2. medium-cost context layers,
3. expensive confirmation layers,
4. final decision.

Для тяжёлых модулей определить режимы:
- `degraded mode` (минимум вычислений при нехватке данных/лимитов),
- `cached mode` (использование кэша с приемлемой давностью),
- `full mode` (полный расчёт).

## 6) Lifecycle ownership path

Все действия, меняющие позиции/ордера/lifecycle, проходят только через единый ownership path:

`risk gate -> execution orchestration -> server TP/SL -> lifecycle manager -> local fallback close`

Иерархия открытых позиций:
1. server stop-loss,
2. forced loss exit / stuck protection,
3. server take-profit,
4. partial close / breakeven / trailing,
5. local polling fallback close,
6. averaging.

## 7) Правило для index.js

`index.js` отвечает только за:
- bootstrap,
- config,
- wiring,
- orchestration.

Запрещено добавлять в `index.js` бизнес-логику сигналов, sizing, risk-decisions, lifecycle-правил.

## 8) Целевая файловая структура

```text
CBT/
  dist/
    index.js
    runtime/
      app/
      bootstrap/
      orchestration/
      config/
      models/
      shared/
      providers/
      connectors/
      signal-engines/
      confluence/
      risk/
      sizing/
      execution/
      server-orders/
      lifecycle/
      analytics/
      ml/
      scheduler/
      cache/
  docs/
    ARCHITECTURE_CONTRACT_RU.md
  scripts/
    architecture/
      check-architecture.js
  tests/
    architecture/
      architecture.smoke.test.js
    regression/
```

## 9) Матрица слоёв: ответственность и импорт-ограничения

| Слой | Ответственность | Разрешено импортировать | Запрещено импортировать | Что добавлять дальше |
|---|---|---|---|---|
| app/bootstrap/orchestration | Поднять runtime, связать зависимости | config, providers, engines | signal/risk детали напрямую из index.js | wiring, запуск циклов |
| config | Нормализация конфигов и флагов режимов | shared types, utils | execution/risk logic | новые config-флаги |
| models/shared | DTO и контракты (`DecisionContext`, snapshots) | базовые утилиты | exchange прямые клиенты | контракты и схемы |
| market data providers | Чтение market/account data | connectors, shared store | confluence/risk business logic | адаптеры источников |
| exchange connectors | API биржи и capability | external clients, mapper | signal/confluence/risk | multi-exchange интеграции |
| signal engines | Базовые сигналы | shared snapshots/features | прямые запросы в exchange | технические сигналы |
| confluence/entry | Финальная конвергенция входа | signal outputs, regime, veto | execution side-effects | final score/confidence |
| risk engines | hard veto и ограничения капитала | positions, config, context | открытие/закрытие ордеров | risk rules |
| sizing | Размер позиции после approve | risk+entry result | raw exchange actions | dynamic sizing |
| execution | Постановка ордеров | connectors, sizing task | signal calculations | order routing |
| server TP/SL | Серверные защитные ордера | execution/lifecycle state | entry signals | tp/sl policy |
| lifecycle | Состояния позиции и ownership path | execution/server-order events | new entries bypass risk | trailing/partial/be |
| analytics/storage | Журнал и наблюдаемость | runtime events | торговые решения | trade journal |
| ml dataset/training/inference/meta | ML контур и мета-контроль | shared features, analytics | прямой execution bypass | inference/meta-controller |
| scheduler/cache/performance | Частоты, кэши, лимиты | shared store, config | бизнес-решения входа | refresh policy/governor |

## 10) Таблица соответствия будущих шагов плана

## Таблица соответствия будущих шагов

| Шаг плана / Функциональность | Целевой модуль | Целевая директория/файл | Владелец логики | Runtime-слой подключения | Fallback/совместимость | Raw data | Derived features | Lazy eval | Обновление реже цикла |
|---|---|---|---|---|---|---|---|---|---|
| Dynamic asset selection | selection engine | `dist/runtime/signal-engines/assetSelection.*` | Signal team | после universe filters | legacy defined tickers | Да | Да | Да | Нет |
| Market regime router | regime router | `dist/runtime/confluence/marketRegimeRouter.*` | Confluence team | перед confluence score | no-trade regime fallback | Да | Да | Да | Да |
| Confluence entry | confluence engine | `dist/runtime/confluence/entryConfluence.*` | Confluence team | перед sizing | legacy predict fallback | Нет | Да | Да | Нет |
| Support/resistance zones | sr engine | `dist/runtime/signal-engines/supportResistance.*` | Signal team | medium-cost stage | сигналы отключены флагом | Да | Да | Да | Да |
| Technical confirmations | confirmation engine | `dist/runtime/signal-engines/technicalConfirmations.*` | Signal team | expensive stage | weak-entry fallback | Да | Да | Да | Нет |
| Veto signals/final score | veto/final scorer | `dist/runtime/confluence/finalScore.*` | Risk+Confluence | final decision | legacy hard checks | Нет | Да | Нет | Нет |
| Dynamic sizing | sizing engine | `dist/runtime/sizing/dynamicSizing.*` | Risk/Sizing | после approved entry | fixed margin fallback | Нет | Да | Нет | Нет |
| Lifecycle позиции | lifecycle manager | `dist/runtime/lifecycle/*` | Lifecycle team | после execution | local polling close | Нет | Да | Нет | Нет |
| Paper/Shadow mode | runtime mode router | `dist/runtime/app/modeRouter.*` | Platform team | orchestration level | live mode fallback | Нет | Да | Нет | Нет |
| ML dataset | dataset builder | `dist/runtime/ml/dataset/*` | ML team | analytics/storage tap | disabled by config | Да | Да | Да | Да |
| ML inference | inference adapter | `dist/runtime/ml/inference/*` | ML team | medium/expensive stages | confluence-only fallback | Нет | Да | Да | Да |
| ML meta-controller | meta controller | `dist/runtime/ml/metaController/*` | ML+Risk | перед final decision | manual policy fallback | Нет | Да | Да | Да |
| Multi-exchange support | connectors registry | `dist/runtime/connectors/*` | Exchange team | providers layer | single-exchange fallback | Да | Нет | Нет | Нет |
| Analytics/Journal/Observability | analytics pipeline | `dist/runtime/analytics/*` | Analytics team | post-decision lifecycle tap | log-only fallback | Нет | Да | Нет | Да |
| Scheduler/Performance governor | refresh scheduler | `dist/runtime/scheduler/*` | Platform team | до staged pipeline | default interval fallback | Да | Да | Да | Да |

## 11) Как добавлять новую функциональность после этапа 4

1. Определить слой-владельца из матрицы выше.
2. Добавить config-флаг включения (новое поведение выключено по умолчанию).
3. Подключить слой в runtime в своей позиции пайплайна, не через `index.js` бизнес-код.
4. Использовать только shared `MarketSnapshot/FeatureSnapshot/FeatureStore`.
5. Возвращать `DecisionContext` либо совместимый score/veto контракт.
6. Обновить архитектурную таблицу соответствия.
7. Добавить/обновить архитектурный smoke-test и регрессионные тесты.

## 12) Технические защитные механизмы

В проект добавлены:
- архитектурный smoke-test: `tests/architecture/architecture.smoke.test.js`,
- скрипт проверки архитектуры: `scripts/architecture/check-architecture.js`,
- проверка обязательных секций архитектурного документа,
- проверка запрета импорта `dist/index.js` из runtime-модулей,
- size-limit для `dist/index.js` как технический стоп-контроль роста bootstrap-файла.

