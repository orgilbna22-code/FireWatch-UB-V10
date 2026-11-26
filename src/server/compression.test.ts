import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  cacheControlForStaticPath,
  createDynamicCompressionMiddleware,
  createPrecompressedStaticMiddleware,
  negotiateEncoding,
} from './compression.ts';

async function withServer(
  setup: (app: express.Express) => void,
  fn: (baseUrl: string) => Promise<void>
) {
  const app = express();
  setup(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

describe('node:zlib compression middleware', () => {
  it('negotiates br over gzip and respects q=0 rejections', () => {
    assert.equal(negotiateEncoding('gzip, deflate, br'), 'br');
    assert.equal(negotiateEncoding('gzip, deflate'), 'gzip');
    assert.equal(negotiateEncoding('br;q=0, gzip;q=1'), 'gzip');
    assert.equal(negotiateEncoding('identity'), null);
    assert.equal(negotiateEncoding(undefined), null);
  });

  it('assigns immutable cache headers only to hashed assets and no-cache to html/sw', () => {
    assert.equal(
      cacheControlForStaticPath('/assets/index-ClNY6XK_.js'),
      'public, max-age=31536000, immutable'
    );
    assert.equal(cacheControlForStaticPath('/sw.js'), 'no-cache, no-store, must-revalidate');
    assert.equal(cacheControlForStaticPath('/index.html'), 'no-cache, no-store, must-revalidate');
    assert.equal(
      cacheControlForStaticPath('/assets/images/ub_ger_hillside_1794629996135-800.webp'),
      'public, max-age=86400'
    );
  });

  it('serves precompressed .br/.gz sidecars for hashed text assets and leaves images uncompressed', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-comp-'));
    try {
      fs.mkdirSync(path.join(tmpDir, 'assets'));
      const jsBody = 'console.log("firewatch-ub-hashed-bundle");'.repeat(20);
      const jsPath = path.join(tmpDir, 'assets', 'main-ABC12345.js');
      fs.writeFileSync(jsPath, jsBody);
      fs.writeFileSync(`${jsPath}.br`, zlib.brotliCompressSync(Buffer.from(jsBody)));
      fs.writeFileSync(`${jsPath}.gz`, zlib.gzipSync(Buffer.from(jsBody)));

      const pngPath = path.join(tmpDir, 'assets', 'sample.png');
      fs.writeFileSync(pngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

      await withServer(
        (app) => {
          app.use(createPrecompressedStaticMiddleware(tmpDir));
        },
        async (baseUrl) => {
          const brRes = await fetch(`${baseUrl}/assets/main-ABC12345.js`, {
            headers: { 'Accept-Encoding': 'gzip, br' },
          });
          assert.equal(brRes.status, 200);
          assert.equal(brRes.headers.get('content-encoding'), 'br');
          assert.ok(brRes.headers.get('vary')?.toLowerCase().includes('accept-encoding'));
          assert.equal(
            brRes.headers.get('cache-control'),
            'public, max-age=31536000, immutable'
          );
          const decodedText = await brRes.text();
          assert.equal(decodedText, jsBody);

          const imgRes = await fetch(`${baseUrl}/assets/sample.png`, {
            headers: { 'Accept-Encoding': 'br, gzip' },
          });
          assert.equal(imgRes.status, 200);
          assert.equal(imgRes.headers.get('content-encoding'), null);
        }
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('dynamically compresses JSON >= 1KB, skips tiny payloads, and avoids double compression', async () => {
    await withServer(
      (app) => {
        app.use(createDynamicCompressionMiddleware({ minBytes: 1024 }));
        app.get('/api/small', (_req, res) => {
          res.json({ ok: true });
        });
        app.get('/api/large', (_req, res) => {
          res.json({ ok: true, items: Array.from({ length: 60 }, (_, i) => ({ id: i, note: 'ub-khoroo' })) });
        });
        app.get('/api/pre-encoded', (_req, res) => {
          res.setHeader('Content-Encoding', 'gzip');
          res.json({ ok: true, data: 'x'.repeat(2000) });
        });
      },
      async (baseUrl) => {
        const smallRes = await fetch(`${baseUrl}/api/small`, {
          headers: { 'Accept-Encoding': 'br, gzip' },
        });
        assert.equal(smallRes.headers.get('content-encoding'), null);
        assert.deepEqual(await smallRes.json(), { ok: true });

        const largeRes = await fetch(`${baseUrl}/api/large`, {
          headers: { 'Accept-Encoding': 'br, gzip' },
        });
        assert.equal(largeRes.headers.get('content-encoding'), 'br');
        assert.ok(largeRes.headers.get('vary')?.toLowerCase().includes('accept-encoding'));
        const largeJson = (await largeRes.json()) as { ok: boolean; items: unknown[] };
        assert.equal(largeJson.ok, true);
        assert.equal(largeJson.items.length, 60);

        const preRes = await fetch(`${baseUrl}/api/pre-encoded`, {
          headers: { 'Accept-Encoding': 'br, gzip' },
        });
        // Keeps upstream/pre-set encoding untouched rather than double encoding with br
        assert.equal(preRes.headers.get('content-encoding'), 'gzip');
      }
    );
  });
});
