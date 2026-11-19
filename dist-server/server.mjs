// server.ts
import "dotenv/config";
import express from "express";
import path2 from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

// src/server/db.ts
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
function createFireWatchDb(dbPath = process.env.FIREWATCH_DB_PATH || process.env.DB_PATH || "./data/firewatch.sqlite") {
  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    mkdirSync(dir, { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS weather_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fetched_at_ms INTEGER NOT NULL,
      observed_at_iso TEXT NOT NULL,
      temp_celsius REAL NOT NULL,
      apparent_celsius REAL NOT NULL,
      humidity_percent INTEGER NOT NULL,
      wind_speed_kmh REAL NOT NULL,
      wind_direction_deg INTEGER NOT NULL,
      gust_kmh INTEGER NOT NULL,
      precipitation_mm REAL NOT NULL,
      weather_code INTEGER NOT NULL,
      drought_days INTEGER NOT NULL,
      fire_weather_index INTEGER NOT NULL,
      ignition_receptivity INTEGER NOT NULL,
      spread_potential INTEGER NOT NULL,
      utc_offset_seconds INTEGER NOT NULL DEFAULT 28800,
      daily_json TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'Open-Meteo'
    );

    CREATE TABLE IF NOT EXISTS home_audits (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL DEFAULT '',
      created_at_iso TEXT NOT NULL,
      district_id TEXT NOT NULL,
      khoroo_number INTEGER NOT NULL,
      home_type TEXT NOT NULL,
      heating_type TEXT NOT NULL,
      electrical_state TEXT NOT NULL,
      has_smoke_detector INTEGER NOT NULL,
      has_fire_extinguisher INTEGER NOT NULL,
      ash_storage TEXT NOT NULL,
      has_children INTEGER NOT NULL,
      has_elderly INTEGER NOT NULL,
      score INTEGER NOT NULL,
      risk_level TEXT NOT NULL,
      meeting_point TEXT NOT NULL,
      emergency_phone TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS ai_explanation_cache (
      cache_key TEXT PRIMARY KEY,
      created_at_ms INTEGER NOT NULL,
      response_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS managed_incidents (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      district_id TEXT NOT NULL,
      khoroo_number INTEGER NOT NULL,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      cause_guess_mn TEXT NOT NULL,
      cause_guess_en TEXT NOT NULL,
      response_time_min INTEGER NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at_iso TEXT NOT NULL
    );
  `);
  const auditCols = db.prepare(`PRAGMA table_info(home_audits)`).all();
  if (!auditCols.some((c) => c.name === "session_id")) {
    db.exec(`ALTER TABLE home_audits ADD COLUMN session_id TEXT NOT NULL DEFAULT ''`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_home_audits_session ON home_audits(session_id, created_at_iso DESC);
    UPDATE home_audits SET emergency_phone = '' WHERE emergency_phone != '';
  `);
  const insertWeatherStmt = db.prepare(`
    INSERT INTO weather_observations (
      fetched_at_ms, observed_at_iso, temp_celsius, apparent_celsius,
      humidity_percent, wind_speed_kmh, wind_direction_deg, gust_kmh,
      precipitation_mm, weather_code, drought_days, fire_weather_index,
      ignition_receptivity, spread_potential, utc_offset_seconds, daily_json, provider
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const latestWeatherStmt = db.prepare(`
    SELECT
      id,
      fetched_at_ms AS fetchedAtMs,
      observed_at_iso AS observedAtIso,
      temp_celsius AS tempCelsius,
      apparent_celsius AS apparentCelsius,
      humidity_percent AS humidityPercent,
      wind_speed_kmh AS windSpeedKmh,
      wind_direction_deg AS windDirectionDeg,
      gust_kmh AS gustKmh,
      precipitation_mm AS precipitationMm,
      weather_code AS weatherCode,
      drought_days AS droughtDays,
      fire_weather_index AS fireWeatherIndex,
      ignition_receptivity AS ignitionReceptivity,
      spread_potential AS spreadPotential,
      utc_offset_seconds AS utcOffsetSeconds,
      daily_json AS dailyJson,
      provider
    FROM weather_observations
    ORDER BY id DESC
    LIMIT 1
  `);
  const insertAuditStmt = db.prepare(`
    INSERT INTO home_audits (
      id, session_id, created_at_iso, district_id, khoroo_number, home_type, heating_type,
      electrical_state, has_smoke_detector, has_fire_extinguisher, ash_storage,
      has_children, has_elderly, score, risk_level, meeting_point, emergency_phone
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
  `);
  const listAuditsStmt = db.prepare(`
    SELECT
      id,
      session_id AS sessionId,
      created_at_iso AS createdAtIso,
      district_id AS districtId,
      khoroo_number AS khorooNumber,
      home_type AS homeType,
      heating_type AS heatingType,
      electrical_state AS electricalState,
      has_smoke_detector AS hasSmokeDetector,
      has_fire_extinguisher AS hasFireExtinguisher,
      ash_storage AS ashStorage,
      has_children AS hasChildren,
      has_elderly AS hasElderly,
      score,
      risk_level AS riskLevel,
      meeting_point AS meetingPoint
    FROM home_audits
    WHERE session_id = ?
    ORDER BY created_at_iso DESC
    LIMIT 25
  `);
  const deleteAuditStmt = db.prepare(`DELETE FROM home_audits WHERE id = ? AND session_id = ?`);
  const getAiCacheStmt = db.prepare(
    `SELECT created_at_ms AS createdAtMs, response_json AS responseJson FROM ai_explanation_cache WHERE cache_key = ?`
  );
  const setAiCacheStmt = db.prepare(`
    INSERT INTO ai_explanation_cache (cache_key, created_at_ms, response_json)
    VALUES (?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      created_at_ms = excluded.created_at_ms,
      response_json = excluded.response_json
  `);
  const clearAiCacheStmt = db.prepare(`DELETE FROM ai_explanation_cache`);
  const upsertIncidentStmt = db.prepare(`
    INSERT INTO managed_incidents (
      id, date, district_id, khoroo_number, category, severity,
      cause_guess_mn, cause_guess_en, response_time_min, lat, lng, source, created_at_iso
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      date = excluded.date,
      district_id = excluded.district_id,
      khoroo_number = excluded.khoroo_number,
      category = excluded.category,
      severity = excluded.severity,
      cause_guess_mn = excluded.cause_guess_mn,
      cause_guess_en = excluded.cause_guess_en,
      response_time_min = excluded.response_time_min,
      lat = excluded.lat,
      lng = excluded.lng,
      source = excluded.source
  `);
  const listIncidentsStmt = db.prepare(`
    SELECT
      id,
      date,
      district_id AS districtId,
      khoroo_number AS khorooNumber,
      category,
      severity,
      cause_guess_mn AS causeGuessMn,
      cause_guess_en AS causeGuessEn,
      response_time_min AS responseTimeMin,
      lat,
      lng,
      source,
      created_at_iso AS createdAtIso
    FROM managed_incidents
    ORDER BY date DESC, created_at_iso DESC
    LIMIT 200
  `);
  const getIncidentByIdStmt = db.prepare(`
    SELECT
      id,
      date,
      district_id AS districtId,
      khoroo_number AS khorooNumber,
      category,
      severity,
      cause_guess_mn AS causeGuessMn,
      cause_guess_en AS causeGuessEn,
      response_time_min AS responseTimeMin,
      lat,
      lng,
      source,
      created_at_iso AS createdAtIso
    FROM managed_incidents
    WHERE id = ?
  `);
  const deleteIncidentStmt = db.prepare(`DELETE FROM managed_incidents WHERE id = ?`);
  const countWeatherStmt = db.prepare(`SELECT COUNT(*) AS cnt FROM weather_observations`);
  const countAuditsStmt = db.prepare(`SELECT COUNT(*) AS cnt FROM home_audits`);
  const countIncidentsStmt = db.prepare(`SELECT COUNT(*) AS cnt FROM managed_incidents`);
  const countAiCacheStmt = db.prepare(`SELECT COUNT(*) AS cnt FROM ai_explanation_cache`);
  return {
    saveWeather(rec) {
      const info = insertWeatherStmt.run(
        rec.fetchedAtMs,
        rec.observedAtIso,
        rec.tempCelsius,
        rec.apparentCelsius,
        rec.humidityPercent,
        rec.windSpeedKmh,
        rec.windDirectionDeg,
        rec.gustKmh,
        rec.precipitationMm,
        rec.weatherCode,
        rec.droughtDays,
        rec.fireWeatherIndex,
        rec.ignitionReceptivity,
        rec.spreadPotential,
        rec.utcOffsetSeconds,
        rec.dailyJson,
        rec.provider
      );
      return { ...rec, id: Number(info.lastInsertRowid) };
    },
    getLatestWeather() {
      const row = latestWeatherStmt.get();
      return row ?? null;
    },
    saveHomeAudit(audit) {
      if (!audit.sessionId) {
        throw new Error("sessionId is required to store a home audit");
      }
      insertAuditStmt.run(
        audit.id,
        audit.sessionId,
        audit.createdAtIso,
        audit.districtId,
        audit.khorooNumber,
        audit.homeType,
        audit.heatingType,
        audit.electricalState,
        audit.hasSmokeDetector ? 1 : 0,
        audit.hasFireExtinguisher ? 1 : 0,
        audit.ashStorage,
        audit.hasChildren ? 1 : 0,
        audit.hasElderly ? 1 : 0,
        audit.score,
        audit.riskLevel,
        audit.meetingPoint
      );
      return { ...audit, emergencyPhone: "" };
    },
    listHomeAudits(sessionId) {
      if (!sessionId) return [];
      const rows = listAuditsStmt.all(sessionId);
      return rows.map((r) => ({
        ...r,
        hasSmokeDetector: Boolean(r.hasSmokeDetector),
        hasFireExtinguisher: Boolean(r.hasFireExtinguisher),
        hasChildren: Boolean(r.hasChildren),
        hasElderly: Boolean(r.hasElderly),
        emergencyPhone: ""
      }));
    },
    deleteHomeAudit(id, sessionId) {
      if (!id || !sessionId) return false;
      const res = deleteAuditStmt.run(id, sessionId);
      return Number(res.changes) > 0;
    },
    getAiCache(cacheKey, maxAgeMs) {
      const row = getAiCacheStmt.get(cacheKey);
      if (!row) return null;
      if (Date.now() - row.createdAtMs > maxAgeMs) return null;
      try {
        return JSON.parse(row.responseJson);
      } catch {
        return null;
      }
    },
    setAiCache(cacheKey, payload) {
      setAiCacheStmt.run(cacheKey, Date.now(), JSON.stringify(payload));
    },
    clearAiCache() {
      const res = clearAiCacheStmt.run();
      return Number(res.changes);
    },
    upsertIncident(inc) {
      upsertIncidentStmt.run(
        inc.id,
        inc.date,
        inc.districtId,
        inc.khorooNumber,
        inc.category,
        inc.severity,
        inc.causeGuessMn,
        inc.causeGuessEn,
        inc.responseTimeMin,
        inc.lat,
        inc.lng,
        inc.source,
        inc.createdAtIso
      );
      return inc;
    },
    batchUpsertIncidents(items) {
      let count = 0;
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const inc of items) {
          upsertIncidentStmt.run(
            inc.id,
            inc.date,
            inc.districtId,
            inc.khorooNumber,
            inc.category,
            inc.severity,
            inc.causeGuessMn,
            inc.causeGuessEn,
            inc.responseTimeMin,
            inc.lat,
            inc.lng,
            inc.source,
            inc.createdAtIso
          );
          count += 1;
        }
        db.exec("COMMIT");
        return count;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    listIncidents() {
      return listIncidentsStmt.all();
    },
    getIncidentById(id) {
      const row = getIncidentByIdStmt.get(id);
      return row ?? null;
    },
    deleteIncident(id) {
      const res = deleteIncidentStmt.run(id);
      return Number(res.changes) > 0;
    },
    getStats() {
      const w = countWeatherStmt.get()?.cnt ?? 0;
      const a = countAuditsStmt.get()?.cnt ?? 0;
      const i = countIncidentsStmt.get()?.cnt ?? 0;
      const c = countAiCacheStmt.get()?.cnt ?? 0;
      return {
        weatherCount: Number(w),
        homeAuditCount: Number(a),
        incidentCount: Number(i),
        aiCacheCount: Number(c)
      };
    },
    close() {
      db.close();
    }
  };
}

// src/server/security.ts
import crypto from "node:crypto";
var SESSION_COOKIE_NAME = "fw_sid";
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function verifyBearerToken(authHeader, expectedToken) {
  const expected = (expectedToken ?? "").trim();
  if (!expected) {
    return {
      ok: false,
      status: 403,
      error: "Admin write operations are disabled (ADMIN_TOKEN is not configured on the server)."
    };
  }
  if (!authHeader || typeof authHeader !== "string") {
    return {
      ok: false,
      status: 401,
      error: "Authentication required. Provide an Authorization: Bearer <token> header."
    };
  }
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const provided = match?.[1]?.trim() ?? "";
  if (!provided) {
    return {
      ok: false,
      status: 401,
      error: "Malformed Authorization header. Expected Bearer <token>."
    };
  }
  const a = crypto.createHash("sha256").update(provided, "utf8").digest();
  const b = crypto.createHash("sha256").update(expected, "utf8").digest();
  if (!crypto.timingSafeEqual(a, b)) {
    return {
      ok: false,
      status: 403,
      error: "Invalid admin token."
    };
  }
  return { ok: true };
}
function createRequireAdminAuth(getExpectedToken = () => process.env.ADMIN_TOKEN) {
  return (req, res, next) => {
    const result = verifyBearerToken(req.get("authorization"), getExpectedToken());
    if (!result.ok) {
      if (result.status === 401) {
        res.setHeader("WWW-Authenticate", 'Bearer realm="FireWatch UB Admin"');
      }
      return res.status(result.status).json({ error: result.error });
    }
    return next();
  };
}
function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const rawVal = part.slice(eq + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(rawVal);
    } catch {
      out[key] = rawVal;
    }
  }
  return out;
}
function isValidSessionId(val) {
  return typeof val === "string" && UUID_RE.test(val);
}
function readAuditSessionId(req) {
  const cookies = parseCookies(req.get("cookie"));
  const candidate = cookies[SESSION_COOKIE_NAME];
  return isValidSessionId(candidate) ? candidate : null;
}
function getOrMintAuditSessionId(req, res) {
  const existing = readAuditSessionId(req);
  if (existing) return existing;
  const sid = crypto.randomUUID();
  const isHttps = req.secure || req.get("x-forwarded-proto") === "https";
  const parts = [
    `${SESSION_COOKIE_NAME}=${sid}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=2592000"
  ];
  if (isHttps) {
    parts.push("Secure");
  }
  res.append("Set-Cookie", parts.join("; "));
  return sid;
}
function extractClientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}
function createRateLimiter(options) {
  const store = /* @__PURE__ */ new Map();
  let lastPruneMs = 0;
  function check(key, nowMs = Date.now()) {
    if (nowMs - lastPruneMs > Math.min(options.windowMs, 6e4) || store.size > 5e3) {
      for (const [k, entry] of store.entries()) {
        if (nowMs >= entry.resetAtMs) store.delete(k);
      }
      lastPruneMs = nowMs;
    }
    const cur = store.get(key);
    if (!cur || nowMs >= cur.resetAtMs) {
      const next = { count: 1, resetAtMs: nowMs + options.windowMs };
      store.set(key, next);
      return {
        allowed: true,
        remaining: Math.max(0, options.max - 1),
        resetAtMs: next.resetAtMs,
        retryAfterSec: 0
      };
    }
    if (cur.count >= options.max) {
      const retryAfterSec = Math.max(1, Math.ceil((cur.resetAtMs - nowMs) / 1e3));
      return {
        allowed: false,
        remaining: 0,
        resetAtMs: cur.resetAtMs,
        retryAfterSec
      };
    }
    cur.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, options.max - cur.count),
      resetAtMs: cur.resetAtMs,
      retryAfterSec: 0
    };
  }
  function middleware(req, res, next) {
    const key = options.keyGenerator ? options.keyGenerator(req) : extractClientIp(req);
    const result = check(key);
    res.setHeader("X-RateLimit-Limit", String(options.max));
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(result.resetAtMs / 1e3)));
    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfterSec));
      return res.status(429).json({
        error: options.message,
        retryAfterSeconds: result.retryAfterSec
      });
    }
    return next();
  }
  return { check, middleware, clear: () => store.clear() };
}
function normalizeOrigin(raw) {
  if (!raw || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}
function buildAllowedOrigins(opts) {
  const set = /* @__PURE__ */ new Set();
  const port = opts.port ?? 3e3;
  for (const devOrigin of [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    "http://localhost:3000",
    "http://127.0.0.1:3000"
  ]) {
    set.add(devOrigin);
  }
  const appOrigin = normalizeOrigin(opts.appUrlEnv);
  if (appOrigin) set.add(appOrigin);
  if (opts.allowedOriginsEnv) {
    for (const part of opts.allowedOriginsEnv.split(",")) {
      const o = normalizeOrigin(part);
      if (o) set.add(o);
    }
  }
  return set;
}
function isOriginAllowed(origin, requestHost, allowlist) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (allowlist.has(normalized)) return true;
  if (requestHost) {
    try {
      const parsed = new URL(normalized);
      if (parsed.host === requestHost) return true;
    } catch {
      return false;
    }
  }
  return false;
}
function createCorsMiddleware(opts = {}) {
  const allowlist = buildAllowedOrigins({
    allowedOriginsEnv: opts.allowedOriginsEnv ?? process.env.ALLOWED_ORIGINS,
    appUrlEnv: opts.appUrlEnv ?? process.env.APP_URL,
    port: opts.port ?? (Number(process.env.PORT) || 3e3)
  });
  return (req, res, next) => {
    const origin = req.get("origin");
    const host = req.get("host");
    if (!isOriginAllowed(origin, host, allowlist)) {
      return res.status(403).json({ error: "CORS policy: origin is not in allowlist." });
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Max-Age", "600");
    }
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    return next();
  };
}
function createSecurityHeadersMiddleware(isProd = process.env.NODE_ENV === "production") {
  const pageCsp = [
    "default-src 'self'",
    isProd ? "script-src 'self'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://server.arcgisonline.com https://services.arcgisonline.com https://*.arcgisonline.com https://*.arcgis.com https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://tiles.openfreemap.org https://*.openfreemap.org",
    isProd ? "connect-src 'self' https://api.open-meteo.com https://tiles.openfreemap.org https://*.openfreemap.org" : "connect-src 'self' ws://localhost:* ws://127.0.0.1:* https://api.open-meteo.com https://tiles.openfreemap.org https://*.openfreemap.org",
    "object-src 'none'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self' https://aistudio.google.com https://*.google.com https://*.googleusercontent.com"
  ].join("; ");
  const apiCsp = "default-src 'none'; frame-ancestors 'none'";
  return (req, res, next) => {
    const isApi = req.path.startsWith("/api/");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (isApi) {
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    } else {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    }
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    if (isProd) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    res.setHeader("Content-Security-Policy", isApi ? apiCsp : pageCsp);
    return next();
  };
}
var VALID_HOME_TYPES = /* @__PURE__ */ new Set(["ger", "house_fence", "brick_cottage", "apartment"]);
var VALID_HEATING_TYPES = /* @__PURE__ */ new Set(["iron_stove", "improved_stove", "boiler", "electric", "central"]);
var VALID_ELECTRICAL_STATES = /* @__PURE__ */ new Set(["safe", "medium", "overloaded"]);
var VALID_ASH_STORAGE = /* @__PURE__ */ new Set(["metal_box", "open_fence", "plastic_bucket"]);
var VALID_RISK_LEVELS = /* @__PURE__ */ new Set(["low", "moderate", "high", "very_high"]);
function validateAuditPayload(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Invalid home audit payload." };
  }
  const b = raw;
  if (typeof b.districtId !== "string" || !b.districtId.trim() || b.districtId.length > 64) {
    return { ok: false, error: "Invalid districtId." };
  }
  if (typeof b.khorooNumber !== "number" || !Number.isFinite(b.khorooNumber)) {
    return { ok: false, error: "Invalid khorooNumber." };
  }
  if (typeof b.homeType !== "string" || !VALID_HOME_TYPES.has(b.homeType)) {
    return { ok: false, error: "Invalid homeType." };
  }
  if (typeof b.heatingType !== "string" || !VALID_HEATING_TYPES.has(b.heatingType)) {
    return { ok: false, error: "Invalid heatingType." };
  }
  if (typeof b.electricalState !== "string" || !VALID_ELECTRICAL_STATES.has(b.electricalState)) {
    return { ok: false, error: "Invalid electricalState." };
  }
  if (typeof b.ashStorage !== "string" || !VALID_ASH_STORAGE.has(b.ashStorage)) {
    return { ok: false, error: "Invalid ashStorage." };
  }
  if (typeof b.score !== "number" || !Number.isFinite(b.score)) {
    return { ok: false, error: "Invalid score." };
  }
  if (typeof b.riskLevel !== "string" || !VALID_RISK_LEVELS.has(b.riskLevel)) {
    return { ok: false, error: "Invalid riskLevel." };
  }
  const meetingPoint = typeof b.meetingPoint === "string" ? b.meetingPoint.trim().slice(0, 140) : "";
  return {
    ok: true,
    value: {
      districtId: b.districtId.trim().toLowerCase().slice(0, 64),
      khorooNumber: Math.max(1, Math.min(100, Math.round(b.khorooNumber))),
      homeType: b.homeType,
      heatingType: b.heatingType,
      electricalState: b.electricalState,
      hasSmokeDetector: Boolean(b.hasSmokeDetector),
      hasFireExtinguisher: Boolean(b.hasFireExtinguisher),
      ashStorage: b.ashStorage,
      hasChildren: Boolean(b.hasChildren),
      hasElderly: Boolean(b.hasElderly),
      score: Math.max(0, Math.min(100, Math.round(b.score))),
      riskLevel: b.riskLevel,
      meetingPoint
    }
  };
}
function validateAiExplainPayload(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Invalid AI explanation request body." };
  }
  const b = raw;
  if (typeof b.areaId !== "string" || !b.areaId.trim() || b.areaId.length > 64 || typeof b.areaName !== "string" || !b.areaName.trim() || b.areaName.length > 120 || typeof b.riskScore !== "number" || !Number.isFinite(b.riskScore)) {
    return { ok: false, error: "Missing or invalid area context for explanation." };
  }
  const language = b.language === "en" ? "en" : "mn";
  const areaType = b.areaType === "khoroo" ? "khoroo" : "district";
  const districtName = typeof b.districtName === "string" && b.districtName.trim() ? b.districtName.trim().slice(0, 120) : void 0;
  const riskLevel = typeof b.riskLevel === "string" && b.riskLevel.trim() ? b.riskLevel.trim().slice(0, 24) : "moderate";
  const metrics = {};
  if (b.metrics && typeof b.metrics === "object" && !Array.isArray(b.metrics)) {
    const entries = Object.entries(b.metrics).slice(0, 20);
    for (const [k, v] of entries) {
      const cleanKey = k.trim().slice(0, 48);
      if (!cleanKey) continue;
      if (typeof v === "number" && Number.isFinite(v)) metrics[cleanKey] = v;
      else if (typeof v === "boolean") metrics[cleanKey] = v;
      else if (typeof v === "string") metrics[cleanKey] = v.trim().slice(0, 80);
    }
  }
  const contributions = [];
  if (Array.isArray(b.contributions)) {
    if (b.contributions.length > 12) {
      return { ok: false, error: "Too many contribution items (max 12)." };
    }
    for (const entry of b.contributions) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry;
      const name = typeof item.name === "string" ? item.name.trim().slice(0, 80) : "";
      const weight = Number(item.weight);
      const score = Number(item.score);
      const contribution = Number(item.contribution);
      if (name && Number.isFinite(weight) && Number.isFinite(score) && Number.isFinite(contribution)) {
        contributions.push({ name, weight, score, contribution });
      }
    }
  }
  return {
    ok: true,
    value: {
      language,
      areaType,
      areaId: b.areaId.trim().slice(0, 64),
      areaName: b.areaName.trim().slice(0, 120),
      districtName,
      riskScore: Math.max(0, Math.min(100, Math.round(b.riskScore))),
      riskLevel,
      isModelled: Boolean(b.isModelled),
      metrics,
      contributions
    }
  };
}

// src/utils/riskEngine.ts
var clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function computeFireWeatherBreakdown(input) {
  const {
    tempCelsius,
    humidityPercent,
    windSpeedKmh,
    gustKmh = windSpeedKmh * 1.4,
    precipitationMm,
    droughtDays
  } = input;
  const rhDeficit = clamp((100 - humidityPercent) / 100, 0, 1) * 58;
  const droughtTerm = clamp(droughtDays / 21, 0, 1) * 24;
  const thermalDrying = clamp((tempCelsius + 15) / 42, 0, 1) * 18;
  const rainSuppression = clamp(precipitationMm * 14, 0, 38);
  const ignitionReceptivity = Math.round(
    clamp(rhDeficit + droughtTerm + thermalDrying - rainSuppression, 4, 100)
  );
  const effectiveWind = 0.72 * windSpeedKmh + 0.28 * gustKmh;
  const windEnergy = clamp(effectiveWind / 55, 0, 1) * 85;
  const dryMultiplier = clamp((100 - humidityPercent) / 75, 0.25, 1.15);
  const spreadPotential = Math.round(
    clamp(windEnergy * dryMultiplier - rainSuppression * 0.5, 4, 100)
  );
  const fireWeatherIndex = Math.round(
    clamp(0.62 * ignitionReceptivity + 0.38 * spreadPotential, 5, 100)
  );
  let dominantDriver = "balanced";
  if (precipitationMm >= 2 || humidityPercent >= 75) dominantDriver = "moisture";
  else if (spreadPotential - ignitionReceptivity >= 15) dominantDriver = "wind";
  else if (ignitionReceptivity - spreadPotential >= 15) dominantDriver = "dryness";
  return {
    ignitionReceptivity,
    spreadPotential,
    fireWeatherIndex,
    dominantDriver
  };
}

// server.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path2.dirname(__filename);
var PORT = Number(process.env.PORT) || 3e3;
var UB_LAT = 47.9184;
var UB_LON = 106.9177;
var WEATHER_TTL_MS = 10 * 60 * 1e3;
var AI_CACHE_TTL_MS = 15 * 60 * 1e3;
function countDroughtDays(daily, todayIso) {
  let i = daily.findIndex((d) => d.date >= todayIso);
  if (i === -1) i = daily.length - 1;
  let days = 0;
  for (; i >= 0; i--) {
    if (daily[i].precipitationMm < 0.2) days += 1;
    else break;
  }
  return days;
}
function formatWeatherResponse(rec, meta) {
  if (!rec) {
    return {
      status: "unavailable",
      isLive: false,
      stale: true,
      errorReason: meta.errorReason || "No verified observation stored yet."
    };
  }
  let daily = [];
  try {
    daily = JSON.parse(rec.dailyJson);
  } catch {
    daily = [];
  }
  return {
    status: meta.status,
    isLive: meta.isLive,
    stale: meta.stale,
    provider: rec.provider,
    fetchedAtMs: rec.fetchedAtMs,
    observedAtIso: rec.observedAtIso,
    utcOffsetSeconds: rec.utcOffsetSeconds,
    tempCelsius: rec.tempCelsius,
    apparentCelsius: rec.apparentCelsius,
    humidityPercent: rec.humidityPercent,
    windSpeedKmh: rec.windSpeedKmh,
    windDirectionDeg: rec.windDirectionDeg,
    gustKmh: rec.gustKmh,
    precipitationMm: rec.precipitationMm,
    weatherCode: rec.weatherCode,
    droughtDays: rec.droughtDays,
    fireWeatherIndex: rec.fireWeatherIndex,
    ignitionReceptivity: rec.ignitionReceptivity,
    spreadPotential: rec.spreadPotential,
    daily,
    errorReason: meta.errorReason
  };
}
async function fetchLiveOpenMeteo(db) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8500);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${UB_LAT}&longitude=${UB_LON}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,relative_humidity_2m_max&past_days=10&forecast_days=7&timezone=Asia%2FUlaanbaatar`;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const json = await res.json();
    const c = json.current;
    if (!c) throw new Error("Missing current observation block");
    const tempCelsius = Math.round(Number(c.temperature_2m) * 10) / 10;
    const humidityPercent = Math.round(Number(c.relative_humidity_2m));
    const windSpeedKmh = Math.round(Number(c.wind_speed_10m) * 10) / 10;
    const windDirectionDeg = Math.round(Number(c.wind_direction_10m ?? 0));
    const gustKmh = Math.round(Number(c.wind_gusts_10m || windSpeedKmh * 1.4));
    const apparentCelsius = Math.round(Number(c.apparent_temperature ?? tempCelsius) * 10) / 10;
    const precipitationMm = Math.round(Number(c.precipitation ?? 0) * 10) / 10;
    const weatherCode = Number(c.weather_code ?? 0);
    if ([tempCelsius, humidityPercent, windSpeedKmh].some((n) => Number.isNaN(n))) {
      throw new Error("Invalid numeric weather observation");
    }
    const daily = (json.daily?.time ?? []).map((date, i) => ({
      date,
      tempMaxC: Number(json.daily?.temperature_2m_max?.[i] ?? 0),
      tempMinC: Number(json.daily?.temperature_2m_min?.[i] ?? 0),
      precipitationMm: Number(json.daily?.precipitation_sum?.[i] ?? 0),
      windMaxKmh: Number(json.daily?.wind_speed_10m_max?.[i] ?? 0),
      humidityMaxPct: Number(json.daily?.relative_humidity_2m_max?.[i] ?? 60)
    }));
    const observedAtIso = String(c.time ?? (/* @__PURE__ */ new Date()).toISOString());
    const droughtDays = countDroughtDays(daily, observedAtIso.slice(0, 10));
    const breakdown = computeFireWeatherBreakdown({
      tempCelsius,
      humidityPercent,
      windSpeedKmh,
      gustKmh,
      precipitationMm,
      droughtDays
    });
    const saved = db.saveWeather({
      fetchedAtMs: Date.now(),
      observedAtIso,
      tempCelsius,
      apparentCelsius,
      humidityPercent,
      windSpeedKmh,
      windDirectionDeg,
      gustKmh,
      precipitationMm,
      weatherCode,
      droughtDays,
      fireWeatherIndex: breakdown.fireWeatherIndex,
      ignitionReceptivity: breakdown.ignitionReceptivity,
      spreadPotential: breakdown.spreadPotential,
      utcOffsetSeconds: Number(json.utc_offset_seconds ?? 28800),
      dailyJson: JSON.stringify(daily),
      provider: "Open-Meteo"
    });
    return saved;
  } finally {
    clearTimeout(timer);
  }
}
var geminiClient = null;
function getGeminiClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build"
        }
      }
    });
  }
  return geminiClient;
}
var VALID_ID_RE = /^[a-zA-Z0-9._:-]{1,64}$/;
function toPublicAuditRecord(rec) {
  const { sessionId: _sid, emergencyPhone: _phone, ...rest } = rec;
  return rest;
}
function createFireWatchApp(options = {}) {
  const db = options.db ?? createFireWatchDb();
  const isProd = options.isProd ?? process.env.NODE_ENV === "production";
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(createSecurityHeadersMiddleware(isProd));
  app.use(
    "/api",
    createCorsMiddleware({
      allowedOriginsEnv: options.allowedOriginsEnv,
      appUrlEnv: options.appUrlEnv,
      port: options.port ?? PORT
    })
  );
  app.use(express.json({ limit: "256kb" }));
  app.use((err, req, res, next) => {
    if (!err || typeof err !== "object") return next();
    const typed = err;
    if (typed.type === "entity.too.large" || typed.status === 413) {
      return res.status(413).json({ error: "Request payload exceeds 256KB limit." });
    }
    if (err instanceof SyntaxError && req.path.startsWith("/api/")) {
      return res.status(400).json({ error: "Malformed JSON payload." });
    }
    return next(err);
  });
  const requireAdminAuth = createRequireAdminAuth(
    options.getAdminToken ?? (() => process.env.ADMIN_TOKEN)
  );
  const writeLimiter = createRateLimiter({
    windowMs: 6e4,
    max: options.writeMinuteMax ?? 30,
    message: "Too many write requests from this IP. Please slow down and try again shortly."
  });
  const aiMinuteLimiter = createRateLimiter({
    windowMs: 6e4,
    max: options.aiMinuteMax ?? 10,
    message: "Rate limit exceeded: max 10 AI explanation requests per minute per IP."
  });
  const aiDailyLimiter = createRateLimiter({
    windowMs: 24 * 60 * 6e4,
    max: options.aiDailyMax ?? 60,
    message: "Daily limit exceeded for AI explanation requests from this IP."
  });
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      db: "sqlite",
      hasGemini: Boolean(process.env.GEMINI_API_KEY),
      timestampIso: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  app.get("/api/weather", async (req, res) => {
    const force = req.query.force === "1";
    const latest = db.getLatestWeather();
    if (!force && latest && Date.now() - latest.fetchedAtMs < WEATHER_TTL_MS) {
      return res.json(formatWeatherResponse(latest, { isLive: true, stale: false, status: "live" }));
    }
    try {
      const fresh = await fetchLiveOpenMeteo(db);
      return res.json(formatWeatherResponse(fresh, { isLive: true, stale: false, status: "live" }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Weather provider unreachable";
      if (latest) {
        return res.json(
          formatWeatherResponse(latest, {
            isLive: false,
            stale: true,
            status: "stale",
            errorReason: msg
          })
        );
      }
      return res.json(
        formatWeatherResponse(null, {
          isLive: false,
          stale: true,
          status: "unavailable",
          errorReason: msg
        })
      );
    }
  });
  app.get("/api/audits", (req, res) => {
    const sid = readAuditSessionId(req);
    if (!sid) {
      return res.json({ audits: [] });
    }
    res.json({ audits: db.listHomeAudits(sid).map(toPublicAuditRecord) });
  });
  app.post("/api/audits", writeLimiter.middleware, (req, res) => {
    const checked = validateAuditPayload(req.body);
    if (!checked.ok) {
      return res.status(400).json({ error: checked.error });
    }
    const v = checked.value;
    const sid = getOrMintAuditSessionId(req, res);
    const saved = db.saveHomeAudit({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sessionId: sid,
      createdAtIso: (/* @__PURE__ */ new Date()).toISOString(),
      districtId: v.districtId,
      khorooNumber: v.khorooNumber,
      homeType: v.homeType,
      heatingType: v.heatingType,
      electricalState: v.electricalState,
      hasSmokeDetector: v.hasSmokeDetector,
      hasFireExtinguisher: v.hasFireExtinguisher,
      ashStorage: v.ashStorage,
      hasChildren: v.hasChildren,
      hasElderly: v.hasElderly,
      score: v.score,
      riskLevel: v.riskLevel,
      meetingPoint: v.meetingPoint
    });
    res.status(201).json({ audit: toPublicAuditRecord(saved) });
  });
  app.delete("/api/audits/:id", writeLimiter.middleware, (req, res) => {
    const sid = readAuditSessionId(req);
    const id = req.params.id?.trim() ?? "";
    if (!sid || !VALID_ID_RE.test(id)) {
      return res.status(404).json({ error: "Audit record not found." });
    }
    const deleted = db.deleteHomeAudit(id, sid);
    if (!deleted) return res.status(404).json({ error: "Audit record not found." });
    res.json({ deleted: true });
  });
  const VALID_CATEGORIES = /* @__PURE__ */ new Set([
    "residential_ger",
    "residential_apt",
    "commercial",
    "grass_forest",
    "electrical"
  ]);
  const VALID_SEVERITIES = /* @__PURE__ */ new Set(["minor", "moderate", "critical"]);
  const DISTRICT_DEFAULT_COORDS = {
    bayanzurkh: [47.9212, 107.0155],
    songinokhairkhan: [47.9325, 106.7932],
    chingeltei: [47.9495, 106.9052],
    sukhbaatar: [47.9295, 106.9205],
    bayangol: [47.9125, 106.8725],
    "khan-uul": [47.8825, 106.8785],
    nalaikh: [47.775, 107.258],
    baganuur: [47.781, 108.361],
    bagakhangai: [47.345, 107.475]
  };
  function sanitizeIncidentInput(raw, fallbackSource = "manual") {
    const districtId = typeof raw.districtId === "string" && raw.districtId.trim() ? raw.districtId.trim().toLowerCase().slice(0, 48) : "";
    const causeGuessMn = typeof raw.causeGuessMn === "string" && raw.causeGuessMn.trim() ? raw.causeGuessMn.trim().slice(0, 180) : typeof raw.description === "string" && raw.description.trim() ? raw.description.trim().slice(0, 180) : "";
    if (!districtId || !causeGuessMn) return null;
    const dateRaw = typeof raw.date === "string" ? raw.date.trim().slice(0, 10) : "";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const khorooNum = Number(raw.khorooNumber ?? 1);
    const khorooNumber = Number.isFinite(khorooNum) ? Math.max(1, Math.min(60, Math.round(khorooNum))) : 1;
    const catRaw = typeof raw.category === "string" ? raw.category.trim() : "residential_ger";
    const category = VALID_CATEGORIES.has(catRaw) ? catRaw : "residential_ger";
    const sevRaw = typeof raw.severity === "string" ? raw.severity.trim() : "moderate";
    const severity = VALID_SEVERITIES.has(sevRaw) ? sevRaw : "moderate";
    const respNum = Number(raw.responseTimeMin ?? 12);
    const responseTimeMin = Number.isFinite(respNum) ? Math.max(2, Math.min(90, Math.round(respNum))) : 12;
    const fallbackCoord = DISTRICT_DEFAULT_COORDS[districtId] ?? [UB_LAT, UB_LON];
    const latNum = Number(raw.lat);
    const lngNum = Number(raw.lng);
    const lat = Number.isFinite(latNum) && latNum >= 46 && latNum <= 50 ? +latNum.toFixed(5) : fallbackCoord[0];
    const lng = Number.isFinite(lngNum) && lngNum >= 104 && lngNum <= 111 ? +lngNum.toFixed(5) : fallbackCoord[1];
    const causeGuessEn = typeof raw.causeGuessEn === "string" && raw.causeGuessEn.trim() ? raw.causeGuessEn.trim().slice(0, 180) : causeGuessMn;
    const idRaw = typeof raw.id === "string" ? raw.id.trim() : "";
    const id = idRaw && VALID_ID_RE.test(idRaw) ? idRaw : `inc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const source = typeof raw.source === "string" && raw.source.trim() ? raw.source.trim().slice(0, 32) : fallbackSource;
    return {
      id,
      date,
      districtId,
      khorooNumber,
      category,
      severity,
      causeGuessMn,
      causeGuessEn,
      responseTimeMin,
      lat,
      lng,
      source,
      createdAtIso: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  app.get("/api/incidents", (_req, res) => {
    res.json({ incidents: db.listIncidents(), stats: db.getStats() });
  });
  app.post("/api/incidents", writeLimiter.middleware, requireAdminAuth, (req, res) => {
    const b = req.body;
    const item = b && typeof b === "object" && !Array.isArray(b) ? sanitizeIncidentInput(b, "manual") : null;
    if (!item) {
      return res.status(400).json({ error: "Invalid incident payload: districtId and causeGuessMn are required." });
    }
    const saved = db.upsertIncident(item);
    res.status(201).json({ incident: saved, stats: db.getStats() });
  });
  app.put("/api/incidents/:id", writeLimiter.middleware, requireAdminAuth, (req, res) => {
    const id = req.params.id?.trim() ?? "";
    if (!VALID_ID_RE.test(id)) {
      return res.status(400).json({ error: "Invalid incident ID." });
    }
    const existing = db.getIncidentById(id);
    if (!existing) {
      return res.status(404).json({ error: "Incident record not found." });
    }
    const b = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const merged = sanitizeIncidentInput(
      {
        ...existing,
        ...b,
        id: existing.id,
        source: existing.source
      },
      existing.source
    );
    if (!merged) {
      return res.status(400).json({ error: "Invalid incident update payload." });
    }
    const saved = db.upsertIncident({ ...merged, createdAtIso: existing.createdAtIso });
    res.json({ incident: saved, stats: db.getStats() });
  });
  app.delete("/api/incidents/:id", writeLimiter.middleware, requireAdminAuth, (req, res) => {
    const id = req.params.id?.trim() ?? "";
    if (!VALID_ID_RE.test(id)) {
      return res.status(400).json({ error: "Invalid incident ID." });
    }
    const deleted = db.deleteIncident(id);
    if (!deleted) return res.status(404).json({ error: "Incident record not found." });
    res.json({ deleted: true, stats: db.getStats() });
  });
  app.post("/api/v1/incidents/batch-sync", writeLimiter.middleware, requireAdminAuth, (req, res) => {
    const body = req.body;
    const rawList = [];
    if (Array.isArray(body)) {
      for (const entry of body) {
        if (entry && typeof entry === "object") rawList.push(entry);
      }
    } else if (body && typeof body === "object") {
      if (body.type === "FeatureCollection" && Array.isArray(body.features)) {
        for (const feat of body.features) {
          if (!feat || typeof feat !== "object") continue;
          const props = feat.properties && typeof feat.properties === "object" ? feat.properties : {};
          const geom = feat.geometry && typeof feat.geometry === "object" ? feat.geometry : {};
          const coords = Array.isArray(geom.coordinates) ? geom.coordinates : [];
          rawList.push({
            ...props,
            id: feat.id ?? props.id,
            lng: typeof coords[0] === "number" ? coords[0] : props.lng,
            lat: typeof coords[1] === "number" ? coords[1] : props.lat,
            source: "geojson-sync"
          });
        }
      } else if (Array.isArray(body.incidents)) {
        for (const entry of body.incidents) {
          if (entry && typeof entry === "object") rawList.push(entry);
        }
      }
    }
    if (rawList.length === 0) {
      return res.status(400).json({
        error: "Expected a GeoJSON FeatureCollection, { incidents: [...] }, or a JSON array of records."
      });
    }
    if (rawList.length > 200) {
      return res.status(400).json({
        error: "Batch size limit exceeded: maximum 200 incident records per sync request."
      });
    }
    const validItems = [];
    let skippedCount = 0;
    for (const row of rawList) {
      const clean = sanitizeIncidentInput(row, "batch-sync");
      if (clean) validItems.push(clean);
      else skippedCount += 1;
    }
    const nonNull = validItems.filter((x) => x !== null);
    const syncedCount = nonNull.length > 0 ? db.batchUpsertIncidents(nonNull) : 0;
    res.status(200).json({
      syncedCount,
      skippedCount,
      incidents: db.listIncidents(),
      stats: db.getStats()
    });
  });
  app.get("/api/data-management/status", requireAdminAuth, (_req, res) => {
    const latestWeather = db.getLatestWeather();
    res.json({
      ok: true,
      stats: db.getStats(),
      latestWeatherTimestamp: latestWeather?.observedAtIso ?? null,
      latestWeatherProvider: latestWeather?.provider ?? null,
      hasGemini: Boolean(process.env.GEMINI_API_KEY),
      serverTimeIso: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  app.delete("/api/data-management/ai-cache", writeLimiter.middleware, requireAdminAuth, (_req, res) => {
    const cleared = db.clearAiCache();
    res.json({ cleared, stats: db.getStats() });
  });
  app.post("/api/ai/explain", aiMinuteLimiter.middleware, aiDailyLimiter.middleware, async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error: "Gemini AI analyst is not configured on this server (missing GEMINI_API_KEY)."
      });
    }
    const checked = validateAiExplainPayload(req.body);
    if (!checked.ok) {
      return res.status(400).json({ error: checked.error });
    }
    const body = checked.value;
    const lang = body.language;
    const weather = db.getLatestWeather();
    const weatherTag = weather ? `${weather.observedAtIso}` : "unavailable";
    const cacheKey = `${lang}:${body.areaId}:${body.riskScore}:${weatherTag}`;
    const cached = db.getAiCache(cacheKey, AI_CACHE_TTL_MS);
    if (cached) {
      return res.json({ explanation: cached, cached: true });
    }
    const weatherContext = weather ? {
      provider: weather.provider,
      observedAtIso: weather.observedAtIso,
      isLive: Date.now() - weather.fetchedAtMs < WEATHER_TTL_MS,
      tempCelsius: weather.tempCelsius,
      humidityPercent: weather.humidityPercent,
      windSpeedKmh: weather.windSpeedKmh,
      gustKmh: weather.gustKmh,
      droughtDays: weather.droughtDays,
      fireWeatherIndex: weather.fireWeatherIndex,
      ignitionReceptivity: weather.ignitionReceptivity,
      spreadPotential: weather.spreadPotential
    } : { status: "unavailable", note: "No live weather observation cached yet." };
    const systemInstruction = lang === "mn" ? `\u0422\u0430 FireWatch UB \u043E\u0440\u043E\u043D \u0437\u0430\u0439\u043D \u0433\u0430\u043B\u044B\u043D \u044D\u0440\u0441\u0434\u044D\u043B\u0438\u0439\u043D \u0430\u043D\u0430\u043B\u0438\u0442\u0438\u043A \u0442\u0443\u0441\u043B\u0430\u0445.
\u0425\u0410\u0422\u0423\u0423 \u0414\u04AE\u0420\u042D\u041C:
1. \u0417\u04E9\u0432\u0445\u04E9\u043D \u0434\u043E\u043E\u0440 \u04E9\u0433\u04E9\u0433\u0434\u0441\u04E9\u043D JSON \u043C\u044D\u0434\u044D\u044D\u043B\u044D\u043B\u0434 \u0442\u0443\u043B\u0433\u0443\u0443\u0440\u043B\u0430\u043D \u0442\u0430\u0439\u043B\u0431\u0430\u0440\u043B\u0430\u043D\u0430 \u0443\u0443. \u0428\u0438\u043D\u044D \u0434\u0443\u0443\u0434\u043B\u0430\u0433\u0430, \u0446\u0430\u0433 \u0430\u0433\u0430\u0430\u0440\u044B\u043D \u0442\u043E\u043E, \u044D\u0445 \u0441\u0443\u0440\u0432\u0430\u043B\u0436, \u044D\u0441\u0432\u044D\u043B \u0431\u0430\u0442\u0430\u043B\u0433\u0430\u0430\u0433\u04AF\u0439 \u04AF\u0439\u043B \u044F\u0432\u0434\u0430\u043B \u0425\u042D\u0417\u042D\u042D \u0427 \u0437\u043E\u0445\u0438\u043E\u0445\u0433\u04AF\u0439 \u0431\u0430\u0439\u0445.
2. \u042D\u043D\u044D \u044D\u0440\u0441\u0434\u044D\u043B\u0438\u0439\u043D \u043E\u043D\u043E\u043E (0-100) \u043D\u044C \u043E\u043B\u043E\u043D \u0445\u04AF\u0447\u0438\u043D \u0437\u04AF\u0439\u043B\u0438\u0439\u043D \u0430\u043D\u0430\u043B\u0438\u0442\u0438\u043A/\u044D\u0432\u0440\u0438\u0441\u0442\u0438\u043A \u0438\u043D\u0434\u0435\u043A\u0441 \u0431\u04E9\u0433\u04E9\u04E9\u0434 \u0433\u0430\u043B \u0433\u0430\u0440\u0430\u0445 \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A \u043C\u0430\u0433\u0430\u0434\u043B\u0430\u043B (%) \u0411\u0418\u0428 \u0433\u044D\u0434\u0433\u0438\u0439\u0433 \u0442\u043E\u0434\u043E\u0440\u0445\u043E\u0439 \u044F\u043B\u0433\u0430\u0436 \u0445\u044D\u043B\u043D\u044D \u04AF\u04AF.
3. \u0421\u0430\u043B\u0445\u0438 \u043D\u044C \u0433\u0430\u043B \u0430\u0441\u0430\u0430\u0445 \u0448\u0443\u0443\u0434 \u0448\u0430\u043B\u0442\u0433\u0430\u0430\u043D \u0431\u0438\u0448, \u0445\u0430\u0440\u0438\u043D \u043D\u044D\u0433\u044D\u043D\u0442 \u0433\u0430\u0440\u0441\u0430\u043D \u043E\u0447, \u0434\u04E9\u043B\u0438\u0439\u0433 \u0442\u0430\u0440\u0430\u0430\u0445 \u0445\u0443\u0440\u0434\u044B\u0433 \u043D\u044D\u043C\u044D\u0433\u0434\u04AF\u04AF\u043B\u0434\u044D\u0433 \u0445\u04AF\u0447\u0438\u043D \u0437\u04AF\u0439\u043B \u0433\u044D\u0434\u0433\u0438\u0439\u0433 \u0437\u04E9\u0432 \u0442\u0430\u0439\u043B\u0431\u0430\u0440\u043B\u0430\u043D\u0430 \u0443\u0443.
4. \u0426\u0430\u0433 \u0430\u0433\u0430\u0430\u0440\u044B\u043D \u043C\u044D\u0434\u044D\u044D\u043B\u043B\u0438\u0439\u043D \u043E\u0433\u043D\u043E\u043E/\u0446\u0430\u0433 \u0431\u043E\u043B\u043E\u043D \u0442\u0443\u0445\u0430\u0439\u043D \u0445\u043E\u0440\u043E\u043E\u043D\u044B \u04E9\u0433\u04E9\u0433\u0434\u04E9\u043B \u0437\u0430\u0433\u0432\u0430\u0440\u0447\u0438\u043B\u0441\u0430\u043D (isModelled) \u044D\u0441\u044D\u0445\u0438\u0439\u0433 \u0437\u0430\u0430\u0432\u0430\u043B \u0434\u0443\u0440\u0434\u0430\u043D\u0430 \u0443\u0443.
5. \u0410\u043B\u0431\u0430\u043D \u0451\u0441\u043D\u044B \u043E\u043D\u0446\u0433\u043E\u0439 \u0431\u0430\u0439\u0434\u043B\u044B\u043D \u0437\u0430\u0440\u043B\u0430\u043D \u043C\u044D\u0434\u044D\u044D\u043B\u044D\u043B \u0431\u0438\u0448 \u0433\u044D\u0434\u0433\u0438\u0439\u0433 \u0441\u0430\u043D\u0443\u0443\u043B\u043D\u0430 \u0443\u0443. \u0425\u0430\u0440\u0438\u0443\u043B\u0442\u0430\u0430 \u043C\u043E\u043D\u0433\u043E\u043B \u0445\u044D\u043B\u044D\u044D\u0440 \u043E\u0439\u043B\u0433\u043E\u043C\u0436\u0442\u043E\u0439, \u0442\u043E\u0432\u0447 \u0442\u043E\u0434\u043E\u0440\u0445\u043E\u0439 \u0431\u0438\u0447\u043D\u044D \u04AF\u04AF.` : `You are the FireWatch UB spatial fire-risk analytical assistant.
STRICT GROUNDING RULES:
1. Rely EXCLUSIVELY on the supplied JSON context. NEVER invent incidents, weather readings, data sources, or risk scores.
2. Clearly distinguish that the 0-100 risk score is a composite heuristic index, NOT a calibrated probability of fire ignition.
3. Explain wind accurately: wind increases potential fire spread and ember transport once ignition occurs, rather than causing ignition on its own.
4. Explicitly cite the weather observation timestamp (or unavailability) and whether the area includes modelled estimates (isModelled).
5. Clarify that this is an analytical research assessment, not an official emergency dispatch alert. Respond clearly and concisely in English.`;
    try {
      const requestContents = JSON.stringify({
        areaType: body.areaType,
        areaId: body.areaId,
        areaName: body.areaName,
        districtName: body.districtName,
        compositeRiskIndex: body.riskScore,
        riskLevel: body.riskLevel,
        isModelledArea: Boolean(body.isModelled),
        metrics: body.metrics ?? {},
        factorContributions: body.contributions ?? [],
        weatherObservation: weatherContext,
        dataScopeNote: "Historical incident totals are 2024-2026 aggregated demonstration records; khoroos marked isModelled are synthesized from district totals."
      });
      const requestConfig = {
        systemInstruction,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: ["summary", "verifiedFactors", "weatherInfluence", "dataLimitations", "actionableSteps"],
          properties: {
            summary: {
              type: Type.STRING,
              description: "2-3 concise sentences citing exact score, area, and status."
            },
            verifiedFactors: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "2-4 short bullets from the supplied data driving the score."
            },
            weatherInfluence: {
              type: Type.STRING,
              description: "1-2 sentences on how the timestamped weather observation affects ignition receptivity vs wind spread."
            },
            dataLimitations: {
              type: Type.STRING,
              description: "1-2 sentences distinguishing verified vs modelled/missing data and timestamps."
            },
            actionableSteps: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "2-3 short practical household or prevention steps."
            }
          }
        }
      };
      const primaryModel = (process.env.GEMINI_MODEL || "gemini-4-hydrogen").trim() || "gemini-4-hydrogen";
      const fallbackModel = (process.env.GEMINI_FALLBACK_MODEL || "gemini-3.1-flash-lite").trim() || "gemini-3.1-flash-lite";
      const timeoutMs = Math.max(3e3, Math.min(6e4, Number(process.env.GEMINI_TIMEOUT_MS) || 18e3));
      const thinkingFor = (model) => model.includes("flash-lite") ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW;
      const callModelWithTimeout = async (model) => {
        const controller = new AbortController();
        let timer;
        try {
          const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(Object.assign(new Error("Gemini request timed out."), { code: "ETIMEDOUT" }));
            }, timeoutMs);
          });
          const genPromise = ai.models.generateContent({
            model,
            contents: requestContents,
            config: {
              ...requestConfig,
              abortSignal: controller.signal,
              thinkingConfig: { thinkingLevel: thinkingFor(model) }
            }
          });
          return await Promise.race([genPromise, timeoutPromise]);
        } finally {
          if (timer !== void 0) clearTimeout(timer);
        }
      };
      const parseJsonSafe = (raw) => {
        const cleaned = (raw ?? "").trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
        return JSON.parse(cleaned || "{}");
      };
      let parsed;
      try {
        const response = await callModelWithTimeout(primaryModel);
        parsed = parseJsonSafe(response.text);
      } catch (primaryErr) {
        if (primaryErr?.code === "ETIMEDOUT" && fallbackModel === primaryModel) {
          throw primaryErr;
        }
        const fallback = await callModelWithTimeout(fallbackModel);
        parsed = parseJsonSafe(fallback.text);
      }
      const payload = {
        ...parsed,
        generatedAtIso: (/* @__PURE__ */ new Date()).toISOString(),
        weatherTimestamp: weather?.observedAtIso ?? null,
        weatherIsLive: weather ? Date.now() - weather.fetchedAtMs < WEATHER_TTL_MS : false
      };
      db.setAiCache(cacheKey, payload);
      return res.json({ explanation: payload, cached: false });
    } catch (err) {
      if (err?.code === "ETIMEDOUT") {
        return res.status(504).json({ error: "AI explanation timed out. Please retry shortly." });
      }
      const msg = err instanceof Error ? err.message : "Gemini request failed";
      return res.status(502).json({ error: `AI explanation unavailable: ${msg}` });
    }
  });
  return app;
}
async function start() {
  const isProd = process.env.NODE_ENV === "production";
  const app = createFireWatchApp({ isProd, port: PORT });
  if (!isProd) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path2.join(__dirname, "dist");
    app.use(express.static(distDir));
    app.use((req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      const indexHtml = path2.join(distDir, "index.html");
      if (existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send("Production build not found. Run npm run build first.");
      }
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[FireWatch UB] Server listening on http://0.0.0.0:${PORT} (${isProd ? "production" : "development"})`);
  });
}
if (!process.env.NODE_TEST_CONTEXT && process.env.FIREWATCH_NO_LISTEN !== "1") {
  start().catch((err) => {
    console.error("[FireWatch UB] Failed to start server:", err);
    process.exit(1);
  });
}
export {
  createFireWatchApp
};
