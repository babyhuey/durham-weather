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

## Android app

`android/` is a small Android app: the Today page in a full-screen WebView, plus a native home-screen widget (current conditions and six days of low/high from weather.gov, refreshed every 30 minutes). The same 30-minute check sends notifications for National Weather Service alerts at your location and for rain the HRRR model shows starting within the hour. It also checks this repo's GitHub releases and notifies once when a newer version is published; tapping it downloads the APK. Tag releases `vX.Y.Z` to match `versionName` and attach the APK. The whole toolchain runs in Docker; nothing Android is installed on the host.

```sh
android/docker/build.sh      # signed release APK -> android/app/build/outputs/apk/release/
android/docker/emulator.sh   # headless emulator (needs /dev/kvm) with the APK installed
docker exec durham-weather-emu adb shell am start -n app.durhamweather/.MainActivity --ez pin_widget true
```

The release key is kept outside the repo in `~/.config/durham-weather/` (`release.jks` + `signing.properties`). Keep it: phones only accept updates signed with the same key.
