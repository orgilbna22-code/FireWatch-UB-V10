import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RISK_THRESHOLDS,
  aggregateHeatPointsWithKAnonymity,
  clampPointInsidePolygon,
  computeDistrictThreeAxisRisk,
  computeFireWeatherBreakdown,
  computeKhorooThreeAxisRisk,
  computeSynthesizedKhorooScore,
  computeThermalGridField,
  computeVpdKpa,
  computeWeightedDistrictRisk,
  createThermalGridScratch,
  interpolateHeatValueAtPoint,
  mergeSpatialHeatSources,
  metersPerPixelAtLat,
  pointInPolygon,
  radiusMetersToPixels,
  riskLevelFromScore,
  thermalZoomFillFactor,
} from './riskEngine';
import { DEFAULT_RISK_WEIGHTS, calculateNormalizedScore } from '../data/riskConfig';
import type { DistrictData, DistrictWeatherSnapshot, KhorooData, MlModelArtifact } from '../types';

test('riskLevelFromScore obeys shared RISK_THRESHOLDS across all boundary edges', () => {
  assert.equal(RISK_THRESHOLDS.very_high, 75);
  assert.equal(riskLevelFromScore(0), 'low');
  assert.equal(riskLevelFromScore(34), 'low');
  assert.equal(riskLevelFromScore(35), 'moderate');
  assert.equal(riskLevelFromScore(54), 'moderate');
  assert.equal(riskLevelFromScore(55), 'high');
  assert.equal(riskLevelFromScore(74), 'high');
  assert.equal(riskLevelFromScore(75), 'very_high');
  assert.equal(riskLevelFromScore(100), 'very_high');
});

test('riskConfig calculateNormalizedScore shares identical weights and thresholds with riskEngine', () => {
  const res = calculateNormalizedScore(
    {
      incidentDensityScore: 80,
      populationDensityScore: 70,
      stationDistanceScore: 60,
      gerHouseholdScore: 80,
      roadConstraintScore: 70,
      weatherFactorScore: 60,
    },
    DEFAULT_RISK_WEIGHTS
  );
  assert.equal(res.score, 72);
  assert.equal(res.level, 'high');
});

test('computeSynthesizedKhorooScore clamps safely and increases with higher hazard inputs', () => {
  const safer = computeSynthesizedKhorooScore({
    gerHouseholdPercent: 10,
    roadAccessibility: 'Сайн',
    fireHydrantCount: 12,
    avgResponseTimeMin: 4,
    population: 4000,
  });
  const riskier = computeSynthesizedKhorooScore({
    gerHouseholdPercent: 85,
    roadAccessibility: 'Маш муу',
    fireHydrantCount: 2,
    avgResponseTimeMin: 16,
    population: 18000,
  });
  assert.ok(safer >= 12 && safer <= 96);
  assert.ok(riskier >= 12 && riskier <= 96);
  assert.ok(riskier > safer);
});

test('pointInPolygon detects interior and exterior coordinates accurately', () => {
  const square: [number, number][] = [
    [47.90, 106.85],
    [47.90, 106.95],
    [47.98, 106.95],
    [47.98, 106.85],
    [47.90, 106.85],
  ];
  assert.equal(pointInPolygon(47.94, 106.90, square), true);
  assert.equal(pointInPolygon(48.05, 106.90, square), false);
});

test('clampPointInsidePolygon pulls exterior khoroo coordinate inside district polygon', () => {
  const poly: [number, number][] = [
    [47.90, 106.85],
    [47.90, 106.95],
    [47.98, 106.95],
    [47.98, 106.85],
    [47.90, 106.85],
  ];
  const center: [number, number] = [47.94, 106.90];
  const clamped = clampPointInsidePolygon(48.12, 107.10, poly, center);
  assert.equal(pointInPolygon(clamped[0], clamped[1], poly), true);
});

test('computeFireWeatherBreakdown distinguishes wind spread from ignition receptivity', () => {
  const calmDry = computeFireWeatherBreakdown({
    tempCelsius: 14,
    humidityPercent: 18,
    windSpeedKmh: 2,
    precipitationMm: 0,
    droughtDays: 14,
  });
  const windyWet = computeFireWeatherBreakdown({
    tempCelsius: 8,
    humidityPercent: 85,
    windSpeedKmh: 45,
    precipitationMm: 6,
    droughtDays: 0,
  });
  // Calm + very dry has high ignition receptivity but low spread potential
  assert.ok(calmDry.ignitionReceptivity > calmDry.spreadPotential);
  // Rain + high humidity suppresses ignition receptivity even in high wind
  assert.ok(windyWet.ignitionReceptivity < 25);
});

test('computeWeightedDistrictRisk contributions sum accurately to score', () => {
  const mockDistrict: DistrictData = {
    id: 'test-dist',
    nameMn: 'Тест',
    nameEn: 'Test',
    center: [47.92, 106.92],
    polygon: [],
    population: 200000,
    areaKm2: 100,
    gerHouseholdPercent: 58,
    apartmentHouseholdPercent: 42,
    fireStationsCount: 2,
    nearestStationDistKm: 3.4,
    roadAccessibilityGrade: 'C',
    historicalIncidentsCount: 300,
    riskScore: 0,
    riskLevel: 'moderate',
    trend: 'stable',
    khoroosCount: 10,
    keyObservationsMn: '',
    keyObservationsEn: '',
    contributions: [
      { id: '1', nameMn: 'Түүхэн дуудлага', nameEn: 'Incident History', weight: 30, score: 80, contributionValue: 24, impact: 'high', descriptionMn: '', descriptionEn: '' },
      { id: '2', nameMn: 'Хүн амын нягтрал', nameEn: 'Population Density', weight: 20, score: 70, contributionValue: 14, impact: 'moderate', descriptionMn: '', descriptionEn: '' },
      { id: '3', nameMn: 'Гал унтраах ангийн зай', nameEn: 'Station Proximity', weight: 15, score: 60, contributionValue: 9, impact: 'moderate', descriptionMn: '', descriptionEn: '' },
      { id: '4', nameMn: 'Гэр хорооллын халаалт', nameEn: 'Stove & Solid Fuel Ratio', weight: 15, score: 80, contributionValue: 12, impact: 'high', descriptionMn: '', descriptionEn: '' },
      { id: '5', nameMn: 'Замын нэвтрэх чадвар', nameEn: 'Road Accessibility', weight: 10, score: 70, contributionValue: 7, impact: 'moderate', descriptionMn: '', descriptionEn: '' },
      { id: '6', nameMn: 'Улирлын хүчин зүйл', nameEn: 'Seasonal Factor', weight: 10, score: 60, contributionValue: 6, impact: 'moderate', descriptionMn: '', descriptionEn: '' },
    ],
  };

  const res = computeWeightedDistrictRisk(mockDistrict);
  // 80*0.3 + 70*0.2 + 60*0.15 + 80*0.15 + 70*0.1 + 60*0.1 = 24+14+9+12+7+6 = 72
  assert.equal(res.score, 72);
  assert.equal(res.level, 'high');
  const contribSum = Math.round(res.contributions.reduce((s, c) => s + c.contributionValue, 0));
  assert.equal(contribSum, res.score);
});

test('thermal interpolation prevents overlap inflation and respects missing coverage', () => {
  // Five overlapping points all with moderate score 50 should interpolate to 50, NOT >100
  const clustered = Array.from({ length: 5 }, (_, i) => ({
    lat: 47.92 + i * 0.0005,
    lng: 106.92 + i * 0.0005,
    score: 50,
    radiusMeters: 1200,
  }));

  const sampleCenter = interpolateHeatValueAtPoint(47.921, 106.921, clustered);
  assert.equal(sampleCenter.score, 50);
  assert.equal(sampleCenter.confidence, 'high');

  // Outside coverage area returns null score instead of inventing risk
  const outside = interpolateHeatValueAtPoint(48.30, 107.40, clustered);
  assert.equal(outside.score, null);
  assert.equal(outside.confidence, 'none');

  // Grid field preserves absolute score bounds [0, 100] and supports scratch buffer reuse
  const scratch = createThermalGridScratch(40 * 40);
  const grid = computeThermalGridField(
    40,
    40,
    400,
    400,
    [
      { x: 200, y: 200, radiusPx: 80, score: 50, weightScale: 1 },
      { x: 205, y: 205, radiusPx: 80, score: 50, weightScale: 1 },
    ],
    scratch
  );
  const centerIdx = 20 * 40 + 20;
  assert.ok(Math.abs(grid.scores[centerIdx] - 50) < 0.5);
  assert.ok(grid.coverages[centerIdx] > 0.9);
  assert.equal(grid.coverages[0], 0);
  assert.equal(grid.scratch, scratch);
});

test('heatmap Web Mercator radius doubles cleanly per zoom level and fill factor has zero step jumps', () => {
  const latUb = 47.92;
  const r10 = radiusMetersToPixels(1500, latUb, 10);
  const r12 = radiusMetersToPixels(1500, latUb, 12);
  const r14 = radiusMetersToPixels(1500, latUb, 14);
  const r16 = radiusMetersToPixels(1500, latUb, 16);

  // Exact factor of 4 per +2 zoom levels in Web Mercator
  assert.ok(Math.abs(r12 / r10 - 4) < 1e-6);
  assert.ok(Math.abs(r14 / r12 - 4) < 1e-6);
  assert.ok(Math.abs(r16 / r14 - 4) < 1e-6);

  // Confirm metersPerPixelAtLat at zoom 15 around 47.92N is ~3.20 m/px
  const mpp15 = metersPerPixelAtLat(latUb, 15);
  assert.ok(mpp15 > 3.0 && mpp15 < 3.4);

  // Continuous opacity ramp (no sudden cliff at z12 or z14)
  const f119 = thermalZoomFillFactor(11.99, false);
  const f120 = thermalZoomFillFactor(12.0, false);
  const f139 = thermalZoomFillFactor(13.99, false);
  const f140 = thermalZoomFillFactor(14.0, false);
  assert.ok(Math.abs(f119 - f120) < 0.005);
  assert.ok(Math.abs(f139 - f140) < 0.005);
  assert.ok(thermalZoomFillFactor(12, true) > thermalZoomFillFactor(12, false));
});

test('all UB_DISTRICTS and all 204 UB_KHOROOS obey computeWeightedDistrictRisk and riskLevelFromScore', async () => {
  const { CITY_AVERAGE_RISK, UB_DISTRICTS, UB_KHOROOS, MODELLED_KHOROO_COUNT } = await import('../data/ubGeoData');
  assert.equal(UB_DISTRICTS.length, 9);
  assert.equal(UB_KHOROOS.length, 204);
  assert.ok(MODELLED_KHOROO_COUNT > 0);

  for (const d of UB_DISTRICTS) {
    assert.equal(d.dataStatus, 'demo');
    const computed = computeWeightedDistrictRisk(d);
    assert.equal(computed.score, d.riskScore, `District ${d.id} score mismatch`);
    assert.equal(computed.level, d.riskLevel, `District ${d.id} riskLevel mismatch`);
  }
  const totalPop = UB_KHOROOS.reduce((s, k) => s + k.population, 0) || 1;
  const popWeightedMean = Math.round(
    UB_KHOROOS.reduce((s, k) => s + k.riskScore * k.population, 0) / totalPop
  );
  assert.equal(CITY_AVERAGE_RISK, popWeightedMean);

  // Verify every khoroo coordinate sits inside its parent district polygon AND riskLevel matches riskLevelFromScore
  const byId = new Map(UB_DISTRICTS.map((d) => [d.id, d]));
  for (const k of UB_KHOROOS) {
    assert.equal(
      k.riskLevel,
      riskLevelFromScore(k.riskScore),
      `Khoroo ${k.id} stored riskLevel (${k.riskLevel}) disagrees with riskLevelFromScore(${k.riskScore})`
    );
    const parent = byId.get(k.districtId);
    assert.ok(parent, `Missing parent district ${k.districtId}`);
    if (parent.polygon.length >= 3) {
      assert.equal(
        pointInPolygon(k.center[0], k.center[1], parent.polygon),
        true,
        `Khoroo ${k.id} coordinates lie outside district ${parent.id}`
      );
    }
  }
});

test('computeVpdKpa rises with higher temperature and lower humidity', () => {
  const humidCold = computeVpdKpa(-5, 85);
  const dryWarm = computeVpdKpa(22, 18);
  assert.ok(humidCold < 0.2);
  assert.ok(dryWarm > 1.8);
  assert.ok(dryWarm > humidCold);
});

test('computeDistrictThreeAxisRisk and computeKhorooThreeAxisRisk strictly lock % probability without validated ML', () => {
  const dist: DistrictData = {
    id: 'bayanzurkh',
    nameMn: 'Баянзүрх',
    nameEn: 'Bayanzurkh',
    center: [47.94, 107.01],
    polygon: [],
    population: 380000,
    areaKm2: 1200,
    gerHouseholdPercent: 68,
    apartmentHouseholdPercent: 32,
    fireStationsCount: 2,
    nearestStationDistKm: 4.5,
    roadAccessibilityGrade: 'C',
    historicalIncidentsCount: 800,
    riskScore: 76,
    riskLevel: 'very_high',
    trend: 'increasing',
    khoroosCount: 43,
    keyObservationsMn: '',
    keyObservationsEn: '',
    contributions: [],
  };
  const kh: KhorooData = {
    id: 'bzd-27',
    districtId: 'bayanzurkh',
    khorooNumber: 27,
    nameMn: '27-р хороо',
    nameEn: 'Khoroo 27',
    center: [47.94, 107.01],
    population: 14000,
    households: 3600,
    gerHouseholdPercent: 88,
    apartmentHouseholdPercent: 12,
    riskScore: 81,
    riskLevel: 'very_high',
    primaryRiskFactorMn: 'Гэр хорооллын яндан',
    primaryRiskFactorEn: 'Ger stove flue',
    avgResponseTimeMin: 12,
    fireHydrantCount: 3,
    roadAccessibility: 'Муу',
    historicalIncidents2024_2026: 42,
    photoUrl: '',
    landmarksMn: [],
    landmarksEn: [],
  };
  const weather: DistrictWeatherSnapshot = {
    districtId: 'bayanzurkh',
    observedAtIso: '2026-04-01T12:00:00',
    tempCelsius: 14,
    apparentCelsius: 11,
    humidityPercent: 22,
    windSpeedKmh: 34,
    windDirectionDeg: 300,
    gustKmh: 48,
    precipitationMm: 0,
    weatherCode: 1,
    droughtDays: 6,
    vpdKpa: 1.24,
    fireWeatherIndex: 74,
    ignitionReceptivity: 68,
    spreadPotential: 82,
    provider: 'open-meteo',
    fetchedAtMs: Date.now(),
    isLive: true,
  };

  const locked = computeDistrictThreeAxisRisk({ district: dist, weather, mlModel: null, verifiedRealCount: 12 });
  assert.equal(locked.ignitionProbability.unlocked, false);
  assert.equal(locked.ignitionProbability.probabilityPct, null);
  assert.ok(locked.spreadHazard.index >= 60);
  assert.equal(locked.spreadHazard.dominantDriver, 'wind');
  assert.ok(locked.responseCapability.estResponseMin >= 4);

  const mockValidatedMl: MlModelArtifact = {
    id: 'ml-test',
    modelVersion: 'fw-test',
    trainedAtIso: '2026-04-01T00:00:00Z',
    status: 'validated',
    gatePassed: true,
    gateReasonsMn: ['OK'],
    gateReasonsEn: ['OK'],
    metrics: {
      totalSamples: 1000,
      trainSamples: 700,
      valSamples: 300,
      positiveTrainCount: 140,
      positiveValCount: 60,
      trainDateRange: ['2024-01', '2024-12'],
      valDateRange: ['2025-01', '2025-04'],
      rocAuc: 0.79,
      prAuc: 0.65,
      brierScore: 0.14,
      baselineBrierScore: 0.21,
      brierSkillScore: 0.33,
      logLoss: 0.41,
      baselineLogLoss: 0.55,
      ece: 0.06,
      ridgeRmse: 0.5,
      ridgeMae: 0.3,
      baseRatePct: 20,
      calibrationBins: [],
      featureImportances: [],
    },
    weights: {
      intercept: 0,
      coefficients: [],
      featureNames: [],
      featureMeans: [],
      featureStds: [],
      plattA: 1,
      plattB: 0,
      weatherMatchedPct: 100,
    },
    khorooProbabilities: {
      'bayanzurkh-27': { probPct: 31.4, ciLowPct: 24.0, ciHighPct: 38.8 },
    },
  };

  const unlockedKh = computeKhorooThreeAxisRisk({
    khoroo: kh,
    district: dist,
    weather,
    mlModel: mockValidatedMl,
    verifiedRealCount: 250,
  });
  assert.equal(unlockedKh.ignitionProbability.unlocked, true);
  assert.equal(unlockedKh.ignitionProbability.probabilityPct, 31.4);
  assert.equal(unlockedKh.ignitionProbability.ciLowPct, 24.0);
  assert.equal(unlockedKh.ignitionProbability.ciHighPct, 38.8);
});

test('aggregateHeatPointsWithKAnonymity obscures < 5 clusters and mergeSpatialHeatSources deduplicates near overlaps', () => {
  const centers: Record<string, [number, number]> = {
    bayanzurkh: [47.92, 107.01],
    chingeltei: [47.95, 106.91],
  };
  const incidents = [
    ...Array.from({ length: 6 }, (_, i) => ({
      districtId: 'bayanzurkh',
      khorooNumber: 27,
      lat: 47.9401 + i * 0.0001,
      lng: 107.0112 + i * 0.0001,
      severity: i === 0 ? 'critical' : 'moderate',
    })),
    {
      districtId: 'chingeltei',
      khorooNumber: 9,
      lat: 47.9611,
      lng: 106.9188,
      severity: 'critical',
    },
  ];

  const clusters = aggregateHeatPointsWithKAnonymity(incidents, centers, 5);
  const bzd = clusters.find((c) => c.districtId === 'bayanzurkh');
  const chd = clusters.find((c) => c.districtId === 'chingeltei');
  assert.ok(bzd && chd);
  assert.equal(bzd.kAnonymitySatisfied, true);
  assert.equal(bzd.khorooNumber, 27);
  assert.equal(chd.kAnonymitySatisfied, false);
  assert.equal(chd.khorooNumber, 0);
  assert.equal(chd.lat, 47.95);

  const merged = mergeSpatialHeatSources(
    [
      { lat: 47.9402, lng: 107.0112, score: 78, radiusMeters: 1200 },
      { lat: 47.7500, lng: 107.2500, score: 74, radiusMeters: 1200 },
    ],
    [{ lat: 47.9405, lng: 107.0115, score: 76, radiusMeters: 1200 }]
  );
  assert.equal(merged.length, 2);
});
