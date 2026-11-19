# FIREWATCH UB — Data Provenance & Integrity Ledger

This document audits every data source used in **FIREWATCH UB**, separating **live external feeds** from **bundled demo / modelled datasets** and **user-generated records**.

---

## 1. Live External Feeds

| Source | Endpoint / Integration | Usage | Failure Handling / Caveat |
|---|---|---|---|
| **Open-Meteo Weather API** | `GET /api/weather` proxy (falls back to `https://api.open-meteo.com/v1/forecast` for `47.9184, 106.9177`) | Live temperature, relative humidity, wind speed, wind direction, precipitation & drought days driving `computeFireWeatherBreakdown` | Single metropolitan point feed; does not capture street-level microclimate inversions. Falls back cleanly to `CURRENT_UB_WEATHER` static baseline with explicit `offline` / `stale` badge. |
| **Public Map Tiles & Vector Basemaps** | OpenStreetMap, Esri World Imagery/Street, CARTO, OpenTopoMap, OpenFreeMap vector tiles | Interactive geographic map rendering and 3D tactical building footprints | Visual reference only; informal fence/alley edits may lag physical ground conditions. |

---

## 2. Bundled Demo & Modelled Datasets (`src/data/`)

All spatial, demographic, station, and incident datasets shipped under `src/data/` are **static reference baselines and deterministic demonstrations** — **NOT** live feeds from NEMA (ОБЕГ), NSO (ҮСХ), or NAMEM (ЦУОШГ).

| Dataset | Location | Record Count | Status | Derivation & Limitations |
|---|---|---|---|---|
| **UB Districts Baseline** | `src/data/ubGeoData.ts` (`UB_DISTRICTS`) | 9 districts | `dataStatus: 'demo'` | Static demo profiles (`population`, `areaKm2`, `gerHouseholdPercent`, `roadAccessibilityGrade`, `historicalIncidentsCount`). Composite `riskScore` & `riskLevel` are strictly derived via `computeWeightedDistrictRisk()` in `src/utils/riskEngine.ts`. |
| **Curated Khoroo Profiles** | `src/data/ubKhorooData.ts` (`UB_KHOROOS_CURATED`) | 32 khoroos | Bundled curated demo | Hand-authored representative khoroo estimates. Coordinates are clamped inside parent district polygons via `clampPointInsidePolygon()`. `riskLevel` is always derived via `riskLevelFromScore(riskScore)`. |
| **Modelled Khoroo Units** | `src/data/ubKhorooGenerated.ts` (`synthesizeKhoroos`) | 172 khoroos | `isModelled: true` | Deterministically synthesized with seeded PRNG (`mulberry32`) for khoroos without curated records. Score computed via shared `computeSynthesizedKhorooScore()` weights (`0.34 ger + 0.20 road + 0.18 hydrants + 0.16 response + 0.12 pop`) and anchored to parent district score while preserving ordering. |
| **Sample Historical Incidents** | `src/data/ubGeoData.ts` (`DEMO_HISTORICAL_INCIDENTS`) | 12 records | `isDemo: true` | Illustrative sample fire logs (`severity`, cause hints, approximate MNT damage) used solely for UI demonstration. |
| **Fire Stations Reference** | `src/data/ubGeoData.ts` (`UB_FIRE_STATIONS`) | 14 stations | Static reference | Approximate coordinates, vehicle/staff reference numbers, and nominal service radii. Not live dispatch telemetry. |
| **Monthly Seasonal Calendar** | `src/data/ubGeoData.ts` (`MONTH_RISK_CALENDAR`) | 12 months | Static climate baseline | Seasonal Ulaanbaatar weather and heating cycle risk illustrations. |
| **Safety Guides & Checklists** | `src/data/safetyData.ts` | 7 guides | General guidance | Practical preparedness checklists; not official regulatory directives. |

---

## 3. Shared Model Formulas (`src/utils/riskEngine.ts`)

1. **Unified Risk Level Thresholds (`RISK_THRESHOLDS`)**:
   - `>= 75`: `very_high`
   - `55–74`: `high`
   - `35–54`: `moderate`
   - `< 35`: `low`
2. **District Multi-Criteria Index (`DEFAULT_MODEL_WEIGHTS`)**:
   - Historical Incident Density (`30%`)
   - Population Density (`20%`)
   - Fire Station Proximity (`15%`)
   - Ger & Solid-Fuel Stove Ratio (`15%`)
   - Road Accessibility Grade (`10%`)
   - Seasonal & Weather Exposure (`10%`)
3. **Important Calibration Disclaimer**:
   - Output values represent a **heuristic 0–100 risk index** for relative prioritization, **not** a statistically calibrated ignition probability (%).

---

## 4. Server & Browser Persistence Tables (`src/server/db.ts`)

- `incidents` (SQLite): Admin/pilot-managed incidents (protected by Bearer `ADMIN_TOKEN` on write and batch sync routes).
- `ai_explanations` (SQLite cache): Cached grounded summaries from Gemini API.
- `personal_audits` (SQLite): Scoped per anonymous `httpOnly` `fw_sid` session cookie; no phone numbers stored server-side. Static/offline fallback stores drafts locally in `localStorage` (`localOnly: true`).
