import test from 'node:test';
import assert from 'node:assert/strict';
import { airUrl, parseAirResponse } from '../public/lib/air.js';

// Open-Meteo returns local-time strings without a zone, e.g. "2026-11-18T05:00".
const pad = (n) => String(n).padStart(2, '0');
const hourly = (n) => ({
  time: Array.from({ length: n }, (_, i) => `2026-11-${pad(18 + Math.floor(i / 24))}T${pad(i % 24)}:00`),
  us_aqi: Array.from({ length: n }, (_, i) => 100 + i),
  pm2_5: Array.from({ length: n }, (_, i) => 40 + i),
});

test('airUrl carries coordinates and requested pollutants', () => {
  const u = airUrl(18.5, 73.8);
  assert.match(u, /latitude=18\.5&longitude=73\.8/);
  assert.match(u, /current=us_aqi,pm2_5,pm10/);
});

test('parseAirResponse keeps only future hours and caps the list', () => {
  const j = { current: { time: '2026-11-18T12:00', us_aqi: 150 }, hourly: hourly(120) };
  const now = new Date('2026-11-18T12:00').getTime();
  const out = parseAirResponse(j, now, 48);
  assert.equal(out.hours.length, 48);
  assert.ok(out.hours[0].time.getTime() >= now - 3600e3);
  assert.equal(out.current.us_aqi, 150);
});

test('parseAirResponse finds the reading from six hours earlier', () => {
  const j = { current: { time: '2026-11-18T12:00' }, hourly: hourly(48) };
  const out = parseAirResponse(j, new Date('2026-11-18T12:00').getTime());
  assert.equal(out.sixHoursAgoAqi, 106);
});

test('parseAirResponse rejects malformed bodies', () => {
  assert.throws(() => parseAirResponse(null), /unexpected/);
  assert.throws(() => parseAirResponse({ hourly: {} }), /unexpected/);
});
