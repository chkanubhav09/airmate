// AirMate - pure parsing of the Open-Meteo air-quality response (no DOM, no fetch).
import { findPastAqi } from './aqi.js';

export const AIR_API = 'https://air-quality-api.open-meteo.com/v1/air-quality';

/** Build the Open-Meteo request URL for a coordinate. */
export function airUrl(lat, lon) {
  return `${AIR_API}?latitude=${lat}&longitude=${lon}`
    + '&current=us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone,carbon_monoxide'
    + '&hourly=us_aqi,pm2_5&past_days=1&forecast_days=3&timezone=auto';
}

/**
 * Turn an Open-Meteo JSON body into the app's air state.
 * @param {object} j parsed API response
 * @param {number} [now] epoch ms (injectable for tests)
 * @param {number} [maxHours] forecast hours to keep
 * @returns {{current: object, hours: {time: Date, aqi: number, pm25: number}[], sixHoursAgoAqi: number|null}}
 */
export function parseAirResponse(j, now = Date.now(), maxHours = 48) {
  if (!j || !j.hourly || !Array.isArray(j.hourly.time)) {
    throw new Error('unexpected air api response');
  }
  const hours = [];
  for (let i = 0; i < j.hourly.time.length; i++) {
    const t = new Date(j.hourly.time[i]);
    if (t.getTime() < now - 3600e3) continue;
    if (hours.length >= maxHours) break;
    hours.push({ time: t, aqi: j.hourly.us_aqi[i], pm25: j.hourly.pm2_5[i] });
  }
  const sixHoursAgoAqi = findPastAqi(j.hourly, j.current?.time || now, 6);
  return { current: j.current, hours, sixHoursAgoAqi };
}
