import type { ActiveTab } from '../types';

export type AudienceRole = 'citizen' | 'fire_command' | 'police';

export const AUDIENCE_STORAGE_KEY = 'firewatch_audience_v1';

export interface AudienceProfile {
  id: AudienceRole;
  icon: string;
  labelMn: string;
  labelEn: string;
  promiseMn: string;
  promiseEn: string;
  ctaMn: string;
  ctaEn: string;
  ctaTab: ActiveTab;
  mainTabs: ActiveTab[];
}

export const AUDIENCE_PROFILES: Record<AudienceRole, AudienceProfile> = {
  citizen: {
    id: 'citizen',
    icon: '🏠',
    labelMn: 'Иргэн',
    labelEn: 'Citizen',
    promiseMn: 'Миний хороо эрсдэлтэй юу, гэртээ одоо юу хийх вэ?',
    promiseEn: 'Is my khoroo at risk today, and what 3 steps should my home take?',
    ctaMn: 'Миний хорооны эрсдэлийг харах',
    ctaEn: "Check my khoroo's risk",
    ctaTab: 'map',
    mainTabs: ['citizen', 'map', 'personal', 'safety'],
  },
  fire_command: {
    id: 'fire_command',
    icon: '🚒',
    labelMn: 'Гал команд',
    labelEn: 'Fire command',
    promiseMn: 'Дүүргүүдийн эрсдэл, ангийн хүртээмж, тайлан ба өгөгдөл шинэчлэх.',
    promiseEn: 'District status, station coverage, exports, and verified data import.',
    ctaMn: 'Дүүргийн төлөв ба тайлан',
    ctaEn: 'District status & reports',
    ctaTab: 'districts',
    mainTabs: ['overview', 'map', 'districts', 'reports'],
  },
  police: {
    id: 'police',
    icon: '🚓',
    labelMn: 'Цагдаа',
    labelEn: 'Police',
    promiseMn: 'Ажлын хэрэгцээ батлагдаагүй тул зөвхөн үндсэн зураг, холбоо харагдана.',
    promiseEn: 'Operational needs unconfirmed — links to core map and contacts.',
    ctaMn: 'Мэдээлэл ба холбоо',
    ctaEn: 'Overview & contacts',
    ctaTab: 'police',
    mainTabs: ['citizen', 'map', 'police', 'safety'],
  },
};

export const ALL_TAB_METADATA: Record<
  ActiveTab,
  { shortMn: string; shortEn: string; fullMn: string; fullEn: string; icon: string }
> = {
  citizen: { shortMn: 'Хороо шалгах', shortEn: 'Check Risk', fullMn: 'Миний хорооны эрсдэл (Нүүр)', fullEn: 'My Khoroo Risk (Home)', icon: '🏠' },
  landing: { shortMn: 'Тухай', shortEn: 'About', fullMn: 'Төслийн тухай (Танилцуулга)', fullEn: 'About FIREWATCH UB', icon: 'ℹ️' },
  overview: { shortMn: 'Тойм', shortEn: 'Overview', fullMn: 'Нийслэлийн тойм самбар', fullEn: 'City Overview', icon: '📈' },
  map: { shortMn: 'Зураг', shortEn: 'Map', fullMn: 'Галын эрсдэлийн зураг', fullEn: 'Fire Risk Map', icon: '🗺️' },
  personal: { shortMn: 'Миний гэр', shortEn: 'My Home', fullMn: 'Миний гэр ба аудит', fullEn: 'My Home & Audit', icon: '👤' },
  safety: { shortMn: 'Зөвлөмж', shortEn: 'Safety', fullMn: 'Аюулгүй байдлын зөвлөмж', fullEn: 'Safety Guidelines', icon: '🛡️' },
  districts: { shortMn: 'Дүүрэг', shortEn: 'Districts', fullMn: 'Дүүргүүдийн харьцуулалт', fullEn: 'District Analysis', icon: '🏙️' },
  reports: { shortMn: 'Тайлан', shortEn: 'Reports', fullMn: 'Тайлан ба экспорт', fullEn: 'Report Center', icon: '📄' },
  explorer: { shortMn: 'Шинжилгээ', shortEn: 'Explorer', fullMn: 'Эрсдэлийн томьёо & симулятор', fullEn: 'Risk Explorer & Lab', icon: '📊' },
  incidents: { shortMn: 'Дуудлага', shortEn: 'Incidents', fullMn: 'Түүхэн дуудлага', fullEn: 'Historical Incidents', icon: '📍' },
  calendar: { shortMn: 'Хуанли', shortEn: 'Calendar', fullMn: '12 сарын хуанли', fullEn: '12-Month Calendar', icon: '📅' },
  emergency: { shortMn: 'Ангиуд', shortEn: 'Stations', fullMn: 'Гал унтраах ангиуд', fullEn: 'Fire Stations', icon: '🚒' },
  weather: { shortMn: 'Цаг агаар', shortEn: 'Weather', fullMn: 'Цаг агаар ба хуурайшилт', fullEn: 'Live Weather', icon: '🌤️' },
  sources: { shortMn: 'Эх сурвалж', shortEn: 'Sources', fullMn: 'Өгөгдлийн эх сурвалж', fullEn: 'Data Sources & Admin', icon: 'ℹ️' },
  police: { shortMn: 'Цагдаа', shortEn: 'Police', fullMn: 'Цагдаагийн байгууллагын хуудас', fullEn: 'Police Coordination Placeholder', icon: '🚓' },
};

const ALL_ORDERED_TABS: ActiveTab[] = [
  'citizen',
  'map',
  'overview',
  'districts',
  'personal',
  'safety',
  'reports',
  'explorer',
  'emergency',
  'incidents',
  'calendar',
  'weather',
  'sources',
  'landing',
  'police',
];

export function isAudienceRole(val: unknown): val is AudienceRole {
  return val === 'citizen' || val === 'fire_command' || val === 'police';
}

export function readSavedAudience(): AudienceRole {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(AUDIENCE_STORAGE_KEY) : null;
    if (isAudienceRole(raw)) return raw;
  } catch {
    // Ignore storage restriction errors
  }
  return 'citizen';
}

export function saveAudience(role: AudienceRole): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(AUDIENCE_STORAGE_KEY, role);
    }
  } catch {
    // Ignore storage quota/privacy mode errors
  }
}

export function getSecondaryTabsForAudience(role: AudienceRole): ActiveTab[] {
  const mainSet = new Set(AUDIENCE_PROFILES[role].mainTabs);
  return ALL_ORDERED_TABS.filter((tab) => !mainSet.has(tab));
}
