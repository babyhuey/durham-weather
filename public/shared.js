export const HOME = { lat: 36.091, lon: -78.902 };

export const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } },
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const round3 = (n) => Math.round(n * 1000) / 1000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(status, url) { super(`HTTP ${status} from ${url}`); this.status = status; }
}

export async function fetchJSON(url, attempt = 0) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/geo+json, application/json' } });
    if (!res.ok) throw new HttpError(res.status, url);
    return await res.json();
  } catch (err) {
    const retryable = !(err instanceof HttpError) || err.status >= 500;
    if (retryable && attempt === 0) { await wait(1500); return fetchJSON(url, 1); }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    const timer = setTimeout(() => resolve(null), 5000);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(timer); resolve({ lat: round3(p.coords.latitude), lon: round3(p.coords.longitude) }); },
      () => { clearTimeout(timer); resolve(null); },
      { timeout: 5000, maximumAge: 10 * 60000 },
    );
  });
}
