import type {
  DistrictData,
  DistrictWeatherSnapshot,
  FactorContribution,
  KhorooData,
  MlModelArtifact,
  PublicHeatCluster,
  RiskLevel,
  RiskModelWeights,
  ThreeAxisRiskProfile,
} from '../types';

export interface SpatialHeatPoint {
  lat: number;
  lng: number;
  score: number;
  radiusMeters: number;
  label?: string;
  labelValue?: string;
  isModelled?: boolean;
}

export interface HeatSampleResult {
  score: number | null;
  confidence: 'high' | 'moderate' | 'low' | 'none';
  nearestPoint: SpatialHeatPoint | null;
  distanceKm: number | null;
}

export interface FireWeatherBreakdown {
  ignitionReceptivity: number;
  spreadPotential: number;
  fireWeatherIndex: number;
  dominantDriver: 'dryness' | 'wind' | 'balanced' | 'moisture';
}

export const DEFAULT_MODEL_WEIGHTS: RiskModelWeights = {
  incidentHistoryWeight: 0.30,
  populationDensityWeight: 0.20,
  stationProximityWeight: 0.15,
  gerProportionWeight: 0.15,
  roadAccessibilityWeight: 0.10,
  seasonalWeatherWeight: 0.10,
};

export const RISK_THRESHOLDS = {
  very_high: 75,
  high: 55,
  moderate: 35,
  low: 0,
} as const;

export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export function riskLevelFromScore(score: number): RiskLevel {
  if (score >= RISK_THRESHOLDS.very_high) return 'very_high';
  if (score >= RISK_THRESHOLDS.high) return 'high';
  if (score >= RISK_THRESHOLDS.moderate) return 'moderate';
  return 'low';
}

export const KHOROO_SYNTHESIS_ACCESS_RISK: Record<'Сайн' | 'Дунд' | 'Муу' | 'Маш муу', number> = {
  Сайн: 18,
  Дунд: 42,
  Муу: 68,
  'Маш муу': 86,
};

export const KHOROO_SYNTHESIS_WEIGHTS = {
  gerShare: 0.34,
  accessRisk: 0.20,
  hydrantGap: 0.18,
  responseDelay: 0.16,
  popScale: 0.12,
} as const;

export function computeSynthesizedKhorooScore(input: {
  gerHouseholdPercent: number;
  roadAccessibility: 'Сайн' | 'Дунд' | 'Муу' | 'Маш муу';
  fireHydrantCount: number;
  avgResponseTimeMin: number;
  population: number;
}): number {
  const {
    gerHouseholdPercent,
    roadAccessibility,
    fireHydrantCount,
    avgResponseTimeMin,
    population,
  } = input;

  return Math.round(
    clamp(
      KHOROO_SYNTHESIS_WEIGHTS.gerShare * gerHouseholdPercent +
        KHOROO_SYNTHESIS_WEIGHTS.accessRisk * KHOROO_SYNTHESIS_ACCESS_RISK[roadAccessibility] +
        KHOROO_SYNTHESIS_WEIGHTS.hydrantGap * clamp(100 - fireHydrantCount * 8, 0, 100) +
        KHOROO_SYNTHESIS_WEIGHTS.responseDelay * clamp((avgResponseTimeMin - 3) * 6.5, 0, 100) +
        KHOROO_SYNTHESIS_WEIGHTS.popScale * clamp(population / 240, 0, 100),
      12,
      96
    )
  );
}

/**
 * Standard ray-casting point-in-polygon check for [lat, lng] coordinates.
 */
export function pointInPolygon(
  lat: number,
  lng: number,
  polygon: [number, number][]
): boolean {
  if (!polygon || polygon.length < 3) return true;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    const intersect =
      yi > lng !== yj > lng &&
      lat < ((xj - xi) * (lng - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Ensures any point stays strictly inside a district polygon by pulling it
 * along the ray toward the district centroid if it lands outside.
 */
export function clampPointInsidePolygon(
  lat: number,
  lng: number,
  polygon: [number, number][],
  center: [number, number]
): [number, number] {
  if (!polygon || polygon.length < 3) return [lat, lng];
  if (pointInPolygon(lat, lng, polygon)) return [lat, lng];

  // Binary search along segment [center -> (lat, lng)] for the interior point
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 14; step++) {
    const mid = (lo + hi) / 2;
    const pLat = center[0] + (lat - center[0]) * mid;
    const pLng = center[1] + (lng - center[1]) * mid;
    if (pointInPolygon(pLat, pLng, polygon)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const safeT = Math.max(0, lo * 0.9);
  return [
    +(center[0] + (lat - center[0]) * safeT).toFixed(4),
    +(center[1] + (lng - center[1]) * safeT).toFixed(4),
  ];
}

/**
 * Approximate ground distance in km using equirectangular projection around UB (~47.9N).
 */
export function approxDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const cosLat = Math.cos(((lat1 + lat2) * 0.5 * Math.PI) / 180);
  const dLatKm = (lat2 - lat1) * 111.32;
  const dLngKm = (lng2 - lng1) * 111.32 * cosLat;
  return Math.hypot(dLatKm, dLngKm);
}

/**
 * Separates fire-weather physics into:
 * 1) Ignition receptivity (humidity deficit, dry spell persistence, thermal drying, rain suppression)
 * 2) Spread & ember transport potential (sustained wind speed and gusts — wind accelerates
 *    spread after ignition, rather than causing ignition by itself).
 */
export function computeFireWeatherBreakdown(input: {
  tempCelsius: number;
  humidityPercent: number;
  windSpeedKmh: number;
  gustKmh?: number;
  precipitationMm: number;
  droughtDays: number;
}): FireWeatherBreakdown {
  const {
    tempCelsius,
    humidityPercent,
    windSpeedKmh,
    gustKmh = windSpeedKmh * 1.4,
    precipitationMm,
    droughtDays,
  } = input;

  // Ignition receptivity (0-100): dry fine fuels + low RH + persistent drought - recent rain
  const rhDeficit = clamp((100 - humidityPercent) / 100, 0, 1) * 58;
  const droughtTerm = clamp(droughtDays / 21, 0, 1) * 24;
  // Cold UB winters still sustain indoor stove/ash embers, while warm dry springs add drying
  const thermalDrying = clamp((tempCelsius + 15) / 42, 0, 1) * 18;
  const rainSuppression = clamp(precipitationMm * 14, 0, 38);

  const ignitionReceptivity = Math.round(
    clamp(rhDeficit + droughtTerm + thermalDrying - rainSuppression, 4, 100)
  );

  // Spread potential (0-100): wind carries embers and tilts flame angle; damp fuels resist spread
  const effectiveWind = 0.72 * windSpeedKmh + 0.28 * gustKmh;
  const windEnergy = clamp(effectiveWind / 55, 0, 1) * 85;
  const dryMultiplier = clamp((100 - humidityPercent) / 75, 0.25, 1.15);
  const spreadPotential = Math.round(
    clamp(windEnergy * dryMultiplier - rainSuppression * 0.5, 4, 100)
  );

  // Composite FWI blends ignition receptivity (62%) and spread potential (38%)
  const fireWeatherIndex = Math.round(
    clamp(0.62 * ignitionReceptivity + 0.38 * spreadPotential, 5, 100)
  );

  let dominantDriver: FireWeatherBreakdown['dominantDriver'] = 'balanced';
  if (precipitationMm >= 2 || humidityPercent >= 75) dominantDriver = 'moisture';
  else if (spreadPotential - ignitionReceptivity >= 15) dominantDriver = 'wind';
  else if (ignitionReceptivity - spreadPotential >= 15) dominantDriver = 'dryness';

  return {
    ignitionReceptivity,
    spreadPotential,
    fireWeatherIndex,
    dominantDriver,
  };
}

export interface DistrictFactorScores {
  incidentHistory: number;
  populationDensity: number;
  stationProximity: number;
  gerProportion: number;
  roadAccessibility: number;
  seasonalWeather: number;
}

const ROAD_GRADE_CONSTRAINT: Record<DistrictData['roadAccessibilityGrade'], number> = {
  A: 24,
  B: 45,
  C: 68,
  D: 85,
};

/**
 * Extracts normalized 0-100 factor scores from a district's curated contributions
 * (when present) or directly from its measured demographic/spatial properties.
 * Guarantees 100% score consistency across Overview, Map, District Detail, and Explorer.
 */
export function extractDistrictFactorScores(
  district: DistrictData,
  liveWeatherFwi?: number
): DistrictFactorScores {
  const findByKeywords = (keywords: string[]): number | undefined => {
    const found = district.contributions?.find((c) => {
      const hay = `${c.nameEn} ${c.nameMn}`.toLowerCase();
      return keywords.some((k) => hay.includes(k));
    });
    return found ? clamp(found.score, 0, 100) : undefined;
  };

  // Use curated domain-expert scores if authored, else compute transparently from physical fields
  const incidentHistory =
    findByKeywords(['incident', 'дуудлага']) ??
    Math.round(clamp((district.historicalIncidentsCount / Math.max(1, district.areaKm2) / 3.8) * 100, 10, 100));

  const populationDensity =
    findByKeywords(['population', 'хүн ам', 'electrical', 'цахилгаан']) ??
    Math.round(clamp((district.population / Math.max(1, district.areaKm2) / 3200) * 100, 10, 100));

  const stationProximity =
    findByKeywords(['station', 'proximity', 'ангийн зай']) ??
    Math.round(clamp((district.nearestStationDistKm / 8) * 100, 10, 100));

  const gerProportion =
    findByKeywords(['stove', 'solid fuel', 'гэр хорооллын халаалт']) ??
    clamp(district.gerHouseholdPercent, 0, 100);

  const roadAccessibility =
    findByKeywords(['road', 'замын']) ??
    ROAD_GRADE_CONSTRAINT[district.roadAccessibilityGrade];

  const baseSeasonal =
    findByKeywords(['seasonal', 'улирлын', 'forest', 'ойн']) ?? 62;

  const seasonalWeather =
    typeof liveWeatherFwi === 'number'
      ? Math.round(clamp(0.65 * baseSeasonal + 0.35 * liveWeatherFwi, 5, 100))
      : baseSeasonal;

  return {
    incidentHistory,
    populationDensity,
    stationProximity,
    gerProportion,
    roadAccessibility,
    seasonalWeather,
  };
}

/**
 * Single authoritative composite risk score calculation used everywhere.
 */
export function computeWeightedDistrictRisk(
  district: DistrictData,
  weights: RiskModelWeights = DEFAULT_MODEL_WEIGHTS,
  activeFactors?: Partial<Record<keyof DistrictFactorScores, boolean>>,
  liveWeatherFwi?: number
): {
  score: number;
  level: RiskLevel;
  factors: DistrictFactorScores;
  contributions: FactorContribution[];
} {
  const factors = extractDistrictFactorScores(district, liveWeatherFwi);

  const wInc = activeFactors?.incidentHistory === false ? 0 : weights.incidentHistoryWeight;
  const wPop = activeFactors?.populationDensity === false ? 0 : weights.populationDensityWeight;
  const wSta = activeFactors?.stationProximity === false ? 0 : weights.stationProximityWeight;
  const wGer = activeFactors?.gerProportion === false ? 0 : weights.gerProportionWeight;
  const wRoad = activeFactors?.roadAccessibility === false ? 0 : weights.roadAccessibilityWeight;
  const wSeas = activeFactors?.seasonalWeather === false ? 0 : weights.seasonalWeatherWeight;

  const weightSum = wInc + wPop + wSta + wGer + wRoad + wSeas;
  if (weightSum <= 0) {
    return {
      score: 0,
      level: 'low',
      factors,
      contributions: [],
    };
  }

  const rows: {
    key: keyof DistrictFactorScores;
    weight: number;
    score: number;
    nameMn: string;
    nameEn: string;
    descMn: string;
    descEn: string;
  }[] = [
    {
      key: 'incidentHistory',
      weight: wInc / weightSum,
      score: factors.incidentHistory,
      nameMn: 'Түүхэн дуудлагын нягтрал',
      nameEn: 'Incident History',
      descMn: `Бүртгэгдсэн ${district.historicalIncidentsCount} дуудлагын орон зайн нягтрал.`,
      descEn: `Spatial density across ${district.historicalIncidentsCount} logged fire calls.`,
    },
    {
      key: 'populationDensity',
      weight: wPop / weightSum,
      score: factors.populationDensity,
      nameMn: 'Хүн ам ба суурьшлын нягтрал',
      nameEn: 'Population Density',
      descMn: `${district.population.toLocaleString()} оршин суугч, ${district.areaKm2} км² нутаг дэвсгэр.`,
      descEn: `${district.population.toLocaleString()} residents across ${district.areaKm2} km².`,
    },
    {
      key: 'gerProportion',
      weight: wGer / weightSum,
      score: factors.gerProportion,
      nameMn: 'Гэр хорооллын халаалт',
      nameEn: 'Stove & Solid Fuel Ratio',
      descMn: `Өрхийн ${district.gerHouseholdPercent}% нь төвлөрсөн бус зуух, хатуу түлш ашигладаг.`,
      descEn: `${district.gerHouseholdPercent}% of households rely on decentralized stove heating.`,
    },
    {
      key: 'stationProximity',
      weight: wSta / weightSum,
      score: factors.stationProximity,
      nameMn: 'Гал унтраах ангийн зай',
      nameEn: 'Station Proximity',
      descMn: `Хамгийн ойрын гал унтраах анги хүртэл дунджаар ~${district.nearestStationDistKm} км.`,
      descEn: `Average ~${district.nearestStationDistKm} km transit distance to nearest NEMA unit.`,
    },
    {
      key: 'roadAccessibility',
      weight: wRoad / weightSum,
      score: factors.roadAccessibility,
      nameMn: 'Замын нэвтрэх чадвар',
      nameEn: 'Road Accessibility',
      descMn: `Замын нэвтрэлтийн зэрэглэл: ${district.roadAccessibilityGrade} түвшин.`,
      descEn: `Road accessibility grade: ${district.roadAccessibilityGrade}.`,
    },
    {
      key: 'seasonalWeather',
      weight: wSeas / weightSum,
      score: factors.seasonalWeather,
      nameMn: 'Улирал ба цаг агаарын нөхцөл',
      nameEn: 'Seasonal & Weather Factor',
      descMn: 'Хуурайшилт, салхиар оч тархах эрсдэл болон халаалтын улирлын нөлөөлөл.',
      descEn: 'Relative humidity deficit, wind spread exposure, and heating season load.',
    },
  ];

  const contributions: FactorContribution[] = rows.map((r, idx) => {
    const contrib = +(r.score * r.weight).toFixed(1);
    const impact: FactorContribution['impact'] =
      r.score >= 70 ? 'high' : r.score >= 45 ? 'moderate' : 'low';
    return {
      id: String(idx + 1),
      nameMn: r.nameMn,
      nameEn: r.nameEn,
      weight: Math.round(r.weight * 100),
      score: r.score,
      contributionValue: contrib,
      impact,
      descriptionMn: r.descMn,
      descriptionEn: r.descEn,
    };
  });

  const rawSum = rows.reduce((acc, r) => acc + r.score * r.weight, 0);
  const score = Math.round(clamp(rawSum, 0, 100));

  return {
    score,
    level: riskLevelFromScore(score),
    factors,
    contributions,
  };
}

/**
 * Spatial kernel-weighted IDW interpolation at a geographic point [lat, lng].
 * Unlike additive heatmaps, overlapping points average cleanly in [0, 100]
 * so clustering never creates artificial >100% hot blobs, and areas without
 * nearby points report 'none' / low coverage instead of inventing risk.
 */
export function interpolateHeatValueAtPoint(
  lat: number,
  lng: number,
  points: SpatialHeatPoint[]
): HeatSampleResult {
  if (!points.length) {
    return { score: null, confidence: 'none', nearestPoint: null, distanceKm: null };
  }

  let weightedScoreSum = 0;
  let weightSum = 0;
  let maxKernel = 0;
  let nearest: SpatialHeatPoint | null = null;
  let minDistKm = Infinity;

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const distKm = approxDistanceKm(lat, lng, pt.lat, pt.lng);
    if (distKm < minDistKm) {
      minDistKm = distKm;
      nearest = pt;
    }

    const radiusKm = Math.max(0.45, pt.radiusMeters / 1000);
    if (distKm >= radiusKm) continue;

    const u = distKm / radiusKm;
    // Smooth Wendland C2 / quartic kernel with zero derivative at boundary
    const kernel = (1 - u * u) * (1 - u * u);
    const w = kernel * (pt.isModelled ? 0.85 : 1.15);
    weightedScoreSum += w * pt.score;
    weightSum += w;
    if (kernel > maxKernel) maxKernel = kernel;
  }

  if (weightSum <= 1e-5 || maxKernel < 0.04) {
    return {
      score: null,
      confidence: 'none',
      nearestPoint: nearest,
      distanceKm: Number.isFinite(minDistKm) ? +minDistKm.toFixed(2) : null,
    };
  }

  const score = Math.round(clamp(weightedScoreSum / weightSum, 0, 100));
  const confidence: HeatSampleResult['confidence'] =
    maxKernel >= 0.45 ? 'high' : maxKernel >= 0.16 ? 'moderate' : 'low';

  return {
    score,
    confidence,
    nearestPoint: nearest,
    distanceKm: Number.isFinite(minDistKm) ? +minDistKm.toFixed(2) : null,
  };
}

export const EARTH_CIRCUMFERENCE_METERS = 40075016.68557849;

/**
 * Exact Web Mercator (EPSG:3857) ground resolution in metres per CSS pixel.
 */
export function metersPerPixelAtLat(lat: number, zoom: number): number {
  const safeLat = clamp(lat, -85.05112878, 85.05112878);
  const cosLat = Math.cos((safeLat * Math.PI) / 180);
  return (EARTH_CIRCUMFERENCE_METERS * cosLat) / (256 * Math.pow(2, zoom));
}

/**
 * Converts a ground radius (metres) to screen pixels without upper viewport clamping
 * so heat footprints remain geographically locked across all zoom levels.
 */
export function radiusMetersToPixels(radiusMeters: number, lat: number, zoom: number): number {
  const mpp = metersPerPixelAtLat(lat, zoom);
  if (mpp <= 0) return 3;
  return Math.max(3, radiusMeters / mpp);
}

/**
 * Continuous zoom-dependent fill opacity (replaces step jumps at z12/z14).
 */
export function thermalZoomFillFactor(zoom: number, darkBasemap: boolean): number {
  const base = clamp(0.98 - Math.max(0, zoom - 11) * 0.045, 0.72, 0.98);
  return +(darkBasemap ? base * 1.08 : base * 0.94).toFixed(4);
}

export interface ThermalGridScratchBuffers {
  capacity: number;
  weightAccum: Float32Array;
  weightedScoreAccum: Float32Array;
  maxKernelAccum: Float32Array;
  scores: Float32Array;
  coverages: Float32Array;
}

export function createThermalGridScratch(capacity: number): ThermalGridScratchBuffers {
  return {
    capacity,
    weightAccum: new Float32Array(capacity),
    weightedScoreAccum: new Float32Array(capacity),
    maxKernelAccum: new Float32Array(capacity),
    scores: new Float32Array(capacity),
    coverages: new Float32Array(capacity),
  };
}

/**
 * Generates an absolute-scale (0-100) interpolated scalar + alpha field over a
 * pixel/grid viewport. Zoom-invariant, free of additive overlap artifacts, and
 * allocation-free when supplied with reusable scratch buffers.
 */
export function computeThermalGridField(
  cols: number,
  rows: number,
  widthPx: number,
  heightPx: number,
  projectedPoints: { x: number; y: number; radiusPx: number; score: number; weightScale: number }[],
  scratch?: ThermalGridScratchBuffers
): { scores: Float32Array; coverages: Float32Array; scratch: ThermalGridScratchBuffers } {
  const total = cols * rows;
  const buf =
    scratch && scratch.capacity >= total ? scratch : createThermalGridScratch(total);

  const weightAccum = buf.weightAccum;
  const weightedScoreAccum = buf.weightedScoreAccum;
  const maxKernelAccum = buf.maxKernelAccum;
  const scores = buf.scores;
  const coverages = buf.coverages;

  weightAccum.fill(0, 0, total);
  weightedScoreAccum.fill(0, 0, total);
  maxKernelAccum.fill(0, 0, total);

  const cellW = widthPx / cols;
  const cellH = heightPx / rows;

  for (let i = 0; i < projectedPoints.length; i++) {
    const pt = projectedPoints[i];
    const r = Math.max(2.5, pt.radiusPx);
    // Skip points completely outside viewport with margin
    if (
      pt.x + r < 0 ||
      pt.x - r > widthPx ||
      pt.y + r < 0 ||
      pt.y - r > heightPx
    ) {
      continue;
    }

    const rSq = r * r;
    const gx0 = Math.max(0, Math.floor((pt.x - r) / cellW));
    const gx1 = Math.min(cols - 1, Math.ceil((pt.x + r) / cellW));
    const gy0 = Math.max(0, Math.floor((pt.y - r) / cellH));
    const gy1 = Math.min(rows - 1, Math.ceil((pt.y + r) / cellH));

    for (let gy = gy0; gy <= gy1; gy++) {
      const cy = gy * cellH + cellH * 0.5;
      const dy = cy - pt.y;
      const dy2 = dy * dy;
      const rowOffset = gy * cols;
      for (let gx = gx0; gx <= gx1; gx++) {
        const cx = gx * cellW + cellW * 0.5;
        const dx = cx - pt.x;
        const distSq = dx * dx + dy2;
        if (distSq >= rSq) continue;

        const u2 = distSq / rSq;
        const kernel = (1 - u2) * (1 - u2);
        const w = kernel * pt.weightScale;
        const idx = rowOffset + gx;
        weightedScoreAccum[idx] += w * pt.score;
        weightAccum[idx] += w;
        if (kernel > maxKernelAccum[idx]) {
          maxKernelAccum[idx] = kernel;
        }
      }
    }
  }

  for (let i = 0; i < total; i++) {
    const wSum = weightAccum[i];
    if (wSum > 1e-5) {
      scores[i] = clamp(weightedScoreAccum[i] / wSum, 0, 100);
      // Smooth radial taper lets adjacent urban corridors blend seamlessly while keeping outer hills clean
      const k = maxKernelAccum[i];
      coverages[i] = clamp(Math.pow(k, 0.72), 0, 1);
    } else {
      scores[i] = 0;
      coverages[i] = 0;
    }
  }

  return { scores, coverages, scratch: buf };
}

/**
 * Magnus-Tetens saturation vapor pressure deficit (VPD in kPa).
 * Directly governs fine dead fuel equilibrium moisture content and flammability.
 */
export function computeVpdKpa(tempCelsius: number, humidityPercent: number): number {
  const safeRh = clamp(humidityPercent, 2, 100);
  const esKpa = 0.61078 * Math.exp((17.27 * tempCelsius) / (tempCelsius + 237.3));
  const vpd = esKpa * (1 - safeRh / 100);
  return Math.max(0, Math.round(vpd * 1000) / 1000);
}

/**
 * Computes live weather-adjusted Khoroo composite score while keeping
 * demographic/infrastructure foundation deterministic and bounded [8, 98].
 */
export function computeKhorooDynamicRisk(
  khoroo: KhorooData,
  districtWeather?: Pick<DistrictWeatherSnapshot, 'fireWeatherIndex' | 'spreadPotential'> | null,
  verifiedRealIncidentBoost = 0
): { score: number; level: RiskLevel; weatherComponent: number } {
  const baseScore = khoroo.riskScore;
  const fwi = districtWeather?.fireWeatherIndex;
  if (typeof fwi !== 'number' && verifiedRealIncidentBoost <= 0) {
    return {
      score: baseScore,
      level: riskLevelFromScore(baseScore),
      weatherComponent: 50,
    };
  }
  const weatherComponent = typeof fwi === 'number' ? clamp(fwi, 5, 100) : 50;
  const weatherDelta = typeof fwi === 'number' ? (weatherComponent - 52) * 0.16 : 0;
  const realBoost = clamp(verifiedRealIncidentBoost * 1.4, 0, 12);
  const score = Math.round(clamp(baseScore + weatherDelta + realBoost, 8, 98));
  return {
    score,
    level: riskLevelFromScore(score),
    weatherComponent: Math.round(weatherComponent),
  };
}

const ACCESS_GRADE_BY_KHOROO: Record<KhorooData['roadAccessibility'], 'A' | 'B' | 'C' | 'D'> = {
  Сайн: 'A',
  Дунд: 'B',
  Муу: 'C',
  'Маш муу': 'D',
};

const ACCESS_SCORE_BY_GRADE: Record<'A' | 'B' | 'C' | 'D', number> = {
  A: 90,
  B: 72,
  C: 50,
  D: 28,
};

/**
 * Separates (1) Calibrated Ignition Probability % (locked unless validated ML passes all gates),
 * (2) Spread Hazard Index (0-100), and (3) Suppression / Response Capability.
 */
export function computeDistrictThreeAxisRisk(params: {
  district: DistrictData;
  weather?: DistrictWeatherSnapshot | null;
  mlModel?: MlModelArtifact | null;
  verifiedRealCount?: number;
}): ThreeAxisRiskProfile {
  const { district, weather, mlModel, verifiedRealCount = 0 } = params;
  const hasWeather = Boolean(weather);
  const fwi = weather?.fireWeatherIndex ?? 50;
  const spreadPotential = weather?.spreadPotential ?? 45;

  const spreadIndex = Math.round(
    clamp(
      0.56 * district.gerHouseholdPercent +
        0.28 * spreadPotential +
        0.16 * clamp(fwi, 0, 100),
      6,
      98
    )
  );

  const driver: ThreeAxisRiskProfile['spreadHazard']['dominantDriver'] = weather
    ? weather.precipitationMm >= 2 || weather.humidityPercent >= 75
      ? 'moisture'
      : weather.spreadPotential - weather.ignitionReceptivity >= 14
      ? 'wind'
      : weather.ignitionReceptivity - weather.spreadPotential >= 14
      ? 'dryness'
      : 'balanced'
    : 'balanced';

  const distScore = clamp(100 - district.nearestStationDistKm * 9.5, 18, 96);
  const roadScore = ACCESS_SCORE_BY_GRADE[district.roadAccessibilityGrade];
  const stationBonus = clamp(district.fireStationsCount * 8, 6, 24);
  const readinessScore = Math.round(clamp(0.45 * distScore + 0.4 * roadScore + 0.15 * stationBonus, 12, 98));
  const estResponseMin = Math.max(4, Math.round(district.nearestStationDistKm * 2.4 + (100 - roadScore) * 0.08));

  const mlUnlocked = Boolean(mlModel && mlModel.gatePassed && mlModel.status === 'validated');
  let districtProbPct: number | null = null;
  let ciLowPct: number | null = null;
  let ciHighPct: number | null = null;

  if (mlUnlocked && mlModel?.khorooProbabilities) {
    const matchingKeys = Object.keys(mlModel.khorooProbabilities).filter((k) =>
      k.startsWith(`${district.id}-`)
    );
    if (matchingKeys.length > 0) {
      const meanP =
        matchingKeys.reduce((s, k) => s + (mlModel.khorooProbabilities![k]?.probPct ?? 0), 0) /
        matchingKeys.length;
      const meanLow =
        matchingKeys.reduce((s, k) => s + (mlModel.khorooProbabilities![k]?.ciLowPct ?? 0), 0) /
        matchingKeys.length;
      const meanHigh =
        matchingKeys.reduce((s, k) => s + (mlModel.khorooProbabilities![k]?.ciHighPct ?? 0), 0) /
        matchingKeys.length;
      districtProbPct = Math.round(meanP * 10) / 10;
      ciLowPct = Math.round(meanLow * 10) / 10;
      ciHighPct = Math.round(meanHigh * 10) / 10;
    }
  }

  return {
    ignitionProbability: {
      unlocked: mlUnlocked && districtProbPct !== null,
      probabilityPct: districtProbPct,
      ciLowPct,
      ciHighPct,
      uncertaintyLabelMn:
        mlUnlocked && districtProbPct !== null
          ? `95% CI: ${ciLowPct}%–${ciHighPct}% (ECE ${(mlModel?.metrics.ece ?? 0).toFixed(3)})`
          : `Бодит өгөгдөл: ${verifiedRealCount}/200+ (Магадлал түгжээтэй)`,
      uncertaintyLabelEn:
        mlUnlocked && districtProbPct !== null
          ? `95% CI: ${ciLowPct}%–${ciHighPct}% (ECE ${(mlModel?.metrics.ece ?? 0).toFixed(3)})`
          : `Verified real rows: ${verifiedRealCount}/200+ (Probability locked)`,
      reasonMn:
        mlUnlocked && districtProbPct !== null
          ? 'Open-Meteo болон бодит түүхэн бүртгэл дээр шалгагдсан ML магадлал.'
          : mlModel?.gateReasonsMn?.[0] ||
            'Бодит түүхэн галын бүртгэл ба түр хугацааны шалгалт хангалтгүй тул зохиомол % гаргаагүй.',
      reasonEn:
        mlUnlocked && districtProbPct !== null
          ? 'Calibrated ML ignition probability verified against real incidents and Open-Meteo archive.'
          : mlModel?.gateReasonsEn?.[0] ||
            'Locked until verified real incident logs and temporal calibration pass validation gates.',
      modelVersion: mlModel?.modelVersion,
      calibrationEce: mlModel?.metrics.ece ?? null,
    },
    spreadHazard: {
      index: spreadIndex,
      level: riskLevelFromScore(spreadIndex),
      fuelComponent: district.gerHouseholdPercent,
      weatherSpreadComponent: Math.round(spreadPotential),
      dominantDriver: driver,
      weatherApplied: hasWeather,
    },
    responseCapability: {
      readinessScore,
      grade: district.roadAccessibilityGrade,
      nearestStationDistKm: district.nearestStationDistKm,
      estResponseMin,
      accessConstraintLabelMn: `${district.roadAccessibilityGrade} зэрэг · ~${district.nearestStationDistKm} км`,
      accessConstraintLabelEn: `Grade ${district.roadAccessibilityGrade} · ~${district.nearestStationDistKm} km`,
    },
    reliability: {
      dataOrigin:
        mlUnlocked && districtProbPct !== null
          ? 'real_ml'
          : hasWeather
          ? 'heuristic_with_live_weather'
          : 'heuristic_baseline',
      confidenceTier: mlUnlocked ? 'high' : hasWeather ? 'moderate' : 'low',
      notesMn: mlUnlocked
        ? 'Бодит түүхэн гал + Open-Meteo дүүргийн цаг агаараар баталгаажсан.'
        : hasWeather
        ? 'Дүүргийн бодит цагийн Open-Meteo цаг агаар холбогдсон эвристик индекс.'
        : 'Зөвхөн суурь эвристик өгөгдөл (цаг агаар болон бодит ML хүлээгдэж байна).',
      notesEn: mlUnlocked
        ? 'Backed by verified historical records and Open-Meteo district telemetry.'
        : hasWeather
        ? 'Composite hazard index updated with district-level Open-Meteo telemetry.'
        : 'Baseline heuristic index only (awaiting live weather / verified real ML logs).',
    },
  };
}

export function computeKhorooThreeAxisRisk(params: {
  khoroo: KhorooData;
  district: DistrictData;
  weather?: DistrictWeatherSnapshot | null;
  mlModel?: MlModelArtifact | null;
  verifiedRealCount?: number;
}): ThreeAxisRiskProfile {
  const { khoroo, district, weather, mlModel, verifiedRealCount = 0 } = params;
  const hasWeather = Boolean(weather);
  const fwi = weather?.fireWeatherIndex ?? 50;
  const spreadPotential = weather?.spreadPotential ?? 45;

  const spreadIndex = Math.round(
    clamp(
      0.54 * khoroo.gerHouseholdPercent +
        0.28 * spreadPotential +
        0.18 * clamp(fwi, 0, 100),
      6,
      98
    )
  );

  const grade = ACCESS_GRADE_BY_KHOROO[khoroo.roadAccessibility];
  const roadScore = ACCESS_SCORE_BY_GRADE[grade];
  const hydrantScore = clamp(khoroo.fireHydrantCount * 9, 10, 95);
  const etaScore = clamp(100 - (khoroo.avgResponseTimeMin - 3) * 5.4, 15, 96);
  const readinessScore = Math.round(clamp(0.45 * etaScore + 0.35 * roadScore + 0.2 * hydrantScore, 10, 98));

  const mlUnlocked = Boolean(mlModel && mlModel.gatePassed && mlModel.status === 'validated');
  const kKey = `${khoroo.districtId}-${khoroo.khorooNumber}`;
  const kProb = mlUnlocked ? mlModel?.khorooProbabilities?.[kKey] : undefined;

  return {
    ignitionProbability: {
      unlocked: Boolean(mlUnlocked && kProb),
      probabilityPct: kProb ? Math.round(kProb.probPct * 10) / 10 : null,
      ciLowPct: kProb ? Math.round(kProb.ciLowPct * 10) / 10 : null,
      ciHighPct: kProb ? Math.round(kProb.ciHighPct * 10) / 10 : null,
      uncertaintyLabelMn: kProb
        ? `95% CI: ${kProb.ciLowPct.toFixed(1)}%–${kProb.ciHighPct.toFixed(1)}%`
        : `Бодит өгөгдөл: ${verifiedRealCount}/200+ (Магадлал түгжээтэй)`,
      uncertaintyLabelEn: kProb
        ? `95% CI: ${kProb.ciLowPct.toFixed(1)}%–${kProb.ciHighPct.toFixed(1)}%`
        : `Verified real rows: ${verifiedRealCount}/200+ (Probability locked)`,
      reasonMn: kProb
        ? 'Бодит хорооны түүх болон Open-Meteo ажиглалт дээр калибровклагдсан магадлал.'
        : mlModel?.gateReasonsMn?.[0] ||
          'Хорооны түвшний бодит түүхэн бүртгэл ба ML баталгаажуулалт хүрэлцэхгүй тул магадлал (%) харуулахгүй.',
      reasonEn: kProb
        ? 'Calibrated khoroo-level probability verified against historical incidents and Open-Meteo.'
        : mlModel?.gateReasonsEn?.[0] ||
          'Locked until verified real incident data and temporal calibration gates are met.',
      modelVersion: mlModel?.modelVersion,
      calibrationEce: mlModel?.metrics.ece ?? null,
    },
    spreadHazard: {
      index: spreadIndex,
      level: riskLevelFromScore(spreadIndex),
      fuelComponent: khoroo.gerHouseholdPercent,
      weatherSpreadComponent: Math.round(spreadPotential),
      dominantDriver: weather
        ? weather.precipitationMm >= 2 || weather.humidityPercent >= 75
          ? 'moisture'
          : weather.spreadPotential - weather.ignitionReceptivity >= 14
          ? 'wind'
          : weather.ignitionReceptivity - weather.spreadPotential >= 14
          ? 'dryness'
          : 'balanced'
        : 'balanced',
      weatherApplied: hasWeather,
    },
    responseCapability: {
      readinessScore,
      grade,
      nearestStationDistKm: district.nearestStationDistKm,
      estResponseMin: khoroo.avgResponseTimeMin,
      hydrantCount: khoroo.fireHydrantCount,
      accessConstraintLabelMn: `${khoroo.roadAccessibility} · ${khoroo.fireHydrantCount} гидрант · ~${khoroo.avgResponseTimeMin} мин`,
      accessConstraintLabelEn: `Grade ${grade} · ${khoroo.fireHydrantCount} hydrants · ~${khoroo.avgResponseTimeMin} min`,
    },
    reliability: {
      dataOrigin: kProb
        ? 'real_ml'
        : hasWeather
        ? 'heuristic_with_live_weather'
        : 'heuristic_baseline',
      confidenceTier: kProb ? 'high' : khoroo.isModelled ? 'low' : 'moderate',
      notesMn: khoroo.isModelled
        ? 'Загварчилсан хороо + бодит цаг агаарын тооцоолол.'
        : 'Бодит хорооны үндсэн бүртгэл + дүүргийн Open-Meteo цаг агаар.',
      notesEn: khoroo.isModelled
        ? 'Synthesized khoroo parameters adjusted by district Open-Meteo telemetry.'
        : 'Curated khoroo baseline adjusted by district Open-Meteo telemetry.',
    },
  };
}

/**
 * Privacy-preserving k-anonymity spatial aggregation for public heatmaps:
 * merges sparse real incidents at household precision into district/khoroo centroids
 * so fewer than `kMin` (default 5) real coordinates never expose an individual home location.
 */
export function aggregateHeatPointsWithKAnonymity(
  incidents: Array<{
    districtId: string;
    khorooNumber: number;
    lat: number;
    lng: number;
    severity: string;
  }>,
  districtCenters: Record<string, [number, number]>,
  kMin = 5
): PublicHeatCluster[] {
  const byKhoroo = new Map<
    string,
    {
      districtId: string;
      khorooNumber: number;
      latSum: number;
      lngSum: number;
      count: number;
      criticalCount: number;
    }
  >();

  for (const inc of incidents) {
    const key = `${inc.districtId}-${inc.khorooNumber}`;
    const prev = byKhoroo.get(key);
    if (!prev) {
      byKhoroo.set(key, {
        districtId: inc.districtId,
        khorooNumber: inc.khorooNumber,
        latSum: inc.lat,
        lngSum: inc.lng,
        count: 1,
        criticalCount: inc.severity === 'critical' ? 1 : 0,
      });
    } else {
      prev.latSum += inc.lat;
      prev.lngSum += inc.lng;
      prev.count += 1;
      if (inc.severity === 'critical') prev.criticalCount += 1;
    }
  }

  const out: PublicHeatCluster[] = [];
  for (const [key, g] of byKhoroo.entries()) {
    const satisfiesK = g.count >= kMin;
    const fallbackCenter = districtCenters[g.districtId] ?? [47.9184, 106.9177];
    // Snap sparse clusters (< kMin) to district centroid / coarse 0.01 deg grid (~1.1 km) to protect household PII
    const lat = satisfiesK
      ? Number((g.latSum / g.count).toFixed(3))
      : Number(fallbackCenter[0].toFixed(2));
    const lng = satisfiesK
      ? Number((g.lngSum / g.count).toFixed(3))
      : Number(fallbackCenter[1].toFixed(2));

    out.push({
      clusterId: key,
      districtId: g.districtId,
      khorooNumber: satisfiesK ? g.khorooNumber : 0,
      lat,
      lng,
      incidentCount: g.count,
      criticalCount: g.criticalCount,
      kAnonymitySatisfied: satisfiesK,
      isPublicAggregated: true,
    });
  }
  return out;
}

/**
 * Prevents redundant double-counting between reference hotspot anchors and dense khoroo
 * centers by removing reference hotspots that sit within 450m of an equally-weighted
 * khoroo center while retaining distant corridor anchors cleanly.
 */
export function mergeSpatialHeatSources(
  hotspots: SpatialHeatPoint[],
  khorooPoints: SpatialHeatPoint[]
): SpatialHeatPoint[] {
  const merged = [...khorooPoints];
  for (const h of hotspots) {
    const duplicateNear = khorooPoints.some(
      (k) => approxDistanceKm(h.lat, h.lng, k.lat, k.lng) < 0.45 && Math.abs(h.score - k.score) < 12
    );
    if (!duplicateNear) {
      merged.push(h);
    }
  }
  return merged;
}
