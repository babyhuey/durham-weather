import {
  buildDays, nextHour, hourStrip, currentConditions, nearestStation,
  sunElevation, skyGradient, skyCoverAt,
} from './weather.js';
import { iconSVG, weatherKind, quip } from './icons.js';

const HOME = { lat: 36.091, lon: -78.902 };
const API = 'https://api.weather.gov';
const REFRESH_MS = 10 * 60000;
const app = document.getElementById('app');

const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const round3 = (n) => Math.round(n * 1000) / 1000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class HttpError extends Error {
  constructor(status, url) { super(`HTTP ${status} from ${url}`); this.status = status; }
}

async function fetchJSON(url, attempt = 0) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/geo+json' } });
    if (!res.ok) throw new HttpError(res.status, url);
    return await res.json();
  } catch (err) {
    const retryable = !(err instanceof HttpError) || err.status >= 500;
    if (retryable && attempt === 0) { await wait(1500); return fetchJSON(url, 1); }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    const timer = setTimeout(() => resolve(null), 5000);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(timer); resolve({ lat: round3(p.coords.latitude), lon: round3(p.coords.longitude) }); },
      () => { clearTimeout(timer); resolve(null); },
      { timeout: 5000, maximumAge: 10 * 60000 },
    );
  });
}

async function getMeta({ lat, lon }) {
  const key = `wx:meta:${lat},${lon}`;
  const cached = store.get(key);
  if (cached) return cached;
  const points = (await fetchJSON(`${API}/points/${lat},${lon}`)).properties;
  const stations = await fetchJSON(points.observationStations);
  const meta = {
    lat, lon,
    tz: points.timeZone,
    city: points.relativeLocation.properties.city,
    grid: `${points.gridId} ${points.gridX},${points.gridY}`,
    gridUrl: points.forecastGridData,
    hourlyUrl: points.forecastHourly,
    station: nearestStation(stations, lat, lon),
  };
  store.set(key, meta);
  return meta;
}

async function resolveLocation() {
  const here = await getPosition();
  if (here) {
    try { return { meta: await getMeta(here), where: 'near you' }; } catch (err) {
      if (!(err instanceof HttpError && err.status === 404)) throw err;
      return { meta: await getMeta(HOME), where: 'home', note: 'weather.gov only covers the US, so this is the Durham forecast.' };
    }
  }
  return { meta: await getMeta(HOME), where: 'home' };
}

async function buildModel() {
  const { meta, where, note } = await resolveLocation();
  const [grid, hourly, observation] = await Promise.all([
    fetchJSON(meta.gridUrl),
    fetchJSON(meta.hourlyUrl),
    fetchJSON(`${API}/stations/${meta.station.id}/observations/latest`).catch(() => null),
  ]);
  const now = Date.now();
  const periods = hourly.properties.periods;
  const days = buildDays(grid, periods, meta.tz, now);
  const next = nextHour(periods, now, meta.tz, grid);
  const current = currentConditions(observation, periods, now);
  const isDay = sunElevation(now, meta.lat, meta.lon) > -0.833;
  return {
    kind: weatherKind(current.text, isDay, current.tempF),
    savedAt: now,
    place: meta.city, where, note,
    tz: meta.tz, grid: meta.grid, lat: meta.lat, lon: meta.lon,
    station: meta.station,
    current,
    today: days[0],
    next,
    hours: hourStrip(periods, now, meta.tz, 12, grid),
    days,
    cover: skyCoverAt(grid, now),
  };
}

function paintSky(m) {
  const sky = skyGradient(sunElevation(Date.now(), m.lat, m.lon), m.cover);
  document.documentElement.style.setProperty('--sky-top', sky.top);
  document.documentElement.style.setProperty('--sky-bottom', sky.bottom);
  document.querySelector('meta[name="theme-color"]').content = sky.top;
  drizzle(m.next.pop >= 40);
}

const inches = (v) => (v == null ? '—' : `${v.toFixed(2)}″`);
const deg = (v) => (v == null ? '--' : `${v}°`);

function render(m, stale) {
  const updated = new Date(m.savedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: m.tz });
  const source = m.current.source === 'station'
    ? `Measured at ${esc(m.station.name.split(',')[0])} · ${Math.round(m.station.km)} km away`
    : 'Forecast for this hour (no recent station reading)';
  const notices = [
    m.note,
    stale && `Showing ${updated} data. weather.gov isn't responding right now.`,
  ].filter(Boolean);
  const nowKind = m.kind ?? weatherKind(m.current.text, true, m.current.tempF);

  app.innerHTML = `
    <section class="now">
      <div class="now-text">
        <div class="place">${esc(m.place)} <small>· ${esc(m.where)}</small></div>
        <div class="temp tab">${deg(m.current.tempF)}</div>
        <div class="cond tab">${esc(m.current.text)} · H ${deg(m.today.high)} L ${deg(m.today.low)}</div>
        <div class="source">${source}</div>
      </div>
      <figure class="hero">
        ${iconSVG(nowKind, { hero: true, label: m.current.text })}
        <figcaption class="quip">${esc(quip(nowKind))}</figcaption>
      </figure>
    </section>
    <div class="col">
      ${notices.map((n) => `<div class="notice">${esc(n)}</div>`).join('')}
      <section class="glass" aria-labelledby="next-h">
        <h2 class="label" id="next-h">Next hour</h2>
        <p class="next-text">${esc(m.next.text)}</p>
        <div class="next-meta tab"><span>${deg(m.next.tempNow)} → ${deg(m.next.tempNext)}</span><span>Wind ${esc(m.next.wind)}${m.next.gust ? `, gusts ${m.next.gust} mph` : ''}</span></div>
      </section>
      <section class="glass" aria-labelledby="hours-h">
        <h2 class="label" id="hours-h">Next 12 hours · chance of rain · wind mph</h2>
        <div class="hours tab" tabindex="0">
          ${m.hours.map((h) => `
            <div>
              <div>${esc(h.label)}</div>
              <div class="h-icon">${iconSVG(weatherKind(h.text, h.isDay ?? true, h.temp), { label: h.text })}</div>
              <div class="bar"><i style="height:${Math.max(Number(h.pop) || 0, 3)}%"></i></div>
              <div class="h-temp">${deg(h.temp)}</div>
              <div class="h-pop">${h.pop}%</div>
              ${h.wind == null ? '' : `<div class="h-wind">${esc(h.windDir)} ${h.wind}</div>`}
              ${h.gust ? `<div class="gust">gust ${h.gust}</div>` : ''}
            </div>`).join('')}
        </div>
      </section>
    </div>
    <div class="col">
      <section class="glass tab" aria-labelledby="days-h">
        <h2 class="label" id="days-h">7 days</h2>
        <div class="day day-key"><span></span><span></span><span class="d-cond"></span><span class="d-pop">chance</span><span class="d-range">low – high</span><span class="d-wind">wind</span><span class="d-total">total</span></div>
        ${m.days.map((d) => `
          <div class="day">
            <span>${esc(d.label)}</span>
            <span class="d-icon">${iconSVG(weatherKind(d.condition, true, d.high), { label: d.condition })}</span>
            <span class="d-cond" title="${esc(d.condition)}">${esc(d.condition)}</span>
            <span class="d-pop">${d.pop}%</span>
            <span class="d-range"><span class="lo">${deg(d.low)}</span> – ${deg(d.high)}</span>
            <span class="d-wind">${d.wind == null ? '—' : `${esc(d.windDir)} ${d.wind}`}${d.gust ? `<span class="gust">gust ${d.gust}</span>` : ''}</span>
            <span class="d-total">${inches(d.precipIn)}</span>
          </div>`).join('')}
      </section>
      <p class="foot">
        Updated ${updated} · weather.gov grid ${esc(m.grid)}<br>
        <a href="https://forecast.weather.gov/MapClick.php?lat=${m.lat}&lon=${m.lon}" target="_blank" rel="noopener">Full forecast on weather.gov</a>
      </p>
    </div>`;
  paintSky(m);
}

function renderError() {
  app.innerHTML = `
    <section class="glass error">
      <div class="next-text">The forecast didn't load.</div>
      <p class="cond">weather.gov isn't responding. It usually recovers within a few minutes.</p>
      <button type="button" id="retry">Try again</button>
    </section>`;
  document.getElementById('retry').addEventListener('click', refresh);
}

let busy = false;
async function refresh() {
  if (busy) return;
  busy = true;
  try {
    const model = await buildModel();
    store.set('wx:last', model);
    render(model, false);
  } catch (err) {
    console.error(err);
    const last = store.get('wx:last');
    if (last) render(last, true); else renderError();
  } finally {
    busy = false;
  }
}

let rain = null;
function sizeCanvas() {
  const canvas = document.getElementById('drizzle');
  canvas.width = innerWidth * devicePixelRatio;
  canvas.height = innerHeight * devicePixelRatio;
}
addEventListener('resize', sizeCanvas);

function drizzle(on) {
  const canvas = document.getElementById('drizzle');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!on || reduce) {
    if (rain) { cancelAnimationFrame(rain.frame); rain = null; }
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  if (rain) return;
  const ctx = canvas.getContext('2d');
  const drops = [];
  sizeCanvas();
  for (let i = 0; i < 90; i++) {
    drops.push({ x: Math.random(), y: Math.random(), len: 10 + Math.random() * 14, speed: 0.6 + Math.random() * 0.5 });
  }
  rain = { frame: 0 };
  const step = () => {
    const w = canvas.width, h = canvas.height, s = devicePixelRatio;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.2 * s;
    ctx.beginPath();
    for (const d of drops) {
      d.y += (d.speed * 9 * s) / h;
      if (d.y > 1.05) { d.y = -0.05; d.x = Math.random(); }
      const x = d.x * w, y = d.y * h;
      ctx.moveTo(x, y);
      ctx.lineTo(x - d.len * 0.25 * s, y + d.len * s);
    }
    ctx.stroke();
    rain.frame = requestAnimationFrame(step);
  };
  step();
}

const last = store.get('wx:last');
if (last) render(last, false);
refresh();
setInterval(refresh, REFRESH_MS);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
