import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseDuration, expandSeries, expandAmounts, buildDays, nextHour, hourStrip,
  currentConditions, nearestStation, sunElevation, skyGradient, skyCoverAt, precipWord,
  windMph, compass, notableGust, quarterHours, headline, airReport, aqiBand, uvBand,
  stationDetails, minuteRing, sunsetOn,
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

test('quarterHours reads Open-Meteo unixtime data from the current quarter hour', () => {
  const om = load('open-meteo');
  const first = om.minutely_15.time[1] * 1000;
  const q = quarterHours(om, first + 5 * 60000);
  assert.equal(q.length, 8);
  assert.equal(q[0].t, first);
  assert.ok(q.every((x) => typeof x.mm === 'number'));
});

test('headline prefers radar, then the HRRR model, then weather.gov', () => {
  const t = Date.parse('2026-09-24T19:00:00Z');
  const nwsDry = { pop: 5, text: 'Dry for the next 12 hours.' };
  const nwsWet = { pop: 30, text: 'Rain possible this hour (30%). Drying out by 4 PM.' };
  const quarters = [0, 0, 0.4, 1].map((mm, i) => ({ t: t + i * 900000, mm }));
  assert.equal(headline(nwsWet, { rainSoon: true, text: 'Light rain arriving around 3:40 PM.' }, quarters, TZ).source, 'radar');
  assert.equal(headline(nwsDry, { rainSoon: false }, quarters, TZ).text, 'Dry for now, but the HRRR model shows rain starting around 3:30 PM.');
  assert.equal(headline(nwsWet, { rainSoon: false }, [], TZ).text, `${nwsWet.text} Nothing on radar headed your way yet.`);
  assert.equal(headline(nwsDry, null, null, TZ).source, 'weather.gov');
});

test('airReport reads AQI, its main pollutant and today\'s UV peak', () => {
  const aq = load('air-quality');
  const now = aq.current.time * 1000;
  const r = airReport(aq, now, TZ);
  assert.equal(r.aqi, 32);
  assert.deepEqual(r.aqiBand, { label: 'Good', color: '#3ec46d' });
  assert.equal(r.driver, 'ozone');
  assert.equal(r.uv, 2);
  assert.equal(r.uvBand.label, 'Low');
  // Fixture "now" is 2 PM; the day's peak of 4 (3.5 rounded) was at noon.
  assert.deepEqual(r.uvNext, { uv: 4, at: Date.parse('2026-09-24T16:00:00Z'), when: 'earlier' });
});

test('airReport looks ahead before the peak and to tomorrow at night', () => {
  const aq = load('air-quality');
  const morning = { ...aq, current: { ...aq.current, uv_index: 0.6 } };
  assert.equal(airReport(morning, Date.parse('2026-09-24T13:10:00Z'), TZ).uvNext.when, 'later');
  const night = { ...aq, current: { ...aq.current, uv_index: 0 } };
  const r = airReport(night, Date.parse('2026-09-25T02:00:00Z'), TZ);
  assert.equal(r.uvNext.when, 'tomorrow');
  assert.ok(r.uvNext.uv > 0);
});

test('AQI and UV bands follow the EPA and WHO breakpoints', () => {
  assert.deepEqual([50, 51, 101, 151, 201, 301].map((v) => aqiBand(v).label), ['Good', 'Moderate', 'Unhealthy for sensitive groups', 'Unhealthy', 'Very unhealthy', 'Hazardous']);
  assert.deepEqual([0, 3, 6, 8, 11].map((v) => uvBand(v).label), ['Low', 'Moderate', 'High', 'Very high', 'Extreme']);
});

test('precipWord maps forecast text to a short noun', () => {
  assert.equal(precipWord('Chance Light Rain'), 'Rain');
  assert.equal(precipWord('Slight Chance Rain And Snow'), 'Snow');
  assert.equal(precipWord('Chance Freezing Rain'), 'Wintry mix');
  assert.equal(precipWord('Isolated Thunderstorms'), 'Storms');
});

test('stationDetails converts the latest observation to US units', () => {
  const d = stationDetails({ features: [observation] });
  assert.equal(d.tempF, 54);
  assert.equal(d.feelsF, 54);
  assert.equal(d.dewF, 52);
  assert.equal(d.humidity, 94);
  assert.equal(d.windDir, 'N');
  assert.equal(d.windMph, 9);
  assert.equal(d.gustMph, 20);
  assert.equal(d.visMi, 10);
  assert.equal(d.ceilingFt, 1000);
  assert.equal(d.pressureIn, 30.29);
  assert.equal(d.pressureTrend, null);
});

test('stationDetails prefers heat index or wind chill for feels-like', () => {
  const warm = structuredClone(observation);
  warm.properties.heatIndex.value = 30;
  assert.equal(stationDetails({ features: [warm] }).feelsF, 86);
});

test('stationDetails reports no ceiling under scattered or clear skies', () => {
  const clear = structuredClone(observation);
  clear.properties.cloudLayers = [{ base: { value: 1500 }, amount: 'SCT' }];
  assert.equal(stationDetails({ features: [clear] }).ceilingFt, null);
});

test('stationDetails compares pressure with about three hours earlier', () => {
  const at = (hoursAgo, pa) => {
    const o = structuredClone(observation);
    o.properties.timestamp = new Date(Date.parse(observation.properties.timestamp) - hoursAgo * 3600000).toISOString();
    o.properties.barometricPressure.value = pa;
    return o;
  };
  assert.equal(stationDetails({ features: [at(0, 102570), at(1, 102500), at(3, 102400)] }).pressureTrend, 'rising');
  assert.equal(stationDetails({ features: [at(0, 102570), at(3, 102700)] }).pressureTrend, 'falling');
  assert.equal(stationDetails({ features: [at(0, 102570), at(3, 102560)] }).pressureTrend, 'steady');
});

test('minuteRing marks each of the next 60 minutes by rain intensity', () => {
  const t0 = NOW;
  const quarters = [{ t: t0, mm: 0 }, { t: t0 + 15 * 60000, mm: 0.3 }, { t: t0 + 30 * 60000, mm: 3 }, { t: t0 + 45 * 60000, mm: 0 }];
  const ring = minuteRing(quarters, null, t0);
  assert.equal(ring.length, 60);
  assert.equal(ring[0], 0);
  assert.equal(ring[20], 1);
  assert.equal(ring[40], 3);
  assert.equal(ring[59], 0);
});

test('minuteRing takes the wetter of radar and model', () => {
  const radar = { validMs: NOW - 5 * 60000, series: [0, 0, 38, 38, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
  const ring = minuteRing(null, radar, NOW);
  assert.equal(ring[0], 0);
  assert.equal(ring[6], 2);
  assert.equal(ring[30], 0);
});

test('sunsetOn matches published sunset times within two minutes', () => {
  const near = (actual, expected) => assert.ok(Math.abs(actual - Date.parse(expected)) <= 2 * 60000, new Date(actual).toISOString());
  // Open-Meteo lists Durham sunset at 7:09 PM on Sep 24 and 6:46 PM on Oct 10 (EDT).
  near(sunsetOn(NOW, 36.091, -78.902, TZ), '2026-09-24T23:09:00Z');
  near(sunsetOn(Date.parse('2026-10-10T04:30:00Z'), 36.091, -78.902, TZ), '2026-10-10T22:46:00Z');
});

test('sunsetOn returns null when the sun never sets', () => {
  assert.equal(sunsetOn(Date.parse('2026-06-21T12:00:00Z'), 80, 0, 'UTC'), null);
});
