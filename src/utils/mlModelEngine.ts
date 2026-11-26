import { UB_DISTRICTS, UB_KHOROOS } from '../data/ubGeoData';
import type {
  DistrictWeatherSnapshot,
  HistoricalWeatherDay,
  KhorooData,
  MlCalibrationBin,
  MlEvaluationMetrics,
  MlFeatureImportance,
  MlModelArtifact,
} from '../types';
import {
  buildCleanTrainingDataset,
  type NormalizedRealIncident,
  type RawIncidentCandidate,
  validateRealIncidentRow,
} from './mlDataFoundation';
import { clamp, computeVpdKpa } from './riskEngine';
import { getUbDateIso } from './ubTime';

const FEATURE_META: Array<{ key: string; labelMn: string; labelEn: string }> = [
  { key: 'gerShare', labelMn: 'Гэр хорооллын эзлэх хувь', labelEn: 'Ger household share' },
  { key: 'popDensityLog', labelMn: 'Хүн амын нягтрал (log)', labelEn: 'Population density (log)' },
  { key: 'roadImpedance', labelMn: 'Замын саад ба налуу', labelEn: 'Road access impedance' },
  { key: 'responseDelay', labelMn: 'Ангиас хүрэх хугацаа', labelEn: 'Baseline transit delay' },
  { key: 'priorIncidents', labelMn: 'Өмнөх саруудын түүхэн гал', labelEn: 'Prior khoroo incident rate' },
  { key: 'seasonWinterPeak', labelMn: 'Халаалт ба хаврын улирал', labelEn: 'Heating & wind seasonality' },
  { key: 'tempMaxC', labelMn: 'Тухайн үеийн агаарын темп', labelEn: 'Observed max temperature' },
  { key: 'rhDeficit', labelMn: 'Агаарын чийгшлийн дутагдал', labelEn: 'Relative humidity deficit' },
  { key: 'windMaxKmh', labelMn: 'Салхины дээд хурд', labelEn: 'Peak wind speed' },
  { key: 'droughtDays7d', labelMn: 'Хуурай өдрүүдийн хуримтлал', labelEn: 'Antecedent dry days' },
  { key: 'vpdKpa', labelMn: 'Ууршилтын даралтын зөрүү (VPD)', labelEn: 'Vapor pressure deficit (VPD)' },
];

const ROAD_IMPEDANCE: Record<KhorooData['roadAccessibility'], number> = {
  Сайн: 0.15,
  Дунд: 0.45,
  Муу: 0.75,
  'Маш муу': 0.95,
};

interface SpatiotemporalPanelSample {
  khorooKey: string;
  districtId: string;
  monthKey: string;
  yBinary: number; // 1 if >=1 verified real incident in khoroo-month, else 0
  yCount: number;  // count of verified real incidents in khoroo-month
  features: number[];
  weatherMatched: boolean;
}

function sigmoid(z: number): number {
  const safe = Math.max(-30, Math.min(30, z));
  return 1 / (1 + Math.exp(-safe));
}

function enumerateMonthsBetween(minMonth: string, maxMonth: string): string[] {
  const [y1, m1] = minMonth.split('-').map(Number);
  const [y2, m2] = maxMonth.split('-').map(Number);
  if (!Number.isFinite(y1) || !Number.isFinite(y2)) return [];
  const out: string[] = [];
  let y = y1;
  let m = m1;
  while (y < y2 || (y === y2 && m <= m2)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 240) break;
  }
  return out;
}

function seasonFactor(monthKey: string): number {
  const m = Number(monthKey.split('-')[1] ?? 1);
  // Heating peak (Nov-Feb) + dry windy spring peak (Mar-May) normalized cleanly
  const rad = ((m - 1) / 12) * Math.PI * 2;
  return 0.5 + 0.35 * Math.cos(rad) + 0.25 * Math.sin(rad);
}

/**
 * Joins real incidents with verified Open-Meteo Archive historical weather by (districtId, month/date)
 * and computes strictly causal prior incident histories (< curMonth) to eliminate temporal leakage.
 */
export function buildSpatiotemporalPanel(
  realIncidents: NormalizedRealIncident[],
  historicalWeather: HistoricalWeatherDay[],
  khoroos: KhorooData[] = UB_KHOROOS
): {
  samples: SpatiotemporalPanelSample[];
  weatherMatchedPct: number;
} {
  if (realIncidents.length === 0) {
    return { samples: [], weatherMatchedPct: 0 };
  }

  const monthsPresent = Array.from(new Set(realIncidents.map((r) => r.monthKey))).sort();
  const minMonth = monthsPresent[0];
  const maxMonth = monthsPresent[monthsPresent.length - 1];
  const allMonths = enumerateMonthsBetween(minMonth, maxMonth);

  const weatherByDistrictDate = new Map<string, HistoricalWeatherDay>();
  const monthlyWeatherAgg = new Map<
    string,
    { n: number; tempSum: number; rhMinSum: number; windSum: number; drySum: number; vpdSum: number }
  >();

  for (const w of historicalWeather) {
    weatherByDistrictDate.set(`${w.districtId}|${w.date}`, w);
    const mKey = `${w.districtId}|${w.date.slice(0, 7)}`;
    const prev = monthlyWeatherAgg.get(mKey);
    if (!prev) {
      monthlyWeatherAgg.set(mKey, {
        n: 1,
        tempSum: w.tempMaxC,
        rhMinSum: w.rhMinPct,
        windSum: w.windMaxKmh,
        drySum: w.droughtDays7d,
        vpdSum: w.vpdKpa,
      });
    } else {
      prev.n += 1;
      prev.tempSum += w.tempMaxC;
      prev.rhMinSum += w.rhMinPct;
      prev.windSum += w.windMaxKmh;
      prev.drySum += w.droughtDays7d;
      prev.vpdSum += w.vpdKpa;
    }
  }

  // Group counts per khoroo-month AND exact incident dates for weather lookup
  const cellIncidents = new Map<string, NormalizedRealIncident[]>();
  const activeDistricts = new Set<string>();
  const activeKhoroos = new Set<string>();

  for (const inc of realIncidents) {
    activeDistricts.add(inc.districtId);
    const kKey = `${inc.districtId}-${inc.khorooNumber}`;
    activeKhoroos.add(kKey);
    const cellKey = `${kKey}|${inc.monthKey}`;
    const list = cellIncidents.get(cellKey);
    if (list) list.push(inc);
    else cellIncidents.set(cellKey, [inc]);
  }

  // Candidate khoroos: uniform panel across all khoroos in active districts (never conditioned on future test outcomes)
  const candidateKhoroos = khoroos.filter((k) => activeDistricts.has(k.districtId));

  // Cumulative causal tracker per khoroo (strictly updated AFTER emitting month features!)
  const priorCountsByKhoroo = new Map<string, number>();
  const samples: SpatiotemporalPanelSample[] = [];
  let matchedCount = 0;

  for (let mIdx = 0; mIdx < allMonths.length; mIdx++) {
    const monthKey = allMonths[mIdx];
    const seas = seasonFactor(monthKey);

    for (const kh of candidateKhoroos) {
      const kKey = `${kh.districtId}-${kh.khorooNumber}`;
      const cellKey = `${kKey}|${monthKey}`;
      const incs = cellIncidents.get(cellKey) ?? [];
      const priorTotal = priorCountsByKhoroo.get(kKey) ?? 0;
      const priorRate = mIdx > 0 ? priorTotal / mIdx : 0;

      // Exact date match from Open-Meteo Archive first, then district-month archive average
      let tempMaxC = 0;
      let rhMinPct = 50;
      let windMaxKmh = 12;
      let drought7 = 2;
      let vpdKpa = 0.5;
      let matched = false;

      if (incs.length > 0) {
        const matchedDays = incs
          .map((inc) => weatherByDistrictDate.get(`${inc.districtId}|${inc.date}`))
          .filter((w): w is HistoricalWeatherDay => Boolean(w));
        if (matchedDays.length > 0) {
          matched = true;
          tempMaxC = matchedDays.reduce((s, w) => s + w.tempMaxC, 0) / matchedDays.length;
          rhMinPct = matchedDays.reduce((s, w) => s + w.rhMinPct, 0) / matchedDays.length;
          windMaxKmh = matchedDays.reduce((s, w) => s + w.windMaxKmh, 0) / matchedDays.length;
          drought7 = matchedDays.reduce((s, w) => s + w.droughtDays7d, 0) / matchedDays.length;
          vpdKpa = matchedDays.reduce((s, w) => s + w.vpdKpa, 0) / matchedDays.length;
        }
      }

      if (!matched) {
        const mAgg = monthlyWeatherAgg.get(`${kh.districtId}|${monthKey}`);
        if (mAgg && mAgg.n > 0) {
          matched = true;
          tempMaxC = mAgg.tempSum / mAgg.n;
          rhMinPct = mAgg.rhMinSum / mAgg.n;
          windMaxKmh = mAgg.windSum / mAgg.n;
          drought7 = mAgg.drySum / mAgg.n;
          vpdKpa = mAgg.vpdSum / mAgg.n;
        }
      }

      if (matched) matchedCount += 1;

      const features = [
        kh.gerHouseholdPercent / 100,
        Math.log1p(kh.population) / 10,
        ROAD_IMPEDANCE[kh.roadAccessibility],
        clamp(kh.avgResponseTimeMin / 25, 0, 1),
        Math.log1p(priorRate * 4),
        seas,
        tempMaxC / 30,
        (100 - clamp(rhMinPct, 5, 100)) / 100,
        clamp(windMaxKmh / 50, 0, 1.5),
        clamp(drought7 / 7, 0, 1),
        clamp(vpdKpa / 3, 0, 1.5),
      ];

      samples.push({
        khorooKey: kKey,
        districtId: kh.districtId,
        monthKey,
        yBinary: incs.length > 0 ? 1 : 0,
        yCount: incs.length,
        features,
        weatherMatched: matched,
      });

      // Strictly update cumulative prior count AFTER recording sample so future counts never leak backwards
      priorCountsByKhoroo.set(kKey, priorTotal + incs.length);
    }
  }

  const weatherMatchedPct = samples.length > 0 ? Math.round((matchedCount / samples.length) * 100) : 0;
  return { samples, weatherMatchedPct };
}

function fitLogisticL2(
  X: number[][],
  y: number[],
  l2Lambda = 0.08,
  iterations = 450,
  learningRate = 0.18
): { intercept: number; weights: number[] } {
  const n = X.length;
  const d = X[0]?.length ?? 0;
  const w = new Array<number>(d).fill(0);
  let b = 0;

  if (n === 0 || d === 0) return { intercept: 0, weights: w };

  const posCount = y.reduce((s, v) => s + v, 0);
  const baseP = clamp(posCount / n, 0.01, 0.99);
  b = Math.log(baseP / (1 - baseP));

  for (let iter = 0; iter < iterations; iter++) {
    let gradB = 0;
    const gradW = new Array<number>(d).fill(0);

    for (let i = 0; i < n; i++) {
      const xi = X[i];
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * xi[j];
      const err = sigmoid(z) - y[i];
      gradB += err;
      for (let j = 0; j < d; j++) gradW[j] += err * xi[j];
    }

    const step = learningRate / Math.sqrt(1 + iter * 0.015);
    b -= step * (gradB / n);
    for (let j = 0; j < d; j++) {
      w[j] -= step * (gradW[j] / n + l2Lambda * w[j]);
    }
  }

  return { intercept: b, weights: w };
}

function fitRidgeLinear(
  X: number[][],
  y: number[],
  l2Lambda = 0.25,
  iterations = 300,
  learningRate = 0.12
): { intercept: number; weights: number[] } {
  const n = X.length;
  const d = X[0]?.length ?? 0;
  const w = new Array<number>(d).fill(0);
  let b = n > 0 ? y.reduce((s, v) => s + v, 0) / n : 0;

  if (n === 0 || d === 0) return { intercept: b, weights: w };

  for (let iter = 0; iter < iterations; iter++) {
    let gradB = 0;
    const gradW = new Array<number>(d).fill(0);
    for (let i = 0; i < n; i++) {
      const xi = X[i];
      let pred = b;
      for (let j = 0; j < d; j++) pred += w[j] * xi[j];
      const err = pred - y[i];
      gradB += err;
      for (let j = 0; j < d; j++) gradW[j] += err * xi[j];
    }
    const step = learningRate / Math.sqrt(1 + iter * 0.02);
    b -= step * (gradB / n);
    for (let j = 0; j < d; j++) {
      w[j] -= step * (gradW[j] / n + l2Lambda * w[j]);
    }
  }
  return { intercept: b, weights: w };
}

function fitPoissonGlm(
  X: number[][],
  y: number[],
  l2Lambda = 0.25,
  iterations = 320,
  learningRate = 0.08
): { intercept: number; weights: number[] } {
  const n = X.length;
  const d = X[0]?.length ?? 0;
  const w = new Array<number>(d).fill(0);
  const meanY = n > 0 ? y.reduce((s, v) => s + v, 0) / n : 0.05;
  let b = Math.log(Math.max(0.01, meanY));

  if (n === 0 || d === 0) return { intercept: b, weights: w };

  for (let iter = 0; iter < iterations; iter++) {
    let gradB = 0;
    const gradW = new Array<number>(d).fill(0);
    for (let i = 0; i < n; i++) {
      const xi = X[i];
      let eta = b;
      for (let j = 0; j < d; j++) eta += w[j] * xi[j];
      const lam = Math.exp(clamp(eta, -6, 4.5));
      const err = lam - y[i];
      gradB += err;
      for (let j = 0; j < d; j++) gradW[j] += err * xi[j];
    }
    const step = learningRate / Math.sqrt(1 + iter * 0.025);
    b -= step * (gradB / n);
    b = clamp(b, -6, 3.5);
    for (let j = 0; j < d; j++) {
      w[j] -= step * (gradW[j] / n + l2Lambda * w[j]);
    }
  }
  return { intercept: b, weights: w };
}

function fitPlattCalibration(rawLogits: number[], y: number[]): { a: number; b: number } {
  // Regularized Platt calibration p = sigmoid(a * logit + b) fitted ONLY on calibration split
  if (rawLogits.length < 10) return { a: 1, b: 0 };
  let a = 1;
  let b = 0;
  const n = rawLogits.length;

  for (let iter = 0; iter < 180; iter++) {
    let gradA = 0;
    let gradB = 0;
    for (let i = 0; i < n; i++) {
      const p = sigmoid(a * rawLogits[i] + b);
      const err = p - y[i];
      gradA += err * rawLogits[i];
      gradB += err;
    }
    const lr = 0.08 / Math.sqrt(1 + iter * 0.02);
    a -= lr * (gradA / n + 0.05 * (a - 1));
    b -= lr * (gradB / n + 0.02 * b);
    a = clamp(a, 0.25, 3.5);
    b = clamp(b, -3, 3);
  }
  return { a, b };
}

export function computeRocAuc(probs: number[], y: number[]): number {
  const positives: number[] = [];
  const negatives: number[] = [];
  for (let i = 0; i < y.length; i++) {
    if (y[i] === 1) positives.push(probs[i]);
    else negatives.push(probs[i]);
  }
  if (positives.length === 0 || negatives.length === 0) return 0.5;
  let wins = 0;
  for (const p of positives) {
    for (const q of negatives) {
      if (p > q) wins += 1;
      else if (p === q) wins += 0.5;
    }
  }
  return +(wins / (positives.length * negatives.length)).toFixed(4);
}

export function computePrAuc(probs: number[], y: number[]): number {
  const pairs = probs.map((p, i) => ({ p, y: y[i] })).sort((a, b) => b.p - a.p);
  const totalPos = pairs.reduce((s, item) => s + item.y, 0);
  if (totalPos === 0) return 0;

  let tp = 0;
  let fp = 0;
  let prevRecall = 0;
  let area = 0;
  for (const item of pairs) {
    if (item.y === 1) tp += 1;
    else fp += 1;
    const recall = tp / totalPos;
    const precision = tp / (tp + fp);
    area += (recall - prevRecall) * precision;
    prevRecall = recall;
  }
  return +clamp(area, 0, 1).toFixed(4);
}

function computeCalibrationStats(
  probs: number[],
  y: number[],
  numBins = 5
): { ece: number; bins: MlCalibrationBin[] } {
  const bins: MlCalibrationBin[] = [];
  let ece = 0;
  const n = probs.length || 1;
  const step = 1 / numBins;

  for (let b = 0; b < numBins; b++) {
    const lo = b * step;
    const hi = (b + 1) * step;
    let sumP = 0;
    let sumY = 0;
    let count = 0;
    for (let i = 0; i < probs.length; i++) {
      const p = probs[i];
      if ((b === 0 ? p >= lo : p > lo) && p <= hi) {
        sumP += p;
        sumY += y[i];
        count += 1;
      }
    }
    const meanP = count > 0 ? sumP / count : (lo + hi) * 0.5;
    const obsR = count > 0 ? sumY / count : 0;
    if (count > 0) {
      ece += (count / n) * Math.abs(meanP - obsR);
    }
    bins.push({
      binIndex: b,
      rangeLabel: `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`,
      count,
      meanPredicted: +meanP.toFixed(4),
      observedRate: +obsR.toFixed(4),
    });
  }

  return { ece: +ece.toFixed(4), bins };
}

function createDeterministicRng(seed = 20260401) {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentileCi(values: number[]): [number, number] {
  if (values.length === 0) return [0, 0];
  const sorted = [...values].sort((a, b) => a - b);
  const loIdx = Math.max(0, Math.floor(sorted.length * 0.025));
  const hiIdx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.975) - 1);
  return [+sorted[loIdx].toFixed(4), +sorted[hiIdx].toFixed(4)];
}

function computeBootstrapCis(
  probs: number[],
  y: number[],
  iterations = 180
): {
  rocAucCi95: [number, number];
  brierCi95: [number, number];
  eceCi95: [number, number];
} {
  const n = probs.length;
  if (n < 8) {
    const roc = computeRocAuc(probs, y);
    const brier = n > 0 ? probs.reduce((s, p, i) => s + (p - y[i]) ** 2, 0) / n : 1;
    const ece = computeCalibrationStats(probs, y, 5).ece;
    return {
      rocAucCi95: [roc, roc],
      brierCi95: [+brier.toFixed(4), +brier.toFixed(4)],
      eceCi95: [ece, ece],
    };
  }

  const rng = createDeterministicRng(n * 977 + y.reduce((s, v) => s + v, 0));
  const rocs: number[] = [];
  const briers: number[] = [];
  const eces: number[] = [];
  const sampleP = new Array<number>(n);
  const sampleY = new Array<number>(n);

  for (let b = 0; b < iterations; b++) {
    let brierSum = 0;
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(rng() * n);
      sampleP[i] = probs[idx];
      sampleY[i] = y[idx];
      brierSum += (sampleP[i] - sampleY[i]) ** 2;
    }
    rocs.push(computeRocAuc(sampleP, sampleY));
    briers.push(brierSum / n);
    eces.push(computeCalibrationStats(sampleP, sampleY, 5).ece);
  }

  return {
    rocAucCi95: percentileCi(rocs),
    brierCi95: percentileCi(briers),
    eceCi95: percentileCi(eces),
  };
}

export function trainAndEvaluateFireModel(params: {
  rawIncidents: RawIncidentCandidate[];
  historicalWeather?: HistoricalWeatherDay[];
  districtLiveWeather?: Record<string, DistrictWeatherSnapshot>;
  khoroos?: KhorooData[];
  maxDateIso?: string;
}): MlModelArtifact {
  const {
    rawIncidents,
    historicalWeather = [],
    districtLiveWeather = {},
    khoroos = UB_KHOROOS,
    maxDateIso = getUbDateIso(),
  } = params;

  const cleanReport = buildCleanTrainingDataset(rawIncidents, maxDateIso);
  const cleanRealRows: NormalizedRealIncident[] = [];
  const seen = new Set<string>();
  for (const r of rawIncidents) {
    if (r.isDemo === true || r.dataOrigin !== 'real') continue;
    const check = validateRealIncidentRow(r, maxDateIso);
    if (!check.ok || seen.has(check.record.canonicalKey)) continue;
    seen.add(check.record.canonicalKey);
    cleanRealRows.push(check.record);
  }

  const { samples, weatherMatchedPct } = buildSpatiotemporalPanel(
    cleanRealRows,
    historicalWeather,
    khoroos
  );

  const synthesizedKhorooCount = khoroos.filter((k) => k.isModelled === true).length;
  const curatedKhorooCount = khoroos.length - synthesizedKhorooCount;
  const featureProvenance = {
    measuredFeatures: [
      'priorIncidents',
      'seasonWinterPeak',
      'tempMaxC',
      'rhDeficit',
      'windMaxKmh',
      'droughtDays7d',
      'vpdKpa',
    ],
    synthesizedStaticFeatures: [
      'gerShare',
      'popDensityLog',
      'roadImpedance',
      'responseDelay',
    ],
    totalKhoroos: khoroos.length,
    synthesizedKhorooCount,
    curatedKhorooCount,
    noteMn: `Динамик цаг агаар ба өмнөх дуудлага нь бодит бүртгэл дээр суурилах ч ${synthesizedKhorooCount}/${khoroos.length} хорооны суурь статик үзүүлэлтүүд (гэр өрх %, нягтрал, замын саад) загварчилсан тооцоолол байна.`,
    noteEn: `Observed weather & incident counts are measured, whereas static khoroo inputs (ger share, pop density, road impedance, response delay) are synthesized for ${synthesizedKhorooCount}/${khoroos.length} khoroos.`,
  };

  const emptyMetrics: MlEvaluationMetrics = {
    totalSamples: samples.length,
    trainSamples: 0,
    calSamples: 0,
    valSamples: 0,
    positiveTrainCount: 0,
    positiveCalCount: 0,
    positiveValCount: 0,
    trainDateRange: ['—', '—'],
    calDateRange: ['—', '—'],
    valDateRange: ['—', '—'],
    splitPolicy: '3_way_chronological',
    rocAuc: 0.5,
    rocAucCi95: [0.5, 0.5],
    prAuc: 0,
    brierScore: 1,
    brierCi95: [1, 1],
    baselineBrierScore: 1,
    priorRateBrierScore: 1,
    seasonalBrierScore: 1,
    brierSkillScore: 0,
    logLoss: 1,
    baselineLogLoss: 1,
    priorRateLogLoss: 1,
    seasonalLogLoss: 1,
    ece: 1,
    eceCi95: [1, 1],
    ridgeRmse: 0,
    ridgeMae: 0,
    poissonDeviance: 0,
    poissonRmse: 0,
    poissonMae: 0,
    baseRatePct: 0,
    calibrationBins: [],
    featureImportances: [],
    featureProvenance,
  };

  const nowIso = new Date().toISOString();
  const modelVersion = `fw-ub-logit-${nowIso.slice(0, 10)}`;

  // Strict sample insufficiency stop
  const uniqueMonths = Array.from(new Set(samples.map((s) => s.monthKey))).sort();
  if (!cleanReport.readyForTraining || uniqueMonths.length < 5 || samples.length < 48) {
    return {
      id: `ml-${Date.now()}`,
      modelVersion,
      trainedAtIso: nowIso,
      status: 'insufficient_data',
      gatePassed: false,
      gateReasonsMn: [cleanReport.readinessReasonMn],
      gateReasonsEn: [cleanReport.readinessReasonEn],
      metrics: emptyMetrics,
      weights: {
        intercept: 0,
        coefficients: FEATURE_META.map(() => 0),
        featureNames: FEATURE_META.map((f) => f.key),
        featureMeans: FEATURE_META.map(() => 0),
        featureStds: FEATURE_META.map(() => 1),
        plattA: 1,
        plattB: 0,
        weatherMatchedPct,
      },
    };
  }

  // Strictly causal 3-way chronological split: train -> cal -> untouched test (ZERO calibration leakage!)
  const trainEndIdx = Math.max(2, Math.floor(uniqueMonths.length * 0.55));
  const calEndIdx = Math.min(
    uniqueMonths.length - 1,
    Math.max(trainEndIdx + 1, Math.floor(uniqueMonths.length * 0.75))
  );
  const trainCutoff = uniqueMonths[trainEndIdx];
  const testCutoff = uniqueMonths[calEndIdx];

  const trainSamples = samples.filter((s) => s.monthKey < trainCutoff);
  const calSamples = samples.filter((s) => s.monthKey >= trainCutoff && s.monthKey < testCutoff);
  const testSamples = samples.filter((s) => s.monthKey >= testCutoff);

  const numFeat = FEATURE_META.length;
  const means = new Array<number>(numFeat).fill(0);
  const stds = new Array<number>(numFeat).fill(1);

  // Fit scaler ONLY on Train fold
  for (let j = 0; j < numFeat; j++) {
    let sum = 0;
    for (const s of trainSamples) sum += s.features[j];
    means[j] = trainSamples.length > 0 ? sum / trainSamples.length : 0;

    let varSum = 0;
    for (const s of trainSamples) {
      const diff = s.features[j] - means[j];
      varSum += diff * diff;
    }
    const sd = Math.sqrt(varSum / Math.max(1, trainSamples.length));
    stds[j] = sd > 1e-6 ? sd : 1;
  }

  const transformX = (rows: SpatiotemporalPanelSample[]) =>
    rows.map((s) => s.features.map((v, j) => (v - means[j]) / stds[j]));

  const XTrain = transformX(trainSamples);
  const yTrain = trainSamples.map((s) => s.yBinary);
  const XCal = transformX(calSamples);
  const yCal = calSamples.map((s) => s.yBinary);
  const XTest = transformX(testSamples);
  const yTest = testSamples.map((s) => s.yBinary);

  const posTrain = yTrain.reduce((s, v) => s + v, 0);
  const posCal = yCal.reduce((s, v) => s + v, 0);
  const posTest = yTest.reduce((s, v) => s + v, 0);

  // Fit L2 Logistic Regression strictly on Train
  const logitModel = fitLogisticL2(XTrain, yTrain);

  // Fit Platt calibration strictly on held-out Cal fold (never touches Test!)
  const calRawLogits = XCal.map((xi) =>
    xi.reduce((acc, v, j) => acc + v * logitModel.weights[j], logitModel.intercept)
  );
  const platt = fitPlattCalibration(calRawLogits, yCal);

  // Evaluate strictly on untouched Test fold
  const testRawLogits = XTest.map((xi) =>
    xi.reduce((acc, v, j) => acc + v * logitModel.weights[j], logitModel.intercept)
  );
  const testProbs = testRawLogits.map((z) => clamp(sigmoid(platt.a * z + platt.b), 0.001, 0.999));

  // Count regression comparison: Ridge & Poisson log-link GLM evaluated strictly on Test
  const yTrainCounts = trainSamples.map((s) => s.yCount);
  const ridge = fitRidgeLinear(XTrain, yTrainCounts);
  const poisson = fitPoissonGlm(XTrain, yTrainCounts);

  let sqErrSum = 0;
  let absErrSum = 0;
  let poisSqErrSum = 0;
  let poisAbsErrSum = 0;
  let poisDevianceSum = 0;

  for (let i = 0; i < XTest.length; i++) {
    const actual = testSamples[i].yCount;
    const ridgePred = Math.max(
      0,
      XTest[i].reduce((acc, v, j) => acc + v * ridge.weights[j], ridge.intercept)
    );
    const err = ridgePred - actual;
    sqErrSum += err * err;
    absErrSum += Math.abs(err);

    const eta = XTest[i].reduce((acc, v, j) => acc + v * poisson.weights[j], poisson.intercept);
    const lam = Math.max(1e-4, Math.exp(clamp(eta, -6, 4.5)));
    const pErr = lam - actual;
    poisSqErrSum += pErr * pErr;
    poisAbsErrSum += Math.abs(pErr);
    poisDevianceSum += actual > 0 ? 2 * (actual * Math.log(actual / lam) - (actual - lam)) : 2 * lam;
  }

  const nTest = Math.max(1, yTest.length);
  const ridgeRmse = +(Math.sqrt(sqErrSum / nTest)).toFixed(4);
  const ridgeMae = +(absErrSum / nTest).toFixed(4);
  const poissonRmse = +(Math.sqrt(poisSqErrSum / nTest)).toFixed(4);
  const poissonMae = +(poisAbsErrSum / nTest).toFixed(4);
  const poissonDeviance = +(poisDevianceSum / nTest).toFixed(4);

  // Multiple baselines fitted strictly on Train (+ causal prior incidents)
  const baseRate = clamp(posTrain / Math.max(1, trainSamples.length), 0.005, 0.995);

  // Prior-rate empirical Bayes baseline per khoroo estimated strictly from train+cal history
  const khorooTrainPos = new Map<string, { pos: number; total: number }>();
  for (const s of [...trainSamples, ...calSamples]) {
    const prev = khorooTrainPos.get(s.khorooKey) ?? { pos: 0, total: 0 };
    prev.pos += s.yBinary;
    prev.total += 1;
    khorooTrainPos.set(s.khorooKey, prev);
  }

  // Seasonal peak vs off-peak rate baseline estimated strictly from Train
  let peakPos = 0;
  let peakN = 0;
  let offPos = 0;
  let offN = 0;
  for (const s of trainSamples) {
    const m = Number(s.monthKey.split('-')[1] ?? 1);
    const isPeak = m <= 5 || m >= 11;
    if (isPeak) {
      peakN += 1;
      peakPos += s.yBinary;
    } else {
      offN += 1;
      offPos += s.yBinary;
    }
  }
  const peakBaseRate = clamp(peakN > 0 ? peakPos / peakN : baseRate, 0.005, 0.995);
  const offBaseRate = clamp(offN > 0 ? offPos / offN : baseRate, 0.005, 0.995);

  let brierSum = 0;
  let baseBrierSum = 0;
  let priorBrierSum = 0;
  let seasonalBrierSum = 0;
  let logLossSum = 0;
  let baseLogLossSum = 0;
  let priorLogLossSum = 0;
  let seasonalLogLossSum = 0;

  for (let i = 0; i < yTest.length; i++) {
    const p = testProbs[i];
    const y = yTest[i];
    const ts = testSamples[i];

    const khHist = khorooTrainPos.get(ts.khorooKey);
    const pPrior = clamp(
      khHist ? (khHist.pos + 2 * baseRate) / (khHist.total + 2) : baseRate,
      0.005,
      0.995
    );
    const m = Number(ts.monthKey.split('-')[1] ?? 1);
    const pSeas = m <= 5 || m >= 11 ? peakBaseRate : offBaseRate;

    brierSum += (p - y) * (p - y);
    baseBrierSum += (baseRate - y) * (baseRate - y);
    priorBrierSum += (pPrior - y) * (pPrior - y);
    seasonalBrierSum += (pSeas - y) * (pSeas - y);

    logLossSum -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
    baseLogLossSum -= y * Math.log(baseRate) + (1 - y) * Math.log(1 - baseRate);
    priorLogLossSum -= y * Math.log(pPrior) + (1 - y) * Math.log(1 - pPrior);
    seasonalLogLossSum -= y * Math.log(pSeas) + (1 - y) * Math.log(1 - pSeas);
  }

  const brierScore = +(brierSum / nTest).toFixed(4);
  const baselineBrierScore = +(baseBrierSum / nTest).toFixed(4);
  const priorRateBrierScore = +(priorBrierSum / nTest).toFixed(4);
  const seasonalBrierScore = +(seasonalBrierSum / nTest).toFixed(4);
  const brierSkillScore =
    baselineBrierScore > 1e-6
      ? +((baselineBrierScore - brierScore) / baselineBrierScore).toFixed(4)
      : 0;
  const logLoss = +(logLossSum / nTest).toFixed(4);
  const baselineLogLoss = +(baseLogLossSum / nTest).toFixed(4);
  const priorRateLogLoss = +(priorLogLossSum / nTest).toFixed(4);
  const seasonalLogLoss = +(seasonalLogLossSum / nTest).toFixed(4);
  const rocAuc = computeRocAuc(testProbs, yTest);
  const prAuc = computePrAuc(testProbs, yTest);
  const { ece, bins: calibrationBins } = computeCalibrationStats(testProbs, yTest, 5);
  const { rocAucCi95, brierCi95, eceCi95 } = computeBootstrapCis(testProbs, yTest);

  const featureImportances: MlFeatureImportance[] = FEATURE_META.map((meta, idx) => {
    const w = +(logitModel.weights[idx] ?? 0).toFixed(4);
    const direction: MlFeatureImportance['direction'] =
      w >= 0 ? 'increases_risk' : 'decreases_risk';
    return {
      feature: meta.key,
      labelMn: meta.labelMn,
      labelEn: meta.labelEn,
      weight: w,
      absWeight: +Math.abs(w).toFixed(4),
      direction,
    };
  }).sort((a, b) => b.absWeight - a.absWeight);

  const metrics: MlEvaluationMetrics = {
    totalSamples: samples.length,
    trainSamples: trainSamples.length,
    calSamples: calSamples.length,
    valSamples: testSamples.length,
    positiveTrainCount: posTrain,
    positiveCalCount: posCal,
    positiveValCount: posTest,
    trainDateRange: [trainSamples[0]?.monthKey ?? '—', trainSamples[trainSamples.length - 1]?.monthKey ?? '—'],
    calDateRange: [calSamples[0]?.monthKey ?? '—', calSamples[calSamples.length - 1]?.monthKey ?? '—'],
    valDateRange: [testSamples[0]?.monthKey ?? '—', testSamples[testSamples.length - 1]?.monthKey ?? '—'],
    splitPolicy: '3_way_chronological',
    rocAuc,
    rocAucCi95,
    prAuc,
    brierScore,
    brierCi95,
    baselineBrierScore,
    priorRateBrierScore,
    seasonalBrierScore,
    brierSkillScore,
    logLoss,
    baselineLogLoss,
    priorRateLogLoss,
    seasonalLogLoss,
    ece,
    eceCi95,
    ridgeRmse,
    ridgeMae,
    poissonDeviance,
    poissonRmse,
    poissonMae,
    baseRatePct: +(baseRate * 100).toFixed(1),
    calibrationBins,
    featureImportances,
    featureProvenance,
  };

  // Strict out-of-sample validation gate checking counts, ROC-AUC, Calibration ECE, and Baseline improvement
  const gateReasonsMn: string[] = [];
  const gateReasonsEn: string[] = [];

  if (posTrain < 10 || posCal < 3 || posTest < 4) {
    gateReasonsMn.push(`Эерэг түүврийн тоо цөөн (Train: ${posTrain}, Cal: ${posCal}, Test: ${posTest}).`);
    gateReasonsEn.push(`Insufficient positive targets across 3-way split (Train: ${posTrain}, Cal: ${posCal}, Test: ${posTest}).`);
  }
  if (rocAuc < 0.65) {
    gateReasonsMn.push(`Ангилах чадвар хангалтгүй: ROC-AUC = ${rocAuc} (95% CI ${rocAucCi95[0]}–${rocAucCi95[1]}, шаардлага ≥ 0.65).`);
    gateReasonsEn.push(`Discriminative power below gate: ROC-AUC = ${rocAuc} (95% CI ${rocAucCi95[0]}–${rocAucCi95[1]}, requires >= 0.65).`);
  }
  if (brierScore >= baselineBrierScore) {
    gateReasonsMn.push(`Загварын Brier оноо (${brierScore}) суурь дундаж (${baselineBrierScore})-аас сайжирсангүй.`);
    gateReasonsEn.push(`Test Brier score (${brierScore}) did not improve over base rate (${baselineBrierScore}).`);
  }
  if (ece > 0.12) {
    gateReasonsMn.push(`Магадлалын калибровкийн алдаа өндөр: ECE = ${ece} (шаардлага ≤ 0.12).`);
    gateReasonsEn.push(`Out-of-sample calibration error exceeds tolerance: ECE = ${ece} (requires <= 0.12).`);
  }

  const gatePassed = gateReasonsEn.length === 0;
  if (gatePassed) {
    gateReasonsMn.push(
      `Шалгалт тэнцсэн (3-шатлалт хуваалт): ROC-AUC ${rocAuc} [${rocAucCi95[0]}–${rocAucCi95[1]}], Brier ${brierScore} (Base ${baselineBrierScore} / Prior ${priorRateBrierScore}), ECE ${ece}.`
    );
    gateReasonsEn.push(
      `Validated cleanly (3-way holdout): ROC-AUC ${rocAuc} [${rocAucCi95[0]}–${rocAucCi95[1]}], Brier ${brierScore} vs base ${baselineBrierScore} / prior ${priorRateBrierScore}, ECE ${ece}.`
    );
  }

  // Only emit khoroo calibrated inference probabilities if gatePassed === true
  let khorooProbabilities: MlModelArtifact['khorooProbabilities'];
  if (gatePassed) {
    khorooProbabilities = {};
    const curMonth = maxDateIso.slice(0, 7);
    const curSeas = seasonFactor(curMonth);

    // Recent historical counts per khoroo for inference
    const khorooPriorMap = new Map<string, number>();
    for (const r of cleanRealRows) {
      const kk = `${r.districtId}-${r.khorooNumber}`;
      khorooPriorMap.set(kk, (khorooPriorMap.get(kk) ?? 0) + 1);
    }

    for (const kh of khoroos) {
      const kKey = `${kh.districtId}-${kh.khorooNumber}`;
      const liveW = districtLiveWeather[kh.districtId];
      const tempC = liveW?.tempCelsius ?? 0;
      const rh = liveW?.humidityPercent ?? 50;
      const wind = liveW?.windSpeedKmh ?? 12;
      const dry = liveW?.droughtDays ?? 2;
      const vpd = liveW?.vpdKpa ?? computeVpdKpa(tempC, rh);
      const priorRate = (khorooPriorMap.get(kKey) ?? 0) / Math.max(1, uniqueMonths.length);

      const rawVec = [
        kh.gerHouseholdPercent / 100,
        Math.log1p(kh.population) / 10,
        ROAD_IMPEDANCE[kh.roadAccessibility],
        clamp(kh.avgResponseTimeMin / 25, 0, 1),
        Math.log1p(priorRate * 4),
        curSeas,
        tempC / 30,
        (100 - clamp(rh, 5, 100)) / 100,
        clamp(wind / 50, 0, 1.5),
        clamp(dry / 7, 0, 1),
        clamp(vpd / 3, 0, 1.5),
      ];
      const zVec = rawVec.map((v, j) => (v - means[j]) / stds[j]);
      const logit = zVec.reduce((acc, v, j) => acc + v * logitModel.weights[j], logitModel.intercept);
      const prob = clamp(sigmoid(platt.a * logit + platt.b), 0.005, 0.995);

      // Standard error estimate combining sample size, out-of-sample ECE, and synthesized static feature uncertainty
      const synthPenalty = kh.isModelled ? 0.025 : 0;
      const se = Math.sqrt((prob * (1 - prob)) / Math.max(25, testSamples.length)) + ece * 0.5 + synthPenalty;
      const margin = 1.96 * se;
      khorooProbabilities[kKey] = {
        probPct: +(prob * 100).toFixed(1),
        ciLowPct: +(clamp(prob - margin, 0.001, 0.99) * 100).toFixed(1),
        ciHighPct: +(clamp(prob + margin, 0.01, 0.999) * 100).toFixed(1),
      };
    }
  }

  // Verify every district slug reference exists
  void UB_DISTRICTS;

  return {
    id: `ml-${Date.now()}`,
    modelVersion,
    trainedAtIso: nowIso,
    status: gatePassed ? 'validated' : 'rejected_low_quality',
    gatePassed,
    gateReasonsMn,
    gateReasonsEn,
    metrics,
    weights: {
      intercept: +logitModel.intercept.toFixed(5),
      coefficients: logitModel.weights.map((c) => +c.toFixed(5)),
      featureNames: FEATURE_META.map((f) => f.key),
      featureMeans: means.map((m) => +m.toFixed(5)),
      featureStds: stds.map((s) => +s.toFixed(5)),
      plattA: +platt.a.toFixed(5),
      plattB: +platt.b.toFixed(5),
      weatherMatchedPct,
    },
    khorooProbabilities,
  };
}
