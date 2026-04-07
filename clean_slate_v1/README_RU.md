# Clean-slate v1 (архивный reference-only слой)

> Статус: **ARCHIVED / REFERENCE-ONLY**.
> Эта папка больше не считается активной веткой реализации.
> Каноническая новая версия runtime: `clean_slate_v2/`.

Этот каталог сохранён только как исторический reference этапа 1 (каркас + flat-start contract).
Новая разработка и интеграция модулей должны вестись только в `clean_slate_v2`.

## Что осталось в v1

- Исторический архитектурный документ (`docs/ARCHITECTURE_ZERO_STAGE_RU.md`).
- Пример legacy clean-slate конфигурации (`config/clean_slate.config.example.json`).
- Ранняя реализация flat-start/startup/owner-path каркаса.

## Политика использования

- Не добавлять новый runtime-код в `clean_slate_v1/src`.
- Не подключать `clean_slate_v1` в новые тесты и owner-path цепочки.
- Использовать только для сверки и аудита эволюции clean-slate.
