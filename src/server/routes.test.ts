import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createFireWatchDb } from './db';
import { createFireWatchApp } from '../../server';

function startTestServer(db = createFireWatchDb(':memory:')) {
  const app = createFireWatchApp({
    db,
    getAdminToken: () => 'test-secret',
    isProd: false,
  });
  const server = http.createServer(app);
  return new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => {
              db.close();
              if (err) rej(err);
              else res();
            });
          }),
      });
    });
  });
}

test('/api/weather returns honest unavailable status (no fake weather) when Open-Meteo fails and cache is empty', async () => {
  const origFetch = globalThis.fetch;
  const db = createFireWatchDb(':memory:');
  const { baseUrl, close } = await startTestServer(db);
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('open-meteo.com')) {
      throw new Error('Simulated Open-Meteo outage');
    }
    return origFetch(input, init);
  };

  try {
    const res = await origFetch(`${baseUrl}/api/weather?force=1`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; isLive: boolean; stale: boolean; errorReason?: string };
    assert.equal(body.status, 'unavailable');
    assert.equal(body.isLive, false);
    assert.equal(body.stale, true);
    assert.ok(body.errorReason?.includes('Simulated Open-Meteo outage'));
  } finally {
    globalThis.fetch = origFetch;
    await close();
  }
});

test('/api/weather falls back to cached stale observation when Open-Meteo fails', async () => {
  const origFetch = globalThis.fetch;
  const db = createFireWatchDb(':memory:');
  db.saveWeather({
    fetchedAtMs: Date.now() - 3_600_000,
    observedAtIso: '2026-04-01T12:00:00',
    utcOffsetSeconds: 28800,
    provider: 'open-meteo',
    tempCelsius: -4.2,
    apparentCelsius: -9.5,
    humidityPercent: 32,
    windSpeedKmh: 18.4,
    windDirectionDeg: 310,
    gustKmh: 28,
    precipitationMm: 0,
    weatherCode: 1,
    droughtDays: 6,
    fireWeatherIndex: 58,
    ignitionReceptivity: 54,
    spreadPotential: 62,
    dailyJson: '[]',
  });
  const { baseUrl, close } = await startTestServer(db);

  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('open-meteo.com')) {
      return new Response('Upstream 502', { status: 502 });
    }
    return origFetch(input, init);
  };

  try {
    const res = await origFetch(`${baseUrl}/api/weather?force=1`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      status: string;
      isLive: boolean;
      stale: boolean;
      tempCelsius: number;
      errorReason?: string;
    };
    assert.equal(body.status, 'stale');
    assert.equal(body.isLive, false);
    assert.equal(body.stale, true);
    assert.equal(body.tempCelsius, -4.2);
    assert.ok(body.errorReason?.includes('502'));
  } finally {
    globalThis.fetch = origFetch;
    await close();
  }
});

test('/api/ai/explain returns 503 clearly when GEMINI_API_KEY is unconfigured', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const { baseUrl, close } = await startTestServer();

  try {
    const res = await fetch(`${baseUrl}/api/ai/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: 'mn',
        areaType: 'district',
        areaId: 'bayanzurkh',
        areaName: 'Баянзүрх',
        riskScore: 76,
        riskLevel: 'very_high',
        isModelled: false,
      }),
    });
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error: string };
    assert.ok(body.error.includes('GEMINI_API_KEY'));
  } finally {
    if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
    await close();
  }
});

test('/api/v1/incidents/batch-sync deduplicates records and /api/data-management/quality excludes demo rows', async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const unauthQuality = await fetch(`${baseUrl}/api/data-management/quality`);
    assert.equal(unauthQuality.status, 401);

    const syncRes = await fetch(`${baseUrl}/api/v1/incidents/batch-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-secret',
      },
      body: JSON.stringify({
        incidents: [
          {
            id: 'r-1',
            date: '2026-02-10',
            districtId: 'bayanzurkh',
            khorooNumber: 27,
            category: 'residential_ger',
            severity: 'critical',
            causeGuessMn: 'Яндан хэт халсан',
            responseTimeMin: 11,
            lat: 47.9401,
            lng: 107.0112,
            dataOrigin: 'real',
          },
          {
            id: 'r-1-dup',
            date: '2026-02-10',
            districtId: 'bayanzurkh',
            khorooNumber: 27,
            category: 'residential_ger',
            severity: 'critical',
            causeGuessMn: 'Яндан хэт халсан',
            responseTimeMin: 11,
            lat: 47.9401,
            lng: 107.0112,
            dataOrigin: 'real',
          },
          {
            id: 'd-1',
            date: '2026-02-11',
            districtId: 'chingeltei',
            khorooNumber: 5,
            category: 'electrical',
            severity: 'moderate',
            causeGuessMn: 'Жишээ дуудлага',
            responseTimeMin: 10,
            lat: 47.95,
            lng: 106.9,
            dataOrigin: 'demo',
          },
        ],
      }),
    });
    assert.equal(syncRes.status, 200);
    const syncBody = (await syncRes.json()) as {
      syncedCount: number;
      duplicateCount: number;
      mlReadiness: {
        cleanUniqueRealCount: number;
        excludedDemoCount: number;
        readyForTraining: boolean;
      };
    };
    assert.equal(syncBody.syncedCount, 2);
    assert.equal(syncBody.duplicateCount, 1);
    assert.equal(syncBody.mlReadiness.cleanUniqueRealCount, 1);
    assert.equal(syncBody.mlReadiness.excludedDemoCount, 1);
    assert.equal(syncBody.mlReadiness.readyForTraining, false);

    const qualityRes = await fetch(`${baseUrl}/api/data-management/quality`, {
      headers: { Authorization: 'Bearer test-secret' },
    });
    assert.equal(qualityRes.status, 200);
    const qualityBody = (await qualityRes.json()) as {
      ok: boolean;
      stats: { incidentCount: number; realIncidentCount: number };
      mlReadiness: { cleanUniqueRealCount: number; excludedDemoCount: number };
    };
    assert.equal(qualityBody.ok, true);
    assert.equal(qualityBody.stats.incidentCount, 2);
    assert.equal(qualityBody.stats.realIncidentCount, 1);
    assert.equal(qualityBody.mlReadiness.cleanUniqueRealCount, 1);
    assert.equal(qualityBody.mlReadiness.excludedDemoCount, 1);
  } finally {
    await close();
  }
});

test('/api/weather returns 9-district snapshot coverage when Open-Meteo returns multi-point array', async () => {
  const origFetch = globalThis.fetch;
  const { baseUrl, close } = await startTestServer();
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('api.open-meteo.com/v1/forecast')) {
      const points = Array.from({ length: 9 }, (_, i) => ({
        utc_offset_seconds: 28800,
        current: {
          time: '2026-04-01T14:00',
          temperature_2m: 6 + i,
          relative_humidity_2m: 26 + i,
          apparent_temperature: 2 + i,
          precipitation: 0,
          weather_code: 1,
          wind_speed_10m: 20 + i,
          wind_direction_10m: 310,
          wind_gusts_10m: 34 + i,
        },
        daily: {
          time: ['2026-03-31', '2026-04-01'],
          precipitation_sum: [0, 0],
          temperature_2m_max: [10, 12],
          temperature_2m_min: [-3, -2],
          wind_speed_10m_max: [22, 26],
        },
      }));
      return new Response(JSON.stringify(points), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return origFetch(input, init);
  };

  try {
    const res = await origFetch(`${baseUrl}/api/weather?force=1`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      isLive: boolean;
      coverageCount: number;
      districts: Record<string, { tempCelsius: number }>;
    };
    assert.equal(body.isLive, true);
    assert.equal(body.coverageCount, 9);
    assert.equal(Object.keys(body.districts).length, 9);
  } finally {
    globalThis.fetch = origFetch;
    await close();
  }
});

test('/api/v1/incidents/import dry-run + commit joins Open-Meteo Archive weather, logs batch, and respects k-anonymity + ML gate', async () => {
  const origFetch = globalThis.fetch;
  const { baseUrl, close } = await startTestServer();
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('archive-api.open-meteo.com/v1/archive')) {
      return new Response(
        JSON.stringify({
          daily: {
            time: ['2025-11-18', '2025-11-19'],
            temperature_2m_mean: [-6.5, -7.0],
            temperature_2m_max: [1.0, 0.5],
            relative_humidity_2m_min: [24, 28],
            wind_speed_10m_max: [28, 22],
            precipitation_sum: [0, 0],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return origFetch(input, init);
  };

  try {
    // Missing coordinates on a real record via POST /api/incidents must strictly fail (no centroid fallback)
    const badRealRes = await origFetch(`${baseUrl}/api/incidents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-secret',
      },
      body: JSON.stringify({
        date: '2025-11-18',
        districtId: 'bayanzurkh',
        khorooNumber: 27,
        category: 'residential_ger',
        severity: 'critical',
        causeGuessMn: 'Координатгүй бодит бичлэг',
        responseTimeMin: 11,
        dataOrigin: 'real',
      }),
    });
    assert.equal(badRealRes.status, 400);

    const csvPayload = [
      'date,district,khoroo,category,severity,cause,response_time_min,lat,lng',
      // 5 valid rows in Bayanzurkh 27 (satisfies k >= 5)
      '2025-11-18,bayanzurkh,27,residential_ger,critical,Яндангийн цонолт 1,11,47.9401,107.0111',
      '2025-11-18,bayanzurkh,27,residential_ger,critical,Яндангийн цонолт 2,12,47.9405,107.0115',
      '2025-11-18,bayanzurkh,27,electrical,moderate,Цахилгаан богино холболт,10,47.9410,107.0120',
      '2025-11-19,bayanzurkh,27,residential_ger,critical,Зуух хэт халсан,13,47.9415,107.0125',
      '2025-11-19,bayanzurkh,27,residential_ger,moderate,Яндангийн очилт,9,47.9420,107.0130',
      // 1 valid row in Chingeltei 9 (< 5, must be masked on public-heat)
      '2025-11-18,chingeltei,9,electrical,critical,Цахилгаан хуваарилах самбар,8,47.9622,106.9155',
      // 1 invalid row missing coords
      '2025-11-18,sukhbaatar,5,electrical,minor,Координатгүй мөр,10,,',
    ].join('\n');

    const dryRes = await origFetch(`${baseUrl}/api/v1/incidents/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-secret',
      },
      body: JSON.stringify({ format: 'csv', sourceName: 'NEMA-TEST', payload: csvPayload, dryRun: true }),
    });
    assert.equal(dryRes.status, 200);
    const dryBody = (await dryRes.json()) as { dryRun: boolean; validNewCount: number; rejectedCount: number; insertedCount: number };
    assert.equal(dryBody.dryRun, true);
    assert.equal(dryBody.validNewCount, 6);
    assert.equal(dryBody.rejectedCount, 1);
    assert.equal(dryBody.insertedCount, 0);

    const commitRes = await origFetch(`${baseUrl}/api/v1/incidents/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-secret',
      },
      body: JSON.stringify({
        format: 'csv',
        sourceName: 'NEMA-TEST',
        payload: csvPayload,
        dryRun: false,
        enrichWeather: true,
      }),
    });
    assert.equal(commitRes.status, 200);
    const commitBody = (await commitRes.json()) as {
      insertedCount: number;
      weatherSync: { fetchedDays: number; districtsSynced: number; cachedTotal: number };
      stats: { historicalWeatherCount: number; realIncidentCount: number };
    };
    assert.equal(commitBody.insertedCount, 6);
    assert.equal(commitBody.stats.realIncidentCount, 6);
    assert.ok(commitBody.stats.historicalWeatherCount >= 2);
    assert.ok(commitBody.weatherSync.fetchedDays >= 2);
    assert.ok(commitBody.weatherSync.districtsSynced >= 2);

    const batchesRes = await origFetch(`${baseUrl}/api/data-management/batches`, {
      headers: { Authorization: 'Bearer test-secret' },
    });
    const batchesBody = (await batchesRes.json()) as { batches: Array<{ insertedRows: number; sourceName: string }> };
    assert.equal(batchesBody.batches.length, 1);
    assert.equal(batchesBody.batches[0].sourceName, 'NEMA-TEST');
    assert.equal(batchesBody.batches[0].insertedRows, 6);

    // Public heat must protect Chingeltei (<5) while exposing Bayanzurkh 27 (>=5)
    const heatRes = await origFetch(`${baseUrl}/api/incidents/public-heat`);
    const heatBody = (await heatRes.json()) as {
      totalVerifiedIncidents: number;
      clusters: Array<{ districtId: string; khorooNumber: number; kAnonymitySatisfied: boolean }>;
    };
    assert.equal(heatBody.totalVerifiedIncidents, 6);
    const bzd = heatBody.clusters.find((c) => c.districtId === 'bayanzurkh');
    const chd = heatBody.clusters.find((c) => c.districtId === 'chingeltei');
    assert.equal(bzd?.kAnonymitySatisfied, true);
    assert.equal(bzd?.khorooNumber, 27);
    assert.equal(chd?.kAnonymitySatisfied, false);
    assert.equal(chd?.khorooNumber, 0);

    // Train ML -> insufficient_data -> /api/ml/status stays locked
    const trainRes = await origFetch(`${baseUrl}/api/ml/train`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-secret' },
      body: JSON.stringify({}),
    });
    assert.equal(trainRes.status, 200);
    const statusRes = await origFetch(`${baseUrl}/api/ml/status`);
    const statusBody = (await statusRes.json()) as {
      gatePassed: boolean;
      khorooProbabilities: unknown;
      latestModel: { status: string };
    };
    assert.equal(statusBody.gatePassed, false);
    assert.equal(statusBody.khorooProbabilities, null);
    assert.equal(statusBody.latestModel.status, 'insufficient_data');
  } finally {
    globalThis.fetch = origFetch;
    await close();
  }
});
