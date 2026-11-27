// AirMate frontend logic.
import { AQI_BANDS, aqiBand, aqiTrend, AQI_TREND_LABELS, bestWindows, EMISSION_FACTORS, MODE_LABELS, weeklyCo2Kg, switchSavingKg, mdLite } from './lib/aqi.js';
import { airUrl, parseAirResponse } from './lib/air.js';

const $ = (id) => document.getElementById(id);

const state = {
  place: { name: 'Pune, Maharashtra', lat: 18.5204, lon: 73.8567 },
  air: null,          // { current, hours: [{time: Date, aqi, pm25}], sixHoursAgoAqi }
  chat: [],           // [{role, content}]
};

/* ---------------- air data ---------------- */

async function fetchAir() {
  const { lat, lon } = state.place;
  const res = await fetch(airUrl(lat, lon));
  if (!res.ok) throw new Error('air api ' + res.status);
  state.air = parseAirResponse(await res.json());
  renderDashboard();
}

function renderDashboard() {
  const c = state.air.current;
  const aqi = Math.round(c.us_aqi ?? 0);
  const band = aqiBand(aqi);

  $('aqi-num').textContent = aqi;
  const dial = $('aqi-dial');
  dial.style.background = `conic-gradient(${band.color} ${Math.min(aqi / 300, 1) * 360}deg, #10181f 0deg)`;
  dial.style.boxShadow = `0 0 34px ${band.color}33`;
  dial.setAttribute('aria-label', `Current US AQI ${aqi}, ${band.label}`);

  const pill = $('aqi-band');
  pill.textContent = band.label;
  pill.style.background = band.color + '22';
  pill.style.color = band.color;
  pill.style.border = `1px solid ${band.color}66`;

  renderTrend(aqi, state.air.sixHoursAgoAqi);

  $('aqi-advice').innerHTML = `<strong>${band.label}.</strong> ${band.advice}`;
  $('m-pm25').textContent = fmt(c.pm2_5);
  $('m-pm10').textContent = fmt(c.pm10);
  $('m-no2').textContent = fmt(c.nitrogen_dioxide);
  $('m-o3').textContent = fmt(c.ozone);
  $('m-co').textContent = fmt(c.carbon_monoxide, 0);
  $('updated-line').textContent = 'updated ' + new Date(c.time).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  $('place-name').textContent = state.place.name;

  drawChart(state.air.hours);
  renderWindows(state.air.hours);
}

function renderTrend(currentAqi, sixHoursAgoAqi) {
  let el = $('aqi-trend');
  if (!el) {
    el = document.createElement('span');
    el.id = 'aqi-trend';
    el.className = 'aqi-trend';
    const pill = $('aqi-band');
    if (pill && pill.parentNode) {
      pill.parentNode.insertBefore(el, pill.nextSibling);
    }
  }
  const prev = (sixHoursAgoAqi !== null && sixHoursAgoAqi !== undefined) ? Math.round(sixHoursAgoAqi) : null;
  const trend = aqiTrend(currentAqi, prev);
  if (!trend) {
    el.style.display = 'none';
    el.textContent = '';
    el.className = 'aqi-trend';
    return;
  }
  el.textContent = AQI_TREND_LABELS[trend] || `${trend} vs 6h ago`;
  el.className = `aqi-trend ${trend}`;
  el.style.display = 'inline-flex';
}

const fmt = (v, d = 1) => (v === null || v === undefined) ? '–' : Number(v).toFixed(d);

function renderWindows(hours) {
  const el = $('window-chips');
  el.innerHTML = '';
  const good = bestWindows(hours, 100, 2);
  if (!good.length) {
    el.innerHTML = '<span class="chip bad">No clear low-AQI window between 5 am and 10 pm in the next 48h - prefer indoor plans.</span>';
    return;
  }
  for (const w of good.slice(0, 3)) {
    const chip = document.createElement('span');
    chip.className = 'chip good';
    chip.textContent = `Lowest-AQI window (5 am-10 pm): ${dayTime(w.from)} → ${dayTime(w.to)} (AQI ${w.minAqi}–${w.maxAqi})`;
    el.appendChild(chip);
  }
  const worst = hours.reduce((a, b) => (b.aqi > a.aqi ? b : a));
  const warn = document.createElement('span');
  warn.className = 'chip bad';
  warn.textContent = `Worst stretch around ${dayTime(worst.time)} (AQI ${worst.aqi})`;
  el.appendChild(warn);
}

const dayTime = (d) => new Date(d).toLocaleString('en-IN', { weekday: 'short', hour: 'numeric', minute: '2-digit' });

function drawChart(hours) {
  const cv = $('aqi-chart');
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  if (!hours.length) return;

  const maxAqi = Math.max(150, ...hours.map(h => h.aqi || 0));
  const pad = { l: 34, r: 8, t: 10, b: 22 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;

  // band shading
  const bands = [[0, 50, '#34d399'], [50, 100, '#facc15'], [100, 150, '#fb923c'], [150, maxAqi, '#f87171']];
  ctx.globalAlpha = 0.07;
  for (const [lo, hi, col] of bands) {
    const y1 = pad.t + ih - (Math.min(hi, maxAqi) / maxAqi) * ih;
    const y2 = pad.t + ih - (lo / maxAqi) * ih;
    ctx.fillStyle = col;
    ctx.fillRect(pad.l, y1, iw, y2 - y1);
  }
  ctx.globalAlpha = 1;

  // y gridlines
  ctx.strokeStyle = '#1a2530';
  ctx.fillStyle = '#8fa3ad';
  ctx.font = '10px system-ui';
  ctx.textAlign = 'right';
  for (const g of [0, 50, 100, 150, 200, 300]) {
    if (g > maxAqi) break;
    const y = pad.t + ih - (g / maxAqi) * ih;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    ctx.fillText(String(g), pad.l - 5, y + 3);
  }

  // line
  ctx.beginPath();
  hours.forEach((h, i) => {
    const x = pad.l + (i / (hours.length - 1)) * iw;
    const y = pad.t + ih - ((h.aqi || 0) / maxAqi) * ih;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  const grad = ctx.createLinearGradient(pad.l, 0, W - pad.r, 0);
  grad.addColorStop(0, '#22d3ee'); grad.addColorStop(1, '#34d399');
  ctx.strokeStyle = grad; ctx.lineWidth = 2; ctx.stroke();

  // x labels: every 6h on wide screens, every 12h on narrow ones
  const step = W < 520 ? 12 : 6;
  ctx.fillStyle = '#8fa3ad'; ctx.textAlign = 'center';
  hours.forEach((h, i) => {
    if (i % step !== 0) return;
    const x = pad.l + (i / (hours.length - 1)) * iw;
    ctx.fillText(new Date(h.time).toLocaleString('en-IN', { weekday: 'short', hour: 'numeric' }), x, H - 6);
  });
}

/* ---------------- city search + geolocation ---------------- */

let searchTimer = null;
$('city-search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 3) { hideResults(); return; }
  searchTimer = setTimeout(() => searchCity(q), 350);
});
$('city-search').addEventListener('keydown', (e) => { if (e.key === 'Escape') hideResults(); });

async function searchCity(q) {
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`);
    const j = await res.json();
    const box = $('search-results');
    box.innerHTML = '';
    if (!j.results) { hideResults(); return; }
    for (const r of j.results) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.innerHTML = `${escHtml(r.name)} <span class="c">${escHtml([r.admin1, r.country].filter(Boolean).join(', '))}</span>`;
      b.addEventListener('click', () => {
        state.place = { name: [r.name, r.admin1].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude };
        $('city-search').value = r.name;
        hideResults();
        refresh();
      });
      box.appendChild(b);
    }
    box.style.display = 'block';
    $('city-search').setAttribute('aria-expanded', 'true');
  } catch { hideResults(); }
}

function hideResults() {
  $('search-results').style.display = 'none';
  $('city-search').setAttribute('aria-expanded', 'false');
}

$('geo-btn').addEventListener('click', () => {
  if (!navigator.geolocation) return;
  $('geo-btn').disabled = true;
  navigator.geolocation.getCurrentPosition((pos) => {
    state.place = {
      name: `your location (${pos.coords.latitude.toFixed(2)}, ${pos.coords.longitude.toFixed(2)})`,
      lat: +pos.coords.latitude.toFixed(4),
      lon: +pos.coords.longitude.toFixed(4),
    };
    $('geo-btn').disabled = false;
    refresh();
  }, () => { $('geo-btn').disabled = false; }, { timeout: 8000 });
});

/* ---------------- GenAI backend ---------------- */

// Probe the backend once at boot; when no provider is configured, every AI
// section says so up front instead of pretending to work.
async function probeAI() {
  try {
    const res = await fetch('/api/ai');
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.status === 'ready') return aiOnline(true);
    aiOnline(false, j.status);
  } catch {
    aiOnline(false);
  }
}

function aiOnline(on, reason) {
  for (const id of ['ai-banner', 'routine-banner', 'indoor-banner']) {
    const el = $(id);
    if (el) el.classList.toggle('hidden', on);
  }
  $('chat-send').disabled = !on;
  $('indoor-go').disabled = !on;
  // routine-go stays enabled: its commute CO2 baseline is computed locally,
  // and it shows an honest card when the AI layer is offline.
  if (!on) {
    const spent = reason === 'allowance_exhausted' || reason === 'allowance_expired';
    aiStatus(spent
      ? 'The public AI allowance for this deployment is used up. The live air dashboard and commute math above are unaffected.'
      : 'AI backend not connected in this preview. The live air dashboard and commute math above are unaffected.', true);
  }
}

async function ai(mode, payload) {
  const airContext = state.air ? {
    place: state.place.name,
    us_aqi: Math.round(state.air.current.us_aqi ?? 0),
    band: aqiBand(state.air.current.us_aqi ?? 0).label,
    pm25: state.air.current.pm2_5,
    pm10: state.air.current.pm10,
    updated: state.air.current.time,
  } : { place: state.place.name };
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode, payload, airContext }),
  });
  const j = await res.json().catch(() => ({}));
  if (res.status === 501) throw new Error('BACKEND_OFFLINE');
  if (res.status === 429) {
    const err = new Error('AI_BUDGET');
    err.detail = j.text || 'The public AI allowance for this deployment is used up.';
    throw err;
  }
  if (!res.ok) throw new Error(j.error || ('api ' + res.status));
  return j;
}

function aiStatus(msg, warn) {
  const el = $('ai-status');
  el.textContent = msg || '';
  el.className = 'note' + (warn ? ' warn' : '');
}

/* ---------------- chat ---------------- */

const SUGGESTED = [
  'When is the safest time for a walk today?',
  'How should I commute on high-AQI days?',
  'Quick indoor air wins for tonight?',
  'Explain what PM2.5 does to my body',
];

function addMsg(role, content, isError) {
  const log = $('chat-log');
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'user' : 'bot') + (isError ? ' error' : '');
  if (role === 'user') div.textContent = content;
  else div.innerHTML = mdLite(content);
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

function renderSuggestions() {
  const box = $('chat-suggestions');
  box.innerHTML = '';
  for (const s of SUGGESTED) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = s;
    b.addEventListener('click', () => { $('chat-input').value = s; sendChat(); });
    box.appendChild(b);
  }
}

async function sendChat() {
  const input = $('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  addMsg('user', text);
  state.chat.push({ role: 'user', content: text });
  const thinking = addMsg('bot', '…');
  $('chat-send').disabled = true;
  try {
    const j = await ai('chat', { messages: state.chat.slice(-12) });
    thinking.remove();
    addMsg('bot', j.text);
    state.chat.push({ role: 'assistant', content: j.text });
    aiStatus('');
  } catch (e) {
    thinking.remove();
    if (e.message === 'BACKEND_OFFLINE') {
      addMsg('bot', 'The AI backend is not connected in this preview. Once deployed, this chat answers with your live air context.', true);
      aiStatus('AI backend offline in this preview - deploy the worker to enable chat, routines and hacks.', true);
    } else if (e.message === 'AI_BUDGET') {
      addMsg('bot', e.detail + ' The forecast, trend and planner on this page still work.', true);
    } else {
      addMsg('bot', 'Sorry, the assistant could not answer just now. Please try again.', true);
    }
  }
  $('chat-send').disabled = false;
}

$('chat-send').addEventListener('click', sendChat);
$('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

/* ---------------- routine swaps ---------------- */

$('routine-go').addEventListener('click', async () => {
  const mode = $('r-commute').value;
  const km = Math.max(0, +$('r-km').value || 0);
  const days = Math.min(7, Math.max(0, +$('r-days').value || 0));
  const out = $('routine-out');
  out.innerHTML = '';
  const btn = $('routine-go');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Thinking…';

  // Deterministic baseline card first - truthful numbers, no AI needed.
  const current = weeklyCo2Kg(mode, km, days);
  if (current !== null && km > 0) {
    const alts = ['bus', 'metro', 'cycle', 'walk'].filter(m => m !== mode)
      .map(m => ({ m, save: switchSavingKg(mode, m, km, days) }))
      .filter(a => a.save && a.save > 0)
      .sort((a, b) => b.save - a.save);
    const lines = alts.slice(0, 3).map(a =>
      `${cap(MODE_LABELS[a.m])} instead of ${MODE_LABELS[mode]}: save ≈ ${a.save} kg CO₂/week`).join(' · ');
    out.appendChild(suggCard(
      'Your commute baseline',
      `${km} km each way by ${MODE_LABELS[mode]}, ${days} days/week ≈ ${current} kg CO₂ per week. ${lines || 'Your commute is already near-zero emission.'}`,
      `≈ ${current} kg CO₂/week current`
    ));
  }

  try {
    const j = await ai('routine', {
      profile: {
        commuteMode: MODE_LABELS[mode], oneWayKm: km, daysPerWeek: days,
        outdoorExercise: $('r-exercise').value,
        household: $('r-family').value,
        weeklyErrandKm: +$('r-errands').value || 0,
      },
    });
    for (const s of (j.suggestions || [])) {
      out.appendChild(suggCard(s.title, s.detail, s.impact));
    }
    if (!j.suggestions?.length) out.appendChild(suggCard('No extra suggestions', 'The assistant had nothing to add beyond the baseline above.', null));
  } catch (e) {
    out.appendChild(suggCard(
      'AI suggestions unavailable in this preview',
      e.message === 'BACKEND_OFFLINE'
        ? 'The commute math above is exact from emission factors. Deploy the AI backend to get the personalised routine rewrite with health-impact explanations.'
        : e.message === 'AI_BUDGET'
          ? e.detail + ' The baseline commute math above still stands.'
          : 'The assistant could not respond right now. The baseline math above still stands.',
      null
    ));
  }
  btn.disabled = false;
  btn.textContent = 'Suggest cleaner swaps';
});

/* ---------------- indoor hacks ---------------- */

$('indoor-go').addEventListener('click', async () => {
  const out = $('indoor-out');
  out.innerHTML = '';
  const btn = $('indoor-go');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Thinking…';
  try {
    const j = await ai('indoor', {
      home: {
        floor: $('h-floor').value,
        roadFacingWindows: $('h-road').value,
        airPurifier: $('h-purifier').value,
        cookingFuel: $('h-cooking').value,
      },
    });
    for (const s of (j.hacks || [])) out.appendChild(suggCard(s.title, s.detail, s.impact));
    if (!j.hacks?.length) out.appendChild(suggCard('No hacks generated', 'Try again in a moment.', null));
  } catch (e) {
    out.appendChild(suggCard(
      'AI unavailable in this preview',
      e.message === 'BACKEND_OFFLINE'
        ? 'Deploy the AI backend to generate indoor air hacks matched to your home and today\'s AQI.'
        : e.message === 'AI_BUDGET'
          ? e.detail
          : 'The assistant could not respond right now. Please try again.',
      null
    ));
  }
  btn.disabled = false;
  btn.textContent = 'Generate my hacks';
});

function suggCard(title, detail, impact) {
  const div = document.createElement('div');
  div.className = 'sugg';
  div.innerHTML = `<h4>${escHtml(title)}</h4><p>${escHtml(detail)}</p>` +
    (impact ? `<span class="impact">Impact: ${escHtml(impact)}</span>` : '');
  return div;
}

/* ---------------- about modal + easter eggs ---------------- */

$('about-open').addEventListener('click', (e) => {
  e.preventDefault();
  $('about-backdrop').classList.remove('hidden');
});
$('about-close').addEventListener('click', () => $('about-backdrop').classList.add('hidden'));
$('about-backdrop').addEventListener('click', (e) => {
  if (e.target === $('about-backdrop')) $('about-backdrop').classList.add('hidden');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('about-backdrop').classList.add('hidden');
});

// Egg 1: triple-click the logo -> floating motes
let logoClicks = 0, logoTimer = null;
$('logo').addEventListener('click', () => {
  logoClicks++;
  clearTimeout(logoTimer);
  logoTimer = setTimeout(() => { logoClicks = 0; }, 600);
  if (logoClicks >= 3) { logoClicks = 0; toggleMotes(); }
});

function toggleMotes() {
  const cv = $('egg-canvas');
  if (cv.dataset.on) { cv.dataset.on = ''; cv.style.display = 'none'; return; }
  cv.dataset.on = '1';
  cv.style.display = 'block';
  const ctx = cv.getContext('2d');
  const resize = () => { cv.width = innerWidth; cv.height = innerHeight; };
  resize();
  addEventListener('resize', resize);
  const motes = Array.from({ length: 40 }, () => ({
    x: Math.random() * innerWidth, y: Math.random() * innerHeight,
    r: 1 + Math.random() * 2.4, vy: 0.15 + Math.random() * 0.4, vx: (Math.random() - .5) * 0.25,
    a: 0.06 + Math.random() * 0.12,
  }));
  (function frame() {
    if (!cv.dataset.on) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const m of motes) {
      m.y -= m.vy; m.x += m.vx;
      if (m.y < -5) { m.y = cv.height + 5; m.x = Math.random() * cv.width; }
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, 7);
      ctx.fillStyle = `rgba(34,211,238,${m.a})`;
      ctx.fill();
    }
    requestAnimationFrame(frame);
  })();
}

// Egg 2: type "vayu" anywhere -> wind flash
let typed = '';
document.addEventListener('keydown', (e) => {
  if (/input|select|textarea/i.test(document.activeElement?.tagName || '')) return;
  typed = (typed + e.key.toLowerCase()).slice(-4);
  if (typed === 'vayu') {
    document.body.classList.remove('wind-flash');
    void document.body.offsetWidth;
    document.body.classList.add('wind-flash');
  }
});

/* ---------------- utils + boot ---------------- */

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

async function refresh() {
  try { await fetchAir(); }
  catch {
    $('aqi-advice').textContent = 'Could not load the air quality forecast. Check your connection and try again.';
  }
}

renderSuggestions();
addMsg('bot', "Hi! I'm your air-quality assistant. I can see today's forecast for your area once it loads - ask me when to go out, how to commute cleaner, or how to keep indoor air safe tonight.");
probeAI();
refresh();
addEventListener('resize', () => state.air && drawChart(state.air.hours));
