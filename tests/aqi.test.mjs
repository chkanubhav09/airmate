// AirMate unit tests — run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AQI_BANDS, aqiBand, aqiTrend, findPastAqi, bestWindows, EMISSION_FACTORS,
  weeklyCo2Kg, switchSavingKg, mdLite,
} from '../public/lib/aqi.js';

test('aqiBand maps EPA boundaries correctly', () => {
  assert.equal(aqiBand(0).key, 'good');
  assert.equal(aqiBand(50).key, 'good');
  assert.equal(aqiBand(51).key, 'moderate');
  assert.equal(aqiBand(100).key, 'moderate');
  assert.equal(aqiBand(101).key, 'usg');
  assert.equal(aqiBand(150).key, 'usg');
  assert.equal(aqiBand(151).key, 'unhealthy');
  assert.equal(aqiBand(201).key, 'very');
  assert.equal(aqiBand(301).key, 'hazard');
  assert.equal(aqiBand(999).key, 'hazard');
});

test('aqiBand tolerates bad input', () => {
  assert.equal(aqiBand(undefined).key, 'good');
  assert.equal(aqiBand(NaN).key, 'good');
  assert.equal(aqiBand(-5).key, 'good');
});

test('every band has label, color and advice', () => {
  for (const b of AQI_BANDS) {
    assert.ok(b.label && b.color && b.advice, b.key);
    assert.match(b.color, /^#[0-9a-f]{6}$/i);
  }
});

test('bestWindows finds contiguous clean stretches', () => {
  const base = new Date('2026-11-18T06:00:00');
  const hours = [120, 110, 90, 80, 85, 130, 140, 95, 88, 150].map((aqi, i) => ({
    time: new Date(base.getTime() + i * 3600e3), aqi,
  }));
  const w = bestWindows(hours, 100, 2);
  assert.equal(w.length, 2);
  assert.equal(w[0].maxAqi, 90);
  assert.equal(w[1].minAqi, 88);
});

test('bestWindows returns empty when nothing qualifies', () => {
  const hours = [300, 250, 200].map((aqi, i) => ({ time: new Date(i * 3600e3), aqi }));
  assert.deepEqual(bestWindows(hours, 100, 2), []);
});

test('bestWindows never recommends overnight hours', () => {
  // Cleanest air is 10 pm-2 am, plus a moderately clean 5-7 am stretch.
  // The overnight stretch must be excluded; only the 5 am-10 pm one reported.
  const base = new Date('2026-11-18T20:00:00');
  const hours = [150, 140, 60, 55, 50, 60, 55, 145, 150, 95, 90, 98].map((aqi, i) => ({
    time: new Date(base.getTime() + i * 3600e3), aqi,
  }));
  const w = bestWindows(hours, 100, 2);
  assert.equal(w.length, 1);
  const fromHour = new Date(w[0].from).getHours();
  assert.equal(fromHour, 5);
  assert.ok(w[0].minAqi >= 90, 'overnight low-AQI hours were excluded');
});

test('weeklyCo2Kg uses documented factors', () => {
  // 8 km each way, 5 days, motorbike 0.113 -> 0.113*8*2*5 = 9.04
  assert.equal(weeklyCo2Kg('motorbike', 8, 5), 9.04);
  assert.equal(weeklyCo2Kg('walk', 8, 5), 0);
  assert.equal(weeklyCo2Kg('unknown-mode', 8, 5), null);
});

test('switchSavingKg is positive when switching to cleaner mode', () => {
  assert.ok(switchSavingKg('car_petrol', 'metro', 10, 5) > 0);
  assert.ok(switchSavingKg('cycle', 'car_petrol', 10, 5) < 0);
});

test('all emission factors are non-negative numbers', () => {
  for (const [k, v] of Object.entries(EMISSION_FACTORS)) {
    assert.ok(typeof v === 'number' && v >= 0, k);
  }
});

test('mdLite escapes HTML and renders lists', () => {
  const html = mdLite('**Bold** line\n- one\n- two\n<script>alert(1)</script>');
  assert.ok(html.includes('<strong>Bold</strong>'));
  assert.ok(html.includes('<ul><li>one</li><li>two</li></ul>'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('aqiTrend classifies rising when current exceeds past by more than 5 AQI points', () => {
  assert.equal(aqiTrend(106, 100), 'rising');
  assert.equal(aqiTrend(105.1, 100), 'rising');
  assert.equal(aqiTrend(56, 50), 'rising');
  assert.equal(aqiTrend(6, 0), 'rising');
  assert.equal(aqiTrend('110', '100'), 'rising');
});

test('aqiTrend classifies falling when current is below past by more than 5 AQI points', () => {
  assert.equal(aqiTrend(94, 100), 'falling');
  assert.equal(aqiTrend(94.9, 100), 'falling');
  assert.equal(aqiTrend(44, 50), 'falling');
  assert.equal(aqiTrend(0, 6), 'falling');
  assert.equal(aqiTrend('90', '100'), 'falling');
});

test('aqiTrend classifies steady when difference is within 5 AQI points', () => {
  assert.equal(aqiTrend(105, 100), 'steady'); // exact +5 boundary
  assert.equal(aqiTrend(95, 100), 'steady');  // exact -5 boundary
  assert.equal(aqiTrend(100, 100), 'steady'); // zero difference
  assert.equal(aqiTrend(104.9, 100), 'steady');
  assert.equal(aqiTrend(95.1, 100), 'steady');
  assert.equal(aqiTrend(0, 5), 'steady');
  assert.equal(aqiTrend(5, 0), 'steady');
  assert.equal(aqiTrend(0, 0), 'steady');
  assert.equal(aqiTrend('105', '100'), 'steady');
  assert.equal(aqiTrend('95', '100'), 'steady');
});

test('aqiTrend returns null on missing or invalid inputs', () => {
  assert.equal(aqiTrend(null, 100), null);
  assert.equal(aqiTrend(100, null), null);
  assert.equal(aqiTrend(undefined, 100), null);
  assert.equal(aqiTrend(100, undefined), null);
  assert.equal(aqiTrend(NaN, 100), null);
  assert.equal(aqiTrend(100, NaN), null);
  assert.equal(aqiTrend('invalid', 100), null);
  assert.equal(aqiTrend(100, 'invalid'), null);
  assert.equal(aqiTrend('', 100), null);
  assert.equal(aqiTrend(100, '   '), null);
});

test('findPastAqi derives 6-hour-ago AQI from series', () => {
  const baseTime = '2026-11-18T18:00';
  // Open-Meteo object shape
  const openMeteoData = {
    time: [
      '2026-11-18T10:00',
      '2026-11-18T11:00',
      '2026-11-18T12:00',
      '2026-11-18T13:00',
      '2026-11-18T18:00',
    ],
    us_aqi: [80, 85, 90, 95, 110],
  };
  // 6 hours before 18:00 is 12:00, where AQI is 90
  assert.equal(findPastAqi(openMeteoData, baseTime, 6), 90);

  // Array of objects shape
  const arrayData = [
    { time: '2026-11-18T12:00', aqi: 75 },
    { time: '2026-11-18T18:00', aqi: 95 },
  ];
  assert.equal(findPastAqi(arrayData, baseTime, 6), 75);

  // Missing data (gap too large > 90 mins)
  const sparseData = {
    time: ['2026-11-18T10:00', '2026-11-18T18:00'],
    us_aqi: [80, 110],
  };
  assert.equal(findPastAqi(sparseData, baseTime, 6), null);
  assert.equal(findPastAqi(null, baseTime), null);
  assert.equal(findPastAqi(openMeteoData, null), null);
});
