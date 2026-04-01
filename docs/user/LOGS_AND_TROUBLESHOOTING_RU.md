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
