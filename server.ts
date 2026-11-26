import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { createFireWatchDb } from './src/server/db.ts';
import type { StoredHomeAudit } from './src/server/db.ts';
import {
  createCorsMiddleware,
  createRateLimiter,
  createRequireAdminAuth,
  createSecurityHeadersMiddleware,
  getOrMintAuditSessionId,
  readAuditSessionId,
  validateAiExplainPayload,
  validateAuditPayload,
} from './src/server/security.ts';
import { computeFireWeatherBreakdown } from './src/utils/riskEngine.ts';
import { getUbDateIso } from './src/utils/ubTime.ts';
import {
  buildCleanTrainingDataset,
  canonicalIncidentKey,
  UB_GEO_BOUNDS,
} from './src/utils/mlDataFoundation.ts';
import { verifyAiExplanationGrounding } from './src/server/aiGrounding.ts';
import {
  fetchAllDistrictsOpenMeteo,
  syncHistoricalWeatherForRealIncidents,
  type DailySlice,
} from './src/server/weatherService.ts';
import { UB_DISTRICT_COORDS_MAP } from './src/data/districtCenters.ts';
import { UB_KHOROOS } from './src/data/ubGeoData.ts';
import type { DistrictWeatherSnapshot } from './src/types/index.ts';
import {
  containsCitizenPii,
  parseCsvRealIncidents,
  validateAndNormalizeImportRecords,
} from './src/utils/incidentCsvParser.ts';
import { trainAndEvaluateFireModel } from './src/utils/mlModelEngine.ts';
import { aggregateHeatPointsWithKAnonymity } from './src/utils/riskEngine.ts';
import {
  createDynamicCompressionMiddleware,
  createPrecompressedStaticMiddleware,
  sendPrecompressedStaticFile,
} from './src/server/compression.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const WEATHER_TTL_MS = 10 * 60 * 1000;
const AI_CACHE_TTL_MS = 15 * 60 * 1000;

function formatWeatherResponse(
  rec: ReturnType<ReturnType<typeof createFireWatchDb>['getLatestWeather']>,
  meta: {
    isLive: boolean;
    stale: boolean;
    status: 'live' | 'stale' | 'unavailable';
    errorReason?: string;
    districts?: Record<string, DistrictWeatherSnapshot>;
  }
) {
  if (!rec) {
    return {
      status: 'unavailable' as const,
      isLive: false,
      stale: true,
      districts: {},
      coverageCount: 0,
      errorReason: meta.errorReason || 'No verified observation stored yet.',
    };
  }
  let daily: DailySlice[] = [];
  try {
    daily = JSON.parse(rec.dailyJson) as DailySlice[];
  } catch {
    daily = [];
  }
  const districts = meta.districts ?? {};
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
    districts,
    coverageCount: Object.keys(districts).length,
    errorReason: meta.errorReason,
  };
}

let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return geminiClient;
}

const VALID_ID_RE = /^[a-zA-Z0-9._:-]{1,64}$/;

function toPublicAuditRecord(rec: StoredHomeAudit) {
  const { sessionId: _sid, emergencyPhone: _phone, ...rest } = rec;
  return rest;
}

export interface CreateFireWatchAppOptions {
  db?: ReturnType<typeof createFireWatchDb>;
  getAdminToken?: () => string | undefined;
  allowedOriginsEnv?: string;
  appUrlEnv?: string;
  isProd?: boolean;
  port?: number;
  aiMinuteMax?: number;
  aiDailyMax?: number;
  writeMinuteMax?: number;
}

export function createFireWatchApp(options: CreateFireWatchAppOptions = {}) {
  const db = options.db ?? createFireWatchDb();
  const isProd = options.isProd ?? process.env.NODE_ENV === 'production';
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(createSecurityHeadersMiddleware(isProd));
  app.use(createDynamicCompressionMiddleware());
  app.use(
    '/api',
    createCorsMiddleware({
      allowedOriginsEnv: options.allowedOriginsEnv,
      appUrlEnv: options.appUrlEnv,
      port: options.port ?? PORT,
    })
  );
  const defaultJsonParser = express.json({ limit: '256kb' });
  const importJsonParser = express.json({ limit: '2mb' });
  app.use((req, res, next) =>
    req.path === '/api/v1/incidents/import' ? importJsonParser(req, res, next) : defaultJsonParser(req, res, next)
  );
  app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!err || typeof err !== 'object') return next();
    const typed = err as { type?: string; status?: number };
    if (typed.type === 'entity.too.large' || typed.status === 413) {
      return res.status(413).json({ error: 'Request payload exceeds size limit.' });
    }
    if (err instanceof SyntaxError && req.path.startsWith('/api/')) {
      return res.status(400).json({ error: 'Malformed JSON payload.' });
    }
    return next(err);
  });

  const requireAdminAuth = createRequireAdminAuth(
    options.getAdminToken ?? (() => process.env.ADMIN_TOKEN)
  );

  const writeLimiter = createRateLimiter({
    windowMs: 60_000,
    max: options.writeMinuteMax ?? 30,
    message: 'Too many write requests from this IP. Please slow down and try again shortly.',
  });

  const aiMinuteLimiter = createRateLimiter({
    windowMs: 60_000,
    max: options.aiMinuteMax ?? 10,
    message: 'Rate limit exceeded: max 10 AI explanation requests per minute per IP.',
  });

  const aiDailyLimiter = createRateLimiter({
    windowMs: 24 * 60 * 60_000,
    max: options.aiDailyMax ?? 60,
    message: 'Daily limit exceeded for AI explanation requests from this IP.',
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      db: 'sqlite',
      hasGemini: Boolean(process.env.GEMINI_API_KEY),
      timestampIso: new Date().toISOString(),
    });
  });

  app.get('/api/weather', async (req, res) => {
    const force = req.query.force === '1';
    const latest = db.getLatestWeather();
    const cachedDistricts = db.listDistrictWeather(WEATHER_TTL_MS);

    if (!force && latest && Date.now() - latest.fetchedAtMs < WEATHER_TTL_MS && Object.keys(cachedDistricts).length >= 9) {
      return res.json(
        formatWeatherResponse(latest, {
          isLive: true,
          stale: false,
          status: 'live',
          districts: cachedDistricts,
        })
      );
    }

    try {
      const { savedMetro, districts } = await fetchAllDistrictsOpenMeteo(db);
      return res.json(
        formatWeatherResponse(savedMetro, {
          isLive: true,
          stale: false,
          status: 'live',
          districts,
        })
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Weather provider unreachable';
      if (latest) {
        const staleDistricts: Record<string, DistrictWeatherSnapshot> = {};
        for (const [k, v] of Object.entries(cachedDistricts)) {
          staleDistricts[k] = { ...v, isLive: false };
        }
        return res.json(
          formatWeatherResponse(latest, {
            isLive: false,
            stale: true,
            status: 'stale',
            errorReason: msg,
            districts: staleDistricts,
          })
        );
      }
      return res.json(
        formatWeatherResponse(null, {
          isLive: false,
          stale: true,
          status: 'unavailable',
          errorReason: msg,
        })
      );
    }
  });

  app.get('/api/audits', (req, res) => {
    const sid = readAuditSessionId(req);
    if (!sid) {
      return res.json({ audits: [] });
    }
    res.json({ audits: db.listHomeAudits(sid).map(toPublicAuditRecord) });
  });

  app.post('/api/audits', writeLimiter.middleware, (req, res) => {
    const checked = validateAuditPayload(req.body);
    if (!checked.ok) {
      return res.status(400).json({ error: checked.error });
    }
    const v = checked.value;
    const sid = getOrMintAuditSessionId(req, res);

    // Phone numbers are intentionally omitted from server persistence (kept client-side only).
    const saved = db.saveHomeAudit({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sessionId: sid,
      createdAtIso: new Date().toISOString(),
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
      meetingPoint: v.meetingPoint,
    });

    res.status(201).json({ audit: toPublicAuditRecord(saved) });
  });

  app.delete('/api/audits/:id', writeLimiter.middleware, (req, res) => {
    const sid = readAuditSessionId(req);
    const id = req.params.id?.trim() ?? '';
    if (!sid || !VALID_ID_RE.test(id)) {
      return res.status(404).json({ error: 'Audit record not found.' });
    }
    const deleted = db.deleteHomeAudit(id, sid);
    if (!deleted) return res.status(404).json({ error: 'Audit record not found.' });
    res.json({ deleted: true });
  });

const VALID_CATEGORIES = new Set([
  'residential_ger',
  'residential_apt',
  'commercial',
  'grass_forest',
  'electrical',
]);
const VALID_SEVERITIES = new Set(['minor', 'moderate', 'critical']);

function sanitizeIncidentInput(raw: Record<string, unknown>, fallbackSource = 'manual') {
  const isReal = raw.dataOrigin === 'real' && raw.isDemo !== true;
  const districtId =
    typeof raw.districtId === 'string' && raw.districtId.trim()
      ? raw.districtId.trim().toLowerCase().slice(0, 48)
      : '';
  const causeGuessMn =
    typeof raw.causeGuessMn === 'string' && raw.causeGuessMn.trim()
      ? raw.causeGuessMn.trim().slice(0, 180)
      : typeof raw.description === 'string' && raw.description.trim()
      ? raw.description.trim().slice(0, 180)
      : '';
  if (!districtId || !causeGuessMn) return null;
  if (containsCitizenPii(causeGuessMn)) return null;

  const ubToday = getUbDateIso();
  const dateRaw = typeof raw.date === 'string' ? raw.date.trim().slice(0, 10) : '';
  const hasValidDate = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) && dateRaw <= ubToday && dateRaw >= '2015-01-01';
  if (isReal && !hasValidDate) return null;
  const date = hasValidDate ? dateRaw : ubToday;

  const isKnownDistrict = UB_DISTRICT_COORDS_MAP[districtId] !== undefined;
  if (isReal && !isKnownDistrict) return null;

  const khorooNum = Number(raw.khorooNumber ?? 1);
  if (isReal && (!Number.isInteger(khorooNum) || khorooNum < 1 || khorooNum > 60)) return null;
  const khorooNumber = Number.isFinite(khorooNum) ? Math.max(1, Math.min(60, Math.round(khorooNum))) : 1;

  const catRaw = typeof raw.category === 'string' ? raw.category.trim() : '';
  if (isReal && !VALID_CATEGORIES.has(catRaw)) return null;
  const category = (VALID_CATEGORIES.has(catRaw) ? catRaw : 'residential_ger') as
    | 'residential_ger'
    | 'residential_apt'
    | 'commercial'
    | 'grass_forest'
    | 'electrical';

  const sevRaw = typeof raw.severity === 'string' ? raw.severity.trim() : '';
  if (isReal && !VALID_SEVERITIES.has(sevRaw)) return null;
  const severity = (VALID_SEVERITIES.has(sevRaw) ? sevRaw : 'moderate') as
    | 'minor'
    | 'moderate'
    | 'critical';

  const respNum = Number(raw.responseTimeMin ?? (isReal ? NaN : 12));
  if (isReal && (!Number.isFinite(respNum) || respNum < 1 || respNum > 240)) return null;
  const responseTimeMin = Number.isFinite(respNum) ? Math.max(1, Math.min(240, Math.round(respNum))) : 12;

  // Strict zero-coercion policy for verified real data: missing/out-of-bounds coordinates NEVER fall back to centroids!
  const latNum = typeof raw.lat === 'number' ? raw.lat : Number(String(raw.lat ?? '').trim());
  const lngNum = typeof raw.lng === 'number' ? raw.lng : Number(String(raw.lng ?? '').trim());
  const coordsInBounds =
    String(raw.lat ?? '').trim() !== '' &&
    String(raw.lng ?? '').trim() !== '' &&
    Number.isFinite(latNum) &&
    Number.isFinite(lngNum) &&
    latNum >= UB_GEO_BOUNDS.latMin &&
    latNum <= UB_GEO_BOUNDS.latMax &&
    lngNum >= UB_GEO_BOUNDS.lngMin &&
    lngNum <= UB_GEO_BOUNDS.lngMax;

  if (isReal && !coordsInBounds) return null;

  const fallbackCoord = UB_DISTRICT_COORDS_MAP[districtId] ?? [47.9184, 106.9177];
  const lat = coordsInBounds ? +latNum.toFixed(5) : fallbackCoord[0];
  const lng = coordsInBounds ? +lngNum.toFixed(5) : fallbackCoord[1];

  const causeGuessEn =
    typeof raw.causeGuessEn === 'string' && raw.causeGuessEn.trim()
      ? raw.causeGuessEn.trim().slice(0, 180)
      : causeGuessMn;

  const idRaw = typeof raw.id === 'string' ? raw.id.trim() : '';
  const id =
    idRaw && VALID_ID_RE.test(idRaw)
      ? idRaw
      : `inc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const source =
    typeof raw.source === 'string' && raw.source.trim()
      ? raw.source.trim().slice(0, 32)
      : fallbackSource;

  const dataOrigin: 'real' | 'demo' = isReal ? 'real' : 'demo';

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
    dataOrigin,
    createdAtIso: new Date().toISOString(),
  };
}

  app.get('/api/incidents', (_req, res) => {
    res.json({ incidents: db.listIncidents(), stats: db.getStats() });
  });

  // Public privacy-safe k-anonymous (k >= 5) spatial clusters for citizen/public view
  app.get('/api/incidents/public-heat', (_req, res) => {
    const realIncidents = db.listAllIncidents().filter((i) => i.dataOrigin === 'real');
    const clusters = aggregateHeatPointsWithKAnonymity(realIncidents, UB_DISTRICT_COORDS_MAP, 5);
    res.json({
      clusters,
      totalVerifiedIncidents: realIncidents.length,
      kMin: 5,
    });
  });

  app.post('/api/incidents', writeLimiter.middleware, requireAdminAuth, (req, res) => {
    const b = req.body as Record<string, unknown>;
    const item = b && typeof b === 'object' && !Array.isArray(b) ? sanitizeIncidentInput(b, 'manual') : null;
    if (!item) {
      return res.status(400).json({
        error:
          'Invalid incident payload. Verified real incidents require valid date, districtId, khoroo, category, severity, ETA, and in-bounds coordinates (no PII).',
      });
    }
    const saved = db.upsertIncident(item);
    res.status(201).json({ incident: saved, stats: db.getStats() });
  });

  app.put('/api/incidents/:id', writeLimiter.middleware, requireAdminAuth, (req, res) => {
    const id = req.params.id?.trim() ?? '';
    if (!VALID_ID_RE.test(id)) {
      return res.status(400).json({ error: 'Invalid incident ID.' });
    }
    const existing = db.getIncidentById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Incident record not found.' });
    }
    const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>)
      : {};
    const merged = sanitizeIncidentInput(
      {
        ...existing,
        ...b,
        id: existing.id,
        source: existing.source,
      },
      existing.source
    );
    if (!merged) {
      return res.status(400).json({ error: 'Invalid incident update payload.' });
    }
    const saved = db.upsertIncident({ ...merged, createdAtIso: existing.createdAtIso });
    res.json({ incident: saved, stats: db.getStats() });
  });

  app.delete('/api/incidents/:id', writeLimiter.middleware, requireAdminAuth, (req, res) => {
    const id = req.params.id?.trim() ?? '';
    if (!VALID_ID_RE.test(id)) {
      return res.status(400).json({ error: 'Invalid incident ID.' });
    }
    const deleted = db.deleteIncident(id);
    if (!deleted) return res.status(404).json({ error: 'Incident record not found.' });
    res.json({ deleted: true, stats: db.getStats() });
  });

  app.post('/api/v1/incidents/batch-sync', writeLimiter.middleware, requireAdminAuth, (req, res) => {
    const body = req.body as Record<string, unknown> | unknown[];
    const rawList: Record<string, unknown>[] = [];
    const batchOrigin =
      body && !Array.isArray(body) && typeof body === 'object' && body.dataOrigin === 'real'
        ? 'real'
        : undefined;

    if (Array.isArray(body)) {
      for (const entry of body) {
        if (entry && typeof entry === 'object') rawList.push(entry as Record<string, unknown>);
      }
    } else if (body && typeof body === 'object') {
      if (body.type === 'FeatureCollection' && Array.isArray(body.features)) {
        for (const feat of body.features as Array<Record<string, unknown>>) {
          if (!feat || typeof feat !== 'object') continue;
          const props = (feat.properties && typeof feat.properties === 'object' ? feat.properties : {}) as Record<string, unknown>;
          const geom = (feat.geometry && typeof feat.geometry === 'object' ? feat.geometry : {}) as Record<string, unknown>;
          const coords = Array.isArray(geom.coordinates) ? geom.coordinates : [];
          rawList.push({
            ...props,
            dataOrigin: props.dataOrigin ?? batchOrigin,
            id: feat.id ?? props.id,
            lng: typeof coords[0] === 'number' ? coords[0] : props.lng,
            lat: typeof coords[1] === 'number' ? coords[1] : props.lat,
            source: 'geojson-sync',
          });
        }
      } else if (Array.isArray(body.incidents)) {
        for (const entry of body.incidents) {
          if (entry && typeof entry === 'object') {
            const rec = entry as Record<string, unknown>;
            rawList.push({ ...rec, dataOrigin: rec.dataOrigin ?? batchOrigin });
          }
        }
      }
    }

    if (rawList.length === 0) {
      return res.status(400).json({
        error: 'Expected a GeoJSON FeatureCollection, { incidents: [...] }, or a JSON array of records.',
      });
    }
    if (rawList.length > 200) {
      return res.status(400).json({
        error: 'Batch size limit exceeded: maximum 200 incident records per sync request.',
      });
    }

    const validItems: NonNullable<ReturnType<typeof sanitizeIncidentInput>>[] = [];
    const seenKeys = new Set<string>(
      db.listAllIncidents().map((existing) => canonicalIncidentKey(existing))
    );
    let skippedCount = 0;
    let duplicateCount = 0;
    for (const row of rawList) {
      const clean = sanitizeIncidentInput(row, 'batch-sync');
      if (!clean) {
        skippedCount += 1;
        continue;
      }
      const key = canonicalIncidentKey(clean);
      if (seenKeys.has(key)) {
        duplicateCount += 1;
        continue;
      }
      seenKeys.add(key);
      validItems.push(clean);
    }

    const syncedCount = validItems.length > 0 ? db.batchUpsertIncidents(validItems) : 0;
    const allIncidentsFull = db.listAllIncidents();
    const mlReadiness = buildCleanTrainingDataset(allIncidentsFull);

    res.status(200).json({
      syncedCount,
      duplicateCount,
      skippedCount,
      mlReadiness,
      incidents: db.listIncidents(),
      stats: db.getStats(),
    });
  });

  app.post('/api/v1/incidents/import', writeLimiter.middleware, requireAdminAuth, async (req, res) => {
    const body = req.body as {
      format?: 'csv' | 'json';
      payload?: unknown;
      dryRun?: boolean;
      sourceName?: string;
      enrichWeather?: boolean;
    };

    const sourceName =
      typeof body?.sourceName === 'string' && body.sourceName.trim()
        ? body.sourceName.trim().slice(0, 48)
        : 'NEMA-upload';
    const dryRun = Boolean(body?.dryRun);
    const enrichWeather = body?.enrichWeather !== false;

    let report;
    if (body?.format === 'csv' || typeof body?.payload === 'string') {
      const csvText = typeof body?.payload === 'string' ? body.payload : '';
      if (!csvText.trim()) {
        return res.status(400).json({ error: 'CSV payload is empty.' });
      }
      report = parseCsvRealIncidents(csvText, { defaultSource: sourceName });
    } else {
      const p = body?.payload as Record<string, unknown> | unknown[];
      const rawObjs: Array<{ rowIndex: number; fields: Record<string, unknown> }> = [];
      if (Array.isArray(p)) {
        p.forEach((item, idx) => {
          if (item && typeof item === 'object') {
            rawObjs.push({ rowIndex: idx + 1, fields: item as Record<string, unknown> });
          }
        });
      } else if (p && typeof p === 'object' && p.type === 'FeatureCollection' && Array.isArray(p.features)) {
        (p.features as Array<Record<string, unknown>>).forEach((feat, idx) => {
          if (!feat || typeof feat !== 'object') return;
          const props = (feat.properties && typeof feat.properties === 'object' ? feat.properties : {}) as Record<string, unknown>;
          const geom = (feat.geometry && typeof feat.geometry === 'object' ? feat.geometry : {}) as Record<string, unknown>;
          const coords = Array.isArray(geom.coordinates) ? geom.coordinates : [];
          rawObjs.push({
            rowIndex: idx + 1,
            fields: {
              ...props,
              id: feat.id ?? props.id,
              lng: typeof coords[0] === 'number' ? coords[0] : props.lng,
              lat: typeof coords[1] === 'number' ? coords[1] : props.lat,
            },
          });
        });
      } else if (p && typeof p === 'object' && Array.isArray(p.incidents)) {
        (p.incidents as unknown[]).forEach((item, idx) => {
          if (item && typeof item === 'object') {
            rawObjs.push({ rowIndex: idx + 1, fields: item as Record<string, unknown> });
          }
        });
      }

      if (rawObjs.length === 0) {
        return res.status(400).json({
          error: 'Expected CSV string, JSON array, { incidents: [...] }, or GeoJSON FeatureCollection.',
        });
      }
      report = validateAndNormalizeImportRecords(rawObjs, {
        format: 'json',
        defaultSource: sourceName,
      });
    }

    if (report.totalRows > 5000) {
      return res.status(400).json({ error: 'Import exceeds 5,000 rows per upload batch.' });
    }

    const existingKeys = new Set(
      db.listAllIncidents().map((inc) => canonicalIncidentKey(inc))
    );
    const toInsert = report.validRows.filter((row) => !existingKeys.has(row.canonicalKey));
    const existingDuplicateCount = report.validRows.length - toInsert.length;
    const duplicateCount = report.duplicateInBatchCount + existingDuplicateCount;

    let insertedCount = 0;
    let weatherSync: Awaited<ReturnType<typeof syncHistoricalWeatherForRealIncidents>> | null = null;

    if (!dryRun) {
      const nowIso = new Date().toISOString();
      const records = toInsert.map((row) => ({
        id: row.id,
        date: row.date,
        districtId: row.districtId,
        khorooNumber: row.khorooNumber,
        category: row.category,
        severity: row.severity,
        causeGuessMn: row.causeGuessMn,
        causeGuessEn: row.causeGuessEn,
        responseTimeMin: row.responseTimeMin,
        lat: row.lat,
        lng: row.lng,
        source: row.source,
        dataOrigin: 'real' as const,
        createdAtIso: nowIso,
      }));
      insertedCount = records.length > 0 ? db.batchUpsertIncidents(records) : 0;

      db.saveIngestionBatch({
        id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        createdAtIso: nowIso,
        format: report.format,
        sourceName,
        totalRows: report.totalRows,
        insertedRows: insertedCount,
        duplicateRows: duplicateCount,
        rejectedRows: report.rejectedRows.length,
        piiRejectedRows: report.piiRejectedCount,
        rejectionSummaryJson: JSON.stringify(report.rejectedRows.slice(0, 20)),
      });

      if (enrichWeather && records.length > 0) {
        weatherSync = await syncHistoricalWeatherForRealIncidents(db, records);
      }
    }

    const mlReadiness = buildCleanTrainingDataset(db.listAllIncidents());

    res.json({
      ok: true,
      dryRun,
      format: report.format,
      totalRows: report.totalRows,
      validNewCount: toInsert.length,
      insertedCount,
      duplicateCount,
      rejectedCount: report.rejectedRows.length,
      piiRejectedCount: report.piiRejectedCount,
      rejectedSample: report.rejectedRows.slice(0, 25),
      detectedColumns: report.detectedColumns,
      mappedFields: report.mappedFields,
      weatherSync,
      mlReadiness,
      stats: db.getStats(),
    });
  });

  app.get('/api/data-management/batches', requireAdminAuth, (_req, res) => {
    res.json({ batches: db.listIngestionBatches() });
  });

  app.post('/api/ml/sync-historical-weather', writeLimiter.middleware, requireAdminAuth, async (_req, res) => {
    const realIncidents = db.listAllIncidents().filter((i) => i.dataOrigin === 'real');
    const syncResult = await syncHistoricalWeatherForRealIncidents(db, realIncidents);
    res.json({
      ok: true,
      ...syncResult,
      realIncidentCount: realIncidents.length,
      stats: db.getStats(),
    });
  });

  app.post('/api/ml/train', writeLimiter.middleware, requireAdminAuth, async (req, res) => {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as { syncWeather?: boolean };
    const allIncidents = db.listAllIncidents();
    if (body.syncWeather) {
      const realOnly = allIncidents.filter((i) => i.dataOrigin === 'real');
      await syncHistoricalWeatherForRealIncidents(db, realOnly);
    }

    const historicalWeather = db.listHistoricalWeather();
    const districtLiveWeather = db.listDistrictWeather(WEATHER_TTL_MS);
    const artifact = trainAndEvaluateFireModel({
      rawIncidents: allIncidents,
      historicalWeather,
      districtLiveWeather,
      khoroos: UB_KHOROOS,
    });
    const savedModel = db.saveMlModel(artifact);
    res.json({
      ok: true,
      model: savedModel,
      mlReadiness: buildCleanTrainingDataset(allIncidents),
      stats: db.getStats(),
    });
  });

  app.get('/api/ml/status', (_req, res) => {
    const allIncidents = db.listAllIncidents();
    const mlReadiness = buildCleanTrainingDataset(allIncidents);
    const latestModel = db.getLatestMlModel();
    const gatePassed = Boolean(latestModel?.gatePassed);
    res.json({
      ok: true,
      mlReadiness,
      latestModel: latestModel
        ? {
            id: latestModel.id,
            modelVersion: latestModel.modelVersion,
            trainedAtIso: latestModel.trainedAtIso,
            status: latestModel.status,
            gatePassed: latestModel.gatePassed,
            gateReasonsMn: latestModel.gateReasonsMn,
            gateReasonsEn: latestModel.gateReasonsEn,
            metrics: latestModel.metrics,
            weatherMatchedPct: latestModel.weights.weatherMatchedPct,
          }
        : null,
      gatePassed,
      khorooProbabilities: gatePassed ? latestModel?.khorooProbabilities ?? null : null,
      ingestionBatchCount: db.listIngestionBatches().length,
      stats: db.getStats(),
    });
  });

  app.get('/api/data-management/status', requireAdminAuth, (_req, res) => {
    const latestWeather = db.getLatestWeather();
    res.json({
      ok: true,
      stats: db.getStats(),
      latestWeatherTimestamp: latestWeather?.observedAtIso ?? null,
      latestWeatherProvider: latestWeather?.provider ?? null,
      hasGemini: Boolean(process.env.GEMINI_API_KEY),
      serverTimeIso: new Date().toISOString(),
    });
  });

  app.get('/api/data-management/quality', requireAdminAuth, (_req, res) => {
    const allIncidents = db.listAllIncidents();
    const mlReadiness = buildCleanTrainingDataset(allIncidents);
    res.json({
      ok: true,
      stats: db.getStats(),
      mlReadiness,
    });
  });

  app.delete('/api/data-management/ai-cache', writeLimiter.middleware, requireAdminAuth, (_req, res) => {
    const cleared = db.clearAiCache();
    res.json({ cleared, stats: db.getStats() });
  });

  app.post('/api/ai/explain', aiMinuteLimiter.middleware, aiDailyLimiter.middleware, async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error: 'Gemini AI analyst is not configured on this server (missing GEMINI_API_KEY).',
      });
    }

    const checked = validateAiExplainPayload(req.body);
    if (!checked.ok) {
      return res.status(400).json({ error: checked.error });
    }
    const body = checked.value;

    const lang = body.language;
    const weather = db.getLatestWeather();
    const weatherTag = weather ? `${weather.observedAtIso}` : 'unavailable';
    const cacheKey = `${lang}:${body.areaId}:${body.riskScore}:${weatherTag}`;

    const cached = db.getAiCache(cacheKey, AI_CACHE_TTL_MS);
    if (cached) {
      return res.json({ explanation: cached, cached: true });
    }

    const weatherContext = weather
      ? {
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
          spreadPotential: weather.spreadPotential,
        }
      : { status: 'unavailable', note: 'No live weather observation cached yet.' };

    const systemInstruction =
      lang === 'mn'
        ? `Та FireWatch UB орон зайн галын эрсдэлийн аналитик туслах.
ХАТУУ ДҮРЭМ:
1. Зөвхөн доор өгөгдсөн JSON мэдээлэлд тулгуурлан тайлбарлана уу. Шинэ дуудлага, цаг агаарын тоо, эх сурвалж, эсвэл баталгаагүй үйл явдал ХЭЗЭЭ Ч зохиохгүй байх.
2. Энэ эрсдэлийн оноо (0-100) нь олон хүчин зүйлийн аналитик/эвристик индекс бөгөөд гал гарах статистик магадлал (%) БИШ гэдгийг тодорхой ялгаж хэлнэ үү.
3. Салхи нь гал асаах шууд шалтгаан биш, харин нэгэнт гарсан оч, дөлийг тараах хурдыг нэмэгдүүлдэг хүчин зүйл гэдгийг зөв тайлбарлана уу.
4. Цаг агаарын мэдээллийн огноо/цаг болон тухайн хорооны өгөгдөл загварчилсан (isModelled) эсэхийг заавал дурдана уу.
5. Албан ёсны онцгой байдлын зарлан мэдээлэл биш гэдгийг сануулна уу. Хариултаа монгол хэлээр ойлгомжтой, товч тодорхой бичнэ үү.`
        : `You are the FireWatch UB spatial fire-risk analytical assistant.
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
        dataScopeNote:
          'Historical incident totals are 2024-2026 aggregated demonstration records; khoroos marked isModelled are synthesized from district totals.',
      });
      const requestConfig = {
        systemInstruction,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          required: ['summary', 'verifiedFactors', 'weatherInfluence', 'dataLimitations', 'actionableSteps'],
          properties: {
            summary: {
              type: Type.STRING,
              description: '2-3 concise sentences citing exact score, area, and status.',
            },
            verifiedFactors: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '2-4 short bullets from the supplied data driving the score.',
            },
            weatherInfluence: {
              type: Type.STRING,
              description: '1-2 sentences on how the timestamped weather observation affects ignition receptivity vs wind spread.',
            },
            dataLimitations: {
              type: Type.STRING,
              description: '1-2 sentences distinguishing verified vs modelled/missing data and timestamps.',
            },
            actionableSteps: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '2-3 short practical household or prevention steps.',
            },
          },
        },
      };

      const primaryModel = (process.env.GEMINI_MODEL || 'gemini-4-hydrogen').trim() || 'gemini-4-hydrogen';
      const fallbackModel = (process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.1-flash-lite').trim() || 'gemini-3.1-flash-lite';
      const timeoutMs = Math.max(3_000, Math.min(60_000, Number(process.env.GEMINI_TIMEOUT_MS) || 18_000));

      const thinkingFor = (model: string) =>
        model.includes('flash-lite') ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW;

      const callModelWithTimeout = async (model: string) => {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(Object.assign(new Error('Gemini request timed out.'), { code: 'ETIMEDOUT' }));
            }, timeoutMs);
          });
          const genPromise = ai.models.generateContent({
            model,
            contents: requestContents,
            config: {
              ...requestConfig,
              abortSignal: controller.signal,
              thinkingConfig: { thinkingLevel: thinkingFor(model) },
            },
          });
          return await Promise.race([genPromise, timeoutPromise]);
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      };

      const parseJsonSafe = (raw?: string) => {
        const cleaned = (raw ?? '').trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
        return JSON.parse(cleaned || '{}');
      };

      let parsed: Record<string, unknown>;
      try {
        const response = await callModelWithTimeout(primaryModel);
        parsed = parseJsonSafe(response.text);
      } catch (primaryErr) {
        if ((primaryErr as { code?: string })?.code === 'ETIMEDOUT' && fallbackModel === primaryModel) {
          throw primaryErr;
        }
        const fallback = await callModelWithTimeout(fallbackModel);
        parsed = parseJsonSafe(fallback.text);
      }
      const verified = verifyAiExplanationGrounding(parsed, {
        language: lang,
        areaName: body.areaName,
        riskScore: body.riskScore,
        isModelled: body.isModelled,
        weatherObservedAtIso: weather?.observedAtIso ?? null,
      });

      const payload = {
        ...verified.payload,
        generatedAtIso: new Date().toISOString(),
        weatherTimestamp: weather?.observedAtIso ?? null,
        weatherIsLive: weather ? Date.now() - weather.fetchedAtMs < WEATHER_TTL_MS : false,
      };
      db.setAiCache(cacheKey, payload);
      return res.json({ explanation: payload, cached: false });
    } catch (err) {
      if ((err as { code?: string })?.code === 'ETIMEDOUT') {
        return res.status(504).json({ error: 'AI explanation timed out. Please retry shortly.' });
      }
      const msg = err instanceof Error ? err.message : 'Gemini request failed';
      return res.status(502).json({ error: `AI explanation unavailable: ${msg}` });
    }
  });

  return app;
}

async function start() {
  const isProd = process.env.NODE_ENV === 'production';
  const app = createFireWatchApp({ isProd, port: PORT });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const localDist = path.join(__dirname, 'dist');
    const parentDist = path.resolve(__dirname, '..', 'dist');
    const distDir = existsSync(path.join(localDist, 'index.html')) ? localDist : parentDist;
    app.use(createPrecompressedStaticMiddleware(distDir));
    app.use(express.static(distDir, { index: false }));
    app.use((req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      const indexHtml = path.join(distDir, 'index.html');
      if (existsSync(indexHtml)) {
        if (!sendPrecompressedStaticFile(req, res, indexHtml, '/index.html')) {
          res.sendFile(indexHtml);
        }
      } else {
        res.status(404).send('Production build not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[FireWatch UB] Server listening on http://0.0.0.0:${PORT} (${isProd ? 'production' : 'development'})`);
  });
}

if (!process.env.NODE_TEST_CONTEXT && process.env.FIREWATCH_NO_LISTEN !== '1') {
  start().catch((err) => {
    console.error('[FireWatch UB] Failed to start server:', err);
    process.exit(1);
  });
}
