import {
  rgbaToDbz, downsample, estimateMotion, pointSeries, summarize, echoCount, mosaicTiles,
  recordForecast, reconcile, RAIN_DBZ, STEP_MIN, TILE,
} from './nowcast.js';
import { fetchJSON, store } from './shared.js';

const IEM = 'https://mesonet.agron.iastate.edu';
const STEP_MS = STEP_MIN * 60000;
export const ZOOM = 7;
export const FACTOR = 2;
const FRAMES = 4;
const LOG_KEY = 'wx:nowcast-log2';
// Scores under the old key came from unfiltered radar in 5-minute steps and can't be mixed in.
try { localStorage.removeItem('wx:nowcast-log'); } catch { /* storage unavailable */ }

const stamp = (ms) => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 12);
export const radarTemplate = (ms) => `${IEM}/cache/tile.py/1.0.0/mrms::lcref-${stamp(ms)}/{z}/{x}/{y}.png`;

export async function latestValid() {
  const j = await fetchJSON(`${IEM}/data/gis/images/4326/mrms/lcref.json`);
  return Date.parse(j.meta.end_valid);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Radar tile failed: ${url}`));
    img.src = url;
  });
}

async function loadFrame(ms, mosaic) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TILE * 2;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const imgs = await Promise.all(mosaic.tiles.map((t) => loadImage(radarTemplate(ms).replace('{z}', mosaic.z).replace('{x}', t.x).replace('{y}', t.y))));
  mosaic.tiles.forEach((t, i) => ctx.drawImage(imgs[i], t.ox, t.oy));
  const dbz = rgbaToDbz(ctx.getImageData(0, 0, TILE * 2, TILE * 2).data, TILE * 2, TILE * 2);
  return downsample(dbz, TILE * 2, TILE * 2, FACTOR);
}

// The newest composite can be announced a minute or two before its tiles exist, so step back if needed.
async function loadFrames(mosaic) {
  let valid = await latestValid();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const frames = await Promise.all(Array.from({ length: FRAMES }, (_, k) => loadFrame(valid - k * STEP_MS, mosaic)));
      return { valid, frames };
    } catch {
      valid -= STEP_MS;
    }
  }
  throw new Error('Radar frames are unavailable right now.');
}

// The IEM national composite only covers the lower 48 states.
export const inRadarCoverage = (lat, lon) => lat > 24 && lat < 50 && lon > -125.5 && lon < -66;

export async function runNowcast(lat, lon, fmt) {
  if (!inRadarCoverage(lat, lon)) throw new Error('Radar composite covers the lower 48 states only.');
  const mosaic = mosaicTiles(lat, lon, ZOOM);
  const { valid, frames } = await loadFrames(mosaic);
  const { w, h } = frames[0];
  const grids = frames.map((f) => f.grid);
  const px = mosaic.px / FACTOR, py = mosaic.py / FACTOR;
  const kmPerPx = mosaic.kmPerPx * FACTOR;
  const motion = estimateMotion(grids, w, h);
  const series = pointSeries(grids[0], w, h, px, py, motion, 14);
  const summary = summarize({ series, validMs: valid, motion, kmPerPx, echoes: echoCount(grids[0]), fmt });

  const place = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  let log = store.get(LOG_KEY) ?? [];
  grids.forEach((g, k) => {
    const wetNow = pointSeries(g, w, h, px, py, null, 0)[0] >= RAIN_DBZ;
    log = reconcile(log, { place, validMs: valid - k * STEP_MS, wetNow });
  });
  log = recordForecast(log, { place, validMs: valid, wet: series.map((d) => d >= RAIN_DBZ) });
  store.set(LOG_KEY, log);

  return { validMs: valid, motion, series, summary, grid: grids[0], grids, w, h, px, py, kmPerPx, mosaic, log };
}
