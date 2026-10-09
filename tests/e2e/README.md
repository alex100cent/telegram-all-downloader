# Проверка собранного расширения

```sh
npm run build
npx playwright install chromium
npm run test:e2e
```

Тесты загружают `.output/chrome-mv3` в отдельный временный Chromium-профиль. Используются реальные MAIN/ISOLATED content scripts, service worker, IndexedDB и popup собранного расширения. Профиль удаляется после каждого теста; личный браузер и Telegram-аккаунт не используются.

Страницы `https://web.telegram.org/a/` и `/k/` перехватываются Playwright и заменяются собственными синтетическими fixtures. Для A работает настоящий Web Worker с воспроизведённым проверенным протоколом Telegram. Для K fixture предоставляет менеджеры с точным контрактом чтения порций. Другие запросы к Telegram блокируются.

Выбор файла заменён fixture-функцией: она возвращает настоящий OPFS `FileSystemFileHandle`. Создание writer, запись, `close`/`abort`, чтение результата и SHA-256 выполняются браузером. Это проверка browser writer и соединения компонентов, **не проверка нативного диалога выбора файла** и **не живое скачивание из Telegram**.

Восемь сценариев:

1. Web A: непрослушанное аудио, настоящий Worker bridge, хвост после 512 KiB, точный SHA-256.
2. Web K: MAIN → ISOLATED → background → popup, полный файл и точный SHA-256; история сохраняется после закрытия исходной вкладки.
3. Два пользовательских выбора становятся последовательной очередью; закрытие popup не прерывает запись.
4. Отмена из popup после первой порции вызывает abort, частичный файл не обозначается сохранённым.
5. MV3 worker действительно останавливается через Chrome DevTools `ServiceWorker.stopWorker`. После запуска через popup восстанавливается статус ещё работающего writer; повторного чтения уже полученных порций нет.
6. Web A с CSP через `<meta>`, запрещающей JavaScript `eval`: подключение, команды и сохранение работают после применения политики. Fixture использует внешние скрипты своего origin. Это воспроизводит порядок загрузки [Telegram Web A](https://web.telegram.org/a/), при котором content script исполняется раньше CSP, а валидация команд — позже.
7. После `history.pushState` в подключённой Web A сессия сохраняется, файл скачивается целиком. Настоящие `chrome.tabs.onUpdated` события записываются в test attachment.
8. После изменения `location.hash` в подключённой Web A сессия также сохраняется; смена чата внутри SPA не считается закрытием исходной страницы.

Профиль, Playwright traces и результаты находятся вне исходников или в игнорируемом `test-results/`. При сбое сохраняется trace. Живые A/K, Chrome/Яндекс, нативный picker, реальные private/protected channels и большие файлы проверяются отдельно по ручной матрице.

Основа harness: [Playwright Chrome extensions](https://playwright.dev/docs/chrome-extensions), [Chrome DevTools ServiceWorker protocol](https://chromedevtools.github.io/devtools-protocol/tot/ServiceWorker/).
