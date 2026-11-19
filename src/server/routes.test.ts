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
