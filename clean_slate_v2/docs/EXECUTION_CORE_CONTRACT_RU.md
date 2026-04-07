# Контракт execution core (clean-slate v2)

## Что добавлено

Новый execution owner-path в `src/execution_core/`:

- `entryExecutionOwner` — принимает только approved entry + sizing результат и ставит действие в новую очередь;
- `closeExecutionOwner` — ставит закрытие позиции в новую очередь;
- `orderQueue` — последовательное исполнение без хаотичного параллелизма;
- `retryPolicy` — bounded retry;
- `actionDedup` — защита от дублей входа/закрытия;
- `reconciliation` — синхронизация позиций/ордеров и recovery только для `ownerTag=clean_slate_v2`;
- `executionJournal` — audit trace для execution;
- `executionOwnerPath` — единая owner-точка исполнения.

## Жёсткие гарантии

- Новая ветка execution **не использует** legacy ownership runtime-path.
- `approved entry + sizing` попадают только в новый execution owner-layer.
- Сопровождение/закрытие позиций не передаётся в legacy position processing chain.
- Reconciliation v1 не требует поддержки legacy-tail как обязательного поведения.

## Execution journal

Журнал фиксирует события:

- `entry_request`
- `execution_queued`
- `order_submit`
- `retry`
- `fill`
- `reconciliation_result`
- `close_request`
- `blocked_action_reason`
