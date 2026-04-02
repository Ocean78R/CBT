# Короткая проверка согласованности: special position states (step 24 readiness, 2026-04-02)

## Scope
Проверка после patch по restricted/special position states:
- ownership и слой execution/reconciliation,
- propagation в PositionState / DecisionContext / lifecycle context,
- блокировки averaging/leverage-sensitive действий,
- сохранность safe close path,
- совместимость с risk contour / capitalRegime,
- отсутствие регрессии dynamic asset selection,
- готовность использовать state как входной контекст начиная с шага 24.

## Что согласовано

1. **Leverage mismatch state живёт в execution/reconciliation как owner-layer**
   - Регрессия подтверждает, что mismatch фиксируется как `LEVERAGE_MISMATCH_POSITION` именно в snapshot/reconciliation (`restrictedPositionsCount`, `hasRestrictedPositions`).
   - В архитектурном контракте зафиксировано, что special states принадлежат execution/reconciliation/lifecycle owner-path.

2. **PositionState / DecisionContext / lifecycle context получают state**
   - Регрессия на structured propagation проверяет проброс в:
     - `position_state` payload,
     - capability event,
     - `decisionContext.metadata.executionRestrictions`.

3. **Averaging и leverage-sensitive actions блокируются безопасно**
   - Для mismatch позиции разрешения/запреты представлены явной матрицей allowed/blocked actions.
   - Усреднение блокируется через `blocked_action` + `averaging_gate` (hard veto), без падения цикла.

4. **Safe close path остаётся доступным**
   - Есть отдельная регрессия: mismatch не блокирует безопасное закрытие по профиту (`close` ордер создаётся).
   - Это соответствует контракту совместимости special states (safe close не должен блокироваться).

5. **risk contour / capitalRegime учитывают restricted positions как risk input, но сопровождение не ломается**
   - `executionRestrictions` (`restrictedPositionsCount/hasRestrictedPositions`) пробрасываются в `DecisionContext.metadata`.
   - При этом lifecycle-обработка активной позиции продолжается в штатном owner-path (позиция сопровождается, а не «теряется»).
   - Portfolio risk contour продолжает корректно передавать `capitalRegime` в downstream-контексты.

6. **Dynamic asset selection не сломан patch-ем**
   - Регрессии на dynamic shortlist проходят: разрешён вход только для тикеров из shortlist, и приоритет `safeEntryAssets` сохраняется.
   - В контуре портфельного риска сохраняется синхронная передача `capitalRegime` в `dynamicAssetSelection`.

7. **Special position state можно безопасно использовать как входной контекст с шага 24**
   - Контекст уже структурированно доступен в execution snapshot, lifecycle payload и DecisionContext metadata.
   - Поведение restricted-state детерминировано: unsafe actions блокируются, safe close/сопровождение сохраняются.

## Ограничения

1. Проверка выполнена как короткий regression+contract audit (unit/integration), без отдельного live-exchange e2e прогона.
2. Валидация сделана на текущем runtime-срезе (`dist/*`) и существующем тестовом контуре; для шага 24 желательно сохранить этот инвариант отдельным guard-тестом на новый downstream-потребитель контекста.

## Итог по переходу к шагу 24

- **Согласованность подтверждена** для ownership, propagation, blocking matrix, safe close и downstream-risk контекстов.
- **Оставшиеся ограничения не блокируют** следующий этап (они про глубину e2e покрытия, а не про контрактную корректность).
- **Переход к шагу 24: безопасен**, при условии что новый шаг читает state только как input-context и не перехватывает ownership execution/lifecycle path.
