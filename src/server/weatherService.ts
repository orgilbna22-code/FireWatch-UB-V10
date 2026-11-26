import { UB_DISTRICT_SEED_MAP, UB_DISTRICT_SEEDS } from '../data/districtCenters.ts';
import type { DistrictWeatherSnapshot, HistoricalWeatherDay } from '../types/index.ts';
import { computeFireWeatherBreakdown, computeVpdKpa } from '../utils/riskEngine.ts';
import { getUbDateIso } from '../utils/ubTime.ts';
import type { createFireWatchDb, StoredIncident } from './db.ts';

export interface DailySlice {
  date: string;
  tempMaxC: number;
  tempMinC: number;
  precipitationMm: number;
  windMaxKmh: number;
  humidityMaxPct: number;
}

interface OpenMeteoForecastBlock {
  current?: Record<string, number | string>;
  daily?: {
    time?: string[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_sum?: number[];
    wind_speed_10m_max?: number[];
    relative_humidity_2m_max?: number[];
  };
  utc_offset_seconds?: number;
}

interface OpenMeteoArchiveBlock {
  daily?: {
    time?: string[];
    temperature_2m_mean?: number[];
    temperature_2m_max?: number[];
    relative_humidity_2m_min?: number[];
    wind_speed_10m_max?: number[];
    precipitation_sum?: number[];
  };
}

export function countDroughtDays(daily: DailySlice[], todayIso: string): number {
  let i = daily.findIndex((d) => d.date >= todayIso);
  if (i === -1) i = daily.length - 1;
  let days = 0;
  for (; i >= 0; i--) {
    if (daily[i].precipitationMm < 0.2) days += 1;
    else break;
  }
  return days;
}

function parseForecastBlock(
  districtId: string,
  json: OpenMeteoForecastBlock,
  fetchedAtMs: number
): { snapshot: Omit<DistrictWeatherSnapshot, 'isLive'>; daily: DailySlice[]; utcOffsetSeconds: number } {
  const c = json.current;
  if (!c) throw new Error(`Missing current block for ${districtId}`);

  const tempCelsius = Math.round(Number(c.temperature_2m) * 10) / 10;
  const humidityPercent = Math.round(Number(c.relative_humidity_2m));
  const windSpeedKmh = Math.round(Number(c.wind_speed_10m) * 10) / 10;
  const windDirectionDeg = Math.round(Number(c.wind_direction_10m ?? 0));
  const gustKmh = Math.round(Number(c.wind_gusts_10m || windSpeedKmh * 1.4));
  const apparentCelsius = Math.round(Number(c.apparent_temperature ?? tempCelsius) * 10) / 10;
  const precipitationMm = Math.round(Number(c.precipitation ?? 0) * 10) / 10;
  const weatherCode = Number(c.weather_code ?? 0);

  if ([tempCelsius, humidityPercent, windSpeedKmh].some((n) => Number.isNaN(n))) {
    throw new Error(`Invalid numeric observation for ${districtId}`);
  }

  const daily: DailySlice[] = (json.daily?.time ?? []).map((date, i) => ({
    date,
    tempMaxC: Number(json.daily?.temperature_2m_max?.[i] ?? 0),
    tempMinC: Number(json.daily?.temperature_2m_min?.[i] ?? 0),
    precipitationMm: Number(json.daily?.precipitation_sum?.[i] ?? 0),
    windMaxKmh: Number(json.daily?.wind_speed_10m_max?.[i] ?? 0),
    humidityMaxPct: Number(json.daily?.relative_humidity_2m_max?.[i] ?? 60),
  }));

  const ubToday = getUbDateIso();
  const observedAtIso = String(c.time ?? `${ubToday}T00:00`);
  const droughtDays = countDroughtDays(daily, observedAtIso.slice(0, 10));
  const breakdown = computeFireWeatherBreakdown({
    tempCelsius,
    humidityPercent,
    windSpeedKmh,
    gustKmh,
    precipitationMm,
    droughtDays,
  });

  return {
    snapshot: {
      districtId,
      observedAtIso,
      tempCelsius,
      apparentCelsius,
      humidityPercent,
      windSpeedKmh,
      windDirectionDeg,
      gustKmh,
      precipitationMm,
      weatherCode,
      droughtDays,
      vpdKpa: computeVpdKpa(tempCelsius, humidityPercent),
      fireWeatherIndex: breakdown.fireWeatherIndex,
      ignitionReceptivity: breakdown.ignitionReceptivity,
      spreadPotential: breakdown.spreadPotential,
      provider: 'Open-Meteo',
      fetchedAtMs,
    },
    daily,
    utcOffsetSeconds: Number(json.utc_offset_seconds ?? 28800),
  };
}

/**
 * Fetches live observations across all 9 Ulaanbaatar districts in a single
 * batched Open-Meteo multi-point request, saves each district snapshot AND
 * computes the metropolitan summary observation.
 */
export async function fetchAllDistrictsOpenMeteo(
  db: ReturnType<typeof createFireWatchDb>
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9500);
  const lats = UB_DISTRICT_SEEDS.map((d) => d.lat).join(',');
  const lngs = UB_DISTRICT_SEEDS.map((d) => d.lng).join(',');

  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lats}&longitude=${lngs}` +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,relative_humidity_2m_max' +
    '&past_days=10&forecast_days=7&timezone=Asia%2FUlaanbaatar';

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const jsonRaw = (await res.json()) as OpenMeteoForecastBlock | OpenMeteoForecastBlock[];
    const blocks: OpenMeteoForecastBlock[] = Array.isArray(jsonRaw) ? jsonRaw : [jsonRaw];

    const fetchedAtMs = Date.now();
    const snapshots: Array<Omit<DistrictWeatherSnapshot, 'isLive'>> = [];
    let primaryDaily: DailySlice[] = [];
    let primaryUtcOffset = 28800;

    for (let i = 0; i < UB_DISTRICT_SEEDS.length; i++) {
      const seed = UB_DISTRICT_SEEDS[i];
      const block = blocks[i] ?? blocks[0];
      if (!block) continue;
      const parsed = parseForecastBlock(seed.id, block, fetchedAtMs);
      snapshots.push(parsed.snapshot);
      if (i === 0) {
        primaryDaily = parsed.daily;
        primaryUtcOffset = parsed.utcOffsetSeconds;
      }
    }

    if (snapshots.length === 0) {
      throw new Error('Empty Open-Meteo multi-district observation payload');
    }

    db.saveDistrictWeatherBatch(snapshots);

    const n = snapshots.length;
    const meanTemp = Math.round((snapshots.reduce((s, d) => s + d.tempCelsius, 0) / n) * 10) / 10;
    const meanApparent = Math.round((snapshots.reduce((s, d) => s + d.apparentCelsius, 0) / n) * 10) / 10;
    const meanRh = Math.round(snapshots.reduce((s, d) => s + d.humidityPercent, 0) / n);
    const meanWind = Math.round((snapshots.reduce((s, d) => s + d.windSpeedKmh, 0) / n) * 10) / 10;
    const meanGust = Math.round(snapshots.reduce((s, d) => s + d.gustKmh, 0) / n);
    const meanPrecip = Math.round((snapshots.reduce((s, d) => s + d.precipitationMm, 0) / n) * 10) / 10;
    const meanDrought = Math.round(snapshots.reduce((s, d) => s + d.droughtDays, 0) / n);
    const first = snapshots[0];

    const metroBreakdown = computeFireWeatherBreakdown({
      tempCelsius: meanTemp,
      humidityPercent: meanRh,
      windSpeedKmh: meanWind,
      gustKmh: meanGust,
      precipitationMm: meanPrecip,
      droughtDays: meanDrought,
    });

    const savedMetro = db.saveWeather({
      fetchedAtMs,
      observedAtIso: first.observedAtIso,
      tempCelsius: meanTemp,
      apparentCelsius: meanApparent,
      humidityPercent: meanRh,
      windSpeedKmh: meanWind,
      windDirectionDeg: first.windDirectionDeg,
      gustKmh: meanGust,
      precipitationMm: meanPrecip,
      weatherCode: first.weatherCode,
      droughtDays: meanDrought,
      fireWeatherIndex: metroBreakdown.fireWeatherIndex,
      ignitionReceptivity: metroBreakdown.ignitionReceptivity,
      spreadPotential: metroBreakdown.spreadPotential,
      utcOffsetSeconds: primaryUtcOffset,
      dailyJson: JSON.stringify(primaryDaily),
      provider: 'Open-Meteo (9-district)',
    });

    const districts: Record<string, DistrictWeatherSnapshot> = {};
    for (const s of snapshots) {
      districts[s.districtId] = { ...s, isLive: true };
    }

    return { savedMetro, districts };
  } finally {
    clearTimeout(timer);
  }
}

function addDaysIso(dateIso: string, deltaDays: number): string {
  const dt = new Date(`${dateIso}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

/**
 * Queries Open-Meteo Historical Archive (`archive-api.open-meteo.com/v1/archive`)
 * to join real historical meteorological readings (plus 3d & 7d antecedent dryness)
 * onto uploaded verified fire incidents by district and date.
 */
export async function syncHistoricalWeatherForRealIncidents(
  db: ReturnType<typeof createFireWatchDb>,
  realIncidents: StoredIncident[]
): Promise<{
  fetchedDays: number;
  districtsSynced: number;
  cachedTotal: number;
  errors: string[];
}> {
  if (realIncidents.length === 0) {
    return { fetchedDays: 0, districtsSynced: 0, cachedTotal: db.listHistoricalWeather().length, errors: [] };
  }

  const existing = new Set(
    db.listHistoricalWeather().map((w) => `${w.districtId}|${w.date}`)
  );

  // Determine min..max span per district where at least one date is missing
  const spanByDistrict = new Map<string, { minDate: string; maxDate: string; missingCount: number }>();
  for (const inc of realIncidents) {
    if (!UB_DISTRICT_SEED_MAP.has(inc.districtId)) continue;
    const prev = spanByDistrict.get(inc.districtId);
    const isMissing = !existing.has(`${inc.districtId}|${inc.date}`);
    if (!prev) {
      spanByDistrict.set(inc.districtId, {
        minDate: inc.date,
        maxDate: inc.date,
        missingCount: isMissing ? 1 : 0,
      });
    } else {
      if (inc.date < prev.minDate) prev.minDate = inc.date;
      if (inc.date > prev.maxDate) prev.maxDate = inc.date;
      if (isMissing) prev.missingCount += 1;
    }
  }

  const maxAllowedArchiveEnd = addDaysIso(getUbDateIso(), -2);
  let fetchedDays = 0;
  let districtsSynced = 0;
  const errors: string[] = [];

  for (const [districtId, span] of spanByDistrict.entries()) {
    if (span.missingCount === 0) continue;
    const seed = UB_DISTRICT_SEED_MAP.get(districtId);
    if (!seed) continue;

    const startDate = addDaysIso(span.minDate, -7);
    const endDate = span.maxDate > maxAllowedArchiveEnd ? maxAllowedArchiveEnd : span.maxDate;
    if (endDate < startDate) continue;

    const url =
      'https://archive-api.open-meteo.com/v1/archive' +
      `?latitude=${seed.lat}&longitude=${seed.lng}` +
      `&start_date=${startDate}&end_date=${endDate}` +
      '&daily=temperature_2m_mean,temperature_2m_max,relative_humidity_2m_min,wind_speed_10m_max,precipitation_sum' +
      '&timezone=Asia%2FUlaanbaatar';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 11000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        errors.push(`${districtId}: HTTP ${res.status}`);
        continue;
      }
      const json = (await res.json()) as OpenMeteoArchiveBlock;
      const times = json.daily?.time ?? [];
      const toStore: HistoricalWeatherDay[] = [];

      for (let i = 0; i < times.length; i++) {
        const date = times[i];
        const tempMeanC = Number(json.daily?.temperature_2m_mean?.[i] ?? 0);
        const tempMaxC = Number(json.daily?.temperature_2m_max?.[i] ?? tempMeanC);
        const rhMinPct = Number(json.daily?.relative_humidity_2m_min?.[i] ?? 45);
        const windMaxKmh = Number(json.daily?.wind_speed_10m_max?.[i] ?? 12);
        const precipSumMm = Number(json.daily?.precipitation_sum?.[i] ?? 0);

        let drought7 = 0;
        for (let k = Math.max(0, i - 6); k <= i; k++) {
          if (Number(json.daily?.precipitation_sum?.[k] ?? 0) < 0.2) drought7 += 1;
        }
        let rhSum3 = 0;
        let rhCnt3 = 0;
        for (let k = Math.max(0, i - 2); k <= i; k++) {
          rhSum3 += Number(json.daily?.relative_humidity_2m_min?.[k] ?? rhMinPct);
          rhCnt3 += 1;
        }
        const lag3dRhMin = Math.round((rhSum3 / Math.max(1, rhCnt3)) * 10) / 10;

        toStore.push({
          districtId,
          date,
          tempMeanC: Math.round(tempMeanC * 10) / 10,
          tempMaxC: Math.round(tempMaxC * 10) / 10,
          rhMinPct: Math.round(rhMinPct * 10) / 10,
          windMaxKmh: Math.round(windMaxKmh * 10) / 10,
          precipSumMm: Math.round(precipSumMm * 10) / 10,
          vpdKpa: computeVpdKpa(tempMaxC, rhMinPct),
          droughtDays7d: drought7,
          lag3dRhMin,
          provider: 'Open-Meteo-Archive',
        });
      }

      fetchedDays += db.saveHistoricalWeatherDays(toStore);
      districtsSynced += 1;
    } catch (err) {
      errors.push(`${districtId}: ${err instanceof Error ? err.message : 'Archive fetch error'}`);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    fetchedDays,
    districtsSynced,
    cachedTotal: db.listHistoricalWeather().length,
    errors,
  };
}
