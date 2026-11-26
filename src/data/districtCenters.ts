export interface DistrictGeoSeed {
  id: string;
  nameMn: string;
  nameEn: string;
  lat: number;
  lng: number;
}

export const UB_DISTRICT_SEEDS: DistrictGeoSeed[] = [
  { id: 'bayanzurkh', nameMn: 'Баянзүрх', nameEn: 'Bayanzurkh', lat: 47.9231, lng: 106.9936 },
  { id: 'songinokhairkhan', nameMn: 'Сонгинохайрхан', nameEn: 'Songinokhairkhan', lat: 47.9348, lng: 106.8012 },
  { id: 'chingeltei', nameMn: 'Чингэлтэй', nameEn: 'Chingeltei', lat: 47.9516, lng: 106.9062 },
  { id: 'sukhbaatar', nameMn: 'Сүхбаатар', nameEn: 'Sukhbaatar', lat: 47.9397, lng: 106.9242 },
  { id: 'khan-uul', nameMn: 'Хан-Уул', nameEn: 'Khan-Uul', lat: 47.8824, lng: 106.8781 },
  { id: 'bayangol', nameMn: 'Баянгол', nameEn: 'Bayangol', lat: 47.9128, lng: 106.8752 },
  { id: 'nalaikh', nameMn: 'Налайх', nameEn: 'Nalaikh', lat: 47.7689, lng: 107.2602 },
  { id: 'baganuur', nameMn: 'Багануур', nameEn: 'Baganuur', lat: 47.7834, lng: 108.3489 },
  { id: 'bagakhangai', nameMn: 'Багахангай', nameEn: 'Bagakhangai', lat: 47.3418, lng: 107.4847 },
];

export const UB_DISTRICT_SEED_MAP = new Map<string, DistrictGeoSeed>(
  UB_DISTRICT_SEEDS.map((seed) => [seed.id, seed])
);

export const UB_DISTRICT_COORDS_MAP: Record<string, [number, number]> = Object.fromEntries(
  UB_DISTRICT_SEEDS.map((seed) => [seed.id, [seed.lat, seed.lng]])
);
