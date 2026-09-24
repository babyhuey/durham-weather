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

## Files and testing

- `index.html`, `app.js` (fetch + render), `weather.js` (pure derivations).
- `node --test` against real weather.gov responses captured 2026-09-24 in `test/fixtures/`.
- Deploy: `npx wrangler pages deploy public --project-name durham-weather`.
