# FIREWATCH UB — Open Stakeholder & Product Decisions

Decisions below depend on operational information, legal approvals, or infrastructure choices owned by the maintainer and partner agencies. They have intentionally **not** been invented or hardcoded in the codebase.

---

## 1. Deployment Target & Hosting Infrastructure (Phase 2)

- **Question:** Will the public production app run on **(A) a Node.js host with persistent storage** (e.g., Cloud Run with Cloud SQL / Litestream, Render Persistent Disk, Fly.io Volumes) so SQLite/Open-Meteo caching, `ADMIN_TOKEN` writes, and Gemini explanations stay online, OR **(B) static-only hosting** (e.g., GitHub Pages) as a read-only civic prototype?
- **Current state:** Express server (`server.ts`) and static feature detection (`useApiAvailability`) both work cleanly; awaiting final hosting target confirmation.

## 2. Admin Authentication Strategy (Phases 1 & 10)

- **Question:** Is the single `ADMIN_TOKEN` Bearer secret sufficient for an initial pilot, or do Fire Command dispatch officers need named multi-user accounts (OIDC / Firebase Auth / RBAC with audit log attribution)?
- **Current state:** Single `ADMIN_TOKEN` constant-time Bearer gate is active and keeps `DataManagementPanel` hidden from public visitors.

## 3. Official Agency / Pilot Partner Identity & Contacts (Phases 4 & 10)

- **Question:** What is the confirmed pilot unit / partner organization name, official technical liaison email, and official fire hydrant / station inventory data source (if any) permitted for display?
- **Current state:** Pilot partner name defaults to a configurable placeholder editable locally in the Fire Command panel; all emergency numbers (`101`, `102`, `103`, `105`) are isolated in `src/data/emergencyContacts.ts`.

## 4. Police Operational Scope (`#police`, Phases 8 & 10)

- **Question:** What specific operational information—if any—do police officers (`102`) actually need during urban fire responses (e.g., traffic diversion corridors, perimeter buffer radii, hydrant access clearance zones, or 102–105 handoff status)?
- **Current state:** `#police` renders an honest placeholder explaining requirements are unconfirmed, plus direct emergency numbers (`102`, `105`, `101`) and a maintainer inquiry link.

## 5. Historical Fire Incident Dataset for Model Calibration & Backtesting (Phase 12)

- **Question:** Can anonymized historical Ulaanbaatar fire incident logs (date, district, khoroo, cause category, structural type — free of PII) be supplied to calibrate and backtest the 6-factor MCDA risk weights (`0.30 / 0.20 / 0.15 / 0.15 / 0.10 / 0.10`)?
- **Current state:** Only bundled illustrative incidents (`DEMO_HISTORICAL_INCIDENTS`) exist; `/scripts/backtest.ts` documents formula monotonicity and sensitivity checks explicitly as uncalibrated proxy verification (`docs/VALIDATION.md`).

## 6. Citizen & Officer User Research Schedule (Phase 12)

- **Question:** Which ger-district khoroos and fire command shift officers will participate in usability observation sessions using the template in `docs/USER_RESEARCH.md`?
