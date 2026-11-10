# TrafficMCMT Viewer

Веб-визуализация MCMT-треков в реальном времени: **deck.gl 9 + MapLibre GL JS + React 18 + TypeScript + Vite**.

## Требования

- Node.js ≥ 22 (проверено на 26.13.0 LTS)
- npm ≥ 10

> В Windows PowerShell скрипты `npm.ps1` могут быть заблокированы Execution Policy.
> В этом случае используйте `npm.cmd` (например, `npm.cmd install`).

## Запуск

```powershell
npm.cmd install
npm.cmd run dev
```

Приложение откроется на http://localhost:5173.

### Реальный backend (этап 2b)

Viewer совместим с C++ `trafficmcmt_map_gateway` из репозитория [TrafficMCMT](https://github.com/Nuzhny007/TrafficMCMT).
Gateway читает JSONL с треклетами и отдаёт протокол v1 по адресу
`ws://localhost:8080/ws` (health: `http://localhost:8080/health`), раз в
`feed.heartbeat_s` присылая `heartbeat`.

```powershell
# Auburn / Toomer's Corner, две камеры
cd ..\TrafficMCMT
.\build\local-release\Release\trafficmcmt_map_gateway.exe `
  --input build\datasets\auburn_toomer\combined.jsonl `
  --config configs\map_feed.yaml --port 8080 --speed 1 --loop

# Aire, одна камера
.\build\local-release\Release\trafficmcmt_map_gateway.exe `
  --input build\datasets\aire\cam-01.jsonl `
  --config configs\map_feed_aire.yaml --port 8080 --speed 1 --loop
```

`--loop` повторяет запись; без него gateway замолкает после конца replay.
Viewer один раз подстраивает карту под присланные `camera_zones`, поэтому
переключаться между Aire и Auburn можно без правки `.env` (при смене набора
данных перезагрузите страницу). Авто-fit отключается через
`VITE_MAP_AUTOFIT=false`.

Если в конфиге gateway есть блок `emissions` с `enabled: true` (он есть в обоих
конфигах), дополнительно приходит `emission_grid` — поле концентраций
Gaussian puff модели, 120×90 ячеек, 1 Гц. Панель «Концентрации» показывает
NOx/CO/PM2.5/PM10/CO2 и позволяет включить/выключить слой и переключить
загрязнитель. Без этого блока viewer работает как этап 2b.

### Mock-сервер (запасной вариант)

В репозитории есть генератор потока на Python/aiohttp — он имитирует C++
бэкенд: 60 треков, 10 Гц, зоны камер, heartbeat, периодические `id_merge`,
`tracks_remove` и `emission_grid` (120×90, 1 Гц, пять загрязнителей).
Удобен, когда C++ gateway не собран, и для нагрузочных прогонов.

```powershell
pip install -r mock/requirements.txt
npm.cmd run mock
```

Параметры задаются переменными окружения: `MOCK_HOST`, `MOCK_PORT`,
`MOCK_TICK_HZ`, `MOCK_TRACKS` (например, `1000` для нагрузки) и
`MOCK_EMISSIONS=0`, чтобы отключить кадры концентраций. Без запущенного
источника приложение показывает статус `offline` и баннер с подсказкой.

## Панель управления

Верхний правый угол: фильтры по классам и камерам (с счётчиками), переключатели
хвостов и зон, минимальная скорость, поиск трека по номеру и сброс.
Прозрачность слоя концентраций — в панели «Концентрации».

| Действие | Как |
|---|---|
| Класс вкл/выкл | клик по чипу или цифра `1`–`6` |
| Только этот класс | двойной клик по чипу или `Shift`+цифра |
| Хвосты / зоны | тумблеры или `H` / `Z` |
| Выбрать трек | клик по маркеру или поиск `#1042` + Enter |
| Сброс выбора и поиска | `Esc` |

Состояние фильтров кодируется в URL (`?classes=car,truck&cams=1&trails=0&q=1042`)
и восстанавливается при перезагрузке, так что ссылку на конкретный вид можно
передавать коллегам. Без параметров в URL берётся последнее состояние из
`localStorage`.

## Производительность

`npm run perf` поднимает mock на 1000 треков, отдаёт production-сборку и меряет
время кадра в headless Edge (программный WebGL, 1370×758 — заведомо худший
случай, чем настоящий GPU):

| Сценарий | FPS | p95 кадра |
|---|---|---|
| 1000 треков + выбросы | 53 | 21.3 мс |
| 1000 треков, фильтр «только авто» (≈25 %) | 60 | 18.6 мс |
| 60 треков (масштаб датасета Aire) | 60 | 18.1 мс |

Бюджет зафиксирован в скрипте (p95 ≤ 22 мс, ≥ 50 FPS); при регрессе `npm run
perf` падает. Пороги можно переопределить: `npm run perf -- --tracks 2000
--threshold-ms 25`.

## Скрипты

| Команда | Назначение |
|---|---|
| `npm run dev` | dev-server с HMR |
| `npm run build` | typecheck + production-сборка в `dist/` |
| `npm run preview` | локальный просмотр `dist/` |
| `npm run typecheck` | только проверка типов |
| `npm test` | unit-тесты (Vitest) |
| `npm run perf` | профиль производительности на 1000 треках (headless Edge) |
| `npm run mock` | mock WebSocket-сервер (Python/aiohttp) |

## Конфигурация

Скопируйте `.env.example` в `.env` и при необходимости измените:

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `VITE_WS_URL` | `ws://localhost:8080/ws` | WebSocket бэкенда |
| `VITE_WS_TIMEOUT_MS` | `15000` | переподключение после тишины, мс |
| `VITE_TRACK_TTL_MS` | `8000` | удаление треков без обновлений, мс |
| `VITE_MAP_ANIMATE` | `true` | dead reckoning между кадрами 10 Гц |
| `VITE_MAP_STYLE` | CARTO dark matter | стиль MapLibre |
| `VITE_MAP_AUTOFIT` | `true` | подстроить карту под первые зоны/треки |
| `VITE_MAP_LON/LAT/ZOOM` | Aire, 5.9745 / 45.5268 / 16 | начальный вид (если авто-fit выключен) |

## Структура

```
src/
  config.ts                 # env → конфиг приложения
  types/tracking.ts         # протокол WS v1 и типы сообщений
  domain/classes.ts         # классы объектов, цвета, подписи
  domain/clock.ts           # монотонные часы для живых данных
  domain/motion.ts          # dead reckoning, затухание, голова хвоста
  domain/filter.ts          # фильтр треков и разбор «#1042»
  store/trackingStore.ts    # Zustand: соединение, зоны, выбор, статистика
  store/viewStore.ts        # Zustand: фильтры и слои + URL/localStorage
  net/protocol.ts           # валидация кадров WS
  net/wsClient.ts           # reconnect, heartbeat watchdog, backoff
  net/trackBuffer.ts        # мутабельный буфер треков (вне React)
  net/emissionBuffer.ts     # последний emission_grid (вне React)
  net/feed.ts               # склейка сокета, буферов и store
  emissions/palette.ts      # цветовые шкалы и растеризация поля
  hooks/useFps.ts           # счётчик FPS
  hooks/useSelectedTrack.ts # выбранный трек из буфера (низкая частота)
  layers/                   # фабрики слоёв deck.gl
  components/MapView.tsx    # MapLibre + MapboxOverlay + rAF-цикл
  components/ControlPanel.tsx # классы/камеры/слои/поиск
  components/TrackDetails.tsx # карточка выбранного трека
  components/EmissionPanel.tsx # панель концентраций
  demo/staticData.ts        # статические данные для unit-тестов
mock/
  mock_server.py            # генератор потока (Python/aiohttp)
  requirements.txt
scripts/perf-smoke.mjs      # профиль производительности (CDP + mock)
docs/protocol.md            # описание протокола WS v1
```

## Версии и совместимость

Проверенные версии:

| Пакет | Версия |
|---|---|
| React / React DOM | 18.3.1 |
| deck.gl (`deck.gl`, `@deck.gl/*`) | 9.4.1 |
| MapLibre GL JS | 6.16.0 |
| react-map-gl | 8.1.3 |
| Zustand | 5.0.16 |
| Vite | 8.3.5 |
| TypeScript | 7.0.2 |

Особенности, которые важно сохранить при обновлении зависимостей:

1. **`optimizeDeps.exclude: ['maplibre-gl']`** в `vite.config.ts`.
   MapLibre создаёт worker через `new Worker(new URL(...), { type: 'module' })`.
   Предварительная сборка зависимостей Vite переписывает URL, и worker не
   запускается — карта остаётся пустой, `isStyleLoaded()` возвращает `false`.
2. **`interleaved: false`** у `MapboxOverlay`. В interleaved-режиме deck.gl 9.4
   вызывает `map.transform.height`, которого нет в текущей связке с MapLibre,
   и падает с `TypeError: Cannot read properties of undefined (reading 'height')`.
   Overlaid-режим рендерит deck.gl в отдельный canvas поверх карты; выбор
   объектов при этом работает через `MapboxOverlay.pickObject`.
3. **`StrictMode` отключён** в `src/main.tsx`. В dev-режиме он монтирует эффекты
   дважды, из-за чего `useControl` регистрирует `MapboxOverlay` два раза и
   ломает рендеринг. Вернуть после того, как overlay станет StrictMode-совместимым.
4. `MapboxOverlay` должен находиться **внутри** `<Map>`: `useControl` берёт
   экземпляр карты из React-контекста, доступного только детям карты.

## Статус

- [x] **Этап 0** — каркас Vite + React + TS, карта MapLibre, `MapboxOverlay`,
      статические `PolygonLayer` (зоны камер) и `ScatterplotLayer` (треки),
      `PathLayer` (хвосты), выбор трека, FPS-счётчик, базовый store и типы протокола.
- [ ] Этап 1 — уточнение слоёв/стилей.
- [x] **Этап 2** — WebSocket-клиент с reconnect/backoff и heartbeat-контролем,
      валидация кадров, mock-сервер на Python/aiohttp (60 треков @ 10 Гц),
      live-зоны камер, `id_merge`, TTL-очистка, счётчики треков и сообщений.
      Высокочастотные данные идут в мутабельный `TrackBuffer`, deck.gl
      обновляется из `requestAnimationFrame` — без React-рендера на сообщение.
- [x] **Этап 2b** — совместимость с C++ `trafficmcmt_map_gateway`:
      `tracks_remove`, `snapshot` при подключении, `speed_kmh`, `trail` только
      при первом объявлении, авто-fit карты под Aire/Auburn, heartbeat раз в
      `feed.heartbeat_s` и watchdog на 15 с.
- [x] **Этап 2c** — слой концентраций: `emission_grid` (base64 float32,
      120×90 @ 1 Гц), `BitmapLayer` с логарифмической цветовой шкалой,
      переключение NOx/CO/PM2.5/PM10/CO2 и видимости слоя, панель статистики.
- [x] **Этап 3a** — интерполяция: dead reckoning по `velocity` не дальше 150 мс,
      хвост дотягивается до анимированного маркера, потерянные треки гаснут,
      TTL и анимация считаются по монотонным часам (`performance.now()`).
- [ ] Этап 3b — typed-array буферы (SoA) вместо массива объектов.
- [ ] Этап 3c — интерполяция по времени кадра из потока (нужны корректные
      `timestamp` из этапа 7 TrafficMCMT).
- [x] **Этап 4** — 1000 треков с 40-точечными хвостами держат 53–55 FPS
      (p95 ≈ 21 мс) в headless-браузере с программным WebGL; профиль
      `npm run perf` не даёт этому молча деградировать.
- [x] **Этап 5** — фильтры и панель управления: классы и камеры (с счётчиками),
      хвосты, зоны, минимальная скорость, поиск по номеру трека, прозрачность
      концентраций; состояние живёт в URL и localStorage.

Подробности протокола: [`docs/protocol.md`](docs/protocol.md).
