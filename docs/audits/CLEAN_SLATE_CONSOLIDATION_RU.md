# Консолидация clean-slate веток (канонизация v2)

Дата аудита: 2026-04-07.

## Таблица сравнения найденных новых папок

| Папка | Назначение | Степень готовности | Ключевые модули | Дубли / конфликты | Каноническая основа |
|---|---|---|---|---|---|
| `clean_slate_v1/` | Этап 1: flat-start + базовый owner-path каркас | Низкая/ранняя (каркас) | `bootstrap/flatStartGuard`, `runtime/cleanRuntimeOrchestrator`, `contracts/ownerPathContracts` | Дублирует стартовый ownership contract, но без foundation/runtime-base/execution-core | Нет (archive/reference-only) |
| `clean_slate_v2/` | Этапы foundation + runtime-base + execution-core | Высокая (рабочий набор модулей + тесты) | `foundation/*`, `runtime_base/*`, `execution_core/*` + перенесённые `bootstrap/*`, `runtime/*`, `contracts/*` | Был разрыв: flat-start и owner-path contract оставались только в v1; устранено переносом в v2 | Да (каноническая папка) |

## Решение

Канонической clean-slate папкой выбрана `clean_slate_v2/`:

1. В ней уже реализованы foundation/runtime-base/execution-core, которые покрывают основной runtime-контур новой версии.
2. На неё уже опираются clean-slate тесты (кроме ownership-path теста до консолидации).
3. Она не содержит thin-wrapper зависимостей от legacy owner-chain и легче расширяется без расщепления архитектуры.

## Что перенесено в каноническую папку

Из `clean_slate_v1` в `clean_slate_v2` перенесены только полезные модули стартового контракта:

- `src/contracts/ownerPathContracts.js` (rewrite под v2 owner-path названия).
- `src/bootstrap/flatStartGuard.js` (reuse).
- `src/bootstrap/startupReport.js` (reuse).
- `src/runtime/cleanRuntimeOrchestrator.js` (reuse как стартовый orchestration layer).

## Что считается неактивным после консолидации

- `clean_slate_v1/` переведена в статус **ARCHIVED / REFERENCE-ONLY**.
- Активная разработка clean-slate runtime допускается только в `clean_slate_v2/`.

## Контроль конфликтов/дубликатов

Проверены и зафиксированы правила:

- Нет двух реализаций `finalEntryDecisionEngine` в clean-slate зоне.
- Нет двух реализаций `dynamicPositionSizing` в clean-slate зоне.
- Нет раздвоенного owner-path для новой версии: тест ownership-path направлен только на `clean_slate_v2`.
- Нет возврата к `openNewPositionLegacy`/`processExistingPositionLegacy` в execution owner-path v2.

