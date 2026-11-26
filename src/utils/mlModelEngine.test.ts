import test from 'node:test';
import assert from 'node:assert/strict';
import { UB_DISTRICTS, UB_KHOROOS } from '../data/ubGeoData';
import type { HistoricalWeatherDay } from '../types';
import type { RawIncidentCandidate } from './mlDataFoundation';
import { trainAndEvaluateFireModel } from './mlModelEngine';

function buildBenchmarkDataset(options: {
  count: number;
  months: string[];
  signalStrong: boolean;
}): {
  incidents: RawIncidentCandidate[];
  weather: HistoricalWeatherDay[];
} {
  const districts = UB_DISTRICTS.slice(0, 8);
  const khoroosByDistrict = new Map<string, typeof UB_KHOROOS>();
  for (const d of districts) {
    khoroosByDistrict.set(
      d.id,
      UB_KHOROOS.filter((k) => k.districtId === d.id).sort(
        (a, b) => b.gerHouseholdPercent - a.gerHouseholdPercent
      )
    );
  }

  const weather: HistoricalWeatherDay[] = [];
  for (const month of options.months) {
    const dayDate = `${month}-15`;
    const mNum = Number(month.split('-')[1]);
    const isPeak = mNum <= 4 || mNum >= 11;
    for (let dIdx = 0; dIdx < districts.length; dIdx++) {
      const dist = districts[dIdx];
      // Deterministic contrast across districts & months when signalStrong is true
      const highFireDay = options.signalStrong ? (isPeak && dIdx % 2 === 0) || mNum === 3 || mNum === 12 : dIdx % 2 === 0;
      weather.push({
        districtId: dist.id,
        date: dayDate,
        tempMeanC: isPeak ? -8 : 14,
        tempMaxC: highFireDay ? 12 : -2,
        rhMinPct: highFireDay ? 18 : 62,
        windMaxKmh: highFireDay ? 38 : 10,
        precipSumMm: highFireDay ? 0 : 4.5,
        vpdKpa: highFireDay ? 1.45 : 0.25,
        droughtDays7d: highFireDay ? 7 : 0,
        lag3dRhMin: highFireDay ? 20 : 60,
        provider: 'open-meteo-archive',
      });
    }
  }

  const incidents: RawIncidentCandidate[] = [];
  for (let i = 0; i < options.count; i++) {
    const month = options.months[i % options.months.length];
    const day = String(1 + (i % 24)).padStart(2, '0');
    const mNum = Number(month.split('-')[1]);
    const isPeak = mNum <= 4 || mNum >= 11;

    // Pick district/khoroo according to signalStrong vs random uniform
    const dIdx = options.signalStrong
      ? isPeak
        ? i % 3 // Concentrate in first few high-ger districts during winter/spring peak
        : i % districts.length
      : (i * 7 + Number(day)) % districts.length;
    const dist = districts[dIdx];
    const khList = khoroosByDistrict.get(dist.id) ?? [];
    const khIdx = options.signalStrong
      ? i % Math.min(3, khList.length)
      : (i * 13 + mNum) % Math.max(1, khList.length);
    const kh = khList[khIdx] ?? UB_KHOROOS[0];

    incidents.push({
      id: `real-ml-${i + 1}`,
      date: `${month}-${day}`,
      districtId: dist.id,
      khorooNumber: kh.khorooNumber,
      category: kh.gerHouseholdPercent > 40 ? 'residential_ger' : 'electrical',
      severity: i % 3 === 0 ? 'critical' : 'moderate',
      causeGuessMn: 'Зуух яндан болон цахилгааны гэмтэл',
      responseTimeMin: Math.max(5, Math.round(kh.avgResponseTimeMin)),
      lat: +(kh.center[0] + (i % 5) * 0.0007).toFixed(5),
      lng: +(kh.center[1] + (i % 7) * 0.0007).toFixed(5),
      source: 'NEMA-BENCH',
      dataOrigin: 'real',
    });
  }

  return { incidents, weather };
}

test('trainAndEvaluateFireModel strictly locks status as insufficient_data below 200 real rows', () => {
  const { incidents, weather } = buildBenchmarkDataset({
    count: 90,
    months: ['2024-10', '2024-11', '2024-12', '2025-01', '2025-02', '2025-03'],
    signalStrong: true,
  });

  const artifact = trainAndEvaluateFireModel({
    rawIncidents: incidents,
    historicalWeather: weather,
    maxDateIso: '2026-04-01',
  });

  assert.equal(artifact.status, 'insufficient_data');
  assert.equal(artifact.gatePassed, false);
  assert.equal(artifact.khorooProbabilities, undefined);
});

test('trainAndEvaluateFireModel validates causal temporal model when signal passes ROC-AUC, Brier, and ECE gates', () => {
  const months = [
    '2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06',
    '2024-07', '2024-08', '2024-09', '2024-10', '2024-11', '2024-12',
    '2025-01', '2025-02', '2025-03',
  ];
  const { incidents, weather } = buildBenchmarkDataset({
    count: 260,
    months,
    signalStrong: true,
  });

  const artifact = trainAndEvaluateFireModel({
    rawIncidents: incidents,
    historicalWeather: weather,
    maxDateIso: '2026-04-01',
  });

  assert.equal(artifact.status, 'validated');
  assert.equal(artifact.gatePassed, true);
  assert.ok(artifact.metrics.rocAuc >= 0.65, `Expected ROC-AUC >= 0.65, got ${artifact.metrics.rocAuc}`);
  assert.ok(
    artifact.metrics.brierScore < artifact.metrics.baselineBrierScore,
    `Expected Brier ${artifact.metrics.brierScore} < baseline ${artifact.metrics.baselineBrierScore}`
  );
  assert.ok(artifact.metrics.ece <= 0.12, `Expected ECE <= 0.12, got ${artifact.metrics.ece}`);
  assert.ok(artifact.weights.weatherMatchedPct > 90);
  assert.ok(artifact.metrics.trainDateRange[1] < artifact.metrics.valDateRange[0], 'Temporal split must be strictly causal');
  assert.ok(artifact.khorooProbabilities && Object.keys(artifact.khorooProbabilities).length === UB_KHOROOS.length);

  const sampleProb = Object.values(artifact.khorooProbabilities!)[0];
  assert.ok(sampleProb.ciLowPct <= sampleProb.probPct && sampleProb.probPct <= sampleProb.ciHighPct);
});

test('trainAndEvaluateFireModel locks probabilities (rejected_low_quality) when signal is weak/uninformative', () => {
  const months = [
    '2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06',
    '2024-07', '2024-08', '2024-09', '2024-10', '2024-11', '2024-12',
  ];
  const { weather } = buildBenchmarkDataset({ count: 220, months, signalStrong: true });
  const districts = UB_DISTRICTS.slice(0, 8);
  const highGerPool = districts
    .map((d) => UB_KHOROOS.filter((k) => k.districtId === d.id).sort((a, b) => b.gerHouseholdPercent - a.gerHouseholdPercent)[0])
    .filter(Boolean);
  const lowGerPool = districts
    .map((d) => UB_KHOROOS.filter((k) => k.districtId === d.id).sort((a, b) => a.gerHouseholdPercent - b.gerHouseholdPercent)[0])
    .filter(Boolean);

  const regimeShiftedIncidents: RawIncidentCandidate[] = Array.from({ length: 240 }, (_, i) => {
    const mIdx = i % months.length;
    const month = months[mIdx];
    const pool = mIdx < 8 ? highGerPool : lowGerPool;
    const kh = pool[i % pool.length];
    return {
      id: `shift-${i}`,
      date: `${month}-${String(1 + (i % 26)).padStart(2, '0')}`,
      districtId: kh.districtId,
      khorooNumber: kh.khorooNumber,
      category: 'electrical',
      severity: 'minor',
      causeGuessMn: 'Шалгалтын сарнисан өгөгдөл',
      responseTimeMin: 10,
      lat: +(kh.center[0] + (Math.floor(i / 8) % 10) * 0.0003 + (i % 3) * 0.0002).toFixed(5),
      lng: +(kh.center[1] + (Math.floor(i / 12) % 10) * 0.0003).toFixed(5),
      dataOrigin: 'real',
    };
  });

  const artifact = trainAndEvaluateFireModel({
    rawIncidents: regimeShiftedIncidents,
    historicalWeather: weather,
    maxDateIso: '2026-04-01',
  });

  assert.equal(artifact.gatePassed, false);
  assert.equal(artifact.status, 'rejected_low_quality');
  assert.equal(artifact.khorooProbabilities, undefined);
});

test('Platt calibration and weights are strictly invariant to test-split labels (zero calibration leakage)', () => {
  const months = [
    '2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06',
    '2024-07', '2024-08', '2024-09', '2024-10', '2024-11', '2024-12',
    '2025-01', '2025-02', '2025-03',
  ];
  const { incidents, weather } = buildBenchmarkDataset({
    count: 260,
    months,
    signalStrong: true,
  });

  const baselineArtifact = trainAndEvaluateFireModel({
    rawIncidents: incidents,
    historicalWeather: weather,
    maxDateIso: '2026-04-01',
  });

  assert.equal(baselineArtifact.metrics.splitPolicy, '3_way_chronological');
  assert.ok(baselineArtifact.metrics.calSamples && baselineArtifact.metrics.calSamples > 0);
  assert.ok(baselineArtifact.metrics.calDateRange);
  assert.ok(
    baselineArtifact.metrics.trainDateRange[1] < baselineArtifact.metrics.calDateRange![0],
    'Train must strictly precede Calibration split'
  );
  assert.ok(
    baselineArtifact.metrics.calDateRange![1] < baselineArtifact.metrics.valDateRange[0],
    'Calibration must strictly precede Test split'
  );

  // Verify 95% CIs, stronger baselines, Poisson GLM, and featureProvenance
  const m = baselineArtifact.metrics;
  assert.ok(m.rocAucCi95 && m.rocAucCi95[0] <= m.rocAuc && m.rocAuc <= m.rocAucCi95[1]);
  assert.ok(m.brierCi95 && m.brierCi95[0] <= m.brierScore && m.brierScore <= m.brierCi95[1]);
  assert.ok(m.eceCi95 && m.eceCi95[0] <= m.eceCi95[1]);
  assert.equal(typeof m.priorRateBrierScore, 'number');
  assert.equal(typeof m.seasonalBrierScore, 'number');
  assert.equal(typeof m.poissonDeviance, 'number');
  assert.equal(typeof m.poissonRmse, 'number');
  assert.equal(m.featureProvenance?.synthesizedKhorooCount, UB_KHOROOS.filter((k) => k.isModelled).length);

  // Flip/move incidents ONLY inside the Test split (months >= valDateRange[0])
  const testStartMonth = m.valDateRange[0];
  const perturbedIncidents = incidents.map((inc, idx) => {
    if ((inc.date ?? '').slice(0, 7) >= testStartMonth) {
      const altKhoroo = UB_KHOROOS[(idx * 17) % UB_KHOROOS.length];
      return {
        ...inc,
        districtId: altKhoroo.districtId,
        khorooNumber: altKhoroo.khorooNumber,
        lat: +(altKhoroo.center[0] + 0.0004).toFixed(5),
        lng: +(altKhoroo.center[1] + 0.0004).toFixed(5),
      };
    }
    return inc;
  });

  const perturbedArtifact = trainAndEvaluateFireModel({
    rawIncidents: perturbedIncidents,
    historicalWeather: weather,
    maxDateIso: '2026-04-01',
  });

  assert.equal(perturbedArtifact.weights.plattA, baselineArtifact.weights.plattA);
  assert.equal(perturbedArtifact.weights.plattB, baselineArtifact.weights.plattB);
  assert.equal(perturbedArtifact.weights.intercept, baselineArtifact.weights.intercept);
  assert.deepEqual(perturbedArtifact.weights.coefficients, baselineArtifact.weights.coefficients);
});
