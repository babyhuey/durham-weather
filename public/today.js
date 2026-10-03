import {
  currentConditions, stationDetails, minuteRing, quarterHours, headline, nextHour,
  skyCoverAt, sunElevation, sunsetOn, skyGradient, airReport, formatClock,
} from './weather.js';
import { iconSVG, weatherKind } from './icons.js';
import { store, esc, fetchJSON } from './shared.js';
import { API, resolveLocation } from './location.js';
import { mountSearch } from './places.js';
import { runNowcast } from './radar-data.js';

const REFRESH_MS = 10 * 60000;
const app = document.getElementById('app');

async function buildModel() {
  const { meta, where, note } = await resolveLocation();
  const soft = (p, what) => p.catch((err) => { console.warn(`${what} unavailable`, err); return null; });
  const [grid, hourly, forecast, observations, openMeteo, radar, airQuality] = await Promise.all([
    fetchJSON(meta.gridUrl),
    fetchJSON(meta.hourlyUrl),
    fetchJSON(`${meta.gridUrl}/forecast`),
    soft(fetchJSON(`${API}/stations/${meta.station.id}/observations?limit=12`), 'Station readings'),
    soft(fetchJSON(`https://api.open-meteo.com/v1/forecast?latitude=${meta.lat}&longitude=${meta.lon}&minutely_15=precipitation&forecast_minutely_15=5&past_minutely_15=1&timeformat=unixtime&timezone=GMT`), 'Open-Meteo'),
    soft(runNowcast(meta.lat, meta.lon, (ms) => formatClock(ms, meta.tz)), 'Radar nowcast'),
    soft(fetchJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${meta.lat}&longitude=${meta.lon}&current=us_aqi,us_aqi_pm2_5,us_aqi_pm10,us_aqi_ozone,us_aqi_nitrogen_dioxide,uv_index&hourly=uv_index&forecast_days=2&timeformat=unixtime&timezone=GMT`), 'Air quality'),
  ]);
  const now = Date.now();
  const periods = hourly.properties.periods;
  const latest = observations?.features?.[0] ?? null;
  const current = currentConditions(latest, periods, now);
  const station = current.source === 'station' ? stationDetails(observations) : null;
  const quarters = openMeteo ? quarterHours(openMeteo, now, 5) : null;
  const top = headline(nextHour(periods, now, meta.tz, grid), radar?.summary, quarters, meta.tz);
  const [first, second] = forecast.properties.periods;
  return {
    savedAt: now,
    place: meta.state ? `${meta.city}, ${meta.state}` : meta.city,
    where, note,
    lat: meta.lat, lon: meta.lon,
    tz: meta.tz,
    isDay: sunElevation(now, meta.lat, meta.lon) > -0.833,
    sunset: sunsetOn(now, meta.lat, meta.lon, meta.tz),
    current,
    station,
    stationName: meta.station.name.split(',')[0],
    headline: top.text,
    ring: minuteRing(quarters, radar ? { validMs: radar.validMs, series: radar.series } : null, now),
    cover: skyCoverAt(grid, now),
    air: airQuality?.current ? airReport(airQuality, now, meta.tz) : null,
    outlook: [first, second].map((p) => ({ name: p.name, isDay: p.isDaytime, temp: p.temperature, short: p.shortForecast, detail: p.detailedForecast })),
  };
}

const deg = (v) => (v == null ? '--' : `${v}°`);
const dash = (v, unit = '') => (v == null ? '—' : `${v}${unit}`);

// 60 minute ticks around a circle; minute 0 sits at the top under "Now".
function ringSVG(ring) {
  const ticks = ring.map((level, i) => {
    const a = (i / 60) * 2 * Math.PI;
    const [sx, sy] = [Math.sin(a), -Math.cos(a)];
    const r1 = 118, r2 = 146;
    return `<line class="tick l${level}" x1="${(150 + sx * r1).toFixed(1)}" y1="${(150 + sy * r1).toFixed(1)}" x2="${(150 + sx * r2).toFixed(1)}" y2="${(150 + sy * r2).toFixed(1)}"/>`;
  }).join('');
  return `<svg class="ring" viewBox="0 0 300 300" aria-hidden="true">${ticks}</svg>`;
}

const TREND = { rising: '↑', falling: '↓', steady: '→' };

function rows(m) {
  const s = m.station ?? {};
  const a = m.air;
  return [
    [['Feels like', s.feelsF == null ? '—' : `${s.feelsF}° F`]],
    [['Wind', s.windMph == null ? '—' : s.windMph === 0 ? 'Calm' : `${s.windDir} ${s.windMph} mph`], ['Wind gusts', dash(s.gustMph, ' mph')]],
    [['Humidity', dash(s.humidity, '%')], ['Dew point', s.dewF == null ? '—' : `${s.dewF}° F`]],
    [['UV index', a ? `${a.uv} (${a.uvBand.label})` : '—'], ['Cloud cover', `${m.cover}%`], ['Visibility', dash(s.visMi, ' mi')], ['Cloud ceiling', s.ceilingFt == null ? 'Unlimited' : `${s.ceilingFt.toLocaleString('en-US')} ft`]],
    [['Air quality', a ? `${a.aqi} (${a.aqiBand.label})` : '—'], ['Pressure', s.pressureIn == null ? '—' : `${s.pressureTrend ? `${TREND[s.pressureTrend]} ` : ''}${s.pressureIn.toFixed(2)} in`]],
  ];
}

function render(m, stale) {
  const updated = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: m.tz, timeZoneName: 'short' }).format(m.savedAt);
  const dateLabel = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: m.tz }).format(m.savedAt).toUpperCase();
  const kind = weatherKind(m.current.text, m.isDay, m.current.tempF);
  const feels = m.station?.feelsF ?? null;
  document.title = `${m.place.split(',')[0]} Today`;
  app.innerHTML = `
    <div class="place">${esc(m.place)}${m.where ? ` <small>· ${esc(m.where)}</small>` : ''}</div>
    ${m.note ? `<div class="notice">${esc(m.note)}</div>` : ''}
    ${stale ? `<div class="notice">Showing ${esc(updated)} data. weather.gov isn't responding right now.</div>` : ''}
    <section class="glass now-card" aria-labelledby="now-h">
      <h2 class="label" id="now-h">Next 60 minutes</h2>
      <p class="headline">${esc(m.headline)}</p>
      <div class="dial">
        <div class="now-mark">Now</div>
        ${ringSVG(m.ring)}
        <div class="dial-center">
          <span class="dial-icon">${iconSVG(kind, { hero: true, label: m.current.text })}</span>
          <span class="big-temp tab">${deg(m.current.tempF)}</span>
          ${feels == null ? '' : `<div class="feels">Feels like ${feels}°</div>`}
          <a class="pill" href="radar">See radar →</a>
        </div>
      </div>
      ${m.ring.some(Boolean) ? '<div class="ring-key"><span><i class="l1"></i>Light</span><span><i class="l2"></i>Moderate</span><span><i class="l3"></i>Heavy</span></div>' : ''}
      <p class="updated">Updated as of ${esc(updated)}</p>
    </section>

    <details class="glass list-card" open>
      <summary><span class="when-closed">Show current conditions</span><span class="when-open">Close current conditions</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 10l5-5 5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></summary>
      ${rows(m).map((group) => `<dl class="group">${group.map(([k, v]) => `<div class="row"><dt>${esc(k)}</dt><dd class="tab">${esc(v)}</dd></div>`).join('')}</dl>`).join('')}
      <p class="source">${m.station ? `Measured at ${esc(m.stationName)}` : 'No recent station reading'}. UV and air quality from Open-Meteo.</p>
    </details>

    <section class="glass" aria-labelledby="today-h">
      <div class="card-head"><h2 class="label" id="today-h">${m.outlook[0].isDay ? "Today's weather" : "Tonight's weather"}</h2><span class="date">${esc(dateLabel)}</span></div>
      <div>
        ${m.outlook.map((p) => `
          <div class="period">
            <div class="p-head"><span class="p-label">${p.isDay ? 'High' : 'Low'}</span><span class="p-temp tab">${deg(p.temp)}</span><span class="p-icon">${iconSVG(weatherKind(p.short, p.isDay, p.temp), { label: p.short })}</span></div>
            <p class="p-text">${p === m.outlook[0] ? esc(p.detail) : `${esc(p.name)}: ${esc(p.short)}`}</p>
          </div>`).join('')}
      </div>
      ${m.sunset ? `<div class="sunset"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17a6 6 0 0 1 12 0z" fill="#f5c451"/><path d="M2 17h20M12 3v5m-2.5-2.5L12 8l2.5-2.5M4.2 10.2l1.4 1.4M19.8 10.2l-1.4 1.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>Sunset<span class="tab">${esc(formatClock(m.sunset, m.tz))}</span></div>` : ''}
    </section>`;
  paintSky(m);
}

function renderError() {
  app.innerHTML = `
    <section class="glass now-card">
      <p class="headline">The forecast didn't load.</p>
      <p class="updated">weather.gov isn't responding. It usually recovers within a few minutes.</p>
      <button type="button" class="pill" id="retry">Try again</button>
    </section>`;
  document.getElementById('retry').addEventListener('click', refresh);
}

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && darkQuery.matches);

function paintSky(m) {
  const sky = skyGradient(sunElevation(Date.now(), m.lat, m.lon), m.cover);
  document.documentElement.style.setProperty('--sky-top', sky.top);
  document.documentElement.style.setProperty('--sky-bottom', sky.bottom);
  document.querySelector('meta[name="theme-color"]').content = isDark() ? '#0b111c' : sky.top;
}

function applyTheme(choice) {
  if (choice === 'light' || choice === 'dark') document.documentElement.dataset.theme = choice;
  else delete document.documentElement.dataset.theme;
  store.set('wx:theme', choice);
  document.querySelectorAll('[data-theme-choice]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeChoice === choice)));
  const m = store.get('wx:today');
  if (m) paintSky(m);
}

document.querySelectorAll('[data-theme-choice]').forEach((b) => b.addEventListener('click', () => applyTheme(b.dataset.themeChoice)));
darkQuery.addEventListener('change', () => { const m = store.get('wx:today'); if (m) paintSky(m); });
applyTheme(store.get('wx:theme') ?? 'auto');

let busy = false;
let again = false;
async function refresh() {
  if (busy) { again = true; return; }
  busy = true;
  try {
    const model = await buildModel();
    store.set('wx:today', model);
    render(model, false);
  } catch (err) {
    console.error(err);
    const last = store.get('wx:today');
    if (last) render(last, true); else renderError();
  } finally {
    busy = false;
    if (again) { again = false; refresh(); }
  }
}

mountSearch((place) => {
  app.innerHTML = `<div class="place">${esc(place ? place.name : 'Your location')}</div><section class="glass now-card"><p class="headline">Loading today…</p></section>`;
  refresh();
});

const last = store.get('wx:today');
if (last) render(last, false);
refresh();
setInterval(refresh, REFRESH_MS);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
