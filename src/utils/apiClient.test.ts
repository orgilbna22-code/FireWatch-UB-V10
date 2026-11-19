import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApiUrl, normalizeApiBase, safeParseJsonResponse } from './apiClient.ts';

test('buildApiUrl normalizes trailing slashes and joins VITE_API_BASE cleanly', () => {
  assert.equal(normalizeApiBase('  https://api.firewatch.mn/  '), 'https://api.firewatch.mn');
  assert.equal(buildApiUrl('/api/health', ''), '/api/health');
  assert.equal(buildApiUrl('api/weather', 'https://api.firewatch.mn/'), 'https://api.firewatch.mn/api/weather');
});

test('safeParseJsonResponse refuses HTML responses instead of throwing Unexpected token <', async () => {
  const html404 = new Response('<!doctype html><html><body>Not Found</body></html>', {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
  const resMn = await safeParseJsonResponse(html404, 'mn');
  assert.equal(resMn.ok, false);
  if (!resMn.ok) {
    assert.equal(resMn.isApiMissing, true);
    assert.ok(!resMn.error.includes('Unexpected token'));
    assert.ok(resMn.error.includes('демо хувилбарт'));
  }

  const html200 = new Response('<!doctype html><html><body>SPA Fallback</body></html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });
  const resEn = await safeParseJsonResponse(html200, 'en');
  assert.equal(resEn.ok, false);
  if (!resEn.ok) {
    assert.equal(resEn.isApiMissing, true);
    assert.ok(resEn.error.includes('disabled in this demo'));
  }
});

test('safeParseJsonResponse parses valid JSON errors and 429/503 statuses cleanly', async () => {
  const res429 = new Response(JSON.stringify({ error: 'Rate cap' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json' },
  });
  const parsed429 = await safeParseJsonResponse(res429, 'en');
  assert.equal(parsed429.ok, false);
  if (!parsed429.ok) {
    assert.equal(parsed429.status, 429);
    assert.ok(parsed429.error.includes('Too many requests'));
  }

  const okRes = new Response(JSON.stringify({ ok: true, count: 3 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
  const parsedOk = await safeParseJsonResponse<{ ok: boolean; count: number }>(okRes, 'mn');
  assert.equal(parsedOk.ok, true);
  if (parsedOk.ok) {
    assert.equal(parsedOk.data.count, 3);
  }
});
