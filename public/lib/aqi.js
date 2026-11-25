// AirMate - pure, testable logic (no DOM access here).
// AQI bands follow the US EPA AirNow standard (airnow.gov).
// Emission factors are rounded averages from UK Government GHG Conversion
// Factors 2026 (gov.uk) - used only for rough, clearly-labelled estimates.

export const AQI_BANDS = [
  { max: 50, key: 'good', label: 'Good', color: '#34d399',
    advice: 'Air quality is satisfactory. A great day to be active outside.' },
  { max: 100, key: 'moderate', label: 'Moderate', color: '#facc15',
    advice: 'Air quality is acceptable. Unusually sensitive people should consider making outdoor activities shorter and less intense.' },
  { max: 150, key: 'usg', label: 'Unhealthy for Sensitive Groups', color: '#fb923c',
    advice: 'Children, older adults, and people with heart or lung disease should shorten and soften outdoor activities. Everyone else can stay active with more breaks.' },
  { max: 200, key: 'unhealthy', label: 'Unhealthy', color: '#f87171',
    advice: 'Everyone should avoid long or intense outdoor activities. Consider rescheduling or moving activities indoors.' },
  { max: 300, key: 'very', label: 'Very Unhealthy', color: '#c084fc',
    advice: 'Health alert. Avoid all physical activity outdoors; move activities indoors.' },
  { max: 500, key: 'hazard', label: 'Hazardous', color: '#f43f5e',
    advice: 'Emergency conditions. Remain indoors, keep windows closed, and keep activity levels low.' },
];

export function aqiBand(aqi) {
  const v = Number(aqi);
  if (!Number.isFinite(v) || v < 0) return AQI_BANDS[0];
  for (const b of AQI_BANDS) if (v <= b.max) return b;
  return AQI_BANDS[AQI_BANDS.length - 1];
}

// Classify AQI trend comparing current AQI to a past reading (e.g. 6 hours earlier).
// Returns 'rising', 'falling', or 'steady' (steady when |current - past| <= 5).
export function aqiTrend(current, sixHoursAgo) {
  if (current === null || current === undefined || sixHoursAgo === null || sixHoursAgo === undefined) {
    return null;
  }
  if (typeof current === 'string' && current.trim() === '') return null;
  if (typeof sixHoursAgo === 'string' && sixHoursAgo.trim() === '') return null;

  const c = Number(current);
  const prev = Number(sixHoursAgo);
  if (!Number.isFinite(c) || !Number.isFinite(prev)) return null;

  const diff = c - prev;
  if (Math.abs(diff) <= 5 + 1e-9) return 'steady';
  return diff > 5 ? 'rising' : 'falling';
}

export const AQI_TREND_LABELS = {
  rising: 'Rising vs 6h ago',
  falling: 'Falling vs 6h ago',
  steady: 'Steady vs 6h ago',
};

// Derive past AQI from an hourly series (Open-Meteo object or array of {time, aqi}).
export function findPastAqi(series, currentTime, hoursAgo = 6) {
  if (!series || currentTime === null || currentTime === undefined) return null;
  const targetMs = new Date(currentTime).getTime() - hoursAgo * 3600 * 1000;
  if (!Number.isFinite(targetMs)) return null;

  let closestAqi = null;
  let minDiff = Infinity;

  if (Array.isArray(series)) {
    for (const item of series) {
      if (!item || item.aqi === null || item.aqi === undefined) continue;
      const t = new Date(item.time).getTime();
      if (!Number.isFinite(t)) continue;
      const diff = Math.abs(t - targetMs);
      if (diff < minDiff) {
        minDiff = diff;
        closestAqi = item.aqi;
      }
    }
  } else if (series && Array.isArray(series.time)) {
    const aqiArr = series.us_aqi || series.aqi;
    if (!Array.isArray(aqiArr)) return null;
    for (let i = 0; i < series.time.length; i++) {
      const val = aqiArr[i];
      if (val === null || val === undefined) continue;
      const t = new Date(series.time[i]).getTime();
      if (!Number.isFinite(t)) continue;
      const diff = Math.abs(t - targetMs);
      if (diff < minDiff) {
        minDiff = diff;
        closestAqi = val;
      }
    }
  }

  if (closestAqi !== null && minDiff <= 90 * 60 * 1000) {
    const num = Number(closestAqi);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

// Find contiguous windows in the next hours where AQI stays at or under a
// threshold, restricted to plausible outdoor hours (default 05:00-22:00 local)
// so the app never recommends a 1 am "best time to go out".
// hours: [{time: Date|string, aqi: number}]
export function bestWindows(hours, threshold = 100, minLen = 2, fromHour = 5, toHour = 22) {
  const out = [];
  let start = null;
  for (let i = 0; i <= hours.length; i++) {
    const h = hours[i];
    const hr = h ? new Date(h.time).getHours() : -1;
    const ok = h && Number.isFinite(h.aqi) && h.aqi <= threshold && hr >= fromHour && hr < toHour;
    if (ok && start === null) start = i;
    if ((!ok || i === hours.length) && start !== null) {
      if (i - start >= minLen) {
        const seg = hours.slice(start, i);
        out.push({
          from: seg[0].time,
          to: seg[seg.length - 1].time,
          minAqi: Math.min(...seg.map(s => s.aqi)),
          maxAqi: Math.max(...seg.map(s => s.aqi)),
        });
      }
      start = null;
    }
  }
  return out;
}

// kg CO2e per passenger-km, rounded from UK Gov GHG Conversion Factors 2026.
// These are rough global averages, used for order-of-magnitude estimates only.
export const EMISSION_FACTORS = {
  car_petrol: 0.166,   // average car, unknown fuel
  car_diesel: 0.171,
  motorbike: 0.113,    // average motorcycle
  auto_rickshaw: 0.10, // estimate, comparable small petrol vehicle
  bus: 0.089,          // local bus, per passenger
  metro: 0.035,        // national rail average, per passenger
  cycle: 0,
  walk: 0,
};

export const MODE_LABELS = {
  car_petrol: 'petrol car', car_diesel: 'diesel car', motorbike: 'motorbike',
  auto_rickshaw: 'auto-rickshaw', bus: 'bus', metro: 'metro',
  cycle: 'bicycle', walk: 'walking',
};

// Weekly CO2e for a commute done `daysPerWeek` round trips.
export function weeklyCo2Kg(mode, oneWayKm, daysPerWeek = 5) {
  const f = EMISSION_FACTORS[mode];
  if (f === undefined) return null;
  return +(f * oneWayKm * 2 * daysPerWeek).toFixed(2);
}

// Savings from switching one commute mode to another.
export function switchSavingKg(fromMode, toMode, oneWayKm, daysPerWeek = 5) {
  const a = weeklyCo2Kg(fromMode, oneWayKm, daysPerWeek);
  const b = weeklyCo2Kg(toMode, oneWayKm, daysPerWeek);
  if (a === null || b === null) return null;
  return +(a - b).toFixed(2);
}

// Tiny markdown-lite renderer shared by app and tests (bold, lists, line breaks).
export function mdLite(text) {
  const esc = String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = esc.split('\n');
  let html = '', inList = false;
  for (const line of lines) {
    const li = line.match(/^\s*[-*]\s+(.*)/);
    if (li) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += '<li>' + bold(li[1]) + '</li>';
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      if (line.trim()) html += '<p>' + bold(line) + '</p>';
    }
  }
  if (inList) html += '</ul>';
  return html;
}
function bold(s) { return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'); }
