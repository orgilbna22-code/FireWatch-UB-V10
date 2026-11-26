# FIREWATCH UB — Open Stakeholder & Architecture Decisions

Decisions below depend on operational information, legal approvals, domain agency feeds, or infrastructure budgets owned by the maintainer and partner agencies. **None of these are invented or pre-selected without your confirmation.** Phases 19–21 (ML model training/runtime, bulk weather & OSM ingestion, real street routing, H3 privacy aggregation) are paused until you answer these decisions.

---

## 1. Deployment Target & Hosting Infrastructure (Phase 2)

- **Question:** Will the public production app run on **(A) a persistent Node.js server** (Cloud Run + Cloud SQL / Litestream, Render Disk, Fly.io Volumes) keeping SQLite/Open-Meteo cache, `ADMIN_TOKEN` writes, and Gemini `/api/ai/explain` live, OR **(B) static-only hosting** (e.g., GitHub Pages) as a read-only civic prototype?
- **Current state:** Express server (`server.ts`) and static fallback detection (`useApiAvailability`) both work cleanly.

## 2. ML Runtime & Dependency Stack (Phase 19)

- **Question:** When verified real incident data arrives, should offline ML training/evaluation run in **(A) a standalone Python pipeline** (`scikit-learn` / `lightgbm` / `xgboost` exporting calibrated JSON weights or ONNX to Node), OR **(B) pure Node/TypeScript** inside this single-runtime container?
- **Current state:** Data schema (`dataOrigin: 'real' | 'demo'`), validation, canonical deduplication, and minimum statistical readiness checks (`src/utils/mlDataFoundation.ts`) are complete in TypeScript without installing extra runtimes or packages.

## 3. Authoritative Incident Source & Readiness Overrides (Phase 18/19)

- **Question:** What is the official source and export format for historical Ulaanbaatar fire incident logs (date, district, khoroo, category, response time — stripped of PII), and do you approve the proposed minimum readiness floors in `docs/ML_DATA.md` (`>= 200` unique real incidents, `>= 12` months, `>= 65%` district coverage)?
- **Current state:** `0` verified real agency records are bundled (`DEMO_HISTORICAL_INCIDENTS` contains 12 demo examples, strictly excluded from ML).

## 4. Bulk Weather Archive & Multi-Station Spatial Grid (Phase 20)

- **Question:** Do you authorize running an offline script to backfill multi-year historical Ulaanbaatar weather from **Open-Meteo Historical Archive API** and querying district/valley sub-grid points (or official NAMEM/ЦУОШГ stations) to fix the current single-station (`47.9184, 106.9177`) inversion limitation?

## 5. Geospatial Routing Engine & Authoritative GIS Boundaries (Phase 21)

- **Question:** Should straight-line emergency station ETA placeholders be replaced with **(A) hosted/self-hosted OSRM or Valhalla** using OSM road extracts, OR **(B) OpenRouteService / Google Routes API**, and can official khoroo boundary GeoJSON & hydrant inventories be supplied?
- **Current state:** Explicit `"Ойролцоо шулуун ETA (бодит диспетчер биш)"` disclaimer is displayed in 3D/station views.

## 6. Citizen Privacy k-Anonymity Threshold for Spatial Aggregation (Phase 21)

- **Question:** Before displaying public heatmaps from real incident dispatches, what minimum `k`-anonymity suppression threshold (e.g., `k >= 5` or `k >= 10` incidents per H3 hex / khoroo cell) does your team require to prevent identifying individual households?

## 7. Admin Auth, Pilot Partner Legal Review & Police Scope (`#police`, Phases 4, 8, 10)

- **Questions:**
  1. Is a single `ADMIN_TOKEN` Bearer secret enough for pilot trials, or do Fire Command staff need named multi-user RBAC accounts?
  2. Who owns formal legal sign-off on the public/dispatch disclaimers in `docs/RISK_REGISTER.md` (Category A/B)?
  3. What specific operational views—if any—do UB Police officers (`102`) need in `#police` (traffic diversion corridors, perimeter buffers, hydrant clearance zones)?
- **Current state:** Single `ADMIN_TOKEN` constant-time Bearer gate is active; `#police` renders an honest scope-unconfirmed placeholder (`PolicePlaceholder.tsx`).
