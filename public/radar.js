import { HOME, getPosition } from './shared.js';
import { runNowcast, radarTemplate, latestValid, inRadarCoverage, ZOOM } from './radar-data.js';
import { advect, dbzToRgb, pixelToLonLat, scorecard, STEP_MIN, TILE } from './nowcast.js';
import { formatClock } from './weather.js';

const STEP_MS = STEP_MIN * 60000;
const PAST = 12;
const AHEAD = 12;
const SHOWN = 0.72;
const FORECAST_MIN_DBZ = 10;

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const clock = (ms) => formatClock(ms, tz);
const $ = (id) => document.getElementById(id);

const map = L.map('map', { zoomControl: false, attributionControl: false, minZoom: 5, maxZoom: 11 }).setView([HOME.lat, HOME.lon], 8);
L.control.attribution({ position: 'topright', prefix: false }).addTo(map);
const esri = (layer) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${layer}/MapServer/tile/{z}/{y}/{x}`;
const attribution = 'Map: Esri, HERE, Garmin, &copy; OpenStreetMap · Radar: <a href="https://mesonet.agron.iastate.edu/">Iowa Environmental Mesonet</a>';
L.tileLayer(esri('World_Dark_Gray_Base'), { attribution, maxNativeZoom: 16 }).addTo(map);
map.createPane('labels').style.zIndex = 450;
map.getPane('labels').style.pointerEvents = 'none';
L.tileLayer(esri('World_Dark_Gray_Reference'), { pane: 'labels', maxNativeZoom: 16 }).addTo(map);

const frames = [];
let current = 0;
let timer = null;

function show(i) {
  current = i;
  frames.forEach((f, k) => f.layer.setOpacity(k === i ? SHOWN : 0));
  const f = frames[i];
  $('time').textContent = clock(f.ms);
  $('chip').textContent = f.forecast ? 'Forecast' : 'Radar';
  $('chip').classList.toggle('forecast', f.forecast);
  $('scrub').value = i;
}

function play() {
  let hold = 0;
  timer = setInterval(() => {
    if (current === frames.length - 1 && hold++ < 3) return;
    hold = 0;
    show((current + 1) % frames.length);
  }, 450);
  $('play').textContent = 'Pause';
}

function pause() {
  clearInterval(timer);
  timer = null;
  $('play').textContent = 'Play';
}

$('play').addEventListener('click', () => (timer ? pause() : play()));
$('scrub').addEventListener('input', (e) => { pause(); show(Number(e.target.value)); });

function forecastImage(grid, w, h, motion, steps) {
  const moved = advect(grid, w, h, motion, steps);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let p = 0; p < w * h; p++) {
    if (moved[p] < FORECAST_MIN_DBZ) continue;
    const [r, g, b] = dbzToRgb(moved[p]);
    img.data.set([r, g, b, 255], p * 4);
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

function renderScore(log) {
  const rows = scorecard(log).map((s) => {
    if (s.checks < 5) return `<div><b>${s.minutes} min ahead:</b> not enough checks yet (${s.checks})</div>`;
    const pct = Math.round((s.right / s.checks) * 100);
    const caught = s.rainEvents ? `, caught ${s.hits} of ${s.rainEvents} rainy moments` : '';
    return `<div><b>${s.minutes} min ahead:</b> right ${s.right} of ${s.checks} times (${pct}%)${caught}</div>`;
  });
  $('score').innerHTML = rows.join('');
}

async function start() {
  const here = (await getPosition()) ?? HOME;
  map.setView([here.lat, here.lon], 8);
  L.marker([here.lat, here.lon], { icon: L.divIcon({ className: '', html: '<div class="you"></div>', iconSize: [14, 14] }), interactive: false }).addTo(map);
  if (!inRadarCoverage(here.lat, here.lon)) {
    $('summary').textContent = 'This radar only covers the lower 48 states, so there is nothing to show here.';
    $('time').textContent = '';
    return;
  }

  let nowcast = null;
  try {
    nowcast = await runNowcast(here.lat, here.lon, clock);
  } catch (err) {
    console.warn(err);
  }
  const valid = nowcast?.validMs ?? (await latestValid()) - STEP_MS;

  for (let k = PAST; k >= 0; k--) {
    const ms = valid - k * STEP_MS;
    frames.push({ ms, forecast: false, layer: L.tileLayer(radarTemplate(ms), { opacity: 0, maxNativeZoom: 10, crossOrigin: 'anonymous' }).addTo(map) });
  }

  if (nowcast?.motion) {
    const { mosaic, grid, w, h, motion } = nowcast;
    const nw = pixelToLonLat(mosaic.x0 * TILE, mosaic.y0 * TILE, ZOOM);
    const se = pixelToLonLat((mosaic.x0 + 2) * TILE, (mosaic.y0 + 2) * TILE, ZOOM);
    for (let k = 1; k <= AHEAD; k++) {
      const layer = L.imageOverlay(forecastImage(grid, w, h, motion, k), [[se.lat, nw.lon], [nw.lat, se.lon]], { opacity: 0, className: 'forecast-frame' }).addTo(map);
      frames.push({ ms: valid + k * STEP_MS, forecast: true, layer });
    }
  }

  $('summary').textContent = nowcast
    ? nowcast.summary.text + (nowcast.motion ? '' : ' (Not enough rain on radar to measure its motion, so there are no forecast frames.)')
    : 'Radar loop only: the radar forecast could not run right now.';
  if (nowcast) renderScore(nowcast.log);
  $('scrub').max = frames.length - 1;
  show(PAST);
  play();
}

start().catch((err) => {
  console.error(err);
  $('summary').innerHTML = `The radar didn't load. <button type="button" onclick="location.reload()">Try again</button>`;
});
