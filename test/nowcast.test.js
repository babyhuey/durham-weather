import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rgbaToDbz, dbzToRgb, dbzToRate, downsample, estimateShift, estimateMotion, advect, pointSeries,
  summarize, comingFrom, lonLatToPixel, pixelToLonLat, mosaicTiles, recordForecast, reconcile, scorecard,
  NO_ECHO, RAIN_DBZ, echoCount,
} from '../public/nowcast.js';

const W = 120, H = 120;
// A storm cell with a 45 dBZ core, centered at (cx, cy).
function blob(cx, cy, r = 9) {
  const g = new Float32Array(W * H).fill(NO_ECHO);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d < r) g[y * W + x] = 45 - d * 2;
    }
  }
  return g;
}
const fmt = (ms) => new Date(ms).toISOString().slice(11, 16);

test('palette colors decode back to the same reflectivity', () => {
  for (const dbz of [11, 20, 35.5, 60]) {
    const rgba = new Uint8ClampedArray([...dbzToRgb(dbz), 255]);
    assert.equal(rgbaToDbz(rgba, 1, 1)[0], dbz);
  }
  assert.equal(rgbaToDbz(new Uint8ClampedArray([0, 0, 0, 0]), 1, 1)[0], NO_ECHO);
});

test('rain rate follows Marshall-Palmer and ignores light returns', () => {
  assert.equal(dbzToRate(15), 0);
  assert.ok(Math.abs(dbzToRate(40) - 11.5) < 0.2);
});

test('downsample keeps the strongest echo', () => {
  const g = new Float32Array(16).fill(NO_ECHO);
  g[5] = 40;
  const d = downsample(g, 4, 4, 2);
  assert.deepEqual([...d.grid], [40, NO_ECHO, NO_ECHO, NO_ECHO]);
});

test('estimateShift recovers a known displacement', () => {
  const s = estimateShift(blob(50, 60), blob(56, 56), W, H);
  assert.ok(Math.abs(s.dx - 6) < 0.3 && Math.abs(s.dy + 4) < 0.3, JSON.stringify(s));
  assert.equal(estimateShift(new Float32Array(W * H).fill(NO_ECHO), blob(50, 50), W, H), null);
});

test('estimateMotion gives the per-step motion of a moving cell', () => {
  // Newest first; the cell moves (+3, -2) px per step.
  const frames = [0, 1, 2, 3].map((k) => blob(50 - 3 * k, 60 + 2 * k));
  const m = estimateMotion(frames, W, H);
  assert.ok(Math.abs(m.dx - 3) < 0.3 && Math.abs(m.dy + 2) < 0.3, JSON.stringify(m));
});

test('advect slides the field along the motion', () => {
  const moved = advect(blob(40, 40), W, H, { dx: 2, dy: 1 }, 5);
  assert.ok(moved[45 * W + 50] > 40, 'core should now sit at (50, 45)');
  assert.ok(moved[40 * W + 40] < RAIN_DBZ);
});

test('a cell moving toward the point is forecast to arrive', () => {
  const motion = { dx: 3, dy: -2 };
  const series = pointSeries(blob(50, 60), W, H, 80, 40, motion, 14);
  const first = series.findIndex((d) => d >= RAIN_DBZ);
  assert.ok(first >= 5 && first <= 8, `arrives at step ${first}`);
  const s = summarize({ series, validMs: Date.parse('2026-09-24T18:00:00Z'), motion, kmPerPx: 2, echoes: 200, fmt });
  assert.equal(s.rainNow, false);
  assert.equal(s.rainSoon, true);
  assert.equal(s.from, 'southwest');
  assert.match(s.text, /^Heavy rain arriving around 18:[34]\d, moving in from the southwest at \d+ mph\.$/);
});

test('summaries for rain now, rain nearby, and clear radar', () => {
  const base = { validMs: 0, motion: { dx: 0, dy: 3 }, kmPerPx: 2, fmt };
  assert.match(summarize({ ...base, series: [25, 25, 25, 10, 10], echoes: 50 }).text, /^Light rain on radar right now, clearing around 00:18\.$/);
  assert.match(summarize({ ...base, series: [35, 35, 35], echoes: 50 }).text, /continuing past 00:12/);
  assert.equal(summarize({ ...base, series: [10, 10], echoes: 50 }).text, 'Rain on radar nearby, but none headed your way in the next hour.');
  assert.equal(summarize({ ...base, series: [NO_ECHO], echoes: 0 }).text, 'Radar is clear for about 150 miles around you.');
});

test('comingFrom names where the rain starts', () => {
  assert.equal(comingFrom({ dx: 0, dy: 3 }), 'north');
  assert.equal(comingFrom({ dx: -3, dy: 0 }), 'east');
  assert.equal(comingFrom({ dx: 2, dy: -2 }), 'southwest');
});

test('mercator helpers round-trip and the mosaic centers the point', () => {
  const p = lonLatToPixel(36.091, -78.902, 7);
  const back = pixelToLonLat(p.x, p.y, 7);
  assert.ok(Math.abs(back.lat - 36.091) < 1e-9 && Math.abs(back.lon + 78.902) < 1e-9);
  const m = mosaicTiles(36.091, -78.902, 7);
  assert.equal(m.tiles.length, 4);
  assert.ok(m.px >= 128 && m.px <= 384 && m.py >= 128 && m.py <= 384, JSON.stringify(m));
  assert.ok(m.kmPerPx > 0.95 && m.kmPerPx < 1.0);
});

test('accuracy log records, reconciles and scores forecasts', () => {
  const t0 = Date.parse('2026-09-24T18:00:00Z');
  const step = 6 * 60000;
  let log = recordForecast([], { place: 'a', validMs: t0, wet: Array(15).fill(false).map((_, k) => k >= 5) });
  log = recordForecast(log, { place: 'a', validMs: t0, wet: Array(15).fill(true) });
  assert.equal(log.length, 3, 'duplicate issues are ignored');
  log = reconcile(log, { place: 'a', validMs: t0 + 3 * step, wetNow: false });
  log = reconcile(log, { place: 'a', validMs: t0 + 5 * step, wetNow: true });
  log = reconcile(log, { place: 'b', validMs: t0 + 10 * step, wetNow: true });
  const card = scorecard(log);
  assert.deepEqual(card.map((c) => [c.minutes, c.checks, c.right, c.hits, c.rainEvents]), [[18, 1, 1, 0, 0], [30, 1, 1, 1, 1], [60, 0, 0, 0, 0]]);
  assert.equal(echoCount(blob(50, 50)) > 100, true);
});
