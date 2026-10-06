import { LCREF_PALETTE } from './lcref-palette.js';

export const RAIN_DBZ = 20;
export const NO_ECHO = -99;
export const TILE = 256;
export const STEP_MIN = 6;

const PALETTE = Array.from({ length: 256 }, (_, i) => parseInt(LCREF_PALETTE.slice(i * 6, i * 6 + 6), 16));
const LUT = new Map(PALETTE.map((rgb, i) => [rgb, i]));
export const indexToDbz = (i) => (i === 255 ? NO_ECHO : i * 0.5 - 32);
// Palette colors are distinct only from 11 dBZ (entry 86) to 80.5 dBZ (entry 225).
export const dbzToRgb = (dbz) => {
  const i = Math.max(86, Math.min(225, Math.round((dbz + 32) * 2)));
  return [(PALETTE[i] >> 16) & 255, (PALETTE[i] >> 8) & 255, PALETTE[i] & 255];
};

// Marshall-Palmer Z = 200 R^1.6, in mm/h.
export const dbzToRate = (dbz) => (dbz < RAIN_DBZ ? 0 : (10 ** (dbz / 10) / 200) ** (1 / 1.6));

export function rgbaToDbz(rgba, w, h) {
  const out = new Float32Array(w * h).fill(NO_ECHO);
  for (let p = 0; p < w * h; p++) {
    if (rgba[p * 4 + 3] === 0) continue;
    const i = LUT.get((rgba[p * 4] << 16) | (rgba[p * 4 + 1] << 8) | rgba[p * 4 + 2]);
    if (i !== undefined) out[p] = indexToDbz(i);
  }
  return out;
}

// Max-pool by `f` so a thin line of heavy rain survives downsampling.
export function downsample(grid, w, h, f) {
  const W = Math.floor(w / f), H = Math.floor(h / f);
  const out = new Float32Array(W * H).fill(NO_ECHO);
  for (let y = 0; y < H * f; y++) {
    for (let x = 0; x < W * f; x++) {
      const o = Math.floor(y / f) * W + Math.floor(x / f);
      if (grid[y * w + x] > out[o]) out[o] = grid[y * w + x];
    }
  }
  return { grid: out, w: W, h: H };
}

const weight = (dbz) => Math.max(0, dbz - RAIN_DBZ + 5);

// Displacement (dx, dy) in pixels that best maps echoes in `a` onto the later frame `b`.
export function estimateShift(a, b, w, h, maxShift = 10) {
  const pts = [];
  for (let y = maxShift; y < h - maxShift; y++) {
    for (let x = maxShift; x < w - maxShift; x++) {
      const v = weight(a[y * w + x]);
      if (v > 0) pts.push(y * w + x, v);
    }
  }
  if (pts.length / 2 < 20) return null;
  const size = 2 * maxShift + 1;
  const score = new Float64Array(size * size);
  for (let sy = -maxShift; sy <= maxShift; sy++) {
    for (let sx = -maxShift; sx <= maxShift; sx++) {
      let s = 0;
      const off = sy * w + sx;
      for (let k = 0; k < pts.length; k += 2) s += pts[k + 1] * weight(b[pts[k] + off]);
      score[(sy + maxShift) * size + sx + maxShift] = s;
    }
  }
  let best = 0;
  for (let i = 1; i < score.length; i++) if (score[i] > score[best]) best = i;
  if (score[best] <= 0) return null;
  const bx = best % size, by = Math.floor(best / size);
  const refine = (m, c, p) => {
    const d = m - 2 * c + p;
    return d < 0 ? (0.5 * (m - p)) / d : 0;
  };
  const at = (x, y) => score[y * size + x];
  const fx = bx > 0 && bx < size - 1 ? refine(at(bx - 1, by), at(bx, by), at(bx + 1, by)) : 0;
  const fy = by > 0 && by < size - 1 ? refine(at(bx, by - 1), at(bx, by), at(bx, by + 1)) : 0;
  return { dx: bx - maxShift - fx, dy: by - maxShift - fy, strength: score[best] };
}

// frames[0] is the newest; frames are STEP_MIN apart. Returns motion per step.
export function estimateMotion(frames, w, h, maxShift = 12) {
  const pairs = [[2, 0], [3, 1], [3, 0]].filter(([o]) => o < frames.length);
  let sx = 0, sy = 0, sw = 0;
  for (const [older, newer] of pairs) {
    const s = estimateShift(frames[older], frames[newer], w, h, maxShift);
    if (!s) continue;
    const steps = older - newer;
    sx += (s.dx / steps) * s.strength;
    sy += (s.dy / steps) * s.strength;
    sw += s.strength;
  }
  return sw ? { dx: sx / sw, dy: sy / sw } : null;
}

function bilinear(grid, w, h, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) return NO_ECHO;
  const fx = x - x0, fy = y - y0;
  const g = (xx, yy) => grid[yy * w + xx];
  return g(x0, y0) * (1 - fx) * (1 - fy) + g(x0 + 1, y0) * fx * (1 - fy) + g(x0, y0 + 1) * (1 - fx) * fy + g(x0 + 1, y0 + 1) * fx * fy;
}

// The latest frame slid forward `steps` times along the motion vector.
export function advect(grid, w, h, motion, steps) {
  const out = new Float32Array(w * h);
  const ox = motion.dx * steps, oy = motion.dy * steps;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = bilinear(grid, w, h, x - ox, y - oy);
  return out;
}

// Strongest echo within `radius` pixels of (px, py) at each lead step.
export function pointSeries(grid, w, h, px, py, motion, steps = 14, radius = 1) {
  const m = motion ?? { dx: 0, dy: 0 };
  return Array.from({ length: steps + 1 }, (_, k) => {
    let max = NO_ECHO;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        max = Math.max(max, bilinear(grid, w, h, px + dx - m.dx * k, py + dy - m.dy * k));
      }
    }
    return max;
  });
}

export const echoCount = (grid) => grid.reduce((n, v) => n + (v >= RAIN_DBZ ? 1 : 0), 0);

const WORDS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
// Compass word for where the rain is coming from, given screen-space motion (y points down).
export function comingFrom(motion) {
  const bearing = (Math.atan2(-motion.dx, motion.dy) * 180) / Math.PI;
  return WORDS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}

const intensity = (dbz) => (dbz >= 50 ? 'Heavy storms' : dbz >= 40 ? 'Heavy rain' : dbz >= 30 ? 'Moderate rain' : 'Light rain');

export function summarize({ series, validMs, motion, kmPerPx, echoes, fmt }) {
  const at = (k) => fmt(validMs + k * STEP_MIN * 60000);
  const wet = series.map((d) => d >= RAIN_DBZ);
  const peak = Math.max(...series);
  const speedMph = motion ? Math.round((Math.hypot(motion.dx, motion.dy) * kmPerPx * (60 / STEP_MIN)) / 1.609) : null;
  const moving = motion && speedMph >= 3 ? `, moving in from the ${comingFrom(motion)} at ${speedMph} mph` : '';
  const base = { rainNow: wet[0], rainSoon: wet.some(Boolean), speedMph, from: motion && speedMph >= 3 ? comingFrom(motion) : null };
  if (wet[0]) {
    const dry = wet.findIndex((w) => !w);
    const tail = dry > 0 ? `clearing around ${at(dry)}` : `continuing past ${at(series.length - 1)}`;
    return { ...base, text: `${intensity(peak)} on radar right now, ${tail}.` };
  }
  const start = wet.findIndex(Boolean);
  if (start > 0) return { ...base, text: `${intensity(peak)} arriving around ${at(start)}${moving}.` };
  if (echoes) return { ...base, text: 'Rain on radar nearby, but none headed your way in the next hour.' };
  return { ...base, text: 'Radar is clear for about 150 miles around you.' };
}

// Web Mercator pixel coordinates at zoom z.
export function lonLatToPixel(lat, lon, z) {
  const scale = TILE * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * scale, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale };
}

export function pixelToLonLat(x, y, z) {
  const scale = TILE * 2 ** z;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lon: (x / scale) * 360 - 180 };
}

// A 2x2 tile block that keeps the point at least half a tile from every edge.
export function mosaicTiles(lat, lon, z) {
  const p = lonLatToPixel(lat, lon, z);
  const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
  const x0 = p.x - tx * TILE < TILE / 2 ? tx - 1 : tx;
  const y0 = p.y - ty * TILE < TILE / 2 ? ty - 1 : ty;
  return {
    z, x0, y0,
    tiles: [[0, 0], [1, 0], [0, 1], [1, 1]].map(([i, j]) => ({ x: x0 + i, y: y0 + j, ox: i * TILE, oy: j * TILE })),
    px: p.x - x0 * TILE,
    py: p.y - y0 * TILE,
    kmPerPx: (40075.016 * Math.cos((lat * Math.PI) / 180)) / (TILE * 2 ** z),
  };
}

// --- Accuracy log: each forecast is checked when a radar frame for its target time arrives.
export const LEADS = [3, 5, 10];
const WEEK = 7 * 86400000;

export function recordForecast(log, { place, validMs, wet }) {
  const known = new Set(log.map((e) => `${e.place}|${e.issued}|${e.lead}`));
  const added = LEADS.filter((k) => k < wet.length && !known.has(`${place}|${validMs}|${k}`))
    .map((k) => ({ place, issued: validMs, lead: k, target: validMs + k * STEP_MIN * 60000, predicted: wet[k], observed: null }));
  return [...log.filter((e) => e.target > validMs - WEEK), ...added];
}

export function reconcile(log, { place, validMs, wetNow }) {
  return log.map((e) => (e.place === place && e.target === validMs && e.observed === null ? { ...e, observed: wetNow } : e));
}

export function scorecard(log) {
  return LEADS.map((lead) => {
    const done = log.filter((e) => e.lead === lead && e.observed !== null);
    const hits = done.filter((e) => e.predicted && e.observed).length;
    const misses = done.filter((e) => !e.predicted && e.observed).length;
    const right = done.filter((e) => e.predicted === e.observed).length;
    return { minutes: lead * STEP_MIN, checks: done.length, right, hits, rainEvents: hits + misses };
  });
}
