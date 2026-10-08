import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeFromResult, placesFromSearch, rememberPlace } from '../public/places.js';

const place = (name, lat, lon) => ({ name, region: 'North Carolina', lat, lon });

test('placeFromResult keeps the name, state, and a rounded position', () => {
  const r = { name: 'Asheville', admin1: 'North Carolina', latitude: 35.60095, longitude: -82.55402 };
  assert.deepEqual(placeFromResult(r), { name: 'Asheville', region: 'North Carolina', lat: 35.601, lon: -82.554 });
  assert.equal(placeFromResult({ name: 'Somewhere', latitude: 1, longitude: 2 }).region, '');
});

test('rememberPlace keeps the last three, newest first, without duplicates', () => {
  const a = place('A', 1, 1), b = place('B', 2, 2), c = place('C', 3, 3), d = place('D', 4, 4);
  let recent = [];
  for (const p of [a, b, c]) recent = rememberPlace(recent, p);
  assert.deepEqual(recent.map((p) => p.name), ['C', 'B', 'A']);
  assert.deepEqual(rememberPlace(recent, d).map((p) => p.name), ['D', 'C', 'B']);
  assert.deepEqual(rememberPlace(recent, place('A again', 1, 1)).map((p) => p.name), ['A again', 'C', 'B']);
});

test('placesFromSearch keeps US states and territories, at most six', () => {
  const r = (name, country_code) => ({ name, country_code, admin1: '', latitude: 18, longitude: -65 });
  const json = { results: [r('Vieques', 'PR'), r('San Juan', 'AR'), r('San Juan', 'US'), ...Array(6).fill(r('Hagåtña', 'GU'))] };
  assert.deepEqual(placesFromSearch(json).map((p) => p.name), ['Vieques', 'San Juan', 'Hagåtña', 'Hagåtña', 'Hagåtña', 'Hagåtña']);
  assert.deepEqual(placesFromSearch({}), []);
});
