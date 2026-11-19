# FIREWATCH UB — Model Validation & Limitations Report

> **Honesty Statement:** The Ulaanbaatar district/khoroo risk scores and Fire Weather Index (FWI) in this codebase are **heuristic Multi-Criteria Decision Analysis (MCDA) indices (0–100)**. They have **NOT** yet been empirically calibrated or backtested against confidential official NEMA 101/105 multi-year historical dispatch records.

---

## 1. What `scripts/backtest.ts` Verified

Running `npx --yes tsx scripts/backtest.ts` checks **internal mathematical soundness** across bundled codebase constants (`src/utils/riskEngine.ts` and `src/data/ubGeoData.ts`):

1. **Threshold & Derivation Consistency:** Confirms every one of the 9 districts and all 204 khoroos strictly obey `riskLevelFromScore(score)` (`≥ 75 = very_high`, `55–74 = high`, `35–54 = moderate`, `< 35 = low`) and exact weighted-sum formula weights (`0.30 / 0.20 / 0.15 / 0.15 / 0.10 / 0.10`).
2. **Monotonicity Under Synthetic Stress Scenarios:**
   - **FWI Sensitivity:** Increasing wind speed (`5 → 45 km/h`) and lowering relative humidity (`70% → 18%`) strictly non-decreases `fireWeatherIndex`, `ignitionReceptivity`, and `spreadPotential`.
   - **Khoroo Structural Sensitivity:** Increasing ger-household share (`10% → 90%`) and nearest-station response delay (`5 → 22 min`) strictly non-decreases `computeSynthesizedKhorooScore`.
3. **Bundled Demo Incident Correlation (Proxy Check Only):** Computes Spearman rank-order correlation between district MCDA scores and the 35 bundled illustrative `DEMO_HISTORICAL_INCIDENTS`. Because those 35 rows are **illustrative bundled demonstration logs**, this check proves internal alignment rather than real-world predictive accuracy.

---

## 2. Known Limitations Requiring Real Ground-Truth Data

- **Uncalibrated Weights:** The `30% / 20% / 15% / 15% / 10% / 10%` factor weights reflect domain heuristics rather than logistic/Poisson regression fitted on historical fire counts per khoroo-year.
- **172 Synthesized Khoroos:** Khoroos marked `isModelled: true` (172 of 204) derive attributes deterministically around parent district averages (`ubGeoData.ts`). Actual intra-district micro-risk differences (e.g., frozen hillside roads, blocked hydrants) require field verification.
- **Single-Point Open-Meteo Grid:** Live meteorology covers `(47.9184, 106.9177)` and cannot resolve hyper-local valley temperature inversions or localized wind gusts.

---

## 3. Running the Verification Script

```bash
npx --yes tsx scripts/backtest.ts
```
