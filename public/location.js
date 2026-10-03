import { nearestStation } from './weather.js';
import { HOME, store, HttpError, fetchJSON, getPosition } from './shared.js';
import { pickedPlace } from './places.js';

export const API = 'https://api.weather.gov';

async function getMeta({ lat, lon }) {
  const key = `wx:meta2:${lat},${lon}`;
  const cached = store.get(key);
  if (cached) return cached;
  const points = (await fetchJSON(`${API}/points/${lat},${lon}`)).properties;
  const stations = await fetchJSON(points.observationStations);
  const meta = {
    lat, lon,
    tz: points.timeZone,
    city: points.relativeLocation.properties.city,
    state: points.relativeLocation.properties.state,
    grid: `${points.gridId} ${points.gridX},${points.gridY}`,
    gridUrl: points.forecastGridData,
    hourlyUrl: points.forecastHourly,
    station: nearestStation(stations, lat, lon),
  };
  store.set(key, meta);
  return meta;
}

export async function resolveLocation() {
  const picked = pickedPlace();
  if (picked) return { meta: { ...(await getMeta(picked)), city: picked.name }, where: 'searched' };
  const here = await getPosition();
  if (here) {
    try { return { meta: await getMeta(here), where: 'near you' }; } catch (err) {
      if (!(err instanceof HttpError && err.status === 404)) throw err;
      return { meta: await getMeta(HOME), where: 'home', note: 'weather.gov only covers the US, so this is the Durham forecast.' };
    }
  }
  return { meta: await getMeta(HOME), where: 'home' };
}
