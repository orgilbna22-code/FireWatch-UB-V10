import { UB_DISTRICTS } from '../data/ubGeoData';
import type { DataOrigin, IncidentRecord } from '../types';
import { getUbDateIso } from './ubTime';

export const UB_GEO_BOUNDS = {
  latMin: 47.2,
  latMax: 48.35,
  lngMin: 106.15,
  lngMax: 108.7,
} as const;

export const ML_READINESS_THRESHOLDS = {
  minRealIncidents: 200,
  minDistinctMonths: 12,
  minDistrictCoveragePct: 65,
} as const;

const VALID_DISTRICTS = new Map(UB_DISTRICTS.map((d) => [d.id, d.khoroosCount]));
const VALID_CATEGORIES = new Set<IncidentRecord['category']>([
  'residential_ger',
  'residential_apt',
  'commercial',
  'grass_forest',
  'electrical',
]);
const VALID_SEVERITIES = new Set<IncidentRecord['severity']>(['minor', 'moderate', 'critical']);

export interface RawIncidentCandidate {
  id?: string;
  date?: string;
  districtId?: string;
  khorooNumber?: number;
  khoroo?: number;
  category?: string;
  severity?: string;
  causeGuessMn?: string;
  causeGuessEn?: string;
  responseTimeMin?: number;
  lat?: number;
  lng?: number;
  coordinates?: [number, number];
  source?: string;
  isDemo?: boolean;
  dataOrigin?: DataOrigin;
}

export interface NormalizedRealIncident {
  id: string;
  date: string;
  monthKey: string;
  districtId: string;
  khorooNumber: number;
  category: IncidentRecord['category'];
  severity: IncidentRecord['severity'];
  causeGuessMn: string;
  responseTimeMin: number;
  lat: number;
  lng: number;
  canonicalKey: string;
}

export interface KhorooPeriodRow {
  khorooKey: string;
  districtId: string;
  khorooNumber: number;
  monthKey: string;
  incidentCount: number;
  criticalCount: number;
  gerCount: number;
  avgResponseTimeMin: number;
}

export interface DatasetQualityReport {
  realRowCount: number;
  cleanUniqueRealCount: number;
  excludedDemoCount: number;
  duplicateCount: number;
  rejectedCount: number;
  rejectionBreakdown: Record<string, number>;
  distinctDistricts: number;
  totalDistricts: number;
  districtCoveragePct: number;
  distinctMonths: number;
  panelRows: KhorooPeriodRow[];
  readyForTraining: boolean;
  readinessReasonMn: string;
  readinessReasonEn: string;
}

export function canonicalIncidentKey(params: {
  date: string;
  districtId: string;
  khorooNumber: number;
  lat: number;
  lng: number;
  category: string;
}): string {
  return [
    params.date,
    params.districtId.toLowerCase(),
    String(params.khorooNumber),
    params.lat.toFixed(4),
    params.lng.toFixed(4),
    params.category,
  ].join('|');
}

export function validateRealIncidentRow(
  raw: RawIncidentCandidate,
  maxDateIso: string = getUbDateIso()
): { ok: true; record: NormalizedRealIncident } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id) reasons.push('missing_id');

  const date = typeof raw.date === 'string' ? raw.date.trim().slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '2015-01-01' || date > maxDateIso) {
    reasons.push('invalid_date');
  }

  const districtId = typeof raw.districtId === 'string' ? raw.districtId.trim().toLowerCase() : '';
  const maxKhoroos = VALID_DISTRICTS.get(districtId);
  if (!maxKhoroos) {
    reasons.push('invalid_district');
  }

  const khorooNum = Number(raw.khorooNumber ?? raw.khoroo);
  if (!Number.isInteger(khorooNum) || khorooNum < 1 || (maxKhoroos && khorooNum > maxKhoroos)) {
    reasons.push('invalid_khoroo');
  }

  const category = (raw.category ?? '').trim() as IncidentRecord['category'];
  if (!VALID_CATEGORIES.has(category)) {
    reasons.push('invalid_category');
  }

  const severity = (raw.severity ?? '').trim() as IncidentRecord['severity'];
  if (!VALID_SEVERITIES.has(severity)) {
    reasons.push('invalid_severity');
  }

  const lat = typeof raw.lat === 'number' ? raw.lat : raw.coordinates?.[0];
  const lng = typeof raw.lng === 'number' ? raw.lng : raw.coordinates?.[1];
  const validCoord =
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= UB_GEO_BOUNDS.latMin &&
    lat <= UB_GEO_BOUNDS.latMax &&
    lng >= UB_GEO_BOUNDS.lngMin &&
    lng <= UB_GEO_BOUNDS.lngMax;
  if (!validCoord) {
    reasons.push('out_of_ub_bounds');
  }

  const responseTimeMin = Number(raw.responseTimeMin ?? 0);
  if (!Number.isFinite(responseTimeMin) || responseTimeMin < 1 || responseTimeMin > 240) {
    reasons.push('invalid_response_time');
  }

  const cause = (raw.causeGuessMn ?? '').trim();
  if (cause.length < 3) {
    reasons.push('missing_cause');
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }

  const roundedLat = Number((lat as number).toFixed(5));
  const roundedLng = Number((lng as number).toFixed(5));

  return {
    ok: true,
    record: {
      id,
      date,
      monthKey: date.slice(0, 7),
      districtId,
      khorooNumber: khorooNum,
      category,
      severity,
      causeGuessMn: cause,
      responseTimeMin: Math.round(responseTimeMin),
      lat: roundedLat,
      lng: roundedLng,
      canonicalKey: canonicalIncidentKey({
        date,
        districtId,
        khorooNumber: khorooNum,
        lat: roundedLat,
        lng: roundedLng,
        category,
      }),
    },
  };
}

/**
 * Strictly separates verified real agency records (`dataOrigin === 'real'` and `!isDemo`)
 * from any demo/pilot test rows, deduplicates by canonical spatiotemporal key, and evaluates
 * minimum statistical readiness before ML model training is permitted.
 */
export function buildCleanTrainingDataset(
  records: RawIncidentCandidate[],
  maxDateIso: string = getUbDateIso()
): DatasetQualityReport {
  let realRowCount = 0;
  let excludedDemoCount = 0;
  let duplicateCount = 0;
  let rejectedCount = 0;
  const rejectionBreakdown: Record<string, number> = {};
  const seenKeys = new Set<string>();
  const cleanRows: NormalizedRealIncident[] = [];

  for (const row of records) {
    // Strict data-origin gate: NEVER allow demo or synthetic rows into training sets
    if (row.isDemo === true || row.dataOrigin !== 'real') {
      excludedDemoCount += 1;
      continue;
    }

    realRowCount += 1;
    const checked = validateRealIncidentRow(row, maxDateIso);
    if (!checked.ok) {
      rejectedCount += 1;
      for (const reason of checked.reasons) {
        rejectionBreakdown[reason] = (rejectionBreakdown[reason] ?? 0) + 1;
      }
      continue;
    }

    if (seenKeys.has(checked.record.canonicalKey)) {
      duplicateCount += 1;
      continue;
    }
    seenKeys.add(checked.record.canonicalKey);
    cleanRows.push(checked.record);
  }

  const panelMap = new Map<
    string,
    {
      khorooKey: string;
      districtId: string;
      khorooNumber: number;
      monthKey: string;
      incidentCount: number;
      criticalCount: number;
      gerCount: number;
      responseSum: number;
    }
  >();

  const districtSet = new Set<string>();
  const monthSet = new Set<string>();

  for (const row of cleanRows) {
    districtSet.add(row.districtId);
    monthSet.add(row.monthKey);
    const khorooKey = `${row.districtId}-${row.khorooNumber}`;
    const cellKey = `${khorooKey}|${row.monthKey}`;
    const prev = panelMap.get(cellKey);
    if (!prev) {
      panelMap.set(cellKey, {
        khorooKey,
        districtId: row.districtId,
        khorooNumber: row.khorooNumber,
        monthKey: row.monthKey,
        incidentCount: 1,
        criticalCount: row.severity === 'critical' ? 1 : 0,
        gerCount: row.category === 'residential_ger' ? 1 : 0,
        responseSum: row.responseTimeMin,
      });
    } else {
      prev.incidentCount += 1;
      if (row.severity === 'critical') prev.criticalCount += 1;
      if (row.category === 'residential_ger') prev.gerCount += 1;
      prev.responseSum += row.responseTimeMin;
    }
  }

  const panelRows: KhorooPeriodRow[] = Array.from(panelMap.values())
    .map((p) => ({
      khorooKey: p.khorooKey,
      districtId: p.districtId,
      khorooNumber: p.khorooNumber,
      monthKey: p.monthKey,
      incidentCount: p.incidentCount,
      criticalCount: p.criticalCount,
      gerCount: p.gerCount,
      avgResponseTimeMin: Math.round((p.responseSum / p.incidentCount) * 10) / 10,
    }))
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey) || a.khorooKey.localeCompare(b.khorooKey));

  const totalDistricts = UB_DISTRICTS.length;
  const districtCoveragePct = Math.round((districtSet.size / Math.max(1, totalDistricts)) * 100);

  const readyForTraining =
    cleanRows.length >= ML_READINESS_THRESHOLDS.minRealIncidents &&
    monthSet.size >= ML_READINESS_THRESHOLDS.minDistinctMonths &&
    districtCoveragePct >= ML_READINESS_THRESHOLDS.minDistrictCoveragePct;

  let readinessReasonMn: string;
  let readinessReasonEn: string;
  if (cleanRows.length === 0) {
    readinessReasonMn =
      'Бодит баталгаажсан (real) дуудлагын өгөгдөл 0 байна. Жишээ (demo) бичлэг ML сургалтад ордоггүй тул загвар хараахан сургагдаагүй.';
    readinessReasonEn =
      '0 verified real incident records present. Demo records are strictly excluded from ML datasets, so no predictive model is trained yet.';
  } else if (!readyForTraining) {
    readinessReasonMn =
      `Одоогоор ${cleanRows.length} цэвэр бодит бүртгэл (${monthSet.size} сар, ${districtCoveragePct}% дүүрэг) байна. Найдвартай сургалтад дор хаяж ${ML_READINESS_THRESHOLDS.minRealIncidents} бичлэг, ${ML_READINESS_THRESHOLDS.minDistinctMonths} сарын цуваа, ${ML_READINESS_THRESHOLDS.minDistrictCoveragePct}%+ хамрах хүрээ шаардлагатай.`;
    readinessReasonEn =
      `Only ${cleanRows.length} clean real records (${monthSet.size} months, ${districtCoveragePct}% districts). Minimum statistical readiness requires ${ML_READINESS_THRESHOLDS.minRealIncidents}+ records, ${ML_READINESS_THRESHOLDS.minDistinctMonths}+ distinct months, and ${ML_READINESS_THRESHOLDS.minDistrictCoveragePct}%+ district coverage.`;
  } else {
    readinessReasonMn = `Сургалтад бэлэн: ${cleanRows.length} бодит бичлэг (${monthSet.size} сар, ${districtCoveragePct}% дүүрэг).`;
    readinessReasonEn = `Ready for temporal holdout validation: ${cleanRows.length} verified records across ${monthSet.size} months (${districtCoveragePct}% district coverage).`;
  }

  return {
    realRowCount,
    cleanUniqueRealCount: cleanRows.length,
    excludedDemoCount,
    duplicateCount,
    rejectedCount,
    rejectionBreakdown,
    distinctDistricts: districtSet.size,
    totalDistricts,
    districtCoveragePct,
    distinctMonths: monthSet.size,
    panelRows,
    readyForTraining,
    readinessReasonMn,
    readinessReasonEn,
  };
}
