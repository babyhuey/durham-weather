import { store, esc, fetchJSON } from './shared.js';

const PICKED = 'wx:place';
const RECENT = 'wx:recent';
const round3 = (n) => Math.round(n * 1000) / 1000;
// The geocoder files territories under their own country codes; weather.gov forecasts all of these.
const NWS_COUNTRIES = new Set(['US', 'PR', 'VI', 'GU', 'AS', 'MP']);

export const pickedPlace = () => store.get(PICKED);

export function placeFromResult(r) {
  return { name: r.name, region: r.admin1 ?? '', lat: round3(r.latitude), lon: round3(r.longitude) };
}

export function rememberPlace(recent, place) {
  const same = (p) => p.lat === place.lat && p.lon === place.lon;
  return [place, ...recent.filter((p) => !same(p))].slice(0, 3);
}

export function placesFromSearch(json) {
  return (json.results ?? []).filter((r) => NWS_COUNTRIES.has(r.country_code)).slice(0, 6).map(placeFromResult);
}

export async function searchPlaces(query) {
  // countryCode takes only one country, so search everywhere and keep the ones weather.gov covers.
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=100&language=en&format=json`;
  return placesFromSearch(await fetchJSON(url));
}

function choose(place) {
  store.set(PICKED, place);
  if (place) store.set(RECENT, rememberPlace(store.get(RECENT) ?? [], place));
  // Each page paints its saved forecast before refreshing; drop both so the old place can't reappear.
  store.set('wx:today', null);
  store.set('wx:last', null);
}

export function mountSearch(onPick) {
  const input = document.getElementById('search-input');
  const list = document.getElementById('search-list');
  let options = [];
  let seq = 0;
  let timer;

  const row = (place, i) => `<li role="option" data-i="${i}">${esc(place.name)}${place.region ? ` <small>${esc(place.region)}</small>` : ''}</li>`;
  const show = (html) => { list.innerHTML = html; list.hidden = false; input.setAttribute('aria-expanded', 'true'); };
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); };

  function showRecent() {
    const recent = store.get(RECENT) ?? [];
    options = [null, ...recent];
    const mine = `<li role="option" data-i="0" class="mine">Use my location${pickedPlace() ? '' : ' <small>current</small>'}</li>`;
    show(mine + (recent.length ? `<li class="label" role="presentation">Recent</li>${recent.map((p, i) => row(p, i + 1)).join('')}` : ''));
  }

  async function showResults(query) {
    const mine = ++seq;
    let results;
    try {
      results = await searchPlaces(query);
    } catch (err) {
      console.warn('Place search failed', err);
      if (mine === seq) show('<li class="label" role="presentation">Search isn\'t working right now.</li>');
      return false;
    }
    if (mine !== seq) return false;
    options = results;
    show(results.length ? results.map(row).join('') : '<li class="label" role="presentation">No US places match, territories included.</li>');
    return results.length > 0;
  }

  function pick(i) {
    if (!(i in options)) return;
    choose(options[i]);
    input.value = '';
    input.blur();
    close();
    onPick(options[i]);
  }

  input.addEventListener('focus', () => { if (!input.value.trim()) showRecent(); });
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const query = input.value.trim();
    if (query.length < 2) { seq++; showRecent(); return; }
    timer = setTimeout(() => showResults(query), 250);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); input.blur(); }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const query = input.value.trim();
    if (query.length < 2) return;
    clearTimeout(timer);
    showResults(query).then((found) => { if (found) pick(0); });
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  // pointerdown keeps focus in the input, so the list survives long enough for the click to land.
  list.addEventListener('pointerdown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) pick(Number(li.dataset.i));
  });
}
