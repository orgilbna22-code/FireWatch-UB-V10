# FIREWATCH UB — Deployment Options & Production Guide

FIREWATCH UB runs either as a **full-stack Node.js server** (Option A, with SQLite persistence and Gemini AI analysis) or as a **static frontend demo** (Option B, e.g. GitHub Pages) that cleanly disables backend-only features when `/api` is unavailable.

---

## Option A: Node Host (Cloud Run / Fly.io / Render) with Persistent Disk

1. **Node.js requirement**: `>= 22.5.0` (enforced via `"engines"` in `package.json` for built-in `node:sqlite`).
2. **Build & Run**:
   ```bash
   npm ci
   npm run build        # builds dist/ (Vite SPA) + dist-server/server.mjs (esbuild bundle)
   npm run start:prod   # runs compiled dist-server/server.mjs in NODE_ENV=production
   ```
   Or build and deploy the included `Dockerfile`.
3. **Persistence (critical)**:
   Mount a persistent volume (e.g. `/data` on Fly.io / Render Disk / Cloud Run volume) and set:
   ```env
   FIREWATCH_DB_PATH=/data/firewatch.sqlite
   ```
   Without a persistent volume, container restarts wipe SQLite data on ephemeral root filesystems.
4. **Required Environment Variables**:
   - `ADMIN_TOKEN` — secret Bearer token enabling incident CRUD, batch-sync, and AI cache reset.
   - `GEMINI_API_KEY` — optional server-only key for `/api/ai/explain` (returns HTTP `503` cleanly when unset).
   - `GEMINI_MODEL` (default: `gemini-4-hydrogen`), `GEMINI_FALLBACK_MODEL` (default: `gemini-3.1-flash-lite`), `GEMINI_TIMEOUT_MS` (default: `18000`).
   - `ALLOWED_ORIGINS` / `APP_URL` — explicit CORS allowlist origins.

---

## Option B: Static-Only Hosting (GitHub Pages)

- Build the static client with `npx vite build` (and optionally set `VITE_API_BASE=https://your-api-host` if pointing to a separate API server).
- When `VITE_API_BASE` is empty and `/api/health` is unreachable (returns HTML 404/200 SPA fallback), the client:
  - Displays a bilingual notice (`"Энэ демо хувилбарт AI тайлбар болон хадгалалт идэвхгүй."`)
  - Disables AI explanation calls, incident database writes, and server audit saving without raw JSON parse errors
  - Keeps local browser-only home audit drafts clearly marked as *"Saved locally only — not saved on server"*.
