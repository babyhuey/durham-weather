# Durham Weather

A personal forecast page with a sky that follows the real weather, live at https://durham-weather.pages.dev.

- Forecast from [weather.gov](https://www.weather.gov/documentation/services-web-api), for your location or ZIP 27712.
- 15-minute rain from the HRRR model via [Open-Meteo](https://open-meteo.com/).
- Radar from the [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/), plus a home-grown one-hour radar forecast (see `public/nowcast.js`).

Plain HTML and JavaScript with no build step. Design notes are in `docs/spec.md`.

```sh
npm test         # unit tests against saved real API responses
npm run serve    # local preview of public/
npm run deploy   # Cloudflare Pages
```
