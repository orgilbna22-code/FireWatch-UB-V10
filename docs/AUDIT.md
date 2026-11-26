# FIREWATCH UB — Phase 17 Bug Hunt, Performance & Dependency Audit

**Audit Date:** 2026-11-20  
**Scope:** Full-stack TypeScript codebase (`server.ts`, `src/**`, `public/sw.js`, `index.html`, `package.json`), runtime behavior, build output, and unit tests.

---

## 1. Bugs Found & Fixed

| ID | Severity | Location | Root Cause | Fix Applied |
|---|---|---|---|---|
| **B-01** | **High** | `src/components/map/ThermalHeatLayer.tsx`, `src/utils/riskEngine.ts` | Heat zone radii were clamped to a synthetic pixel floor and recalculated with two-point latitude approximation across zoom levels, shifting hotspot footprint and causing `z12`/`z14` opacity flicker steps. | Added exact Web Mercator `metersPerPixelAtLat()` / `radiusMetersToPixels()` scaling and smooth continuous `thermalZoomFillFactor()` with pooled typed-array & `ImageData` scratch buffers (`ThermalGridScratchBuffers`). |
| **B-02** | **High** | `src/utils/osmVectorBuildings.ts`, `src/components/map/Tactical3DOverlay.tsx` | Missing request timeout on OpenFreeMap vector tiles/TileJSON allowed hung sockets; failed tile fetches cached `Promise<null>` permanently in `tileCache` and `requestedTilesRef`, preventing retry on transient network drops. | Added 8-second `AbortController` `fetchWithTimeout()`, cleared failed `tileTemplatePromise`, evicted failed tile keys in `finally`, and cleared failed `requestedTilesRef` keys in `Tactical3DOverlay`. |
| **B-03** | **High** | `public/sw.js` | Single cache version (`v1`) lacked strict separation between mutable HTML documents (`index.html`, `/manifest.webmanifest`) and immutable Vite hashed assets (`/assets/*`), risking stale shell hydration after deploys. | Upgraded to `firewatch-ub-shell-v2`: network-first for HTML navigations, manifest, and `theme-init.js`; cache-first exclusively for immutable hashed `/assets/*`; stale-while-revalidate for static icons/media. |
| **B-04** | **Medium** | `server.ts`, `src/hooks/liveWeather.ts`, `LandingHero.tsx`, `RiskCalendar.tsx`, `WeatherModule.tsx`, `ReportCenter.tsx`, `AnalyticsDashboardSection.tsx`, `DataManagementPanel.tsx` | Multiple UI modules and server incident/weather date fallbacks used UTC `new Date().toISOString().slice(0, 10)` or browser-local `getMonth()`, causing off-by-one calendar dates between `00:00–07:59 UTC+8` or non-UB browsers. | Introduced `src/utils/ubTime.ts` (`getUbDateIso`, `getUbMonthIndex`, `getUbWeekdayIndex`, `formatUbShortWeekdayEn`) locked to `Asia/Ulaanbaatar` and replaced all UTC/local date calls with unit tests in `src/utils/ubTime.test.ts`. |
| **B-05** | **Medium** | `src/components/map/Tactical3DOverlay.tsx`, `src/components/map/RiskMap.tsx` | 3D tactical mode labelled demonstration hotspots as `"Гал илэрсэн" / "Incident active"`, risking misinterpretation as live NEMA emergency dispatch alerts; khoroo/heatmap captions needed clearer modelled vs curated wording. | Relabelled 3D focus marker to `"Загварчилсан цэг" / "Scenario focus"`, added explicit amber 3D scenario disclaimer banner, and clarified district-clamped modelled vs curated khoroo status in tooltips/legend. |
| **B-06** | **Low** | `src/components/common/DataSourcesModal.tsx` | Static import of `AdminDataGate` alongside a dynamic import elsewhere triggered Vite's `[INEFFECTIVE_DYNAMIC_IMPORT]` warning and bloated the initial modal chunk. | Converted `AdminDataGate` inside `DataSourcesModal.tsx` to `React.lazy` wrapped in `<Suspense>`. |
| **B-07** | **Low** | `index.html`, `vite.config.ts` | Canonical/OG/Twitter image meta tags needed environment-configurable absolute HTTPS URLs without hardcoded legacy hostnames. | Parameterized `canonical`, `og:url`, `og:image`, and `twitter:image` via `%VITE_PUBLIC_URL%` in `index.html` and `vite.config.ts` (`https://firewatch-ub-v10.onrender.com` default). |

---

## 2. Dependency & Lockfile Standardization

- **Single Lockfile:** Standardized on `package-lock.json` (removed `bun.lock`) and renamed package to `firewatch-ub`.
- **Verification / Dev-Only Tooling:** Added `@playwright/test` and `@axe-core/playwright` under `devDependencies` with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` for CI/Render builds.
- **Assessment & Mitigations:**
  - Runtime dependencies (`express ^4.21.2`, `@google/genai ^3.3.0`, `leaflet ^1.9.4`, `react ^19.0.1`, `@mapbox/vector-tile ^3.0.0`, `pbf ^5.1.2`, `dotenv ^17.2.3`) are current stable major releases with strict CSP, `helmet`-equivalent headers (`src/server/security.ts`), constant-time `ADMIN_TOKEN` Bearer auth, `256kb` JSON payload cap, and per-IP rate limiting.

---

## 3. Build, Lint & Test Verification Notes

- Verified TypeScript typechecking (`npm run lint`), Node built-in test runner (`npm test`), and production bundle (`npm run build`) after edits.
- Confirmed zero `[INEFFECTIVE_DYNAMIC_IMPORT]` warnings remain in Vite build output.
