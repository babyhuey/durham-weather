import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseDuration, expandSeries, expandAmounts, buildDays, nextHour, hourStrip,
  currentConditions, nearestStation, sunElevation, skyGradient, skyCoverAt, precipWord,
  windMph, compass, notableGust,
} from '../public/weather.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const grid = load('grid');
const periods = load('hourly').properties.periods;
const observation = load('observation');
const stations = load('stations');
const TZ = 'America/New_York';
// Fixtures were captured 2026-09-24 at 10:38 AM EDT.
const NOW = Date.parse('2026-09-24T14:38:00Z');

test('parseDuration handles hours, days and minutes', () => {
  assert.equal(parseDuration('PT1H'), 1);
  assert.equal(parseDuration('PT13H'), 13);
  assert.equal(parseDuration('P1DT6H'), 30);
  assert.equal(parseDuration('P2D'), 48);
  assert.equal(parseDuration('PT30M'), 1);
});

test('expandSeries repeats a value across its interval', () => {
  const m = expandSeries([{ validTime: '2026-09-24T07:00:00+00:00/PT2H', value: 15 }]);
  assert.deepEqual([...m.values()], [15, 15]);
  assert.equal([...m.keys()][1], Date.parse('2026-09-24T08:00:00Z'));
});

test('expandAmounts spreads a total across its interval', () => {
  const m = expandAmounts([{ validTime: '2026-09-24T12:00:00+00:00/PT6H', value: 0.6 }]);
  assert.equal(m.size, 6);
  assert.ok(Math.abs([...m.values()].reduce((a, b) => a + b) - 0.6) < 1e-9);
});

test('buildDays gives real highs, lows, chances and totals', () => {
  const days = buildDays(grid, periods, TZ, NOW);
  assert.equal(days.length, 7);
  assert.deepEqual(days.map((d) => d.label), ['Today', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed']);
  assert.deepEqual(days.slice(0, 3).map((d) => [d.low, d.high]), [[56, 66], [50, 70], [47, 78]]);
  assert.equal(days[0].precipIn.toFixed(2), '0.02');
  assert.equal(days[1].precipIn, 0);
  assert.ok(days[0].pop >= 28);
  assert.match(days[0].condition, /Rain/);
  assert.equal(days[1].condition, 'Sunny');
});

test('buildDays shows no total once precip amounts run out', () => {
  const days = buildDays(grid, periods, TZ, NOW);
  // Amounts end 2026-09-27 18Z, partway through Sunday.
  assert.equal(days[2].precipIn, 0);
  assert.equal(days[3].precipIn, null);
  assert.equal(days[6].precipIn, null);
});

test('nextHour describes rain now and when it clears', () => {
  const n = nextHour(periods, NOW, TZ);
  assert.equal(n.text, 'Rain possible this hour (28%). Drying out by 1 PM.');
  assert.equal(n.tempNow, 58);
  assert.equal(n.tempNext, 59);
  assert.equal(n.wind, 'N 13 mph');
});

test('nextHour covers dry and wet-all-window cases', () => {
  const mk = (pops, text = 'Chance Showers') => pops.map((p, i) => ({
    startTime: new Date(NOW - 1800000 + i * 3600000).toISOString(),
    endTime: new Date(NOW + 1800000 + i * 3600000).toISOString(),
    probabilityOfPrecipitation: { value: p }, shortForecast: p >= 20 ? text : 'Cloudy',
    temperature: 60, windDirection: 'S', windSpeed: '5 mph',
  }));
  assert.equal(nextHour(mk(Array(12).fill(0)), NOW, TZ).text, 'Dry for the next 12 hours.');
  assert.equal(nextHour(mk([5, 5, 40, 60]), NOW, TZ).text, 'Dry this hour. Rain chances reach 40% around 12 PM.');
  assert.match(nextHour(mk(Array(12).fill(70), 'Thunderstorms Likely'), NOW, TZ).text, /^Storms likely this hour \(70%\)\. Wet through at least /);
});

test('hourStrip starts at the current hour', () => {
  const h = hourStrip(periods, NOW, TZ);
  assert.equal(h.length, 12);
  assert.deepEqual(h.slice(0, 4).map((x) => x.label), ['Now', '11a', '12p', '1p']);
  assert.deepEqual(h.slice(0, 2).map((x) => [x.temp, x.pop]), [[58, 28], [59, 28]]);
});

test('currentConditions prefers a fresh station reading', () => {
  const c = currentConditions(observation, periods, NOW);
  assert.deepEqual(c, { tempF: 54, text: 'Cloudy', source: 'station' });
});

test('currentConditions borrows forecast wording when the station reports no description', () => {
  const blank = { properties: { ...observation.properties, textDescription: '' } };
  assert.equal(currentConditions(blank, periods, NOW).text, 'Chance Light Rain');
});

test('currentConditions falls back to the forecast when the reading is stale or missing', () => {
  const later = NOW + 3 * 3600000;
  assert.equal(currentConditions(observation, periods, later).source, 'forecast');
  assert.equal(currentConditions(null, periods, NOW).tempF, 58);
});

test('nearestStation picks the closest by distance', () => {
  const s = nearestStation(stations, 36.091, -78.902);
  assert.equal(s.id, 'KTDF');
  assert.ok(s.km > 22 && s.km < 24);
});

test('sunElevation is high at midday and negative at midnight in Durham', () => {
  const noon = sunElevation(Date.parse('2026-09-24T17:15:00Z'), 36.091, -78.902);
  const midnight = sunElevation(Date.parse('2026-09-25T04:00:00Z'), 36.091, -78.902);
  assert.ok(noon > 50 && noon < 56, `noon ${noon}`);
  assert.ok(midnight < -40, `midnight ${midnight}`);
});

test('skyGradient moves from clear blue to overcast grey to night', () => {
  assert.equal(skyGradient(50, 0).top, '#2a78d2');
  assert.equal(skyGradient(50, 100).top, '#56697f');
  assert.equal(skyGradient(-30, 0).top, '#0a1430');
  assert.equal(skyGradient(-30, 0).night, true);
  assert.ok(skyCoverAt(grid, NOW) > 50);
});

test('wind helpers parse speeds, compass points and notable gusts', () => {
  assert.equal(windMph('13 mph'), 13);
  assert.equal(windMph('10 to 15 mph'), 15);
  assert.equal(windMph(''), 0);
  assert.deepEqual([0, 20, 180, 337, 355].map(compass), ['N', 'NNE', 'S', 'NNW', 'N']);
  assert.equal(notableGust(24, 13), 24);
  assert.equal(notableGust(17, 5), null);
  assert.equal(notableGust(22, 20), null);
});

test('hourly, next-hour and daily wind come from the real forecast', () => {
  const h = hourStrip(periods, NOW, TZ, 12, grid);
  assert.deepEqual([h[0].windDir, h[0].wind, h[0].gust], ['N', 13, 24]);
  assert.equal(nextHour(periods, NOW, TZ, grid).gust, 24);
  const days = buildDays(grid, periods, TZ, NOW);
  assert.deepEqual([days[0].windDir, days[0].wind, days[0].gust], ['NNE', 13, 25]);
  assert.deepEqual([days[2].windDir, days[2].wind, days[2].gust], ['NNW', 8, null]);
});

test('precipWord maps forecast text to a short noun', () => {
  assert.equal(precipWord('Chance Light Rain'), 'Rain');
  assert.equal(precipWord('Slight Chance Rain And Snow'), 'Snow');
  assert.equal(precipWord('Chance Freezing Rain'), 'Wintry mix');
  assert.equal(precipWord('Isolated Thunderstorms'), 'Storms');
});
