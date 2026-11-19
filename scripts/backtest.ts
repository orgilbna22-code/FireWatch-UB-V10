/**
 * FIREWATCH UB — Deterministic Model Soundness & Demo-Proxy Check
 *
 * Strictly verifies:
 *  1) Formula consistency across 9 UB districts and 204 UB khoroos
 *  2) Monotonicity under synthetic weather / housing stress steps
 *  3) Spearman rank correlation against bundled DEMO_HISTORICAL_INCIDENTS
 *     (explicitly documented as an uncalibrated demo proxy — NOT real NEMA backtesting)
 */
import assert from 'node:assert/strict';
import {
  DEMO_HISTORICAL_INCIDENTS,
  UB_DISTRICTS,
  UB_KHOROOS,
} from '../src/data/ubGeoData';
import {
  computeFireWeatherBreakdown,
  computeSynthesizedKhorooScore,
  computeWeightedDistrictRisk,
  riskLevelFromScore,
} from '../src/utils/riskEngine';

function spearmanRankCorrelation(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2 || n !== ys.length) return 0;

  const rank = (arr: number[]) => {
    const indexed = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array<number>(n).fill(0);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && indexed[j + 1].v === indexed[i].v) j++;
      const avgRank = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[indexed[k].i] = avgRank;
      i = j + 1;
    }
    return ranks;
  };

  const rx = rank(xs);
  const ry = rank(ys);
  let sumD2 = 0;
  for (let i = 0; i < n; i++) {
    const d = rx[i] - ry[i];
    sumD2 += d * d;
  }
  return 1 - (6 * sumD2) / (n * (n * n - 1));
}

function main() {
  console.log('=== FIREWATCH UB — Model Validation & Monotonicity Check ===');
  console.log('Note: Historical logs below are bundled DEMO records; true calibration requires official NEMA history.\n');

  // 1. Structural & Threshold Integrity
  for (const d of UB_DISTRICTS) {
    const computed = computeWeightedDistrictRisk(d);
    assert.equal(d.riskScore, computed.score, `District ${d.id} score mismatch`);
    assert.equal(d.riskLevel, riskLevelFromScore(d.riskScore), `District ${d.id} level mismatch`);
  }
  for (const k of UB_KHOROOS) {
    assert.equal(k.riskLevel, riskLevelFromScore(k.riskScore), `Khoroo ${k.id} level mismatch`);
  }
  console.log(`[PASS] All ${UB_DISTRICTS.length} districts and ${UB_KHOROOS.length} khoroos strictly match riskEngine thresholds.`);

  // 2. Weather FWI Monotonicity Check
  const calmWet = computeFireWeatherBreakdown({
    tempCelsius: -2,
    humidityPercent: 72,
    windSpeedKmh: 4,
    gustKmh: 7,
    precipitationMm: 2.5,
    droughtDays: 0,
  });
  const windyDry = computeFireWeatherBreakdown({
    tempCelsius: 14,
    humidityPercent: 18,
    windSpeedKmh: 38,
    gustKmh: 58,
    precipitationMm: 0,
    droughtDays: 14,
  });
  assert.ok(windyDry.fireWeatherIndex > calmWet.fireWeatherIndex, 'FWI must rise in hot/dry/windy conditions');
  assert.ok(windyDry.ignitionReceptivity > calmWet.ignitionReceptivity, 'Ignition receptivity must rise');
  assert.ok(windyDry.spreadPotential > calmWet.spreadPotential, 'Spread potential must rise with wind');
  console.log(
    `[PASS] Weather monotonicity: calm/wet FWI=${calmWet.fireWeatherIndex} -> dry/windy FWI=${windyDry.fireWeatherIndex}`
  );

  // 3. Khoroo Structural Sensitivity Monotonicity Check
  const lowGerKhoroo = computeSynthesizedKhorooScore({
    gerHouseholdPercent: 15,
    roadAccessibility: 'Сайн',
    fireHydrantCount: 10,
    avgResponseTimeMin: 6,
    population: 12000,
  });
  const highGerKhoroo = computeSynthesizedKhorooScore({
    gerHouseholdPercent: 88,
    roadAccessibility: 'Маш муу',
    fireHydrantCount: 2,
    avgResponseTimeMin: 20,
    population: 32000,
  });
  assert.ok(highGerKhoroo > lowGerKhoroo, 'Higher ger/road/delay exposure must yield higher index');
  console.log(
    `[PASS] Khoroo sensitivity: low-exposure=${lowGerKhoroo} -> high-exposure=${highGerKhoroo}`
  );

  // 4. Demo Incident Proxy Correlation (Uncalibrated Check Only)
  const demoCounts = new Map<string, number>();
  for (const inc of DEMO_HISTORICAL_INCIDENTS) {
    demoCounts.set(inc.districtId, (demoCounts.get(inc.districtId) ?? 0) + 1);
  }
  const districtScores = UB_DISTRICTS.map((d) => d.riskScore);
  const demoIncPerDistrict = UB_DISTRICTS.map((d) => demoCounts.get(d.id) ?? 0);
  const rho = spearmanRankCorrelation(districtScores, demoIncPerDistrict);
  console.log(
    `[INFO] Spearman rho vs bundled DEMO incidents (n=${DEMO_HISTORICAL_INCIDENTS.length}): rho=${rho.toFixed(3)} (demo proxy only — not empirical accuracy).`
  );
}

main();
