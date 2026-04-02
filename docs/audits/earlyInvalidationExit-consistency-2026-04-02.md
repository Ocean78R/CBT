# Аудит согласованности after earlyInvalidationExit (2026-04-02)

## Scope
Проверка согласованности между:
- server stop-loss,
- earlyInvalidationExit,
- forcedLossExit,
- averaging,
- lifecycle ownership path.

## Что согласовано

1. **Позиционирование раннего слоя в иерархии защиты**
   - В risk-слое явно зафиксировано, что post-entry observation/early invalidation живёт между server SL и legacy forced/stuck fallback.
   - В engine-адаптере явно закреплено: `forcedLossExit` расположен после server SL и до averaging, а действие отдаётся через ownership path.

2. **Ранний и поздний слой не смешаны в одной ветке исполнения**
   - Если `earlyInvalidation` triggered, legacy forced-loss ветка больше не вычисляется (`legacyForcedLossEvaluated=false`, `triggerStage=early_invalidation_exit`).
   - Если ранний trigger не сработал, выполняется legacy fallback с `triggerStage=forced_loss_exit_fallback`.

3. **forcedLossExit остаётся fallback по отношению к раннему слою**
   - Поведение подтверждено и кодом, и регрессионным тестом о недостаточных данных тренда (ранний слой не триггерит, fallback остаётся активным).

4. **capitalRegime влияет на раннюю invalidation-логику**
   - Пороги раннего окна ужесточаются через `regimeTightening.byCapitalRegime` с выбором более строгих лимитов.
   - Это покрыто тестом для режима `CAPITAL_PRESERVATION`, где ранний trigger срабатывает на более строгих параметрах.

5. **Averaging согласован с protective-решением**
   - При trigger для раннего (`partial_reduce|force_close`) и позднего (`block_averaging|partial_reduce|force_close`) режима выставляется `shouldBlockAveraging`.
   - Это предотвращает конфликт «защитный выход + параллельное усреднение».

6. **Lifecycle ownership path сохранён**
   - Защитные действия не исполняются напрямую в risk-слое, а формируются как `ownershipAction` с `ownerPath=execution_lifecycle_manager`.
   - Это соответствует архитектурному контракту ownership цепочки.

7. **Dynamic asset selection не затронут побочно**
   - В портфельном risk-контуре `capitalRegime` пробрасывается в downstream-контекст, включая `dynamicAssetSelection`.
   - Регрессия проверяет, что `dynamicAssetSelection.capitalRegime` синхронен с итоговым режимом и не смешивается с forecast полями.

## Ограничения и текущие риски

1. **serverStopLoss на текущем срезе подтверждён конфигом/документацией, но не найден как полноценный runtime-модуль в `dist/runtime/server-orders/*`**
   - Есть валидация и docs-контракт (`fallbackToForcedLossExit`, `refreshOnAveraging`, `reconcileOnLoop`),
   - но в данном срезе кода проверка сделана на уровне контракта/позиционирования, а не полного e2e исполнения server-SL менеджера.

2. **Защита от дублирования server SL и earlyInvalidation опирается на оркестрационный порядок и ownership path**
   - Явного «mutex»-механизма между уже выставленным server close и локальным forced action в этом модуле нет;
   - предполагается, что дедупликация/идемпотентность обеспечивается execution+lifecycle/reconciliation слоем.

3. **Ранняя invalidation зависит от качества входных метрик позиции**
   - При отсутствии `minutesSinceEntry`, `entryDeviationPercent` или подтверждения тренда ранний слой намеренно не триггерит.
   - Это корректно как safety, но повышает нагрузку на fallback-ветку и качество provider-данных.

## Что учесть в следующих шагах

1. Добавить/усилить e2e-тесты orchestration уровня для сценариев:
   - server SL выставлен и сработал,
   - earlyInvalidation одновременно генерирует ownershipAction,
   - проверка отсутствия двойного закрытия и корректного reconciliation.

2. Формализовать явный dedup/ownership token между server-order manager и forced/early protective actions
   - чтобы исключить race-condition при высокочастотных циклах.

3. Если модуль serverStopLoss уже вынесен в другой слой/репозиторий, добавить ссылку в docs/архитектуру на фактический runtime-owner,
   - чтобы аудит согласованности был не только контрактным, но и по конкретному коду исполнения.

4. Сохранить отдельную регрессию на dynamic asset selection при дальнейших изменениях protective-логики,
   - чтобы гарантировать отсутствие побочного влияния на downstream routing.
