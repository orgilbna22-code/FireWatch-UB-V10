import type { NextFunction, Request, Response } from 'express';
import { existsSync, createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

export const PRECOMPRESSIBLE_EXTS = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.svg',
  '.json',
  '.webmanifest',
  '.txt',
  '.xml',
]);

export const NEVER_COMPRESS_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.avif',
  '.gif',
  '.ico',
  '.woff',
  '.woff2',
  '.zip',
  '.br',
  '.gz',
  '.wasm',
]);

const HASHED_ASSET_RE = /^\/assets\/.+-[A-Za-z0-9_-]{6,}\.[a-z0-9]+$/i;

export function appendVaryHeader(res: Response, value: string): void {
  const existing = res.getHeader('Vary');
  const lower = value.toLowerCase();
  if (!existing) {
    res.setHeader('Vary', value);
    return;
  }
  const parts = String(existing)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.some((p) => p.toLowerCase() === lower)) {
    res.setHeader('Vary', [...parts, value].join(', '));
  }
}

export function negotiateEncoding(acceptEncodingHeader: string | undefined): 'br' | 'gzip' | null {
  if (!acceptEncodingHeader) return null;
  let brQ = 0;
  let gzQ = 0;
  for (const rawPart of acceptEncodingHeader.split(',')) {
    const [rawEnc, ...params] = rawPart.trim().toLowerCase().split(';');
    const enc = rawEnc.trim();
    if (!enc) continue;
    let q = 1;
    for (const param of params) {
      const m = param.trim().match(/^q\s*=\s*([0-9.]+)$/);
      if (m) q = Number(m[1]);
    }
    if (!Number.isFinite(q) || q <= 0) continue;
    if (enc === 'br') brQ = Math.max(brQ, q);
    if (enc === 'gzip' || enc === 'x-gzip') gzQ = Math.max(gzQ, q);
    if (enc === '*') {
      if (brQ === 0) brQ = q * 0.5;
      if (gzQ === 0) gzQ = q * 0.5;
    }
  }
  if (brQ > 0 && brQ >= gzQ) return 'br';
  if (gzQ > 0) return 'gzip';
  return null;
}

export function cacheControlForStaticPath(reqPath: string): string {
  if (reqPath === '/sw.js' || reqPath === '/' || reqPath.endsWith('.html')) {
    return 'no-cache, no-store, must-revalidate';
  }
  if (HASHED_ASSET_RE.test(reqPath)) {
    return 'public, max-age=31536000, immutable';
  }
  if (reqPath.startsWith('/assets/images/')) {
    return 'public, max-age=86400';
  }
  return 'public, max-age=3600';
}

export function sendPrecompressedStaticFile(
  req: Request,
  res: Response,
  rawFilePath: string,
  urlPath: string
): boolean {
  if (!existsSync(rawFilePath)) return false;
  const st = statSync(rawFilePath);
  if (!st.isFile()) return false;

  const ext = path.extname(rawFilePath).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', cacheControlForStaticPath(urlPath));

  const canServeCompressed =
    PRECOMPRESSIBLE_EXTS.has(ext) &&
    !NEVER_COMPRESS_EXTS.has(ext) &&
    !res.getHeader('Content-Encoding');

  let servePath = rawFilePath;
  let serveSize = st.size;

  if (canServeCompressed) {
    appendVaryHeader(res, 'Accept-Encoding');
    const encoding = negotiateEncoding(req.get('accept-encoding'));
    if (encoding === 'br' && existsSync(`${rawFilePath}.br`)) {
      servePath = `${rawFilePath}.br`;
      serveSize = statSync(servePath).size;
      res.setHeader('Content-Encoding', 'br');
    } else if (encoding === 'gzip' && existsSync(`${rawFilePath}.gz`)) {
      servePath = `${rawFilePath}.gz`;
      serveSize = statSync(servePath).size;
      res.setHeader('Content-Encoding', 'gzip');
    }
  }

  res.setHeader('Content-Length', String(serveSize));
  if (req.method === 'HEAD') {
    res.status(200).end();
    return true;
  }

  res.status(200);
  createReadStream(servePath).pipe(res);
  return true;
}

export function createPrecompressedStaticMiddleware(distDir: string) {
  const rootResolved = path.resolve(distDir);

  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next();
    }
    if (req.path.startsWith('/api/') || req.path === '/api') {
      return next();
    }

    const decodedPath = (() => {
      try {
        return decodeURIComponent(req.path);
      } catch {
        return req.path;
      }
    })();

    const cleanRel = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
    if (!cleanRel || cleanRel.endsWith('.br') || cleanRel.endsWith('.gz')) {
      return next();
    }

    const resolved = path.resolve(rootResolved, cleanRel);
    if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
      return res.status(403).end();
    }

    const served = sendPrecompressedStaticFile(
      req,
      res,
      resolved,
      decodedPath === '/' ? '/index.html' : decodedPath
    );
    if (served) return;
    return next();
  };
}

export function isDynamicContentTypeCompressible(contentTypeHeader: string | undefined): boolean {
  if (!contentTypeHeader) return false;
  const lower = contentTypeHeader.toLowerCase();
  return (
    lower.includes('text/html') ||
    lower.includes('application/json') ||
    lower.includes('+json')
  );
}

export interface DynamicCompressionOptions {
  minBytes?: number;
  disabled?: boolean;
}

/**
 * Compresses dynamic HTML and JSON API payloads >= minBytes with Node's built-in zlib
 * when the client advertises br/gzip and no upstream Content-Encoding header is set.
 */
export function createDynamicCompressionMiddleware(options: DynamicCompressionOptions = {}) {
  const minBytes = options.minBytes ?? 1024;
  const envDisabled = process.env.DISABLE_DYNAMIC_COMPRESSION === '1';

  return (req: Request, res: Response, next: NextFunction) => {
    if (options.disabled || envDisabled || req.method === 'HEAD') {
      return next();
    }

    const acceptEncoding = req.get('accept-encoding');
    const encoding = negotiateEncoding(acceptEncoding);
    if (!encoding) {
      return next();
    }

    const origJson = res.json.bind(res);
    const origSend = res.send.bind(res);

    const tryCompressPayload = (buf: Buffer, contentType: string): boolean => {
      if (res.headersSent || res.getHeader('Content-Encoding')) return false;
      if (res.statusCode === 204 || res.statusCode === 304) return false;
      if (!isDynamicContentTypeCompressible(contentType)) return false;
      if (buf.length < minBytes) return false;

      const compressed =
        encoding === 'br'
          ? zlib.brotliCompressSync(buf, {
              params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 },
            })
          : zlib.gzipSync(buf, { level: 6 });

      if (compressed.length >= buf.length) return false;

      appendVaryHeader(res, 'Accept-Encoding');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Encoding', encoding);
      res.setHeader('Content-Length', String(compressed.length));
      res.end(compressed);
      return true;
    };

    res.json = ((body: unknown) => {
      const jsonStr = JSON.stringify(body);
      if (jsonStr === undefined) {
        return origJson(body);
      }
      const buf = Buffer.from(jsonStr, 'utf8');
      const ct = String(res.getHeader('Content-Type') || 'application/json; charset=utf-8');
      if (tryCompressPayload(buf, ct)) {
        return res;
      }
      return origJson(body);
    }) as Response['json'];

    res.send = ((body?: unknown) => {
      if (body === undefined || body === null) {
        return origSend(body);
      }
      if (typeof body === 'string') {
        const ct = String(res.getHeader('Content-Type') || 'text/html; charset=utf-8');
        if (tryCompressPayload(Buffer.from(body, 'utf8'), ct)) {
          return res;
        }
      } else if (Buffer.isBuffer(body)) {
        const ct = String(res.getHeader('Content-Type') || '');
        if (tryCompressPayload(body, ct)) {
          return res;
        }
      }
      return origSend(body);
    }) as Response['send'];

    return next();
  };
}
