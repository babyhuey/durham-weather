# Durham Weather: design spec (2026-09-24)

A personal, single-screen forecast page built on the weather.gov API, hosted on Cloudflare Pages.

## Goals

- Hyper-local "next hour" outlook for the viewer's position (falls back to ZIP 27712, Durham NC).
- Daily highs and lows, chance of precipitation, and total precipitation for 7 days.
- Visually striking "living sky" design whose background follows real cloud cover and time of day.

## Data sources (all `https://api.weather.gov`, CORS `*`)

| Endpoint | Used for |
|---|---|
| `/points/{lat},{lon}` | grid office/x/y, time zone, city, station list URL |
| `/gridpoints/{wfo}/{x},{y}` | sky cover, hourly chance of precip, 6-hour precip amounts (mm), daily max/min (°C) |
| `/gridpoints/{wfo}/{x},{y}/forecast/hourly` | hourly temperature (°F), chance of precip, short forecast text, wind |
| `/gridpoints/{wfo}/{x},{y}/stations` + `/stations/{id}/observations/latest` | current measured temperature at the nearest station |

weather.gov has no minute-level nowcast; "next hour" is built from hourly data.

## Behavior

1. Location: browser geolocation (5 s timeout), else 36.091, -78.902. Coordinates rounded to 3 decimals.
2. Points lookup and nearest station (by great-circle distance) are cached in `localStorage` per location.
3. Grid, hourly and observation are fetched in parallel. Each request has a 10 s timeout and one retry on network error or 5xx.
4. Derivations (`weather.js`, pure functions):
   - Grid values with ISO 8601 interval durations are expanded to one entry per hour. Precip amounts are spread evenly across their interval.
   - Days are local calendar days in the grid's time zone. High = the `maxTemperature` period starting that day. Low = the `minTemperature` period ending that day (that morning's low).
   - Daily chance of precip = max hourly chance that day. Daily total = sum of hourly amounts, in inches; shown as "—" when the forecast's amounts don't cover the rest of that day (weather.gov only issues amounts ~3.5 days out).
   - Next-hour sentence from hourly chance of precip, with a 20% threshold for "possible" and 60% for "likely".
   - Current temperature from the station if its reading is under 90 minutes old and non-null; otherwise the current hourly forecast value, labeled as a forecast.
   - Sky gradient from solar elevation (computed locally) and current sky cover.
5. Refresh every 10 minutes and when the tab becomes visible.

## Errors

- weather.gov unavailable: render the last good data from `localStorage` with a "weather.gov not responding" note; with no saved data, show an error and Retry button.
- Points 404 (outside the US): message, then fall back to Durham.

## Layout

Phone-first, single column: Now → Next hour → Next 12 hours (chance-of-rain bars) → 7 days → footer (updated time, grid, link to forecast.weather.gov). Two columns at ≥ 820 px. Animated drizzle when the current hour's chance of precip is ≥ 40%, disabled under `prefers-reduced-motion`.

## Additions (2026-09-24)

- **Weather characters** (`icons.js`): inline animated SVG per forecast type, mapped from weather.gov wording, with an hourly quip.
- **Wind**: hourly direction/speed, daily max sustained wind and direction; gusts shown when ≥ 20 mph and ≥ 5 mph above the steady wind.
- **Open-Meteo 15-minute precipitation** (HRRR, `timeformat=unixtime`) in the Next hour card.
- **Radar nowcast** (`nowcast.js`, `radar-data.js`): NOAA MRMS lowest-elevation composite reflectivity via IEM tiles for exact timestamps (`mrms::lcref-YYYYMMDDHHMM`, every 2 minutes, newest from `mrms/lcref.json`). MRMS is quality-controlled, so bird and insect blooms that fill the raw N0Q composite on fall nights don't show as rain; the cost is ~5 more minutes of lag (newest frame 5.5–7.5 min old vs 0–4 for N0Q, measured 2026-10-06). 2×2 tiles at zoom 7, decoded to dBZ via the published palette, max-pooled 2×. One motion vector from cross-correlating frame pairs (12 and 18 minutes apart), then the newest frame is advected in 6-minute steps (a multiple of the 2-minute MRMS cadence); rain at the point = ≥ 20 dBZ within ~2 km. This is the constant-vector extrapolation baseline used by pySTEPS/rainymotion; it cannot forecast new storms.
- **Headline priority**: radar (rain now or arriving within the hour) → HRRR 15-minute model (weather.gov dry but model wet) → weather.gov hourly chance.
- **Radar page** (`radar.html`, `radar.js`): Leaflet 1.9.4 (cdnjs, SRI), Esri dark gray basemap, 13 past frames + 12 forecast frames, scrubber, and a per-device accuracy scorecard (forecasts at +15/+30/+60 minutes checked against later radar frames, kept in `localStorage` for 7 days).

## Files and testing

- `index.html`, `app.js` (fetch + render), `weather.js` (pure derivations).
- `node --test` against real weather.gov responses captured 2026-09-24 in `test/fixtures/`.
- Deploy: `npx wrangler pages deploy public --project-name durham-weather`.
