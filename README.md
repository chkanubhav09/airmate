# AirMate - Urban Air Quality Assistant

PromptWars Virtual · Challenge 06 entry (Google for Developers × Hack2skill).

AirMate is a GenAI-powered assistant that helps families and communities navigate severe
winter smog and urban air pollution. It suggests **low-emission daily routines**,
**indoor air quality hacks**, and **sustainable alternatives** tailored to the user's
location and lifestyle - and every suggestion **explains the direct impact** of the choice.

## Features

| Area | What it does |
| --- | --- |
| Live air dashboard | Current US AQI + PM2.5 / PM10 / NO₂ / O₃ / CO, 48-hour forecast chart, best and worst outdoor windows |
| GenAI assistant chat | Answers grounded in the live air context (place, AQI, pollutants) - e.g. "when should I take my kids to the park today?" |
| My low-emission day | Turns a commute/routine profile into cleaner swaps; commute CO₂ baseline computed deterministically from published emission factors, AI adds personalised swaps with impact notes |
| Indoor air hacks | Generated from home context (floor, road-facing windows, purifier, cooking fuel) and today's AQI |

## Data sources & honesty notes

- **Air quality data**: [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api),
  Copernicus **CAMS global atmospheric composition model** (~45 km grid, updated every 12 h).
  License [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); free tier is non-commercial
  (<10k calls/day). **These are model forecasts, not ground-station readings.** For official
  Indian station data see CPCB's Sameer app.
- **AQI scale & health guidance**: [US EPA AirNow](https://www.airnow.gov/) bands
  (Good / Moderate / USG / Unhealthy / Very Unhealthy / Hazardous). India's CPCB national AQI
  bands differ slightly.
- **Emission factors**: rounded averages from the
  [UK Government GHG Conversion Factors 2026](https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2026)
  (e.g. average car ≈ 0.166 kg CO₂e/km). Used only for order-of-magnitude comparisons,
  always shown with "≈".
- **Not medical advice.** Health tips are general public guidance; sensitive groups should
  follow their doctor's plan.

## Tech

- Frontend: dependency-free HTML/CSS/JS (`public/`), canvas chart, OLED-dark UI,
  semantic markup + ARIA for accessibility.
- Backend: one Cloudflare Worker (`worker/index.js`) that serves the static app and
  proxies `/api/ai` so no AI key ever reaches the browser. Requests are stateless;
  nothing personal is stored.
- AI providers (either, both free-tier):
  1. **Cloudflare Workers AI** - uncomment `[ai]` in `wrangler.toml`.
  2. **Gemini API (free tier)** - `npx wrangler secret put GEMINI_API_KEY`.

## Run locally

```bash
npx wrangler dev          # serves app + /api/ai (needs a provider configured)
# or preview the static app only:
npx serve public          # AI features show an honest "backend offline" state
```

## Test

```bash
node --test tests/*.test.mjs
```

## Deploy

```bash
npx wrangler deploy       # after `wrangler login`
```

## GenAI disclosure (for the submission form)

- App development: AI-assisted ("vibe coding") throughout - structure, styling, worker proxy, tests.
- Runtime GenAI: large-language-model via the `/api/ai` proxy powers the assistant chat,
  routine swaps and indoor hacks, grounded with the live air context.
- Data: Open-Meteo (CAMS) air-quality forecasts; no user data leaves the app except the
  location/coarse profile sent with each AI request.

## Repo notes

- No secrets in this repo. `GEMINI_API_KEY` (if used) is a Wrangler secret.
- Repo stays under the 10 MB submission limit.
