# FIREWATCH UB — Real ML Data Foundation Specification

**Status:** Schema & Validation Ready · **Model Training Status:** Not Trained Yet (`0` verified agency records bundled).

---

## 1. Non-Negotiable Data Honesty Policy

1. **Zero Demo Contamination:** Every record in `managed_incidents` and `IncidentRecord` carries an explicit `dataOrigin: 'real' | 'demo'` tag (SQLite `data_origin TEXT NOT NULL DEFAULT 'demo'`).
2. **Hard Training Gate:** `buildCleanTrainingDataset()` in `src/utils/mlDataFoundation.ts` unconditionally rejects every row where `isDemo === true` or `dataOrigin !== 'real'`. Bundled `DEMO_HISTORICAL_INCIDENTS` and synthesized `isModelled: true` khoroo profiles are **never** passed to ML training.
3. **No Synthetic Fabrication:** Because 0 verified historical NEMA (ОБЕГ) incident records currently exist in the repository, FIREWATCH UB trains **no** predictive ML model yet and displays heuristic composite indices (`0–100`) rather than calibrated statistical probabilities (`%`).

---

## 2. Spatiotemporal Panel Schema (`KhorooPeriodRow`)

Real incident logs are normalized to Ulaanbaatar time (`Asia/Ulaanbaatar`, `UTC+8`) and aggregated into a khoroo-by-period panel (`districtId-khorooNumber × YYYY-MM` / ISO week):

| Column | Type | Validation Rule | Source |
|---|---|---|---|
| `id` | `string` | Non-empty canonical dispatch/record ID (`^[a-zA-Z0-9._:-]{1,64}$`) | Agency log |
| `date` | `YYYY-MM-DD` | Valid calendar date (`2015-01-01` .. `getUbDateIso()`) in `UTC+8` | Agency dispatch timestamp |
| `districtId` | `string` | One of 9 Ulaanbaatar districts in `UB_DISTRICTS` | Standardized GIS lookup |
| `khorooNumber` | `integer` | `1..district.khoroosCount` | Standardized GIS lookup |
| `lat`, `lng` | `float` | Inside UB envelope (`47.2–48.35°N`, `106.15–108.7°E`, including Nalaikh/Baganuur/Bagakhangai) | Geocoded dispatch point |
| `category` | `enum` | `residential_ger \| residential_apt \| commercial \| grass_forest \| electrical` | Normalized taxonomy |
| `severity` | `enum` | `minor \| moderate \| critical` | Dispatch log |
| `responseTimeMin` | `integer` | `1..240` minutes | Dispatch-to-arrival delta |
| `dataOrigin` | `enum` | `'real'` (verified agency data) vs `'demo'` (pilot/sample test row) | Import pipeline |

---

## 3. Deduplication & Coordinate Bounds

- Canonical key: `canonicalIncidentKey(row)` = `${date}|${districtId}|${khorooNumber}|${lat.toFixed(4)}|${lng.toFixed(4)}|${category}`.
- Duplicate rows inside a single batch sync (`POST /api/v1/incidents/batch-sync`) or training dataset pass are dropped cleanly with an explicit `duplicateCount`.
- Out-of-bounds or missing coordinates are counted in `rejectedCount` (`out_of_ub_bounds`) and never silently coerced into ML training rows.

---

## 4. Weather & Exposure Covariates + Station Caveat

When agency history arrives, training joins khoroo-period panels with lagged (`1d`, `3d`, `7d`) weather features:
- `tempCelsius`, `humidityPercent`, `windSpeedKmh`, `gustKmh`, `precipitationMm`, `droughtDays`
- **Known Limitation (Single-Station Feed):** Current Open-Meteo proxy queries a single central point (`47.9184, 106.9177`). Winter valley inversions and elevated ger-district hillsides (Chingeltei, Songinokhairkhan, Nalaikh) experience microclimate temperature and wind divergence that a single coordinate cannot resolve. Any future historical weather backfill must document station grid resolution.

---

## 5. Minimum Statistical Readiness Gate (`ML_READINESS_THRESHOLDS`)

Model training and temporal holdout evaluation remain locked (`readyForTraining: false`) until verified `dataOrigin === 'real'` rows satisfy **all** minimum floors:
- `cleanUniqueRealCount >= 200` deduplicated incidents
- `distinctMonths >= 12` (minimum one full heating/spring/winter annual cycle to avoid seasonal leakage)
- `districtCoveragePct >= 65%` of Ulaanbaatar districts represented

---

## 6. Calibration, Baselines, Uncertainty & Static Feature Caveats (`mlModelEngine.ts`)

1. **Strict 3-Way Chronological Split (`train` -> `cal` -> `test`):**
   - Training months (`~55%`) fit the feature scaler, L2 logistic regression weights, and count models (`fitPoissonGlm` log-link + `fitRidgeLinear`).
   - Held-out calibration months (`~20%`) fit Platt scaling (`plattA`, `plattB`) strictly isolated from the final evaluation split.
   - Untouched test months (`~25%`) report `rocAuc`, `prAuc`, `brierScore`, `logLoss`, `ece`, `poissonDeviance`, `poissonRmse`, and `ridgeRmse` with zero calibration leakage.
2. **Baselines & Uncertainty:**
   - Out-of-sample Brier and LogLoss are benchmarked against three baselines fitted without test leakage: constant `baseRate`, Empirical Bayes per-khoroo `priorRate`, and heating/spring `seasonal` rate.
   - Deterministic 180-resample 95% bootstrap confidence intervals (`rocAucCi95`, `brierCi95`, `eceCi95`) accompany point metrics.
3. **Static Khoroo Feature Provenance:**
   - Even after 200+ verified agency incidents arrive, 4 static features (`gerShare`, `popDensityLog`, `roadImpedance`, `responseDelay`) remain **synthesized baselines** for `172` of `204` khoroos (`curatedKhoroos: 32`) until official National Statistical Office (ҮСХ) / UB GIS khoroo micro-tables are imported; khoroo prediction intervals widen (`synthPenalty`) accordingly and `featureProvenance` discloses this count explicitly.
