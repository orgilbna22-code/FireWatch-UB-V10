import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DIST_DIR = path.resolve(process.cwd(), 'dist');

const COMPRESSIBLE_EXTS = new Set([
  '.js',
  '.mjs',
  '.css',
  '.svg',
  '.json',
  '.webmanifest',
  '.html',
  '.txt',
  '.xml',
]);

const SKIP_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.avif',
  '.gif',
  '.ico',
  '.woff',
  '.woff2',
  '.br',
  '.gz',
  '.zip',
  '.wasm',
  '.map',
]);

function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

export function precompressDirectory(targetDir = DIST_DIR) {
  if (!fs.existsSync(targetDir)) {
    throw new Error(`Directory not found for precompression: ${targetDir}`);
  }
  const files = walkFiles(targetDir);
  let compressedCount = 0;
  let totalRawBytes = 0;
  let totalBrBytes = 0;
  let totalGzBytes = 0;

  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    if (SKIP_EXTS.has(ext) || !COMPRESSIBLE_EXTS.has(ext)) {
      continue;
    }
    const raw = fs.readFileSync(filePath);
    if (raw.length < 256) continue;

    const br = zlib.brotliCompressSync(raw, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
      },
    });
    const gz = zlib.gzipSync(raw, { level: 9 });

    let wroteAny = false;
    if (br.length < raw.length) {
      fs.writeFileSync(`${filePath}.br`, br);
      totalBrBytes += br.length;
      wroteAny = true;
    }
    if (gz.length < raw.length) {
      fs.writeFileSync(`${filePath}.gz`, gz);
      totalGzBytes += gz.length;
      wroteAny = true;
    }
    if (wroteAny) {
      compressedCount += 1;
      totalRawBytes += raw.length;
    }
  }

  return {
    compressedCount,
    totalRawBytes,
    totalBrBytes,
    totalGzBytes,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const stats = precompressDirectory(DIST_DIR);
  console.log(
    `[precompress] ${stats.compressedCount} files: raw ${(stats.totalRawBytes / 1024).toFixed(1)} KB -> br ${(stats.totalBrBytes / 1024).toFixed(1)} KB, gz ${(stats.totalGzBytes / 1024).toFixed(1)} KB`
  );
}
