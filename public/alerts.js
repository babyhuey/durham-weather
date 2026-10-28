import { alertParagraphs } from './weather.js';
import { esc, fetchJSON, HttpError } from './shared.js';
import { API } from './location.js';

const app = document.getElementById('app');
const ids = new URLSearchParams(location.search).getAll('id');

const when = (iso) => new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso));
const paras = (text) => alertParagraphs(text).map((p) => `<p>${esc(p)}</p>`).join('');

function card(p) {
  const until = p.ends ?? p.expires;
  const ended = until && Date.parse(until) < Date.now();
  return `
    <article class="card">
      <h1>${esc(p.event)}</h1>
      <p class="meta">${esc(p.senderName)}${until ? ` · <span class="${ended ? 'ended' : ''}">${ended ? 'Ended' : 'Until'} ${esc(when(until))}</span>` : ''}</p>
      ${paras(p.description)}
      ${p.instruction ? `<h2>What to do</h2>${paras(p.instruction)}` : ''}
      ${p.areaDesc ? `<h2>Areas</h2><p>${esc(p.areaDesc)}</p>` : ''}
    </article>`;
}

const gone = '<article class="card"><p class="meta">This alert is no longer available from the National Weather Service. It has probably ended.</p></article>';
const failed = '<article class="card"><p class="meta">The alert didn\'t load. weather.gov isn\'t responding right now. Reload to try again.</p></article>';

async function show(id) {
  try {
    return card((await fetchJSON(`${API}/alerts/${encodeURIComponent(id)}`)).properties);
  } catch (err) {
    console.error(err);
    return err instanceof HttpError && err.status === 404 ? gone : failed;
  }
}

if (ids.length === 0) {
  app.innerHTML = '<article class="card"><p class="meta">No alert to show.</p></article>';
} else {
  const cards = await Promise.all(ids.map(show));
  app.innerHTML = cards.join('');
  const first = app.querySelector('h1');
  if (first) document.title = first.textContent;
}
