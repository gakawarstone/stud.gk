# SolidJS: проверка переноса

Весь интерфейс использует SolidJS 1 и строгий TypeScript. Express, Electron,
авторизация, дисковый кеш, FeedSession, API-клиенты и PDF-модули сохранены.
Снимки FeedSession копируются в отдельный store с `reconcile` по ID для сохранения
фокуса и раскрытых объявлений. Polling остаётся последовательным, запросы и
подписки очищаются при смене сессии и размонтировании.

Markdown использует remark/GFM и rehype-sanitize без raw HTML. Ссылки допускают
HTTP, HTTPS и mailto без учётных данных в URL. Иконки используют lucide-solid,
сборка — vite-plugin-solid. Стили и SVG-логотип сохранены из master. Основания выбора:
[Solid](https://docs.solidjs.com/reference/store-utilities/reconcile),
[Lucide](https://github.com/lucide-icons/lucide/blob/main/docs/guide/installation.md),
[очистка Markdown](https://github.com/rehypejs/rehype-sanitize).

## Результаты

React-база — `35411f3`, её дерево совпадает с master после слияния #10.
Замеры React сделаны до переноса; измеренная версия Solid — `1551af8`.
Это историческое сравнение до последующего объединения с master. Оно не
измеряет добавленные позже историю GitLab, несколько проектов, переводы и
расширенное рабочее пространство.
[Все исходные значения](benchmarks.json) сохранены без округления.

| Метрика | React | Solid |
| --- | ---: | ---: |
| Стартовый JS | 527 192 Б | 326 616 Б |
| Gzip стартового JS | 163 478 Б | 104 593 Б |
| Открытие 1000 файлов | 116,6 мс | 147,4 мс |
| Раскрытие 1000 дочерних строк дерева | 49,5 мс | 39,9 мс |
| ArrowDown в раскрытом дереве | 31,5 мс | 26,0 мс |
| Сумма working set процессов Electron | 602,0 МиБ | 614,2 МиБ |
| Working set renderer | 199,7 МиБ | 211,3 МиБ |
| Занятая V8 heap renderer после GC | 9,95 МиБ | 19,40 МиБ |

JS уменьшился, но список создаётся медленнее и память выросла. Общего ускорения
и снижения памяти не получено. Разница ArrowDown сопоставима с периодом кадров
и шумом измерения. Сумма working set включает общие страницы и не равна
уникально занятой физической RAM; V8 heap не включает всю DOM/native/GPU память.

## Методика

[ui-benchmark.cjs](../scripts/ui-benchmark.cjs) использует production build,
локальный тестовый API и новый профиль для каждого из трёх последовательных
запусков. Для обеих версий одинаковы Electron 44.5.1, Chromium 152.0.7977.130,
Node 24.21.0, Linux 7.2.11-zen1-1-zen, Ryzen 9 7900, окно 1280 × 850 и отключённое
hardware acceleration. Фикстуры: курс с 1000 текстовых файлов, дерево с 2000
корневыми строками и папкой с 1000 детьми. PDF и миниатюры не загружаются.

Время считается от действия до появления нужных DOM-узлов или фокуса и двух
requestAnimationFrame. Первый проход исключается; таблица содержит медианы
следующих девяти проходов в каждом процессе, всего 27 значений на сценарий.
Папка при измерении уже закеширована. Память снимается с раскрытыми 3000 строками
через секунду после HeapProfiler.collectGarbage через Runtime.getHeapUsage и
app.getAppMetrics; используются медианы трёх процессов. Стартовый JS берётся
из script/modulepreload в dist/index.html, gzip — zlib.gzipSync по умолчанию.
Динамические PDF, worker и highlighter в стартовый размер не включены.

```sh
npm ci
npm run build
BENCH_LABEL=solid BENCH_OUTPUT=/tmp/solid-1.json \
  xvfb-run -a npm run benchmark:ui -- --no-sandbox --ozone-platform=x11
```

Повтори запуск ещё два раза с разными BENCH_OUTPUT. Для React в чистом checkout
базового коммита используй его package-lock, скопируй только ui-benchmark.cjs,
выполни npm ci/build и запусти тот же скрипт через Electron напрямую:

```sh
BENCH_LABEL=react BENCH_OUTPUT=/tmp/react-1.json \
  xvfb-run -a env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron \
  scripts/ui-benchmark.cjs --no-sandbox --ozone-platform=x11
```

Запуски выполнены на общей машине, сначала React, затем Solid. Загрузка Google
Fonts отдельно не фиксируется. Холодный запуск, длительная работа, реальные
аккаунты, сеть Stud.IP, энергопотребление и GPU ноутбука не измерялись.

## Проверки

React-база прошла 102 теста, build и три исходных smoke-теста. Перенос прошёл
106 тестов, strict frontend TypeScript, server checkJs и production build.
Четыре smoke-теста выполнены последовательно под Xvfb из исходников и на app.asar,
извлечённом из AppImage. Сам AppImage проверен с изолированным профилем.

Новые проверки охватывают Markdown/URL, сохранение DOM и раскрытия при polling,
перестановку курсов, PDF-текст/цвета/fullscreen/масштаб/виртуализацию/скачивание,
Escape, фокус и cleanup. Исходные проверки и два кадра ожидания IntersectionObserver
сохранены. Команды запуска находятся в README и package.json.

T3 preview проверил DOM и навигацию. Его снимки и клики завершались timeout,
а resize не менял фактический viewport, поэтому внешний вид и узкие окна
проверены через Electron. Реальные университетские и приватные внешние аккаунты
не использовались.

После объединения с master `c2ac48e` сохранены английский интерфейс, несколько
GitLab-проектов на курс, история и диффы коммитов, встроенный PDF, постоянные
токены и ручные релизы 0.x. Строгая проверка типов, build и 120 тестов проходят;
расширенные smoke-тесты master сохранены.
