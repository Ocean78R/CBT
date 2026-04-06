# Запуск и режимы работы

## Назначение раздела
Раздел описывает порядок запуска бота и режимы работы в терминах оператора.

## Как запускать бота
Базовые команды проекта:
- `npm run test:architecture` — проверка архитектурных и документарных контрактов.
- `npm run test:regression` — регрессионный контур торговой логики.
- `npm test` — полный набор проверок перед запуском/поставкой.

Для рабочего запуска используйте штатный сценарий окружения (`run_dist.sh`) и актуальный конфиг `dist/_config/config.json`.

## Режимы работы
### 1) Базовый (fallback) торговый режим
- Используется существующая торговая логика стратегии.
- Новые слои, которые ещё не переведены в «главные», работают как безопасные hooks/наблюдение.

### 2) Режим повышенной наблюдаемости
- Включается структурированное runtime-логирование через блок `logger.runtime` в конфиге.
- Торговые решения не меняются, повышается детальность диагностики.

### 3) Режим проверки перед релизом
- Обязателен прогон архитектурных и регрессионных тестов.
- Дополнительно проверяется политика обновления документации.

## Безопасный порядок запуска
1. Проверить конфиг и лимиты риска.
2. Запустить тесты (`npm test`).
3. Запустить бота с мониторингом логов на первом цикле.
4. Убедиться, что нет критических veto/ошибок коннектора.

### 4) Paper/Shadow режим (без реальных ордеров)
- Включается через `paperTrading.enabled=true`.
- Отличие от live только на execution-слое: сигналы, risk-контуры, capitalRegime/balanceState и forecast-слои остаются теми же.
- Реальные ордера не отправляются: вместо этого выполняется виртуальный lifecycle (open/average/close).
- Для сравнимости с live поддерживается тот же DecisionContext и общий runtime-пайплайн до execution ownership path.

### 5) Safe Canary Live (первый запуск с реальными деньгами)
Используйте preset `safeStartupPresets.liveCanaryV1` из `dist/_config/config.json` как стартовую точку.
Для запуска с time-limit используйте `npm run run:safe-canary` (обёртка с `timeout`, по умолчанию 20 минут; override: `CBT_CANARY_MAX_RUNTIME_MINUTES`).

Рекомендуемый профиль:
1. Оставить только 1–2 тикера (`allowedTickers`, `maxTickers=2`).
2. Выставить минимальный размер позиции (`minPositionMarginSize`, плюс минимальный `singleSetts.marginSize`).
3. Отключить weak entry (`decision.disableWeakEntry=true`).
4. Отключить averaging (`execution.disableAveraging=true` и `singleSetts.averagingProtection.enabled=true`).
5. Зафиксировать максимально защитный capital regime (`risk.forceCapitalRegime=CAPITAL_PRESERVATION`).
6. Включить полный decision trace (`observability.fullDecisionTrace=true`, `logger.runtime.enabled=true`, sampling=100%).
7. Включить авто-остановку:
   - после первого завершённого цикла (`stopAfterCompletedCycles=1`, плюс `loopsLength=1`),
   - либо по времени (`maxRuntimeMinutes`, запуск через `timeout`).

### Предзапусковый checklist для live
Перед первым live-стартом все пункты должны быть `true` в `preLiveChecklist`:
- `configSanity`,
- `modelAvailability`,
- `exchangeCapabilityChecks`,
- `protectiveManagersReady`,
- `paperModeLastPassCompleted`,
- `restartSafetyConfirmed`.
