export const KINDS = [
  'clear-day', 'scorcher', 'frosty', 'clear-night', 'partly-day', 'partly-night',
  'cloudy', 'maybe-rain', 'rain', 'storm', 'snow', 'mix', 'fog', 'wind',
];

export function weatherKind(text = '', isDay = true, tempF = null) {
  const t = text.toLowerCase();
  if (/thunder|t-storm/.test(t)) return 'storm';
  if (/sleet|freezing|ice|wintry/.test(t)) return 'mix';
  if (/snow|flurr|blizzard/.test(t)) return 'snow';
  if (/rain|shower|drizzle/.test(t)) return /slight chance|isolated/.test(t) ? 'maybe-rain' : 'rain';
  if (/fog|haze|smoke|mist/.test(t)) return 'fog';
  if (/wind|breezy|blustery|gust/.test(t)) return 'wind';
  if (/partly/.test(t)) return isDay ? 'partly-day' : 'partly-night';
  if (/cloudy|overcast/.test(t)) return 'cloudy';
  if (!isDay) return 'clear-night';
  if (tempF != null && tempF >= 92) return 'scorcher';
  if (tempF != null && tempF <= 32) return 'frosty';
  return 'clear-day';
}

const QUIPS = {
  'clear-day': ['Sunglasses: mandatory. Sunscreen: also mandatory.', 'Not a cloud in sight. The sun is insufferable about it.', 'Go outside. That is an order.'],
  scorcher: ["It's not the heat, it's the... no, it's the heat.", 'The sun is sweating. You will too.', 'Asphalt currently rated medium-rare.'],
  frosty: ['Bright, sunny, and lying to you about the temperature.', 'The sun brought earmuffs. Take the hint.'],
  'clear-night': ['The moon is asleep. You should be too.', 'Clear skies, lots of stars, one very sleepy moon.'],
  'partly-day': ['Sun and clouds are negotiating. It is going fine.', 'A little sun, a little cloud, a lot of indecision.'],
  'partly-night': ['Some clouds, some stars, zero effort from the moon.', 'The moon is hiding. It has had a long day.'],
  cloudy: ['The sky has chosen grey. Respect its choice.', 'Overcast, as in "cast over", as in "meh".', 'Cloud cover: yes.'],
  'maybe-rain': ['A cloud is thinking about it.', 'Rain is possible. So is not rain.', 'Bring an umbrella or live dangerously.'],
  rain: ['The cloud is going through something.', 'Umbrella weather. Not a drill.', 'Ducks: thrilled. Everyone else: less so.'],
  storm: ['The cloud is VERY upset. Stay inside.', 'Thunder is just the sky rearranging furniture. Loudly.', 'Unplug something dramatic.'],
  snow: ['Snow! Durham, act normal. (Durham will not act normal.)', 'The bread and milk are already gone.', 'The cloud built a snowman. You should too.'],
  mix: ["Rain? Snow? The cloud doesn't know either.", 'It is raining ice cubes. Drive like it.'],
  fog: ['Visibility: vibes only.', 'The cloud came down to say hi. It is very close.', 'Fog. Your headlights have entered the chat.'],
  wind: ['Hold onto your hat. Someone already lost theirs.', 'It is breezy. The leaves are having a day.'],
};

export function quip(kind, now = Date.now()) {
  const list = QUIPS[kind] ?? QUIPS.cloudy;
  return list[Math.floor(now / 3600000) % list.length];
}

const INK = '#23304a';

function face(x, y, type, s = 1, ink = INK) {
  const eyes = `<circle cx="-8" cy="-2" r="2.4" fill="${ink}"/><circle cx="8" cy="-2" r="2.4" fill="${ink}"/>`;
  const blush = '<circle cx="-13" cy="5" r="3.2" fill="#ff8fa3" opacity=".55"/><circle cx="13" cy="5" r="3.2" fill="#ff8fa3" opacity=".55"/>';
  const parts = {
    shades: `<path d="M-15 -6h12a2 2 0 0 1 2 2v2a6 6 0 0 1-6 6h-2a7 7 0 0 1-7-7v-1a2 2 0 0 1 1-2zM15 -6H3a2 2 0 0 0-2 2v2a6 6 0 0 0 6 6h2a7 7 0 0 0 7-7v-1a2 2 0 0 0-1-2z" fill="#1b1b24"/><path d="M-1 -4h2" stroke="#1b1b24" stroke-width="2"/><path d="M-12 -3l3 -1" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".8"/><path d="M-6 10q5 4 11 -1" stroke="${ink}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
    happy: `${eyes}${blush}<path d="M-6 6q6 6 12 0" stroke="${ink}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
    sleepy: `<path d="M-11 -2q3 3 6 0M5 -2q3 3 6 0" stroke="${ink}" stroke-width="2" fill="none" stroke-linecap="round"/>${blush}<ellipse cx="1" cy="8" rx="2.2" ry="2.8" fill="${ink}"/>`,
    meh: `<path d="M-11 -2h6M5 -2h6" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><path d="M-11 -5q3 -1 6 0M5 -5q3 -1 6 0" stroke="${ink}" stroke-width="1.4" fill="none" opacity=".5"/><path d="M-5 8h10" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/>`,
    sad: `${eyes}<path d="M-12 -7l6 -2M12 -7l-6 -2" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/><path d="M-6 10q6 -5 12 0" stroke="${ink}" stroke-width="2.2" fill="none" stroke-linecap="round"/><g class="fall slow"><path d="M-9 2q-2 3 0 5q2 -2 0 -5z" fill="#7ec3ff"/></g>`,
    angry: `<path d="M-13 -9l9 4M13 -9l-9 4" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>${eyes}<rect x="-8" y="5" width="16" height="7" rx="2" fill="${ink}"/><path d="M-4 5v7M0 5v7M4 5v7" stroke="${ink === '#fff' ? '#6b7689' : '#fff'}" stroke-width="1.2"/>`,
    puff: `${eyes}<circle cx="-12" cy="5" r="5" fill="#ff8fa3" opacity=".6"/><circle cx="12" cy="5" r="5" fill="#ff8fa3" opacity=".6"/><circle cx="4" cy="8" r="3" fill="none" stroke="${ink}" stroke-width="2"/>`,
    confused: `<circle cx="-8" cy="-2" r="2.4" fill="${ink}"/><circle cx="8" cy="-1" r="3.4" fill="${ink}"/><path d="M-12 -7l6 -1M4 -10l7 3" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/><path d="M-7 9q3 -3 5 0t5 0t5 0" stroke="${ink}" stroke-width="2" fill="none" stroke-linecap="round"/>`,
    nervous: `<circle cx="-8" cy="-2" r="4.5" fill="#fff"/><circle cx="8" cy="-2" r="4.5" fill="#fff"/><circle cx="-7" cy="-1" r="2" fill="${ink}"/><circle cx="9" cy="-1" r="2" fill="${ink}"/><path d="M-6 9l3 -2l3 2l3 -2l3 2" stroke="${ink}" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M15 -9q-3 4 0 6q3 -2 0 -6z" fill="#7ec3ff"/>`,
    squint: `<path d="M-12 -5l6 3l-6 3M12 -5l-6 3l6 3" stroke="${ink}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M-4 9h8" stroke="${ink}" stroke-width="2" stroke-linecap="round"/>`,
    hot: `<path d="M-11 -3q3 -3 6 0M5 -3q3 -3 6 0" stroke="${ink}" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M-7 6q7 5 14 0z" fill="${ink}"/><path d="M-2 8q2 7 5 0" fill="#ff6b81"/><g class="fall"><path d="M-15 -8q-3 4 0 6q3 -2 0 -6z" fill="#7ec3ff"/></g>`,
    cold: `${eyes}<rect x="-7" y="5" width="14" height="6" rx="1.5" fill="#fff" stroke="${ink}" stroke-width="1.6"/><path d="M-3.5 5v6M0 5v6M3.5 5v6" stroke="${ink}" stroke-width="1"/>`,
  };
  return `<g transform="translate(${x} ${y}) scale(${s})">${parts[type]}</g>`;
}

function sun(x, y, r, faceType, color = '#ffc83d', rays = '#ffb21e') {
  const rayEls = Array.from({ length: 12 }, (_, i) => `<rect x="-3" y="${-r - 14}" width="6" height="10" rx="3" fill="${rays}" transform="rotate(${i * 30})"/>`).join('');
  return `<g transform="translate(${x} ${y})"><g class="spin">${rayEls}</g><circle r="${r}" fill="${color}"/><circle r="${r}" fill="url(#wx-sheen)"/>${face(0, 2, faceType, r / 26)}</g>`;
}

function cloud(x, y, s, faceType, fill = '#f4f7fb', shade = '#d3dcea', ink = INK) {
  const blob = (c) => `<ellipse cx="0" cy="14" rx="38" ry="14" fill="${c}"/><circle cx="-18" cy="4" r="16" fill="${c}"/><circle cx="4" cy="-6" r="22" fill="${c}"/><circle cx="24" cy="6" r="14" fill="${c}"/>`;
  return `<g transform="translate(${x} ${y}) scale(${s})"><g transform="translate(2 4)">${blob(shade)}</g>${blob(fill)}${faceType ? face(3, 7, faceType, 0.9, ink) : ''}</g>`;
}

function moon(x, y, s, faceType) {
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M8 -26a27 27 0 1 0 18 40a22 22 0 1 1 -18 -40z" fill="#f3e6b8"/>${face(-4, 4, faceType, 0.7)}<path d="M-18 -18q10 -22 34 -12l-6 4z" fill="#6c63ff"/><circle cx="18" cy="-28" r="4.5" fill="#fff"/></g>`;
}

const drops = (xs, y, color = '#7ec3ff', len = 9) => xs.map((x, i) => `<g class="fall" style="animation-delay:${(i * 0.23) % 1}s"><path d="M${x} ${y}l-2 ${len}" stroke="${color}" stroke-width="3" stroke-linecap="round"/></g>`).join('');
const stars = (pts) => pts.map(([x, y, r], i) => `<g class="twinkle" style="animation-delay:${i * 0.4}s"><path d="M${x} ${y - r}l${r * 0.3} ${r * 0.7}l${r * 0.7} ${r * 0.3}l${-r * 0.7} ${r * 0.3}l${-r * 0.3} ${r * 0.7}l${-r * 0.3} ${-r * 0.7}l${-r * 0.7} ${-r * 0.3}l${r * 0.7} ${-r * 0.3}z" fill="#fff6c9"/></g>`).join('');
const flake = (x, y, i) => `<g class="drift" style="animation-delay:${i * 0.5}s"><g transform="translate(${x} ${y})" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M0 -5v10M-4.3 -2.5l8.6 5M-4.3 2.5l8.6 -5"/></g></g>`;

const ART = {
  'clear-day': () => `${stars([[18, 22, 5], [102, 28, 4], [100, 98, 5]])}<g class="bob">${sun(60, 60, 28, 'shades')}</g>`,
  scorcher: () => `<g class="shimmer">${[30, 60, 90].map((x) => `<path d="M${x} 112q5 -5 0 -10t0 -10" stroke="#ff6b3d" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".7"/>`).join('')}</g>${sun(60, 54, 28, 'hot', '#ff9f43', '#ff6b3d')}<g class="drip"><path d="M52 84q0 8 4 10q4 -2 4 -10z" fill="#ff9f43"/></g>`,
  frosty: () => `${sun(60, 58, 27, 'cold', '#ffd66b', '#ffc24a')}<path d="M33 52a27 27 0 0 1 54 0" stroke="#8e7dff" stroke-width="4" fill="none"/><circle cx="33" cy="58" r="8" fill="#b9a8ff"/><circle cx="87" cy="58" r="8" fill="#b9a8ff"/><path d="M38 80q22 10 44 0v8q-22 10 -44 0z" fill="#e8475f"/><path d="M72 86l4 20h8l-6 -22z" fill="#e8475f"/><path d="M76 106h8" stroke="#fff" stroke-width="2" stroke-dasharray="2 2"/>`,
  'clear-night': () => `${stars([[20, 24, 5], [98, 20, 4], [104, 70, 5], [22, 92, 4], [88, 104, 3]])}<g class="bob">${moon(56, 64, 1.1, 'sleepy')}</g><g class="zzz"><text x="80" y="44" font-family="system-ui" font-weight="700" font-size="14" fill="#fff">z</text></g><g class="zzz" style="animation-delay:1s"><text x="88" y="34" font-family="system-ui" font-weight="700" font-size="11" fill="#fff">z</text></g>`,
  'partly-day': () => `${sun(44, 42, 22, 'happy')}<g class="slide">${cloud(68, 74, 0.85, 'squint')}</g>`,
  'partly-night': () => `${stars([[18, 20, 4], [102, 24, 5], [100, 100, 4]])}${moon(42, 44, 0.8, 'sleepy')}<g class="slide">${cloud(70, 78, 0.8, 'sleepy')}</g>`,
  cloudy: () => `${cloud(40, 40, 0.62, 'meh', '#c9d2df', '#a9b5c6')}<g class="bob">${cloud(66, 72, 0.95, 'meh')}</g><g class="zzz" style="animation-duration:4s"><text x="96" y="46" font-family="system-ui" font-style="italic" font-size="10" fill="#fff">sigh</text></g>`,
  'maybe-rain': () => `<g class="bob">${cloud(58, 52, 0.95, 'nervous', '#e8eef6', '#c3cedd')}</g><g class="dangle"><path d="M62 84q-5 8 0 12q5 -4 0 -12z" fill="#7ec3ff"/></g><text x="92" y="36" font-family="system-ui" font-weight="800" font-size="20" fill="#fff" class="twinkle">?</text>`,
  rain: () => `${cloud(58, 46, 1, 'sad', '#d9e2ee', '#aebbd0')}${drops([34, 48, 62, 76, 90], 78)}<g transform="translate(92 100)"><path d="M-14 0a14 12 0 0 1 28 0z" fill="#ff5d8f"/><path d="M0 0v12q0 4 -4 3" stroke="#23304a" stroke-width="2" fill="none" stroke-linecap="round"/></g>`,
  storm: () => `${cloud(60, 44, 1.05, 'angry', '#6b7689', '#4b5466', '#fff')}<g class="flash"><path d="M44 72l-10 20h9l-6 18l18 -24h-10l7 -14z" fill="#ffe14d"/></g><g class="flash" style="animation-delay:1.3s"><path d="M82 72l-8 16h8l-5 14l15 -20h-9l5 -10z" fill="#ffe14d"/></g>${drops([30, 62, 96], 78, '#9fd0ff', 12)}`,
  snow: () => `<g class="bob">${cloud(58, 40, 0.95, 'happy')}</g>${[[30, 74], [52, 80], [74, 72], [96, 78], [40, 98]].map(([x, y], i) => flake(x, y, i)).join('')}<g transform="translate(92 100)"><circle cy="6" r="9" fill="#fff"/><circle cy="-7" r="6.5" fill="#fff"/><circle cx="-2" cy="-8" r="1" fill="#23304a"/><circle cx="2" cy="-8" r="1" fill="#23304a"/><path d="M0 -6l6 1.5l-6 1z" fill="#ff8a3d"/><path d="M-6 -2h12" stroke="#e8475f" stroke-width="3" stroke-linecap="round"/></g>`,
  mix: () => `${cloud(58, 44, 1, 'confused', '#dfe6f0', '#b3c0d3')}${drops([36, 70], 78)}${[[52, 82], [86, 80]].map(([x, y], i) => `<g class="fall" style="animation-delay:${i * 0.5}s"><rect x="${x}" y="${y}" width="9" height="9" rx="2" fill="#dff4ff" stroke="#9fd0ff" stroke-width="1.5"/></g>`).join('')}<text x="94" y="30" font-family="system-ui" font-weight="800" font-size="16" fill="#fff">?!</text>`,
  fog: () => `${cloud(58, 50, 1, 'squint', '#e6ebf2', '#c5cfdc')}${[76, 88, 100].map((y, i) => `<g class="slide" style="animation-delay:${i * -1.5}s"><path d="M${14 + i * 6} ${y}h${88 - i * 10}" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity="${0.7 - i * 0.15}"/></g>`).join('')}`,
  wind: () => `${cloud(44, 56, 0.85, 'puff')}${[46, 58, 70].map((y, i) => `<g class="gust" style="animation-delay:${i * 0.3}s"><path d="M80 ${y}h22q8 0 8 -6t-6 -6" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-dasharray="40 40"/></g>`).join('')}<g class="tumble"><g transform="translate(96 92)"><path d="M-10 0q10 -12 20 0q-10 12 -20 0z" fill="#5ccf7a"/><path d="M-10 0h20" stroke="#2f8f4e" stroke-width="1.5"/></g></g>`,
};

export function iconSVG(kind, { hero = false, label = '' } = {}) {
  const art = (ART[kind] ?? ART.cloudy)();
  const a11y = label ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true"';
  return `<svg class="wx${hero ? '' : ' wx-static'}" viewBox="0 0 120 120" ${a11y}><defs><radialGradient id="wx-sheen" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>${art}</svg>`;
}
