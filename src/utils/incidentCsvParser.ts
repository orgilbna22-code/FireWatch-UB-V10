import { canonicalIncidentKey, UB_GEO_BOUNDS } from './mlDataFoundation';
import { getUbDateIso } from './ubTime';
import type { IncidentRecord } from '../types';

export interface ParsedCsvImportRow {
  rowIndex: number;
  id: string;
  date: string;
  districtId: string;
  khorooNumber: number;
  category: IncidentRecord['category'];
  severity: IncidentRecord['severity'];
  causeGuessMn: string;
  causeGuessEn: string;
  responseTimeMin: number;
  lat: number;
  lng: number;
  source: string;
  dataOrigin: 'real';
  canonicalKey: string;
}

export interface RejectedImportRow {
  rowIndex: number;
  reasons: string[];
  snippet: string;
}

export interface CsvParseReport {
  format: 'csv' | 'json';
  totalRows: number;
  validRows: ParsedCsvImportRow[];
  rejectedRows: RejectedImportRow[];
  duplicateInBatchCount: number;
  piiRejectedCount: number;
  detectedColumns: string[];
  mappedFields: Record<string, string>;
}

const DISTRICT_MAX_KHOROO: Record<string, number> = {
  bayanzurkh: 43,
  songinokhairkhan: 43,
  sukhbaatar: 20,
  chingeltei: 24,
  'khan-uul': 25,
  bayangol: 34,
  nalaikh: 8,
  baganuur: 5,
  bagakhangai: 2,
};

const DISTRICT_ALIAS_MAP: Record<string, string> = {
  bayanzurkh: 'bayanzurkh',
  баянзүрх: 'bayanzurkh',
  бзд: 'bayanzurkh',
  bzd: 'bayanzurkh',
  songinokhairkhan: 'songinokhairkhan',
  сонгинохайрхан: 'songinokhairkhan',
  схд: 'songinokhairkhan',
  shd: 'songinokhairkhan',
  skhd: 'songinokhairkhan',
  sukhbaatar: 'sukhbaatar',
  сүхбаатар: 'sukhbaatar',
  сбд: 'sukhbaatar',
  sbd: 'sukhbaatar',
  chingeltei: 'chingeltei',
  чингэлтэй: 'chingeltei',
  чд: 'chingeltei',
  chd: 'chingeltei',
  'khan-uul': 'khan-uul',
  khanuul: 'khan-uul',
  'хан-уул': 'khan-uul',
  хануул: 'khan-uul',
  худ: 'khan-uul',
  khu: 'khan-uul',
  hud: 'khan-uul',
  bayangol: 'bayangol',
  баянгол: 'bayangol',
  бгд: 'bayangol',
  bgd: 'bayangol',
  nalaikh: 'nalaikh',
  налайх: 'nalaikh',
  нд: 'nalaikh',
  baganuur: 'baganuur',
  багануур: 'baganuur',
  бнд: 'baganuur',
  bagakhangai: 'bagakhangai',
  багахангай: 'bagakhangai',
  бхд: 'bagakhangai',
};

const CATEGORY_ALIAS_MAP: Record<string, IncidentRecord['category']> = {
  residential_ger: 'residential_ger',
  ger: 'residential_ger',
  гэр: 'residential_ger',
  'гэр хороолол': 'residential_ger',
  гэр_хороолол: 'residential_ger',
  residential_apt: 'residential_apt',
  apartment: 'residential_apt',
  apt: 'residential_apt',
  'орон сууц': 'residential_apt',
  орон_сууц: 'residential_apt',
  commercial: 'commercial',
  business: 'commercial',
  аж_ахуй: 'commercial',
  'аж ахуй': 'commercial',
  үйлдвэр: 'commercial',
  grass_forest: 'grass_forest',
  wildfire: 'grass_forest',
  forest: 'grass_forest',
  ой: 'grass_forest',
  өвс: 'grass_forest',
  'ой хээр': 'grass_forest',
  electrical: 'electrical',
  electric: 'electrical',
  цахилгаан: 'electrical',
};

const SEVERITY_ALIAS_MAP: Record<string, IncidentRecord['severity']> = {
  minor: 'minor',
  low: 'minor',
  хөнгөн: 'minor',
  бага: 'minor',
  moderate: 'moderate',
  medium: 'moderate',
  дунд: 'moderate',
  critical: 'critical',
  high: 'critical',
  severe: 'critical',
  хүнд: 'critical',
  ноцтой: 'critical',
};

const HEADER_ALIASES: Record<string, string[]> = {
  id: ['id', 'incident_id', 'call_id', 'код', 'дугаар', 'record_id'],
  date: ['date', 'incident_date', 'occurred_at', 'timestamp', 'огноо', 'өдөр'],
  districtId: ['districtid', 'district_id', 'district', 'дүүрэг', 'duureg'],
  khorooNumber: ['khoroonumber', 'khoroo_number', 'khoroo', 'khoroo_no', 'хороо'],
  category: ['category', 'type', 'fire_type', 'ангилал', 'төрөл'],
  severity: ['severity', 'level', 'ноцтой_байдал', 'зэрэг', 'зэрэглэл'],
  causeGuessMn: ['causeguessmn', 'cause_mn', 'cause', 'description', 'cause_guess', 'шалтгаан', 'тайлбар'],
  causeGuessEn: ['causeguessen', 'cause_en', 'description_en'],
  responseTimeMin: ['responsetimemin', 'response_time_min', 'response_min', 'eta_min', 'хүрэх_хугацаа', 'хугацаа'],
  lat: ['lat', 'latitude', 'y', 'өргөрөг'],
  lng: ['lng', 'lon', 'longitude', 'x', 'уртраг'],
  source: ['source', 'agency', 'эх_үүсвэр', 'эх_сурвалж'],
};

const PHONE_PII_RE = /(?<!\d)(?:9\d{7}|8\d{7}|7\d{7})(?!\d)/;
const NATIONAL_ID_PII_RE = /[А-ЯӨҮЁ]{2}\d{8}/u;
const EMAIL_PII_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

export function containsCitizenPii(text: string): boolean {
  if (!text) return false;
  return PHONE_PII_RE.test(text) || NATIONAL_ID_PII_RE.test(text) || EMAIL_PII_RE.test(text);
}

function detectDelimiter(headerLine: string): ',' | ';' | '\t' {
  const counts = {
    ',': (headerLine.match(/,/g) || []).length,
    ';': (headerLine.match(/;/g) || []).length,
    '\t': (headerLine.match(/\t/g) || []).length,
  };
  if (counts[';'] > counts[','] && counts[';'] >= counts['\t']) return ';';
  if (counts['\t'] > counts[','] && counts['\t'] >= counts[';']) return '\t';
  return ',';
}

/**
 * RFC-4180 compliant CSV tokenizer supporting quoted commas, newlines inside quotes,
 * doubled quotes (`""`), and UTF-8 BOM stripping.
 */
export function parseRfc4180Csv(rawText: string): string[][] {
  const text = rawText.replace(/^\uFEFF/, '');
  const firstBreak = text.search(/\r?\n/);
  const firstLine = firstBreak === -1 ? text : text.slice(0, firstBreak);
  const delim = detectDelimiter(firstLine);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field.trim());
      field = '';
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i += 1;
      row.push(field.trim());
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\n') {
      row.push(field.trim());
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  row.push(field.trim());
  if (row.some((cell) => cell !== '')) rows.push(row);
  return rows;
}

function normalizeHeaderName(h: string): string {
  return h.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function resolveCanonicalField(headerCell: string): string | null {
  const norm = normalizeHeaderName(headerCell);
  const normCompact = norm.replace(/_/g, '');
  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) {
      if (norm === alias || normCompact === alias.replace(/_/g, '')) {
        return canonical;
      }
    }
  }
  return null;
}

function normalizeDateIso(raw: string): string | null {
  const trimmed = raw.trim();
  const isoMatch = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(trimmed);
  if (!isoMatch) return null;
  const y = Number(isoMatch[1]);
  const m = Number(isoMatch[2]);
  const d = Number(isoMatch[3]);
  if (y < 2015 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function validateAndNormalizeImportRecords(
  rawObjects: Array<{ rowIndex: number; fields: Record<string, unknown> }>,
  options: {
    format: 'csv' | 'json';
    defaultSource?: string;
    maxDateIso?: string;
    detectedColumns?: string[];
    mappedFields?: Record<string, string>;
  }
): CsvParseReport {
  const maxDateIso = options.maxDateIso ?? getUbDateIso();
  const defaultSource = options.defaultSource?.trim().slice(0, 32) || 'agency-csv';
  const validRows: ParsedCsvImportRow[] = [];
  const rejectedRows: RejectedImportRow[] = [];
  const seenKeys = new Set<string>();
  let duplicateInBatchCount = 0;
  let piiRejectedCount = 0;

  for (const entry of rawObjects) {
    const f = entry.fields;
    const reasons: string[] = [];

    const combinedText = [
      String(f.causeGuessMn ?? ''),
      String(f.causeGuessEn ?? ''),
      String(f.source ?? ''),
      String(f.address ?? ''),
    ].join(' ');
    if (containsCitizenPii(combinedText)) {
      piiRejectedCount += 1;
      rejectedRows.push({
        rowIndex: entry.rowIndex,
        reasons: ['contains_pii_phone_or_id'],
        snippet: String(f.causeGuessMn ?? '').slice(0, 60),
      });
      continue;
    }

    const rawDate = String(f.date ?? '');
    const date = normalizeDateIso(rawDate);
    if (!date || date > maxDateIso) {
      reasons.push('invalid_or_future_date');
    }

    const districtRaw = String(f.districtId ?? '').trim().toLowerCase();
    const districtId = DISTRICT_ALIAS_MAP[districtRaw] ?? '';
    const maxKhoroo = DISTRICT_MAX_KHOROO[districtId];
    if (!districtId || !maxKhoroo) {
      reasons.push('invalid_district');
    }

    const khDigits = String(f.khorooNumber ?? '').replace(/[^\d]/g, '');
    const khorooNum = khDigits ? Number(khDigits) : Number(f.khorooNumber);
    if (!Number.isInteger(khorooNum) || khorooNum < 1 || (maxKhoroo && khorooNum > maxKhoroo)) {
      reasons.push('invalid_khoroo');
    }

    const catRaw = String(f.category ?? '').trim().toLowerCase();
    const category = CATEGORY_ALIAS_MAP[catRaw];
    if (!category) {
      reasons.push('invalid_category');
    }

    const sevRaw = String(f.severity ?? '').trim().toLowerCase();
    const severity = SEVERITY_ALIAS_MAP[sevRaw];
    if (!severity) {
      reasons.push('invalid_severity');
    }

    // Strict coordinate validation: NEVER silently fallback missing/bad coords to district centroid!
    const latNum = typeof f.lat === 'number' ? f.lat : Number(String(f.lat ?? '').trim());
    const lngNum = typeof f.lng === 'number' ? f.lng : Number(String(f.lng ?? '').trim());
    if (
      String(f.lat ?? '').trim() === '' ||
      String(f.lng ?? '').trim() === '' ||
      !Number.isFinite(latNum) ||
      !Number.isFinite(lngNum) ||
      latNum < UB_GEO_BOUNDS.latMin ||
      latNum > UB_GEO_BOUNDS.latMax ||
      lngNum < UB_GEO_BOUNDS.lngMin ||
      lngNum > UB_GEO_BOUNDS.lngMax
    ) {
      reasons.push('invalid_or_out_of_bounds_coordinates');
    }

    const respNum = Number(String(f.responseTimeMin ?? '').trim());
    if (!Number.isFinite(respNum) || respNum < 1 || respNum > 240) {
      reasons.push('invalid_response_time_min');
    }

    const causeMn = String(f.causeGuessMn ?? '').trim().slice(0, 180);
    if (causeMn.length < 3) {
      reasons.push('missing_cause_description');
    }

    if (reasons.length > 0) {
      rejectedRows.push({
        rowIndex: entry.rowIndex,
        reasons,
        snippet: `${rawDate} | ${String(f.districtId ?? '')} | ${causeMn}`.slice(0, 80),
      });
      continue;
    }

    const roundedLat = +latNum.toFixed(5);
    const roundedLng = +lngNum.toFixed(5);
    const canonicalKey = canonicalIncidentKey({
      date: date!,
      districtId,
      khorooNumber: khorooNum,
      lat: roundedLat,
      lng: roundedLng,
      category: category!,
    });

    if (seenKeys.has(canonicalKey)) {
      duplicateInBatchCount += 1;
      continue;
    }
    seenKeys.add(canonicalKey);

    const rawId = String(f.id ?? '').trim().replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 64);
    const id = rawId || `real-${date}-${districtId.slice(0, 4)}-${khorooNum}-${validRows.length + 1}`;
    const source = String(f.source ?? defaultSource).trim().slice(0, 32) || defaultSource;
    const causeEn = String(f.causeGuessEn ?? '').trim().slice(0, 180) || causeMn;

    validRows.push({
      rowIndex: entry.rowIndex,
      id,
      date: date!,
      districtId,
      khorooNumber: khorooNum,
      category: category!,
      severity: severity!,
      causeGuessMn: causeMn,
      causeGuessEn: causeEn,
      responseTimeMin: Math.round(respNum),
      lat: roundedLat,
      lng: roundedLng,
      source,
      dataOrigin: 'real',
      canonicalKey,
    });
  }

  return {
    format: options.format,
    totalRows: rawObjects.length,
    validRows,
    rejectedRows,
    duplicateInBatchCount,
    piiRejectedCount,
    detectedColumns: options.detectedColumns ?? [],
    mappedFields: options.mappedFields ?? {},
  };
}

export function parseCsvRealIncidents(
  csvText: string,
  options: { defaultSource?: string; maxDateIso?: string } = {}
): CsvParseReport {
  const matrix = parseRfc4180Csv(csvText);
  if (matrix.length < 2) {
    return {
      format: 'csv',
      totalRows: 0,
      validRows: [],
      rejectedRows:
        matrix.length === 1
          ? [{ rowIndex: 1, reasons: ['missing_data_rows'], snippet: matrix[0].join(', ') }]
          : [],
      duplicateInBatchCount: 0,
      piiRejectedCount: 0,
      detectedColumns: matrix[0] ?? [],
      mappedFields: {},
    };
  }

  const headers = matrix[0];
  const mappedFields: Record<string, string> = {};
  const colToCanonical: Array<string | null> = headers.map((h) => {
    const target = resolveCanonicalField(h);
    if (target) mappedFields[h] = target;
    return target;
  });

  const rawObjects = matrix.slice(1).map((cells, idx) => {
    const fields: Record<string, unknown> = {};
    for (let c = 0; c < headers.length; c++) {
      const target = colToCanonical[c];
      if (target) {
        fields[target] = cells[c] ?? '';
      }
    }
    return { rowIndex: idx + 2, fields };
  });

  return validateAndNormalizeImportRecords(rawObjects, {
    format: 'csv',
    defaultSource: options.defaultSource,
    maxDateIso: options.maxDateIso,
    detectedColumns: headers,
    mappedFields,
  });
}

export const NEMA_CSV_TEMPLATE = [
  'date,district,khoroo,category,severity,cause,response_time_min,lat,lng,source',
  '2025-11-18,bayanzurkh,27,residential_ger,critical,Яндангийн цонолт болон ханын халсан хэсэг,11,47.9408,107.0112,NEMA-UB',
  '2025-12-04,songinokhairkhan,24,electrical,moderate,Цахилгаан халаагуурын богино холболт,13,47.9452,106.7875,NEMA-UB',
].join('\n');
