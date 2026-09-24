import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { weatherKind, iconSVG, quip, KINDS, sillyDistance } from '../public/icons.js';

test('weatherKind maps weather.gov wording to a character', () => {
  const cases = [
    ['Sunny', true, 75, 'clear-day'],
    ['Mostly Sunny', true, 75, 'clear-day'],
    ['Sunny', true, 97, 'scorcher'],
    ['Sunny', true, 28, 'frosty'],
    ['Clear', false, 60, 'clear-night'],
    ['Partly Sunny', true, 70, 'partly-day'],
    ['Partly Cloudy', false, 60, 'partly-night'],
    ['Mostly Cloudy', true, 64, 'cloudy'],
    ['Cloudy', true, 64, 'cloudy'],
    ['Slight Chance Light Rain', true, 62, 'maybe-rain'],
    ['Chance Light Rain', true, 58, 'rain'],
    ['Rain Showers Likely', true, 58, 'rain'],
    ['Chance Showers And Thunderstorms', true, 80, 'storm'],
    ['Light Snow Likely', true, 30, 'snow'],
    ['Freezing Rain', true, 31, 'mix'],
    ['Patchy Fog', true, 50, 'fog'],
    ['Breezy', true, 60, 'wind'],
  ];
  for (const [text, isDay, temp, kind] of cases) assert.equal(weatherKind(text, isDay, temp), kind, text);
});

test('every real forecast phrase in the fixture maps to a known character', () => {
  const periods = JSON.parse(readFileSync(new URL('./fixtures/hourly.json', import.meta.url))).properties.periods;
  for (const p of periods) assert.ok(KINDS.includes(weatherKind(p.shortForecast, p.isDaytime, p.temperature)), p.shortForecast);
});

test('iconSVG renders every character, animated only as the hero', () => {
  for (const kind of KINDS) {
    const hero = iconSVG(kind, { hero: true, label: 'x' });
    assert.match(hero, /^<svg class="wx" viewBox="0 0 120 120" role="img" aria-label="x">/);
    assert.match(iconSVG(kind), /class="wx wx-static"/);
    assert.ok(!hero.includes('undefined') && !hero.includes('NaN'), kind);
  }
});

test('sillyDistance rotates units every 10 minutes and keeps real miles', () => {
  const km = 22.8;
  const slot = 600000;
  const texts = new Set();
  for (let i = 0; i < 20; i++) {
    const d = sillyDistance(km, i * slot);
    assert.equal(d.miles, '14 mi');
    texts.add(d.text);
  }
  assert.equal(texts.size, 20);
  assert.equal(sillyDistance(km, 0).text, '4.72 leagues');
  assert.equal(sillyDistance(km, slot).text, '1.9 million honeybees');
  assert.equal(sillyDistance(km, 0).text, sillyDistance(km, slot - 1).text);
});

test('quip is stable within an hour', () => {
  const t = Date.parse('2026-09-24T14:05:00Z');
  assert.equal(quip('rain', t), quip('rain', t + 40 * 60000));
  assert.equal(typeof quip('not-a-kind', t), 'string');
});
