const HOUR = 3600000;
const RAD = Math.PI / 180;

export const cToF = (c) => (c == null ? null : Math.round((c * 9) / 5 + 32));

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

export function hourStrip(periods, now, tz, count = 12) {
  const i = currentIndex(periods, now);
  return periods.slice(i, i + count).map((p, k) => ({
    label: k === 0 ? 'Now' : formatHour(Date.parse(p.startTime), tz).replace(' AM', 'a').replace(' PM', 'p'),
    temp: p.temperature,
    pop: pop(p),
  }));
}

export function nextHour(periods, now, tz) {
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

  return keys.map((key, n) => {
    const { start, end } = bounds.get(key);
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
