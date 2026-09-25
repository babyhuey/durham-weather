const HOUR = 3600000;
const RAD = Math.PI / 180;
const KMH_TO_MPH = 0.621371;

export const cToF = (c) => (c == null ? null : Math.round((c * 9) / 5 + 32));
const kmhToMph = (v) => (v == null ? null : Math.round(v * KMH_TO_MPH));

// Hourly wind arrives as text like "13 mph" or "10 to 15 mph"; keep the top of the range.
export const windMph = (text) => Math.max(0, ...(String(text).match(/\d+/g) ?? []).map(Number));

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (deg) => (deg == null ? '' : POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]);

// Gusts only earn a mention when they are both strong and well above the steady wind.
export const notableGust = (gust, speed) => (gust != null && gust >= 20 && gust >= speed + 5 ? gust : null);

export function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(iso);
  if (!m) throw new Error(`Unrecognized duration: ${iso}`);
  const hours = Number(m[1] || 0) * 24 + Number(m[2] || 0) + Math.round(Number(m[3] || 0) / 60);
  return Math.max(hours, 1);
}

function splitInterval(validTime) {
  const [start, duration] = validTime.split('/');
  return { start: Date.parse(start), hours: parseDuration(duration) };
}

// Grid values cover multi-hour intervals; repeat each value for every hour it covers.
export function expandSeries(values) {
  const out = new Map();
  for (const { validTime, value } of values) {
    const { start, hours } = splitInterval(validTime);
    for (let i = 0; i < hours; i++) out.set(start + i * HOUR, value);
  }
  return out;
}

// Accumulated amounts are spread evenly across the hours of their interval.
export function expandAmounts(values) {
  const out = new Map();
  for (const { validTime, value } of values) {
    const { start, hours } = splitInterval(validTime);
    for (let i = 0; i < hours; i++) out.set(start + i * HOUR, (value ?? 0) / hours);
  }
  return out;
}

const formatters = new Map();
function fmt(tz, opts) {
  const key = tz + JSON.stringify(opts);
  if (!formatters.has(key)) formatters.set(key, new Intl.DateTimeFormat(opts.locale || 'en-US', { timeZone: tz, ...opts }));
  return formatters.get(key);
}

export const localDate = (ms, tz) => fmt(tz, { locale: 'en-CA', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
export const formatHour = (ms, tz) => fmt(tz, { hour: 'numeric' }).format(ms);
export const formatClock = (ms, tz) => fmt(tz, { hour: 'numeric', minute: '2-digit' }).format(ms);

// Open-Meteo 15-minute HRRR data (requested with timeformat=unixtime), from the current quarter hour on.
export function quarterHours(openMeteo, now, count = 8) {
  const m = openMeteo.minutely_15;
  const start = m.time.findIndex((t) => t * 1000 + 15 * 60000 > now);
  if (start === -1) return [];
  return m.time.slice(start, start + count).map((t, i) => ({
    t: t * 1000,
    mm: m.precipitation[start + i] ?? 0,
  }));
}

// EPA AQI and WHO UV index bands: [upper bound, label, color].
const AQI_BANDS = [[50, 'Good', '#3ec46d'], [100, 'Moderate', '#f2d34b'], [150, 'Unhealthy for sensitive groups', '#ff9a3c'], [200, 'Unhealthy', '#ff5a5a'], [300, 'Very unhealthy', '#b36bff'], [Infinity, 'Hazardous', '#a8324a']];
const UV_BANDS = [[2, 'Low', '#3ec46d'], [5, 'Moderate', '#f2d34b'], [7, 'High', '#ff9a3c'], [10, 'Very high', '#ff5a5a'], [Infinity, 'Extreme', '#b36bff']];
const band = (bands, v) => { const [, label, color] = bands.find(([max]) => v <= max); return { label, color }; };
export const aqiBand = (aqi) => band(AQI_BANDS, aqi);
export const uvBand = (uv) => band(UV_BANDS, uv);

const POLLUTANTS = [['us_aqi_pm2_5', 'fine particles (PM2.5)'], ['us_aqi_ozone', 'ozone'], ['us_aqi_pm10', 'coarse dust (PM10)'], ['us_aqi_nitrogen_dioxide', 'nitrogen dioxide']];

// Open-Meteo air-quality response (timeformat=unixtime) → what the card shows.
export function airReport(aq, now, tz) {
  const c = aq.current;
  const driver = POLLUTANTS.map(([key, name]) => [name, c[key] ?? -1]).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  const uv = Math.round(c.uv_index ?? 0);
  const hours = aq.hourly.time.map((t, i) => ({ at: t * 1000, uv: Math.round(aq.hourly.uv_index[i] ?? 0) }));
  const peakOf = (list) => list.reduce((a, b) => (b.uv > a.uv ? b : a), { uv: 0, at: null });
  const today = localDate(now, tz);
  const todays = hours.filter((h) => localDate(h.at, tz) === today);
  const later = peakOf(todays.filter((h) => h.at > floorHour(now)));
  const earlier = peakOf(todays.filter((h) => h.at < floorHour(now)));
  let uvNext = null;
  if (later.uv > uv) uvNext = { ...later, when: 'later' };
  else if (earlier.uv > uv && uv > 0) uvNext = { ...earlier, when: 'earlier' };
  else if (uv === 0) {
    const tomorrow = peakOf(hours.filter((h) => localDate(h.at, tz) > today));
    if (tomorrow.uv > 0) uvNext = { ...tomorrow, when: 'tomorrow' };
  }
  return { aqi: c.us_aqi, aqiBand: aqiBand(c.us_aqi), driver, uv, uvBand: uvBand(uv), uvNext };
}

// Radar sees rain that already exists; the HRRR model can see rain that hasn't formed yet.
export function headline(nws, radar, quarters, tz) {
  if (radar?.rainSoon) return { text: radar.text, source: 'radar' };
  const wet = (quarters ?? []).slice(0, 4).find((q) => q.mm >= 0.1);
  if (nws.pop < 20 && wet) {
    return { text: `Dry for now, but the HRRR model shows rain starting around ${formatClock(wet.t, tz)}.`, source: 'HRRR model' };
  }
  if (nws.pop >= 20 && radar) return { text: `${nws.text} Nothing on radar headed your way yet.`, source: 'weather.gov + radar' };
  return { text: nws.text, source: 'weather.gov' };
}
const weekday = (ms, tz) => fmt(tz, { weekday: 'short' }).format(ms);
const localHour = (ms, tz) => Number(fmt(tz, { hour: 'numeric', hourCycle: 'h23' }).format(ms));

const floorHour = (ms) => Math.floor(ms / HOUR) * HOUR;
const pop = (period) => period.probabilityOfPrecipitation?.value ?? 0;

export function precipWord(shortForecast = '') {
  if (/thunder/i.test(shortForecast)) return 'Storms';
  if (/sleet|freezing|ice|wintry/i.test(shortForecast)) return 'Wintry mix';
  if (/snow|flurr/i.test(shortForecast)) return 'Snow';
  if (/drizzle/i.test(shortForecast)) return 'Drizzle';
  return 'Rain';
}

function currentIndex(periods, now) {
  const i = periods.findIndex((p) => Date.parse(p.startTime) <= now && now < Date.parse(p.endTime));
  return i === -1 ? 0 : i;
}

function gustsMph(grid) {
  return grid ? expandSeries(grid.properties.windGust.values) : new Map();
}

export function hourStrip(periods, now, tz, count = 12, grid = null) {
  const i = currentIndex(periods, now);
  const gusts = gustsMph(grid);
  return periods.slice(i, i + count).map((p, k) => ({
    wind: windMph(p.windSpeed),
    windDir: p.windDirection,
    gust: notableGust(kmhToMph(gusts.get(Date.parse(p.startTime))), windMph(p.windSpeed)),
    label: k === 0 ? 'Now' : formatHour(Date.parse(p.startTime), tz).replace(' AM', 'a').replace(' PM', 'p'),
    temp: p.temperature,
    pop: pop(p),
    text: p.shortForecast,
    isDay: p.isDaytime,
  }));
}

export function nextHour(periods, now, tz, grid = null) {
  const i = currentIndex(periods, now);
  const window = periods.slice(i, i + 12);
  const [first, second] = window;
  const p0 = pop(first);
  let text;
  if (p0 >= 20) {
    const word = precipWord(first.shortForecast);
    text = `${word} ${p0 >= 60 ? 'likely' : 'possible'} this hour (${p0}%).`;
    const dry = window.findIndex((p, k) => k > 0 && pop(p) < 20);
    text += dry > 0
      ? ` Drying out by ${formatHour(Date.parse(window[dry].startTime), tz)}.`
      : ` Wet through at least ${formatHour(Date.parse(window.at(-1).endTime), tz)}.`;
  } else {
    const wet = window.findIndex((p, k) => k > 0 && pop(p) >= 20);
    text = wet > 0
      ? `Dry this hour. ${precipWord(window[wet].shortForecast)} chances reach ${pop(window[wet])}% around ${formatHour(Date.parse(window[wet].startTime), tz)}.`
      : 'Dry for the next 12 hours.';
  }
  return {
    text,
    pop: p0,
    tempNow: first.temperature,
    tempNext: second?.temperature ?? null,
    wind: `${first.windDirection} ${first.windSpeed}`,
    gust: notableGust(kmhToMph(gustsMph(grid).get(Date.parse(first.startTime))), windMph(first.windSpeed)),
  };
}

export function buildDays(grid, periods, tz, now, count = 7) {
  const g = grid.properties;
  const startHour = floorHour(now);

  // Walk forward hour by hour so DST days get their real 23 or 25 hours.
  const bounds = new Map();
  for (let t = startHour; bounds.size <= count; t += HOUR) {
    const key = localDate(t, tz);
    if (!bounds.has(key)) bounds.set(key, { start: t, end: t + HOUR });
    else bounds.get(key).end = t + HOUR;
  }
  const keys = [...bounds.keys()].slice(0, count);

  const highs = new Map();
  for (const v of g.maxTemperature.values) highs.set(localDate(splitInterval(v.validTime).start, tz), cToF(v.value));
  const lows = new Map();
  for (const v of g.minTemperature.values) {
    const { start, hours } = splitInterval(v.validTime);
    lows.set(localDate(start + hours * HOUR - 1, tz), cToF(v.value));
  }

  const popByDay = new Map();
  for (const [t, v] of expandSeries(g.probabilityOfPrecipitation.values)) {
    const key = localDate(t, tz);
    popByDay.set(key, Math.max(popByDay.get(key) ?? 0, v ?? 0));
  }

  const qpf = expandAmounts(g.quantitativePrecipitation.values);
  const qpfTimes = [...qpf.keys()];
  const qpfStart = Math.min(...qpfTimes);
  const qpfEnd = Math.max(...qpfTimes) + HOUR;
  const mmByDay = new Map();
  for (const [t, mm] of qpf) {
    const key = localDate(t, tz);
    mmByDay.set(key, (mmByDay.get(key) ?? 0) + mm);
  }

  const windByDay = new Map();
  const dirs = expandSeries(g.windDirection.values);
  const gusts = expandSeries(g.windGust.values);
  for (const [t, kmh] of expandSeries(g.windSpeed.values)) {
    const key = localDate(t, tz);
    const day = windByDay.get(key) ?? { speed: -1, dir: null, gust: null };
    if ((kmh ?? 0) > day.speed) Object.assign(day, { speed: kmh ?? 0, dir: dirs.get(t) ?? null });
    windByDay.set(key, day);
  }
  for (const [t, kmh] of gusts) {
    const day = windByDay.get(localDate(t, tz));
    if (day && kmh != null) day.gust = Math.max(day.gust ?? 0, kmh);
  }

  return keys.map((key, n) => {
    const { start, end } = bounds.get(key);
    const w = windByDay.get(key);
    const wind = w ? kmhToMph(w.speed) : null;
    const covered = qpfStart <= start && qpfEnd >= end;
    const dayPeriods = periods.filter((p) => localDate(Date.parse(p.startTime), tz) === key);
    const dayPop = popByDay.get(key) ?? Math.max(0, ...dayPeriods.map(pop));
    return {
      key,
      label: n === 0 ? 'Today' : weekday(start, tz),
      high: highs.get(key) ?? null,
      low: lows.get(key) ?? null,
      pop: dayPop,
      precipIn: covered ? (mmByDay.get(key) ?? 0) / 25.4 : null,
      condition: dayCondition(dayPeriods, tz),
      wind,
      windDir: w ? compass(w.dir) : '',
      gust: w ? notableGust(kmhToMph(w.gust), wind) : null,
    };
  });
}

function dayCondition(dayPeriods, tz) {
  if (!dayPeriods.length) return '';
  const wettest = dayPeriods.reduce((a, b) => (pop(b) > pop(a) ? b : a));
  if (pop(wettest) >= 30) return wettest.shortForecast;
  const afternoon = dayPeriods.find((p) => localHour(Date.parse(p.startTime), tz) === 13);
  return (afternoon ?? dayPeriods[0]).shortForecast;
}

export function currentConditions(observation, periods, now) {
  const o = observation?.properties;
  const fresh = o && o.temperature?.value != null && now - Date.parse(o.timestamp) < 90 * 60000;
  const p = periods[currentIndex(periods, now)];
  if (fresh) return { tempF: cToF(o.temperature.value), text: o.textDescription || p.shortForecast, source: 'station' };
  return { tempF: p.temperature, text: p.shortForecast, source: 'forecast' };
}

const PA_PER_INHG = 3386.39;
const round = (v, f) => (v == null ? null : Math.round(v * f) / f);

// Pressure change over about three hours; 70 Pa is roughly 0.02 inHg.
function pressureTrend(obs) {
  const [latest, ...older] = obs.filter((o) => o.barometricPressure?.value != null);
  if (!latest) return null;
  const target = Date.parse(latest.timestamp) - 3 * HOUR;
  const past = older
    .filter((o) => Date.parse(o.timestamp) <= target + HOUR)
    .reduce((a, b) => (a && Math.abs(Date.parse(a.timestamp) - target) <= Math.abs(Date.parse(b.timestamp) - target) ? a : b), null);
  if (!past) return null;
  const diff = latest.barometricPressure.value - past.barometricPressure.value;
  return diff >= 70 ? 'rising' : diff <= -70 ? 'falling' : 'steady';
}

// A station's recent observations (newest first) → the measured conditions list, in US units.
export function stationDetails(observations) {
  const obs = observations.features.map((f) => f.properties);
  const o = obs[0];
  const v = (key) => o[key]?.value ?? null;
  const ceiling = (o.cloudLayers ?? [])
    .filter((l) => ['BKN', 'OVC', 'VV'].includes(l.amount) && l.base?.value != null)
    .map((l) => l.base.value)
    .sort((a, b) => a - b)[0];
  return {
    timestamp: Date.parse(o.timestamp),
    tempF: cToF(v('temperature')),
    feelsF: cToF(v('heatIndex') ?? v('windChill') ?? v('temperature')),
    dewF: cToF(v('dewpoint')),
    humidity: v('relativeHumidity') == null ? null : Math.round(v('relativeHumidity')),
    windDir: compass(v('windDirection')),
    windMph: kmhToMph(v('windSpeed')),
    gustMph: kmhToMph(v('windGust')),
    visMi: round(v('visibility') == null ? null : v('visibility') / 1609.34, 1),
    ceilingFt: ceiling == null ? null : Math.round((ceiling * 3.28084) / 100) * 100,
    pressureIn: round(v('barometricPressure') == null ? null : v('barometricPressure') / PA_PER_INHG, 100),
    pressureTrend: pressureTrend(obs),
  };
}

const MINUTE = 60000;
const mmLevel = (mm) => (mm >= 2 ? 3 : mm >= 0.6 ? 2 : mm >= 0.1 ? 1 : 0);
const dbzLevel = (dbz) => (dbz >= 45 ? 3 : dbz >= 35 ? 2 : dbz >= 20 ? 1 : 0);

// Rain intensity (0 dry, 1 light, 2 moderate, 3 heavy) for each of the next 60 minutes,
// from 15-minute HRRR amounts and 5-minute radar nowcast steps, whichever is wetter.
export function minuteRing(quarters, radar, now) {
  return Array.from({ length: 60 }, (_, i) => {
    const t = now + i * MINUTE;
    const q = (quarters ?? []).find((x) => x.t <= t && t < x.t + 15 * MINUTE);
    const dbz = radar ? radar.series[Math.floor((t - radar.validMs) / (5 * MINUTE))] : null;
    return Math.max(q ? mmLevel(q.mm) : 0, dbz == null ? 0 : dbzLevel(dbz));
  });
}

export function skyCoverAt(grid, now) {
  return expandSeries(grid.properties.skyCover.values).get(floorHour(now)) ?? 50;
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const a = Math.sin(((lat2 - lat1) * RAD) / 2) ** 2
    + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

export function nearestStation(stations, lat, lon) {
  return stations.features
    .map((f) => ({
      id: f.properties.stationIdentifier,
      name: f.properties.name,
      km: distanceKm(lat, lon, f.geometry.coordinates[1], f.geometry.coordinates[0]),
    }))
    .reduce((a, b) => (b.km < a.km ? b : a));
}

export function sunElevation(ms, lat, lon) {
  const d = ms / 86400000 - 10957.5;
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) * 15;
  const ha = (gmst + lon - ra) * RAD;
  const la = lat * RAD;
  return Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha)) / RAD;
}

const SKIES = {
  day: { clear: ['#2a78d2', '#8ec6f3'], overcast: ['#56697f', '#aebacb'] },
  twilight: { clear: ['#35467a', '#f0a36b'], overcast: ['#474d62', '#a8918a'] },
  night: { clear: ['#0a1430', '#253862'], overcast: ['#1a212e', '#3a434f'] },
};

function mixHex(a, b, t) {
  const pa = a.match(/\w\w/g).map((h) => parseInt(h, 16));
  const pb = b.match(/\w\w/g).map((h) => parseInt(h, 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));

export function skyGradient(elevation, cover) {
  const c = clamp01(cover / 100);
  const phase = (name) => [0, 1].map((i) => mixHex(SKIES[name].clear[i], SKIES[name].overcast[i], c));
  const [night, twilight, day] = [phase('night'), phase('twilight'), phase('day')];
  let pair;
  if (elevation <= -2) pair = night.map((col, i) => mixHex(col, twilight[i], clamp01((elevation + 12) / 10)));
  else pair = twilight.map((col, i) => mixHex(col, day[i], clamp01((elevation + 2) / 10)));
  return { top: pair[0], bottom: pair[1], night: elevation < -6 };
}
