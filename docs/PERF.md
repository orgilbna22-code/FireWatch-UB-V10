# FIREWATCH UB — Performance, Compression & Lazy Asset Pipeline (Phase 25 / Phase 31)

Every metric in this report was measured directly against `npm run build` (`vite 8.3.8`, Node built-in `node:zlib`) and verified on the running app. No external `compression` npm package or bundle-analyzer dependency was added.

---

## 1. Initial Load Budget (`#citizen` Default Route)

### A. Initial Entry JS + CSS + HTML (`dist/`)

| Asset | Baseline Phase 25 (Raw) | Baseline (Gzip / Brotli) | Phase 31 (`#citizen` Raw) | Phase 31 (Gzip / Brotli) | Budget |
| --- | ---: | ---: | ---: | ---: | ---: |
| Entry application JS (`index-*.js` + `rolldown-runtime-*.js`) | 244,059 B | 66,382 B / 52,914 B | 214,536 B | 60,185 B / 49,009 B | — |
| Split immutable React vendor (`vendor-react-*.js`) | 431,256 B | 128,247 B / 104,380 B | 431,256 B | 128,247 B / 104,380 B | *(cached 1 yr immutable)* |
| **Combined Initial JS (`#citizen`)** | **675,315 B** | **194,629 B / 157,294 B** | **645,792 B** | **188,432 B (184.02 KB) / 153,389 B (149.79 KB)** | **`<= 300 KB` (PASS)** |
| Entry CSS (`index-*.css`) | 108,139 B | 17,638 B / 13,966 B | 113,891 B | ~18,320 B / ~14,480 B | — |
| Render-blocking Leaflet CSS (`unpkg.com`) | **0 B** on initial paint | — | **0 B** on initial paint (lazy chunk `RiskMap-*.css`: 15,095 B raw / 5,667 B br) | — | **Zero blocking `<head>` request** |
| HTML document (`index.html`) | 4,100 B | 1,390 B / 1,035 B | 4,120 B | ~1,390 B / ~1,035 B | — |

### B. Deferred / Lazy-Loaded Route & UI Chunks

Moved out of the eager `#citizen` initial entry bundle into on-demand `React.lazy(...)` chunks:

| Chunk | Raw Size | Gzip | Brotli | Trigger |
| --- | ---: | ---: | ---: | --- |
| `MobileMenuDrawer-*.js` (`motion/react`) | 141,442 B | 45,505 B | 40,274 B | Mobile drawer button opened |
| `RiskMap-*.js` + `RiskMap-*.css` (`leaflet`) | 304,714 B + 15,095 B | 84,777 B + 6,363 B | 71,308 B + 5,667 B | `#map` route |
| `AdminDataGate-*.js` | 78,482 B | 17,781 B | 14,974 B | `#sources` admin unlock |
| `PersonalPortal-*.js` | 55,811 B | 13,658 B | 11,340 B | `#personal` route |
| `LandingHero-*.js` + `LandingSections-*.js` | 37,288 B + 28,302 B | 8,068 B + 6,441 B | 6,903 B + 5,254 B | `#about` / `#landing` route |
| `DataSourcesModal-*.js` | 27,061 B | 7,280 B | 6,023 B | Governance modal opened |
| `FamilyQuickView-*.js` | 17,735 B | 5,258 B | 4,394 B | Family mode opened or `#safety` |
| `AboutModal-*.js` | 7,808 B | 2,838 B | 2,305 B | About modal opened |
| `GlobalFireBackground-*.js` | 9,207 B | 3,441 B | 2,998 B | Mounted via `requestIdleCallback` (with static dark backdrop shell during first paint) |
| `AmbientFireBackground-*.js` | 4,188 B | 1,776 B | 1,593 B | Lazy inside `LandingHero`, skipped when `prefers-reduced-motion`, `Save-Data`, or `deviceMemory <= 2` |

---

## 2. Image & Dead Asset Cleanup

| Item | Before | After | Savings |
| --- | ---: | ---: | ---: |
| Unused `/public/assets/aistudio/*` (6 debug PNGs) | 990,889 B | Removed (0 B) | **-990,889 B** |
| Duplicate `/src/assets/images/*` | 4,541,251 B | Removed (0 B) | **-4,541,251 B** |
| 4× JPEG showcase images in `/public/assets/images/` (full payload) | 4,541,251 B (`.jpg` only) | 672,576 B (4× progressive `.jpg`) + responsive WebP (`400w`/`800w`/`1200w`) & `800w` AVIF (`2,734,093 B` total across all 20 variants) | **-85.2% on `.jpg` fallbacks**; typical card (`400w` WebP) transfers **22.8–45.9 KB** vs **1,012–1,391 KB** (~**96–98%** smaller) |

Responsive `<picture>` delivery with explicit `width={960} height={717}`, `loading="lazy"`, and `decoding="async"` is wired in `src/data/ubMediaAssets.ts`, `src/components/map/AreaAnalysisPanel.tsx`, and `src/components/common/RealPhotoModal.tsx`.

Note on existing Git clones: deleting unused assets from the working directory leaves tracked copies if present in upstream history — run `git rm -r --cached public/assets/aistudio src/assets/images` when committing in Git.

---

## 3. Built-in `node:zlib` Compression & HTTP Header Verification

Implemented without external middleware in `scripts/precompress.mjs` and `src/server/compression.ts`:

- **Build-time precompression (`scripts/precompress.mjs`)**: Generates `.br` (`BROTLI_QUALITY = 11`) and `.gz` (`level = 9`) siblings across `dist/` for `.js`, `.mjs`, `.css`, `.svg`, `.json`, `.webmanifest`, `.html`, `.txt`, and `.xml` when smaller than the raw asset (Phase 31 build: 42 files, `1706.5 KB` raw -> `393.6 KB` `.br`, `472.3 KB` `.gz`). Skips `.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`, `.ico`, `.woff2`, and pre-encoded variants.
- **Static serving (`createPrecompressedStaticMiddleware`, `sendPrecompressedStaticFile`)**:
  - Negotiates `br` then `gzip` via `Accept-Encoding` (`Vary: Accept-Encoding` always appended).
  - `/assets/*` served with `Cache-Control: public, max-age=31536000, immutable`.
  - `/sw.js` and `index.html` served with `Cache-Control: no-cache, no-store, must-revalidate`.
  - Images and already-compressed files bypass encoding.
- **Dynamic API / HTML compression (`createDynamicCompressionMiddleware`)**: Compresses compressible text/JSON/HTML responses `>= 1024 B` using `node:zlib` only when `res.getHeader('Content-Encoding')` is unset, honoring `DISABLE_DYNAMIC_COMPRESSION=1` so Render's edge proxy never double-compresses payloads.

### Verified HTTP Probe (`NODE_ENV=production node dist-server/server.mjs`)

| Request | `Accept-Encoding` | Status | `Content-Encoding` | `Vary` | `Cache-Control` | Wire Bytes |
| --- | --- | ---: | --- | --- | --- | ---: |
| `/` | `br, gzip` | 200 | `br` | `Accept-Encoding` | `no-cache, no-store, must-revalidate` | 1,035 B |
| `/` | `gzip` | 200 | `gzip` | `Accept-Encoding` | `no-cache, no-store, must-revalidate` | 1,376 B |
| `/` | `identity` | 200 | *(none)* | `Accept-Encoding` | `no-cache, no-store, must-revalidate` | 4,020 B |
| `/assets/index-*.js` | `br, gzip` | 200 | `br` | `Accept-Encoding` | `public, max-age=31536000, immutable` | 151,748 B |
| `/assets/index-*.css` | `br` | 200 | `br` | `Accept-Encoding` | `public, max-age=31536000, immutable` | 13,966 B |
| `/assets/images/ub_ger_hillside_...-800.webp` | `br, gzip` | 200 | *(none)* | *(none)* | `public, max-age=86400` | 103,260 B |
| `/sw.js` | `br, gzip` | 200 | `br` | `Accept-Encoding` | `no-cache, no-store, must-revalidate` | 898 B |
| `/api/health` (85 B) | `br` | 200 | *(skipped `< 1KB`)* | *(none)* | *(none)* | 85 B |

---

## 4. Runtime Main-Thread Budgets

- **Motion & Data Saver Guard (`src/utils/motionBudget.ts`)**: `GlobalFireBackground`, `AmbientFireBackground`, and `FireAnimation` pause canvas `requestAnimationFrame` loops and heavy wobble keyframes when `prefers-reduced-motion: reduce`, `navigator.connection.saveData`, or `navigator.deviceMemory <= 2` is active, and pause whenever `document.hidden` is true (`AudioAmbiance.ts` also skips crackle timers while hidden).
- **Memoization & Incremental Windowing**: `DistrictAnalysis` (12/page), `AreaAnalysisPanel` (16/page), `IncidentHistory` (25/page), and `DataManagementPanel` (25/page) render `React.memo` rows/cards in paginated slices with *"Show more"* controls, preventing synchronous layout bursts across large district/incident datasets.

---

## 5. Honest Scope / Unresolved Measurements

- Standalone `lighthouse` CLI is not installed in the sandbox container, so mobile Slow-4G Lighthouse LCP/INP/CLS scores were not measured directly. Headless Chromium (`playwright-cli`) verified `#citizen` default route, `#map`, `#about`, zero console errors, zero Leaflet/ML requests on `#citizen`, zero sub-12px text, zero `< 44px` interactive controls (`#citizen` desktop/mobile and `#map` desktop), and zero horizontal overflow or header overlap on desktop (`1440×900`) and mobile (`360×740`, `390×844` light & dark). Run Lighthouse CI or Chrome DevTools Slow-4G throttling locally or in CI after deployment to measure field LCP/INP/CLS.
