# Перенос интерфейса Stud.GK на SolidJS

Перенесён весь интерфейс, включая вход, ленту, навигацию, папки и вкладки,
объявления, расписание, Nextcloud, GitLab, PDF и миниатюры. В браузерном коде и
дереве зависимостей больше нет React, React DOM, react-markdown или lucide-react.
Строгий TypeScript сохранён. Express, Electron, авторизация, FeedSession,
API-клиенты, общие типы и дисковый кеш не переписаны.

React-база: `35411f3373a34dd33fc180ee437a5a995db07f53`, ветка
`t3/review-refactor-tech-stack`, PR #10. До изменений она прошла 102 теста,
production build и три существующих Electron smoke-теста. Её production assets
были сохранены до замены зависимостей. Замеры React сделаны до переноса.

## Решения, влияющие на поведение

- Solid 1.9.17, vite-plugin-solid и lucide-solid. Сигналы, memo, `For`, `Show keyed`,
  `Portal` и lifecycle Solid заменяют React-компоненты и хуки. Props читаются через
  объект; поля ввода используют `onInput`. Обработчик подавления клика после
  перетаскивания использует нативный capture listener.
- FeedSession по-прежнему владеет поколениями сессии, отменой и порядком запросов.
  Подписка очищается при размонтировании. Polling планирует следующий timeout
  только после окончания предыдущего запроса; смена режима или `syncing`
  отменяет старое расписание.
- Входящие снимки копируются в отдельный Solid store и согласуются по `id` через
  `reconcile`. Это сохраняет DOM, фокус и раскрытые объявления при polling.
  Копирование не даёт store менять внутренние снимки FeedSession. Динамические
  заголовки, даты, типы файлов и привязки GitLab проверяются после обновлений.
- Markdown разбирается через unified, remark-parse, remark-gfm и remark-rehype.
  Raw HTML не включается в дерево. rehype-sanitize очищает дерево перед выводом
  нативных узлов Solid. Ссылки допускают только HTTP, HTTPS и mailto без логина и
  пароля в URL; относительные адреса разрешаются относительно файла GitLab.
  Изображения Markdown остаются ссылками, как в React-версии. Подсветка использует
  прежний модуль highlight.js, который экранирует исходный текст.
- CSS и SVG-логотип сохранены. Итоговый production CSS побайтно совпадает с
  React-базой. Порядок импорта CSS также сохранён.

Проверенные официальные источники:
[props](https://docs.solidjs.com/concepts/components/props),
[lifecycle](https://docs.solidjs.com/reference/lifecycle/on-cleanup),
[reconcile](https://docs.solidjs.com/reference/store-utilities/reconcile),
[события](https://docs.solidjs.com/reference/jsx-attributes/on),
[Vite](https://github.com/solidjs/solid-vite-plugin),
[Lucide для Solid 1](https://github.com/lucide-icons/lucide/blob/main/docs/guide/installation.md),
[remark-rehype](https://github.com/remarkjs/remark-rehype),
[rehype-sanitize](https://github.com/rehypejs/rehype-sanitize).

## Сравнение с React

Это измерение данного приложения и фикстур, а не сравнение фреймворков вообще.
Перенос уменьшил стартовый JS, но не дал общего ускорения и экономии памяти.

| Метрика | React | Solid | Изменение |
| --- | ---: | ---: | ---: |
| Стартовый JS, байт | 527 192 | 326 616 | −38,0% |
| Его gzip, байт | 163 478 | 104 593 | −36,0% |
| Открытие списка 1000 файлов, медиана | 116,6 мс | 147,4 мс | +26,4% |
| Раскрытие 1000 дочерних строк дерева, медиана | 49,5 мс | 39,9 мс | −19,4% |
| ArrowDown в раскрытом дереве, медиана | 31,5 мс | 26,0 мс | см. ограничение ниже |
| Сумма working set процессов Electron, медиана | 602,0 МиБ | 614,2 МиБ | +2,0% |
| Working set renderer, медиана | 199,7 МиБ | 211,3 МиБ | +5,8% |
| Занятая V8 heap renderer после GC, медиана | 9,95 МиБ | 19,40 МиБ | +95,0% |

Список в этой версии создаётся медленнее. В памяти одновременно остаются снимок
FeedSession и отдельная реактивная копия данных. Это осознанная цена изоляции
состояния и сохранения идентичности элементов, но таблица не позволяет приписать
весь рост heap одному этому решению. Раскрытие дерева в этой фикстуре быстрее.

### Методика

Скрипт [ui-benchmark.cjs](../scripts/ui-benchmark.cjs) запускается против
production build. Для каждой версии сделаны три отдельных запуска Electron с
новым временным профилем, последовательно под Xvfb. Настройки одинаковы:
Electron 44.5.1, Chromium 152.0.7977.130, встроенный Node 24.21.0, Linux
7.2.11-zen1-1-zen, AMD Ryzen 9 7900, окно 1280 × 850, hardware acceleration
отключено. Сырые результаты содержат эти настройки.

Тестовый сервер возвращает один курс с 1000 текстовых файлов и GitLab-дерево с
2000 корневыми строками. Одна папка добавляет 1000 дочерних строк. Авторизация и
API используют локальные фикстуры без токена и приватного аккаунта. PDF,
миниатюры и подсветка в этих измерениях не загружаются.

Для списка измеряется переход с карточки курса до появления 1000 карточек и
двух requestAnimationFrame. Для дерева измеряется раскрытие уже закешированной
папки до появления 3000 строк и двух кадров. Для клавиатуры измеряется ArrowDown
до перехода фокуса на первого ребёнка и двух кадров. Первый проход каждого
сценария прогревает приложение и исключён; следующие девять сохраняются.
В таблице медианы всех 27 значений. Медианы трёх запусков:

| Сценарий | React, мс | Solid, мс |
| --- | --- | --- |
| Список | 112,7 / 107,1 / 124,5 | 149,7 / 142,6 / 148,8 |
| Раскрытие | 49,7 / 48,8 / 49,9 | 39,2 / 40,3 / 40,4 |
| ArrowDown | 31,4 / 31,7 / 31,5 | 26,2 / 26,0 / 25,1 |

После сценариев остаются открыты 3000 строк. CDP HeapProfiler.collectGarbage
вызывает GC, затем через секунду снимаются Runtime.getHeapUsage и
app.getAppMetrics. Сумма working set включает Browser, GPU, Utility и Tab.
Медианы памяти рассчитаны по трём процессам, а не по 27 действиям.

Стартовый JS определяется по script/modulepreload в dist/index.html. Сейчас это
один entry chunk. Gzip считается Node zlib.gzipSync с настройками по умолчанию;
это оценка передачи с gzip, сервер сам gzip не включает. Динамические PDF,
worker, миниатюры и highlighter в стартовую сумму не включены. Размер JS
привязан к хешам файлов в JSON и может отличаться от округлённого вывода Vite.

Сырые результаты:
[React 1](benchmarks/react-1.json), [2](benchmarks/react-2.json), [3](benchmarks/react-3.json),
[Solid 1](benchmarks/solid-1.json), [2](benchmarks/solid-2.json), [3](benchmarks/solid-3.json).

### Воспроизведение и ограничения

```sh
npm ci
npm run build
BENCH_LABEL=solid BENCH_OUTPUT=/tmp/solid-1.json \
  xvfb-run -a npm run benchmark:ui -- --no-sandbox --ozone-platform=x11
# Повторить с новым BENCH_OUTPUT ещё два раза, последовательно.
```

Для React нужен чистый checkout указанного базового коммита с его package-lock.
Скопируй только `scripts/ui-benchmark.cjs` из этого PR в каталог scripts,
выполни `npm ci` и `npm run build`, затем запусти тот же скрипт:

```sh
BENCH_LABEL=react BENCH_OUTPUT=/tmp/react-1.json \
  xvfb-run -a env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron \
  scripts/ui-benchmark.cjs --no-sandbox --ozone-platform=x11
```

Результаты относятся к повторному открытию большого списка и закешированной
папки. Они не измеряют холодный запуск приложения, длительную работу,
сетевую задержку Stud.IP, энергопотребление, GPU ноутбука или поведение с
реальным аккаунтом. Настройки внешнего шрифта одинаковы, но ожидание загрузки
Google Fonts отдельно не фиксируется. Порядок прогонов не рандомизирован:
React измерен первым. Запуски идут на общей машине без статистической изоляции.

Два кадра дают нижнюю границу времени. Для ArrowDown разброс и период кадров
сопоставимы с разницей результатов, поэтому уверенного вывода об ускорении
клавиатуры нет. Working set процессов содержит общие страницы; его сумма не
равна уникально занятой физической RAM. Heap не включает всю DOM/native/GPU
память. Малый рост суммы working set может зависеть от окружения, но рост V8
heap в этой фикстуре повторился во всех трёх запусках. Не делаем вывода о
снижении памяти Electron.

## Проверки

На финальной версии:

- `npm test`: 106/106. Исходные 102 проверки сохранены; добавлены четыре проверки
  Markdown, URL и разбиения текста объявлений.
- `npm run typecheck` и `npm run build`: strict frontend TS и server checkJs.
- Все четыре Electron smoke-теста из исходников, последовательно под Xvfb.
- `npm run dist:linux`: AppImage собран. Четыре smoke-теста повторены на app.asar,
  извлечённом непосредственно из AppImage, а не на исходном dist.
- Сам исполняемый AppImage запускается отдельной проверкой с временным профилем.
- T3 preview открыл production UI. Через DOM проверены демо, порядок курсов,
  переход в курс и папки. Snapshot дважды завершился ошибкой
  `Preview automation snapshot timed out after 15000ms`, click тоже завис.
  Команда resize вернула настройку 390 px, но фактический viewport остался 1280 px.
  Поэтому визуальные и узкие состояния проверены через Electron workflow,
  включая снимки кода GitLab, объявлений и PDF.

Существующие проверки не удалялись. Ожидание двух кадров перед прокруткой
объявлений сохранено. Smoke-тесты теперь также отклоняют необработанные ошибки
renderer. Новый `test:ui` проверяет ID/DOM/focus после смены снимка, обновление
названия и типа файла, сохранение раскрытого объявления, ввод, три способа
перестановки курсов, PDF-текст, цвета, fullscreen, масштаб, переход к странице,
виртуализацию, скачивание исходных байтов, Escape и cleanup.

```sh
xvfb-run -a npm run test:desktop -- --no-sandbox --ozone-platform=x11
xvfb-run -a npm run test:gitlab -- --no-sandbox --ozone-platform=x11
xvfb-run -a npm run test:session -- --no-sandbox --ozone-platform=x11
xvfb-run -a npm run test:ui -- --no-sandbox --ozone-platform=x11
npm run dist:linux
xvfb-run -a node scripts/appimage-smoke.cjs release/Stud.GK-1.0.0-linux-x86_64.AppImage
```

Для повторения проверки содержимого пакета сначала извлеки AppImage в release:

```sh
cd release
./Stud.GK-1.0.0-linux-x86_64.AppImage --appimage-extract
cd ..
STUDIP_PACKAGED_ROOT="$PWD/release/squashfs-root/resources/app.asar"
CAMPUS_SMOKE_ENTRY="$STUDIP_PACKAGED_ROOT/electron/main.cjs" \
  xvfb-run -a npm run test:desktop -- --no-sandbox --ozone-platform=x11
# Аналогично, по очереди для test:gitlab, test:session и test:ui:
CAMPUS_SMOKE_ROOT="$STUDIP_PACKAGED_ROOT" \
  xvfb-run -a npm run test:gitlab -- --no-sandbox --ozone-platform=x11
```

CI проверяет также PR к промежуточной ветке стека и запускает новый UI smoke.
Перед открытием PR #10 был уже слит squash-коммитом `0bfe90a` в master.
Его дерево побайтно совпало с базовым `35411f3`; перенос перебазирован на этот
master без дополнительных изменений. Слияние и публикация релиза этой задачей
не выполняются. Работа с настоящим
университетским аккаунтом и приватными внешними сервисами без пользовательских
учётных данных не проверена.
