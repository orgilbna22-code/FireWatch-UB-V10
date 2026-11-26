import type { DistrictData, KhorooData } from '../types';
import {
  clamp,
  clampPointInsidePolygon,
  computeSynthesizedKhorooScore,
  riskLevelFromScore,
} from '../utils/riskEngine';
import { UB_MEDIA } from './ubMediaAssets';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const ROAD_LEVELS: KhorooData['roadAccessibility'][] = ['Сайн', 'Дунд', 'Муу', 'Маш муу'];

const PREFIX_SHORT: Record<string, string> = {
  bayanzurkh: 'bzd',
  songinokhairkhan: 'shd',
  chingeltei: 'chd',
  sukhbaatar: 'sbd',
  'khan-uul': 'hud',
  bayangol: 'bgd',
  nalaikh: 'nlh',
  baganuur: 'bgn',
  bagakhangai: 'bkh',
};

export function synthesizeKhoroos(
  districts: DistrictData[],
  curatedKhoroos: KhorooData[]
): KhorooData[] {
  const existingKeys = new Set(
    curatedKhoroos.map((k) => `${k.districtId}-${k.khorooNumber}`)
  );

  const generated: KhorooData[] = [];

  for (const dist of districts) {
    const prefix = PREFIX_SHORT[dist.id] ?? dist.id.slice(0, 3);
    const rng = mulberry32(hashSeed(`firewatch-${dist.id}`));
    const avgPopPerKhoroo = Math.max(2200, Math.round(dist.population / Math.max(1, dist.khoroosCount)));

    // Compute geographic span inside polygon bounding box
    let minLat = dist.center[0] - 0.025;
    let maxLat = dist.center[0] + 0.025;
    let minLng = dist.center[1] - 0.035;
    let maxLng = dist.center[1] + 0.035;
    if (dist.polygon.length >= 3) {
      minLat = Math.min(...dist.polygon.map((p) => p[0]));
      maxLat = Math.max(...dist.polygon.map((p) => p[0]));
      minLng = Math.min(...dist.polygon.map((p) => p[1]));
      maxLng = Math.max(...dist.polygon.map((p) => p[1]));
    }
    const latSpan = (maxLat - minLat) * 0.72;
    const lngSpan = (maxLng - minLng) * 0.72;

    for (let num = 1; num <= dist.khoroosCount; num++) {
      const key = `${dist.id}-${num}`;
      if (existingKeys.has(key)) continue;

      const angle = (num / Math.max(1, dist.khoroosCount)) * Math.PI * 2 + rng() * 0.55;
      const radial = 0.22 + rng() * 0.72;
      const rawLat = dist.center[0] + Math.sin(angle) * latSpan * 0.5 * radial;
      const rawLng = dist.center[1] + Math.cos(angle) * lngSpan * 0.5 * radial;
      const clampedCenter = clampPointInsidePolygon(rawLat, rawLng, dist.polygon, dist.center);

      const gerHouseholdPercent = Math.round(
        clamp(dist.gerHouseholdPercent + (rng() - 0.5) * 38, 4, 96)
      );
      const apartmentHouseholdPercent = 100 - gerHouseholdPercent;

      const population = Math.round(clamp(avgPopPerKhoroo * (0.65 + rng() * 0.7), 1800, 26000));
      const households = Math.max(450, Math.round(population / 3.7));

      const roadAccessibility: KhorooData['roadAccessibility'] =
        gerHouseholdPercent >= 78
          ? rng() > 0.45
            ? 'Маш муу'
            : 'Муу'
          : gerHouseholdPercent >= 45
          ? rng() > 0.5
            ? 'Муу'
            : 'Дунд'
          : rng() > 0.35
          ? 'Сайн'
          : 'Дунд';

      const roadTier = ROAD_LEVELS.indexOf(roadAccessibility);
      const fireHydrantCount = Math.max(
        1,
        Math.round(clamp(12 - gerHouseholdPercent / 10 - roadTier * 1.4 + (rng() - 0.5) * 3, 1, 16))
      );
      const avgResponseTimeMin = Math.round(
        clamp(dist.nearestStationDistKm * 2.1 + roadTier * 2.2 + rng() * 3, 4, 24)
      );

      const rawSynth = computeSynthesizedKhorooScore({
        gerHouseholdPercent,
        roadAccessibility,
        fireHydrantCount,
        avgResponseTimeMin,
        population,
      });
      // Anchor lightly toward parent district heuristic baseline while preserving variance
      const riskScore = Math.round(clamp(rawSynth * 0.65 + dist.riskScore * 0.35, 14, 95));

      const historicalIncidents2024_2026 = Math.max(
        2,
        Math.round((dist.historicalIncidentsCount / Math.max(1, dist.khoroosCount)) * (0.45 + (riskScore / 100) * 1.1))
      );

      const photoUrl =
        gerHouseholdPercent >= 65
          ? UB_MEDIA.ger
          : gerHouseholdPercent >= 30
          ? UB_MEDIA.mixed
          : UB_MEDIA.apartment;

      generated.push({
        id: `${prefix}-${num}`,
        districtId: dist.id,
        khorooNumber: num,
        nameMn: `${num}-р хороо`,
        nameEn: `Khoroo ${num}`,
        center: clampedCenter,
        population,
        households,
        gerHouseholdPercent,
        apartmentHouseholdPercent,
        riskScore,
        riskLevel: riskLevelFromScore(riskScore),
        primaryRiskFactorMn:
          gerHouseholdPercent >= 65
            ? 'Зуух, хатуу түлш ба хашааны нягтрал (загварчилсан)'
            : gerHouseholdPercent >= 30
            ? 'Холимог суурьшил ба шөнийн цахилгаан ачаалал (загварчилсан)'
            : 'Орон сууцны цахилгаан ба замын хөдөлгөөний саад (загварчилсан)',
        primaryRiskFactorEn:
          gerHouseholdPercent >= 65
            ? 'Solid-fuel stoves & dense yard plots (modelled estimate)'
            : gerHouseholdPercent >= 30
            ? 'Mixed housing & peak winter electrical load (modelled estimate)'
            : 'Apartment wiring load & courtyard access (modelled estimate)',
        fireHydrantCount,
        roadAccessibility,
        avgResponseTimeMin,
        historicalIncidents2024_2026,
        photoUrl,
        landmarksMn: [`${dist.nameMn} дүүргийн ${num}-р хорооны төв хэсэг`],
        landmarksEn: [`${dist.nameEn} District Khoroo ${num} Sector`],
        isModelled: true,
        locationConfidence: 'synthetic_offset',
      });
    }
  }

  return generated;
}
