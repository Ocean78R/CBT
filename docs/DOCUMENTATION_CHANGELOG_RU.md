# Журнал изменений пользовательской документации

## Формат записи
- Дата: YYYY-MM-DD
- Изменение: что добавлено/изменено
- Связанные файлы кода: список файлов
- Связанные разделы docs: список файлов

---

## 2026-04-01
- Изменение: создан полноценный пользовательский documentation layer для оператора, добавлена структура user-docs, добавлена политика обязательного обновления документации и автоматическая проверка документационных требований.
- Связанные файлы кода: `scripts/docs/check-documentation.js`, `scripts/architecture/check-architecture.js`, `tests/docs/documentation.policy.test.js`, `package.json`, `README.md`.
- Связанные разделы docs: `docs/user/README_RU.md`, `docs/user/RUN_AND_MODES_RU.md`, `docs/user/TRADING_PIPELINE_RU.md`, `docs/user/RISK_AND_PROTECTION_RU.md`, `docs/user/CONFIG_GUIDE_RU.md`, `docs/user/LOGS_AND_TROUBLESHOOTING_RU.md`, `docs/DOCUMENTATION_UPDATE_POLICY_RU.md`.

## 2026-04-01 (антикризисный unload mode)
- Изменение: добавлен операционный unload mode (до entry decision/sizing) с режимами capitalRegime `NORMAL/CAUTION/DEFENSIVE/HALT_NEW_ENTRIES`, safe-basket для новых входов и лимитами новых входов за цикл/день, при этом сопровождение уже открытых позиций сохранено.
- Связанные файлы кода: `dist/index.js`, `dist/runtime/config/runtimeConfigValidator.js`, `dist/_config/config.json`.
- Связанные разделы docs: `docs/user/TRADING_PIPELINE_RU.md`, `docs/user/CONFIG_GUIDE_RU.md`.

## 2026-04-01 (устойчивый execution contour)
- Изменение: расширен контур исполнения ордеров без изменения торговой стратегии: добавлены очередь заявок, сериализация критичных операций, retry policy, deduplication и reconciliation перед обработкой тикера.
- Связанные файлы кода: `dist/index.js`, `dist/runtime/config/runtimeConfigValidator.js`, `dist/_config/config.json`.
- Связанные разделы docs: `docs/user/TRADING_PIPELINE_RU.md`, `docs/user/CONFIG_GUIDE_RU.md`, `docs/user/LOGS_AND_TROUBLESHOOTING_RU.md`.

## 2026-04-01 (server stop-loss manager BingX)
- Изменение: добавлен serverStopLoss manager-слой для BingX (reduce-only/close-only), постановка после открытия позиции, обновление после averaging, cleanup/reconciliation сиротских SL-ордеров, fallback на forcedLossExit/local polling close.
- Связанные файлы кода: `dist/index.js`, `dist/runtime/config/runtimeConfigValidator.js`, `dist/_config/config.json`.
- Связанные разделы docs: `README.md`, `docs/user/TRADING_PIPELINE_RU.md`, `docs/user/CONFIG_GUIDE_RU.md`, `docs/user/RISK_AND_PROTECTION_RU.md`, `docs/user/LOGS_AND_TROUBLESHOOTING_RU.md`.
