import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface StoredWeatherRecord {
  id: number;
  fetchedAtMs: number;
  observedAtIso: string;
  tempCelsius: number;
  apparentCelsius: number;
  humidityPercent: number;
  windSpeedKmh: number;
  windDirectionDeg: number;
  gustKmh: number;
  precipitationMm: number;
  weatherCode: number;
  droughtDays: number;
  fireWeatherIndex: number;
  ignitionReceptivity: number;
  spreadPotential: number;
  utcOffsetSeconds: number;
  dailyJson: string;
  provider: string;
}

export interface StoredHomeAudit {
  id: string;
  sessionId: string;
  createdAtIso: string;
  districtId: string;
  khorooNumber: number;
  homeType: string;
  heatingType: string;
  electricalState: string;
  hasSmokeDetector: boolean;
  hasFireExtinguisher: boolean;
  ashStorage: string;
  hasChildren: boolean;
  hasElderly: boolean;
  score: number;
  riskLevel: string;
  meetingPoint: string;
  /** Always empty on server: phone numbers are kept locally in browser storage only for PII minimization. */
  emergencyPhone?: string;
}

import type {
  DistrictWeatherSnapshot,
  HistoricalWeatherDay,
  MlModelArtifact,
} from '../types';

export interface StoredIngestionBatch {
  id: string;
  createdAtIso: string;
  format: 'csv' | 'json';
  sourceName: string;
  totalRows: number;
  insertedRows: number;
  duplicateRows: number;
  rejectedRows: number;
  piiRejectedRows: number;
  rejectionSummaryJson: string;
}

export interface StoredIncident {
  id: string;
  date: string;
  districtId: string;
  khorooNumber: number;
  category: 'residential_ger' | 'residential_apt' | 'commercial' | 'grass_forest' | 'electrical';
  severity: 'minor' | 'moderate' | 'critical';
  causeGuessMn: string;
  causeGuessEn: string;
  responseTimeMin: number;
  lat: number;
  lng: number;
  source: string;
  dataOrigin?: 'real' | 'demo';
  createdAtIso: string;
}

export function createFireWatchDb(
  dbPath = process.env.FIREWATCH_DB_PATH || process.env.DB_PATH || './data/firewatch.sqlite'
) {
  if (dbPath !== ':memory:') {
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
      data_origin TEXT NOT NULL DEFAULT 'demo',
      created_at_iso TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS district_weather_observations (
      district_id TEXT PRIMARY KEY,
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
      vpd_kpa REAL NOT NULL,
      fire_weather_index INTEGER NOT NULL,
      ignition_receptivity INTEGER NOT NULL,
      spread_potential INTEGER NOT NULL,
      provider TEXT NOT NULL DEFAULT 'Open-Meteo',
      fetched_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS historical_weather_cache (
      district_id TEXT NOT NULL,
      date TEXT NOT NULL,
      temp_mean_c REAL NOT NULL,
      temp_max_c REAL NOT NULL,
      rh_min_pct REAL NOT NULL,
      wind_max_kmh REAL NOT NULL,
      precip_sum_mm REAL NOT NULL,
      vpd_kpa REAL NOT NULL,
      drought_days_7d INTEGER NOT NULL,
      lag3d_rh_min REAL NOT NULL,
      provider TEXT NOT NULL DEFAULT 'Open-Meteo-Archive',
      fetched_at_ms INTEGER NOT NULL,
      PRIMARY KEY (district_id, date)
    );

    CREATE TABLE IF NOT EXISTS ingestion_batches (
      id TEXT PRIMARY KEY,
      created_at_iso TEXT NOT NULL,
      format TEXT NOT NULL,
      source_name TEXT NOT NULL,
      total_rows INTEGER NOT NULL,
      inserted_rows INTEGER NOT NULL,
      duplicate_rows INTEGER NOT NULL,
      rejected_rows INTEGER NOT NULL,
      pii_rejected_rows INTEGER NOT NULL,
      rejection_summary_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ml_models (
      id TEXT PRIMARY KEY,
      model_version TEXT NOT NULL,
      trained_at_iso TEXT NOT NULL,
      status TEXT NOT NULL,
      gate_passed INTEGER NOT NULL,
      gate_reasons_mn_json TEXT NOT NULL,
      gate_reasons_en_json TEXT NOT NULL,
      metrics_json TEXT NOT NULL,
      weights_json TEXT NOT NULL,
      khoroo_probabilities_json TEXT NOT NULL DEFAULT '{}'
    );
  `);

  // Safe migration for existing SQLite files created before session_id scoping, phone minimization & data_origin
  const auditCols = db.prepare(`PRAGMA table_info(home_audits)`).all() as Array<{ name: string }>;
  if (!auditCols.some((c) => c.name === 'session_id')) {
    db.exec(`ALTER TABLE home_audits ADD COLUMN session_id TEXT NOT NULL DEFAULT ''`);
  }
  const incCols = db.prepare(`PRAGMA table_info(managed_incidents)`).all() as Array<{ name: string }>;
  if (!incCols.some((c) => c.name === 'data_origin')) {
    db.exec(`ALTER TABLE managed_incidents ADD COLUMN data_origin TEXT NOT NULL DEFAULT 'demo'`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_home_audits_session ON home_audits(session_id, created_at_iso DESC);
    CREATE INDEX IF NOT EXISTS idx_managed_incidents_origin_date ON managed_incidents(data_origin, date DESC);
    CREATE INDEX IF NOT EXISTS idx_hist_weather_date ON historical_weather_cache(date DESC, district_id);
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
      cause_guess_mn, cause_guess_en, response_time_min, lat, lng, source, data_origin, created_at_iso
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      source = excluded.source,
      data_origin = excluded.data_origin
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
      data_origin AS dataOrigin,
      created_at_iso AS createdAtIso
    FROM managed_incidents
    ORDER BY date DESC, created_at_iso DESC
    LIMIT ?
  `);

  const listAllIncidentsStmt = db.prepare(`
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
      data_origin AS dataOrigin,
      created_at_iso AS createdAtIso
    FROM managed_incidents
    ORDER BY date ASC, created_at_iso ASC
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
      data_origin AS dataOrigin,
      created_at_iso AS createdAtIso
    FROM managed_incidents
    WHERE id = ?
  `);

  const deleteIncidentStmt = db.prepare(`DELETE FROM managed_incidents WHERE id = ?`);

  const upsertDistrictWeatherStmt = db.prepare(`
    INSERT INTO district_weather_observations (
      district_id, observed_at_iso, temp_celsius, apparent_celsius,
      humidity_percent, wind_speed_kmh, wind_direction_deg, gust_kmh,
      precipitation_mm, weather_code, drought_days, vpd_kpa,
      fire_weather_index, ignition_receptivity, spread_potential, provider, fetched_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(district_id) DO UPDATE SET
      observed_at_iso = excluded.observed_at_iso,
      temp_celsius = excluded.temp_celsius,
      apparent_celsius = excluded.apparent_celsius,
      humidity_percent = excluded.humidity_percent,
      wind_speed_kmh = excluded.wind_speed_kmh,
      wind_direction_deg = excluded.wind_direction_deg,
      gust_kmh = excluded.gust_kmh,
      precipitation_mm = excluded.precipitation_mm,
      weather_code = excluded.weather_code,
      drought_days = excluded.drought_days,
      vpd_kpa = excluded.vpd_kpa,
      fire_weather_index = excluded.fire_weather_index,
      ignition_receptivity = excluded.ignition_receptivity,
      spread_potential = excluded.spread_potential,
      provider = excluded.provider,
      fetched_at_ms = excluded.fetched_at_ms
  `);

  const listDistrictWeatherStmt = db.prepare(`
    SELECT
      district_id AS districtId,
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
      vpd_kpa AS vpdKpa,
      fire_weather_index AS fireWeatherIndex,
      ignition_receptivity AS ignitionReceptivity,
      spread_potential AS spreadPotential,
      provider,
      fetched_at_ms AS fetchedAtMs
    FROM district_weather_observations
  `);

  const upsertHistWeatherStmt = db.prepare(`
    INSERT INTO historical_weather_cache (
      district_id, date, temp_mean_c, temp_max_c, rh_min_pct,
      wind_max_kmh, precip_sum_mm, vpd_kpa, drought_days_7d, lag3d_rh_min, provider, fetched_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(district_id, date) DO UPDATE SET
      temp_mean_c = excluded.temp_mean_c,
      temp_max_c = excluded.temp_max_c,
      rh_min_pct = excluded.rh_min_pct,
      wind_max_kmh = excluded.wind_max_kmh,
      precip_sum_mm = excluded.precip_sum_mm,
      vpd_kpa = excluded.vpd_kpa,
      drought_days_7d = excluded.drought_days_7d,
      lag3d_rh_min = excluded.lag3d_rh_min,
      provider = excluded.provider,
      fetched_at_ms = excluded.fetched_at_ms
  `);

  const listHistWeatherStmt = db.prepare(`
    SELECT
      district_id AS districtId,
      date,
      temp_mean_c AS tempMeanC,
      temp_max_c AS tempMaxC,
      rh_min_pct AS rhMinPct,
      wind_max_kmh AS windMaxKmh,
      precip_sum_mm AS precipSumMm,
      vpd_kpa AS vpdKpa,
      drought_days_7d AS droughtDays7d,
      lag3d_rh_min AS lag3dRhMin,
      provider
    FROM historical_weather_cache
    ORDER BY date ASC
  `);

  const insertIngestionBatchStmt = db.prepare(`
    INSERT INTO ingestion_batches (
      id, created_at_iso, format, source_name, total_rows,
      inserted_rows, duplicate_rows, rejected_rows, pii_rejected_rows, rejection_summary_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const listIngestionBatchesStmt = db.prepare(`
    SELECT
      id,
      created_at_iso AS createdAtIso,
      format,
      source_name AS sourceName,
      total_rows AS totalRows,
      inserted_rows AS insertedRows,
      duplicate_rows AS duplicateRows,
      rejected_rows AS rejectedRows,
      pii_rejected_rows AS piiRejectedRows,
      rejection_summary_json AS rejectionSummaryJson
    FROM ingestion_batches
    ORDER BY created_at_iso DESC
    LIMIT 25
  `);

  const insertMlModelStmt = db.prepare(`
    INSERT INTO ml_models (
      id, model_version, trained_at_iso, status, gate_passed,
      gate_reasons_mn_json, gate_reasons_en_json, metrics_json, weights_json, khoroo_probabilities_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const latestMlModelStmt = db.prepare(`
    SELECT *
    FROM ml_models
    ORDER BY trained_at_iso DESC
    LIMIT 1
  `);

  const countWeatherStmt = db.prepare(`SELECT COUNT(*) AS cnt FROM weather_observations`);
  const countHistWeatherStmt = db.prepare(`SELECT COUNT(*) AS cnt FROM historical_weather_cache`);
  const countAuditsStmt = db.prepare(`SELECT COUNT(*) AS cnt FROM home_audits`);
  const countIncidentsStmt = db.prepare(`SELECT COUNT(*) AS cnt FROM managed_incidents`);
  const countRealIncidentsStmt = db.prepare(`SELECT COUNT(*) AS cnt FROM managed_incidents WHERE data_origin = 'real'`);
  const countAiCacheStmt = db.prepare(`SELECT COUNT(*) AS cnt FROM ai_explanation_cache`);

  return {
    saveWeather(rec: Omit<StoredWeatherRecord, 'id'>): StoredWeatherRecord {
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

    getLatestWeather(): StoredWeatherRecord | null {
      const row = latestWeatherStmt.get() as unknown as StoredWeatherRecord | undefined;
      return row ?? null;
    },

    saveHomeAudit(audit: Omit<StoredHomeAudit, 'emergencyPhone'>): StoredHomeAudit {
      if (!audit.sessionId) {
        throw new Error('sessionId is required to store a home audit');
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
      return { ...audit, emergencyPhone: '' };
    },

    listHomeAudits(sessionId: string): StoredHomeAudit[] {
      if (!sessionId) return [];
      const rows = listAuditsStmt.all(sessionId) as unknown as Array<
        Omit<StoredHomeAudit, 'hasSmokeDetector' | 'hasFireExtinguisher' | 'hasChildren' | 'hasElderly' | 'emergencyPhone'> & {
          hasSmokeDetector: number;
          hasFireExtinguisher: number;
          hasChildren: number;
          hasElderly: number;
        }
      >;
      return rows.map((r) => ({
        ...r,
        hasSmokeDetector: Boolean(r.hasSmokeDetector),
        hasFireExtinguisher: Boolean(r.hasFireExtinguisher),
        hasChildren: Boolean(r.hasChildren),
        hasElderly: Boolean(r.hasElderly),
        emergencyPhone: '',
      }));
    },

    deleteHomeAudit(id: string, sessionId: string): boolean {
      if (!id || !sessionId) return false;
      const res = deleteAuditStmt.run(id, sessionId);
      return Number(res.changes) > 0;
    },

    getAiCache(cacheKey: string, maxAgeMs: number): unknown | null {
      const row = getAiCacheStmt.get(cacheKey) as unknown as
        | { createdAtMs: number; responseJson: string }
        | undefined;
      if (!row) return null;
      if (Date.now() - row.createdAtMs > maxAgeMs) return null;
      try {
        return JSON.parse(row.responseJson);
      } catch {
        return null;
      }
    },

    setAiCache(cacheKey: string, payload: unknown): void {
      setAiCacheStmt.run(cacheKey, Date.now(), JSON.stringify(payload));
    },

    clearAiCache(): number {
      const res = clearAiCacheStmt.run();
      return Number(res.changes);
    },

    upsertIncident(inc: StoredIncident): StoredIncident {
      const dataOrigin: 'real' | 'demo' = inc.dataOrigin === 'real' ? 'real' : 'demo';
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
        dataOrigin,
        inc.createdAtIso
      );
      return { ...inc, dataOrigin };
    },

    batchUpsertIncidents(items: StoredIncident[]): number {
      let count = 0;
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const inc of items) {
          const dataOrigin: 'real' | 'demo' = inc.dataOrigin === 'real' ? 'real' : 'demo';
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
            dataOrigin,
            inc.createdAtIso
          );
          count += 1;
        }
        db.exec('COMMIT');
        return count;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    listIncidents(limit = 500): StoredIncident[] {
      return listIncidentsStmt.all(limit) as unknown as StoredIncident[];
    },

    listAllIncidents(): StoredIncident[] {
      return listAllIncidentsStmt.all() as unknown as StoredIncident[];
    },

    getIncidentById(id: string): StoredIncident | null {
      const row = getIncidentByIdStmt.get(id) as unknown as StoredIncident | undefined;
      return row ?? null;
    },

    deleteIncident(id: string): boolean {
      const res = deleteIncidentStmt.run(id);
      return Number(res.changes) > 0;
    },

    saveDistrictWeatherBatch(items: Array<Omit<DistrictWeatherSnapshot, 'isLive'>>): void {
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const w of items) {
          upsertDistrictWeatherStmt.run(
            w.districtId,
            w.observedAtIso,
            w.tempCelsius,
            w.apparentCelsius,
            w.humidityPercent,
            w.windSpeedKmh,
            w.windDirectionDeg,
            w.gustKmh,
            w.precipitationMm,
            w.weatherCode,
            w.droughtDays,
            w.vpdKpa,
            w.fireWeatherIndex,
            w.ignitionReceptivity,
            w.spreadPotential,
            w.provider,
            w.fetchedAtMs
          );
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    listDistrictWeather(staleCutoffMs: number): Record<string, DistrictWeatherSnapshot> {
      const rows = listDistrictWeatherStmt.all() as unknown as Array<
        Omit<DistrictWeatherSnapshot, 'isLive'>
      >;
      const now = Date.now();
      const map: Record<string, DistrictWeatherSnapshot> = {};
      for (const r of rows) {
        map[r.districtId] = {
          ...r,
          isLive: now - r.fetchedAtMs < staleCutoffMs,
        };
      }
      return map;
    },

    saveHistoricalWeatherDays(days: HistoricalWeatherDay[]): number {
      if (days.length === 0) return 0;
      const now = Date.now();
      let count = 0;
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const d of days) {
          upsertHistWeatherStmt.run(
            d.districtId,
            d.date,
            d.tempMeanC,
            d.tempMaxC,
            d.rhMinPct,
            d.windMaxKmh,
            d.precipSumMm,
            d.vpdKpa,
            d.droughtDays7d,
            d.lag3dRhMin,
            d.provider,
            now
          );
          count += 1;
        }
        db.exec('COMMIT');
        return count;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    listHistoricalWeather(): HistoricalWeatherDay[] {
      return listHistWeatherStmt.all() as unknown as HistoricalWeatherDay[];
    },

    saveIngestionBatch(batch: StoredIngestionBatch): StoredIngestionBatch {
      insertIngestionBatchStmt.run(
        batch.id,
        batch.createdAtIso,
        batch.format,
        batch.sourceName,
        batch.totalRows,
        batch.insertedRows,
        batch.duplicateRows,
        batch.rejectedRows,
        batch.piiRejectedRows,
        batch.rejectionSummaryJson
      );
      return batch;
    },

    listIngestionBatches(): StoredIngestionBatch[] {
      return listIngestionBatchesStmt.all() as unknown as StoredIngestionBatch[];
    },

    saveMlModel(artifact: MlModelArtifact): MlModelArtifact {
      insertMlModelStmt.run(
        artifact.id,
        artifact.modelVersion,
        artifact.trainedAtIso,
        artifact.status,
        artifact.gatePassed ? 1 : 0,
        JSON.stringify(artifact.gateReasonsMn),
        JSON.stringify(artifact.gateReasonsEn),
        JSON.stringify(artifact.metrics),
        JSON.stringify(artifact.weights),
        JSON.stringify(artifact.khorooProbabilities ?? {})
      );
      return artifact;
    },

    getLatestMlModel(): MlModelArtifact | null {
      const row = latestMlModelStmt.get() as
        | {
            id: string;
            model_version: string;
            trained_at_iso: string;
            status: MlModelArtifact['status'];
            gate_passed: number;
            gate_reasons_mn_json: string;
            gate_reasons_en_json: string;
            metrics_json: string;
            weights_json: string;
            khoroo_probabilities_json: string;
          }
        | undefined;
      if (!row) return null;
      try {
        const khorooProbabilities = JSON.parse(row.khoroo_probabilities_json || '{}');
        return {
          id: row.id,
          modelVersion: row.model_version,
          trainedAtIso: row.trained_at_iso,
          status: row.status,
          gatePassed: Boolean(row.gate_passed),
          gateReasonsMn: JSON.parse(row.gate_reasons_mn_json),
          gateReasonsEn: JSON.parse(row.gate_reasons_en_json),
          metrics: JSON.parse(row.metrics_json),
          weights: JSON.parse(row.weights_json),
          khorooProbabilities:
            khorooProbabilities && Object.keys(khorooProbabilities).length > 0
              ? khorooProbabilities
              : undefined,
        };
      } catch {
        return null;
      }
    },

    getStats() {
      const w = (countWeatherStmt.get() as { cnt?: number } | undefined)?.cnt ?? 0;
      const hw = (countHistWeatherStmt.get() as { cnt?: number } | undefined)?.cnt ?? 0;
      const a = (countAuditsStmt.get() as { cnt?: number } | undefined)?.cnt ?? 0;
      const i = (countIncidentsStmt.get() as { cnt?: number } | undefined)?.cnt ?? 0;
      const r = (countRealIncidentsStmt.get() as { cnt?: number } | undefined)?.cnt ?? 0;
      const c = (countAiCacheStmt.get() as { cnt?: number } | undefined)?.cnt ?? 0;
      return {
        weatherCount: Number(w),
        historicalWeatherCount: Number(hw),
        homeAuditCount: Number(a),
        incidentCount: Number(i),
        realIncidentCount: Number(r),
        aiCacheCount: Number(c),
      };
    },

    close() {
      db.close();
    },
  };
}
