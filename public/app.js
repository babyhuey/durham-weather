import {
  buildDays, nextHour, hourStrip, currentConditions, nearestStation,
  sunElevation, skyGradient, skyCoverAt, quarterHours, headline, formatClock,
} from './weather.js';
import { iconSVG, weatherKind, quip, sillyDistance, nextUnit } from './icons.js';
import { HOME, store, esc, HttpError, fetchJSON, getPosition } from './shared.js';
import { runNowcast } from './radar-data.js';
import { miniFrames, drawMini } from './radar-mini.js';

const API = 'https://api.weather.gov';
const REFRESH_MS = 10 * 60000;
const app = document.getElementById('app');
let preview = null;
let previewTimer = null;

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
  const soft = (p, what) => p.catch((err) => { console.warn(`${what} unavailable`, err); return null; });
  const [grid, hourly, observation, openMeteo, radar] = await Promise.all([
    fetchJSON(meta.gridUrl),
    fetchJSON(meta.hourlyUrl),
    soft(fetchJSON(`${API}/stations/${meta.station.id}/observations/latest`), 'Station reading'),
    soft(fetchJSON(`https://api.open-meteo.com/v1/forecast?latitude=${meta.lat}&longitude=${meta.lon}&minutely_15=precipitation&forecast_minutely_15=12&past_minutely_15=1&timeformat=unixtime&timezone=GMT`), 'Open-Meteo'),
    soft(runNowcast(meta.lat, meta.lon, (ms) => formatClock(ms, meta.tz)), 'Radar nowcast'),
  ]);
  const now = Date.now();
  const periods = hourly.properties.periods;
  const days = buildDays(grid, periods, meta.tz, now);
  const quarters = openMeteo ? quarterHours(openMeteo, now) : null;
  const next = nextHour(periods, now, meta.tz, grid);
  const top = headline(next, radar?.summary, quarters, meta.tz);
  next.text = top.text;
  next.source = top.source;
  preview = radar ? { frames: miniFrames(radar), kmPerPx: radar.kmPerPx, tz: meta.tz } : null;
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
    quarters,
    radarRain: radar?.summary.rainNow ?? false,
    hours: hourStrip(periods, now, meta.tz, 12, grid),
    days,
    cover: skyCoverAt(grid, now),
  };
}

function paintSky(m) {
  const sky = skyGradient(sunElevation(Date.now(), m.lat, m.lon), m.cover);
  document.documentElement.style.setProperty('--sky-top', sky.top);
  document.documentElement.style.setProperty('--sky-bottom', sky.bottom);
  document.querySelector('meta[name="theme-color"]').content = isDark() ? '#0b111c' : sky.top;
  drizzle(m.radarRain || m.next.pop >= 40);
}

const inches = (v) => (v == null ? '—' : `${v.toFixed(2)}″`);
const deg = (v) => (v == null ? '--' : `${v}°`);

function render(m, stale) {
  const updated = new Date(m.savedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: m.tz });
  const pick = nextUnit(store.get('wx:units-seen') ?? []);
  store.set('wx:units-seen', pick.seen);
  const far = sillyDistance(m.station.km, pick.index);
  const source = m.current.source === 'station'
    ? `Measured at ${esc(m.station.name.split(',')[0])} · ${esc(far.text)} away (${far.miles})`
    : 'Forecast for this hour (no recent station reading)';
  const notices = [
    m.note,
    stale && `Showing ${updated} data. weather.gov isn't responding right now.`,
  ].filter(Boolean);
  const nowKind = m.kind ?? weatherKind(m.current.text, true, m.current.tempF);
  document.title = `${m.place} Weather`;

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
      ${notices.map((n) => `<div class="notice area-note">${esc(n)}</div>`).join('')}
      <section class="glass next-card" aria-labelledby="next-h">
        <h2 class="label" id="next-h">Next hour</h2>
        <p class="next-text">${esc(m.next.text)}</p>
        ${m.quarters?.length && !m.quarters.some((q) => q.mm > 0) ? '<div class="q-caption">HRRR model: no rain in the next 2 hours.</div>' : ''}
        ${m.quarters?.some((q) => q.mm > 0) ? `
          <div class="quarters tab" aria-label="Model rain every 15 minutes">
            ${m.quarters.map((q, i) => `
              <div class="q">
                <div class="q-bar"><i style="height:${Math.min(100, (q.mm / 2.5) * 100)}%"></i></div>
                <div class="q-amt">${q.mm >= 0.25 ? `${(q.mm / 25.4).toFixed(2).replace(/^0/, '')}″` : ''}</div>
                <div class="q-time">${i === 0 ? 'Now' : esc(formatClock(q.t, m.tz).replace(/ (AM|PM)/, ''))}</div>
              </div>`).join('')}
          </div>
          <div class="q-caption">Rain every 15 min · HRRR model</div>` : ''}
        <div class="next-meta tab"><span>${deg(m.next.tempNow)} → ${deg(m.next.tempNext)}</span><span>Wind ${esc(m.next.wind)}${m.next.gust ? `, gusts ${m.next.gust} mph` : ''}</span></div>
        <div class="next-foot"><span>Headline: ${esc(m.next.source ?? 'weather.gov')}</span></div>
      </section>
      ${preview ? `
        <a class="glass radar-card" href="radar" aria-label="Open the radar map">
          <div class="rc-head"><h2 class="label">Radar</h2><span class="rc-when tab" id="rc-when">Now</span></div>
          <canvas id="rc-canvas" aria-hidden="true"></canvas>
          <div class="rc-foot"><span>Last 15 minutes, then the forecast hour</span><span class="rc-open">Open map →</span></div>
        </a>` : ''}
      <section class="glass hours-card" aria-labelledby="hours-h">
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
      <section class="glass tab days-card" aria-labelledby="days-h">
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
      <p class="foot foot-area">
        Updated ${updated} · weather.gov grid ${esc(m.grid)}<br>
        <a href="radar">Radar map</a> · <a href="https://forecast.weather.gov/MapClick.php?lat=${m.lat}&lon=${m.lon}" target="_blank" rel="noopener">Full forecast on weather.gov</a>
      </p>
    </div>`;
  paintSky(m);
  startPreview();
}

function startPreview() {
  clearInterval(previewTimer);
  const canvas = document.getElementById('rc-canvas');
  if (!preview || !canvas) return;
  const { frames, kmPerPx, tz } = preview;
  const nowIndex = frames.findIndex((f) => f.forecast) - 1;
  const label = document.getElementById('rc-when');
  const show = (i) => {
    const f = frames[i];
    drawMini(canvas, f, kmPerPx);
    const mins = Math.round((f.ms - frames[nowIndex >= 0 ? nowIndex : frames.length - 1].ms) / 60000);
    label.textContent = mins === 0 ? 'Now' : mins < 0 ? `${-mins} min ago` : `Forecast +${mins} min`;
    label.classList.toggle('forecast', f.forecast);
    label.title = formatClock(f.ms, tz);
  };
  const rest = nowIndex >= 0 ? nowIndex : frames.length - 1;
  show(rest);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || frames.length < 2) return;
  let i = rest, hold = 0;
  previewTimer = setInterval(() => {
    if ((i === rest || i === frames.length - 1) && hold++ < 3) return;
    hold = 0;
    i = (i + 1) % frames.length;
    show(i);
  }, 450);
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

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && darkQuery.matches);

function applyTheme(choice) {
  if (choice === 'light' || choice === 'dark') document.documentElement.dataset.theme = choice;
  else delete document.documentElement.dataset.theme;
  store.set('wx:theme', choice);
  document.querySelectorAll('[data-theme-choice]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeChoice === choice)));
  const m = store.get('wx:last');
  if (m) paintSky(m);
}

document.querySelectorAll('[data-theme-choice]').forEach((b) => b.addEventListener('click', () => applyTheme(b.dataset.themeChoice)));
darkQuery.addEventListener('change', () => { const m = store.get('wx:last'); if (m) paintSky(m); });
applyTheme(store.get('wx:theme') ?? 'auto');

const last = store.get('wx:last');
if (last) render(last, false);
refresh();
setInterval(refresh, REFRESH_MS);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
