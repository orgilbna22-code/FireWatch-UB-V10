import { useEffect, useState } from 'react';
import { IncidentRecord } from '../types';
import {
  MODELLED_KHOROO_COUNT,
  TOTAL_KHOROO_COUNT,
  UB_DISTRICTS,
} from '../data/ubGeoData';
import { PROJECT_MAINTAINER } from '../data/emergencyContacts';

export type DatasetSourceMode = 'combined' | 'imported' | 'demo';

const DATASET_MODE_KEY = 'firewatch_dataset_mode';
const PILOT_PARTNER_KEY = 'firewatch_pilot_partner';
const SETTINGS_EVENT = 'firewatch:command-settings-changed';

function isValidMode(v: unknown): v is DatasetSourceMode {
  return v === 'combined' || v === 'imported' || v === 'demo';
}

export function readDatasetSourceMode(): DatasetSourceMode {
  try {
    const raw = window.localStorage.getItem(DATASET_MODE_KEY);
    return isValidMode(raw) ? raw : 'combined';
  } catch {
    return 'combined';
  }
}

export function saveDatasetSourceMode(mode: DatasetSourceMode): void {
  try {
    window.localStorage.setItem(DATASET_MODE_KEY, mode);
  } catch {
    // ignore storage errors in restricted contexts
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SETTINGS_EVENT));
  }
}

export function readPilotPartnerName(): string {
  try {
    const raw = window.localStorage.getItem(PILOT_PARTNER_KEY);
    return raw ? raw.trim().slice(0, 120) : '';
  } catch {
    return '';
  }
}

export function savePilotPartnerName(name: string): void {
  try {
    const cleaned = name.trim().slice(0, 120);
    if (cleaned) {
      window.localStorage.setItem(PILOT_PARTNER_KEY, cleaned);
    } else {
      window.localStorage.removeItem(PILOT_PARTNER_KEY);
    }
  } catch {
    // ignore storage errors
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SETTINGS_EVENT));
  }
}

export function getEffectivePilotPartner(language: 'mn' | 'en', customName?: string): {
  label: string;
  isConfigured: boolean;
} {
  const cleaned = (customName ?? '').trim();
  if (cleaned) {
    return { label: cleaned, isConfigured: true };
  }
  return {
    label: language === 'mn' ? PROJECT_MAINTAINER.pilotPartnerNameMn : PROJECT_MAINTAINER.pilotPartnerNameEn,
    isConfigured: false,
  };
}

export function useFireCommandSettings() {
  const [datasetMode, setDatasetMode] = useState<DatasetSourceMode>(() => readDatasetSourceMode());
  const [pilotPartner, setPilotPartner] = useState<string>(() => readPilotPartnerName());

  useEffect(() => {
    const sync = () => {
      setDatasetMode(readDatasetSourceMode());
      setPilotPartner(readPilotPartnerName());
    };
    window.addEventListener(SETTINGS_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(SETTINGS_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return {
    datasetMode,
    pilotPartner,
    updateDatasetMode: (mode: DatasetSourceMode) => {
      saveDatasetSourceMode(mode);
      setDatasetMode(mode);
    },
    updatePilotPartner: (name: string) => {
      savePilotPartnerName(name);
      setPilotPartner(name.trim().slice(0, 120));
    },
  };
}

export interface IncidentQualitySummary {
  importedCount: number;
  demoBaselineCount: number;
  missingCoordsCount: number;
  unknownCauseCount: number;
  distinctDistrictsCovered: number;
  totalDistricts: number;
  curatedKhoroos: number;
  modelledKhoroos: number;
  totalKhoroos: number;
  metadataReadinessPct: number;
}

const VALID_UB_LAT_MIN = 46;
const VALID_UB_LAT_MAX = 50;
const VALID_UB_LNG_MIN = 104;
const VALID_UB_LNG_MAX = 111;

export interface QualityCheckableRecord {
  districtId: string;
  causeGuessMn?: string;
  lat?: number;
  lng?: number;
  coordinates?: [number, number];
}

export function computeCommandDataQuality(
  importedRows: QualityCheckableRecord[],
  demoRows: QualityCheckableRecord[]
): IncidentQualitySummary {
  const inspectSet: QualityCheckableRecord[] = importedRows.length > 0 ? importedRows : demoRows;
  let missingCoordsCount = 0;
  let unknownCauseCount = 0;
  const districtSet = new Set<string>();

  for (const row of inspectSet) {
    const lat = typeof row.lat === 'number' ? row.lat : row.coordinates?.[0];
    const lng = typeof row.lng === 'number' ? row.lng : row.coordinates?.[1];
    const coordsValid =
      typeof lat === 'number' &&
      typeof lng === 'number' &&
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= VALID_UB_LAT_MIN &&
      lat <= VALID_UB_LAT_MAX &&
      lng >= VALID_UB_LNG_MIN &&
      lng <= VALID_UB_LNG_MAX;

    if (!coordsValid) missingCoordsCount += 1;

    const cause = (row.causeGuessMn ?? '').trim().toLowerCase();
    if (cause.length < 4 || cause.includes('unknown') || cause.includes('тодорхойгүй')) {
      unknownCauseCount += 1;
    }

    if (row.districtId) {
      districtSet.add(row.districtId);
    }
  }

  const curatedKhoroos = TOTAL_KHOROO_COUNT - MODELLED_KHOROO_COUNT;
  const totalChecked = Math.max(1, inspectSet.length);
  const coordRatio = (totalChecked - missingCoordsCount) / totalChecked;
  const causeRatio = (totalChecked - unknownCauseCount) / totalChecked;
  const districtRatio = Math.min(1, districtSet.size / Math.max(1, UB_DISTRICTS.length));
  const khorooRatio = curatedKhoroos / Math.max(1, TOTAL_KHOROO_COUNT);

  const metadataReadinessPct = Math.round(
    (coordRatio * 0.35 + causeRatio * 0.25 + districtRatio * 0.2 + khorooRatio * 0.2) * 100
  );

  return {
    importedCount: importedRows.length,
    demoBaselineCount: demoRows.length,
    missingCoordsCount,
    unknownCauseCount,
    distinctDistrictsCovered: districtSet.size,
    totalDistricts: UB_DISTRICTS.length,
    curatedKhoroos,
    modelledKhoroos: MODELLED_KHOROO_COUNT,
    totalKhoroos: TOTAL_KHOROO_COUNT,
    metadataReadinessPct,
  };
}
