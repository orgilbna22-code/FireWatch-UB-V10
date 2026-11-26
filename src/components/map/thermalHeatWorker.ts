/**
 * Dedicated Web Worker for 60 FPS Thermal Grid Rasterization & Marching Squares Isoline Extraction.
 * Runs Wendland C2 IDW off the main UI thread so panning/zooming never drops frames.
 */

export interface WorkerProjectedPoint {
  x: number;
  y: number;
  radiusPx: number;
  score: number;
  weightScale: number;
}

export interface ThermalWorkerRequest {
  seq: number;
  cols: number;
  rows: number;
  widthPx: number;
  heightPx: number;
  zoomFillScale: number;
  points: WorkerProjectedPoint[];
}

export interface ThermalWorkerResponse {
  seq: number;
  cols: number;
  rows: number;
  widthPx: number;
  heightPx: number;
  zoomFillScale: number;
  rgbaBuffer: ArrayBuffer;
  contours: Array<{ threshold: number; segments: ArrayBuffer }>;
}

const ABSOLUTE_RAMP: { score: number; rgba: [number, number, number, number] }[] = [
  { score: 0, rgba: [20, 184, 166, 0] },
  { score: 30, rgba: [20, 184, 166, 16] },
  { score: 42, rgba: [250, 204, 21, 64] },
  { score: 55, rgba: [249, 140, 20, 108] },
  { score: 68, rgba: [244, 82, 26, 144] },
  { score: 78, rgba: [232, 42, 34, 170] },
  { score: 88, rgba: [202, 20, 32, 186] },
  { score: 100, rgba: [172, 12, 24, 198] },
];

const CONTOUR_THRESHOLDS = [56, 68, 78];

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function sampleAbsoluteRamp(score: number): [number, number, number, number] {
  const s = clamp(score, 0, 100);
  for (let i = 1; i < ABSOLUTE_RAMP.length; i++) {
    const prev = ABSOLUTE_RAMP[i - 1];
    const next = ABSOLUTE_RAMP[i];
    if (s <= next.score) {
      const k = next.score === prev.score ? 0 : (s - prev.score) / (next.score - prev.score);
      return [
        Math.round(prev.rgba[0] + (next.rgba[0] - prev.rgba[0]) * k),
        Math.round(prev.rgba[1] + (next.rgba[1] - prev.rgba[1]) * k),
        Math.round(prev.rgba[2] + (next.rgba[2] - prev.rgba[2]) * k),
        Math.round(prev.rgba[3] + (next.rgba[3] - prev.rgba[3]) * k),
      ];
    }
  }
  return [172, 12, 24, 198];
}

function lerpEdge(a: number, b: number, level: number): number {
  const denom = b - a;
  if (Math.abs(denom) < 1e-5) return 0.5;
  return clamp((level - a) / denom, 0, 1);
}

// Persistent worker scratch buffers (grown on demand, zero GC pressure)
let capacity = 0;
let weightAccum = new Float32Array(0);
let weightedScoreAccum = new Float32Array(0);
let maxKernelAccum = new Float32Array(0);
let contourField = new Float32Array(0);

function ensureCapacity(total: number) {
  if (total <= capacity) return;
  capacity = total;
  weightAccum = new Float32Array(total);
  weightedScoreAccum = new Float32Array(total);
  maxKernelAccum = new Float32Array(total);
  contourField = new Float32Array(total);
}

self.onmessage = (event: MessageEvent<ThermalWorkerRequest>) => {
  const { seq, cols, rows, widthPx, heightPx, zoomFillScale, points } = event.data;
  const total = cols * rows;
  ensureCapacity(total);

  weightAccum.fill(0, 0, total);
  weightedScoreAccum.fill(0, 0, total);
  maxKernelAccum.fill(0, 0, total);

  const cellW = widthPx / cols;
  const cellH = heightPx / rows;

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const r = Math.max(2.5, pt.radiusPx);
    if (pt.x + r < 0 || pt.x - r > widthPx || pt.y + r < 0 || pt.y - r > heightPx) {
      continue;
    }

    const rSq = r * r;
    const gx0 = Math.max(0, Math.floor((pt.x - r) / cellW));
    const gx1 = Math.min(cols - 1, Math.ceil((pt.x + r) / cellW));
    const gy0 = Math.max(0, Math.floor((pt.y - r) / cellH));
    const gy1 = Math.min(rows - 1, Math.ceil((pt.y + r) / cellH));

    for (let gy = gy0; gy <= gy1; gy++) {
      const cy = gy * cellH + cellH * 0.5;
      const dy = cy - pt.y;
      const dy2 = dy * dy;
      const rowOffset = gy * cols;
      for (let gx = gx0; gx <= gx1; gx++) {
        const cx = gx * cellW + cellW * 0.5;
        const dx = cx - pt.x;
        const distSq = dx * dx + dy2;
        if (distSq >= rSq) continue;

        const u2 = distSq / rSq;
        const kernel = (1 - u2) * (1 - u2);
        const w = kernel * pt.weightScale;
        const idx = rowOffset + gx;
        weightedScoreAccum[idx] += w * pt.score;
        weightAccum[idx] += w;
        if (kernel > maxKernelAccum[idx]) {
          maxKernelAccum[idx] = kernel;
        }
      }
    }
  }

  const rgba = new Uint8ClampedArray(total * 4);
  for (let i = 0; i < total; i++) {
    const wSum = weightAccum[i];
    if (wSum <= 1e-5) {
      rgba[i * 4 + 3] = 0;
      contourField[i] = 0;
      continue;
    }
    const cov = clamp(Math.pow(maxKernelAccum[i], 0.72), 0, 1);
    if (cov <= 0.02) {
      rgba[i * 4 + 3] = 0;
      contourField[i] = 0;
      continue;
    }
    const s = clamp(weightedScoreAccum[i] / wSum, 0, 100);
    const edgeFade = cov >= 0.30 ? 1 : (cov - 0.02) / 0.28;
    contourField[i] = s * edgeFade;

    const [r, g, b, baseAlpha] = sampleAbsoluteRamp(s);
    const idx4 = i * 4;
    rgba[idx4] = r;
    rgba[idx4 + 1] = g;
    rgba[idx4 + 2] = b;
    rgba[idx4 + 3] = Math.min(235, Math.round(baseAlpha * cov * zoomFillScale));
  }

  // Extract crisp isoline segments without zoom-space smoothing drift
  const contours: Array<{ threshold: number; segments: ArrayBuffer }> = [];
  const transferables: Transferable[] = [rgba.buffer];

  for (const T of CONTOUR_THRESHOLDS) {
    const coords: number[] = [];
    for (let gy = 0; gy < rows - 1; gy++) {
      const y0 = gy * cellH + cellH * 0.5;
      const y1 = y0 + cellH;
      const rowOffset = gy * cols;
      const nextRowOffset = (gy + 1) * cols;

      for (let gx = 0; gx < cols - 1; gx++) {
        const vTL = contourField[rowOffset + gx];
        const vTR = contourField[rowOffset + gx + 1];
        const vBR = contourField[nextRowOffset + gx + 1];
        const vBL = contourField[nextRowOffset + gx];

        const mask =
          (vTL >= T ? 8 : 0) |
          (vTR >= T ? 4 : 0) |
          (vBR >= T ? 2 : 0) |
          (vBL >= T ? 1 : 0);

        if (mask === 0 || mask === 15) continue;

        const x0 = gx * cellW + cellW * 0.5;
        const x1 = x0 + cellW;

        const topX = x0 + lerpEdge(vTL, vTR, T) * cellW;
        const topY = y0;
        const rightX = x1;
        const rightY = y0 + lerpEdge(vTR, vBR, T) * cellH;
        const bottomX = x0 + lerpEdge(vBL, vBR, T) * cellW;
        const bottomY = y1;
        const leftX = x0;
        const leftY = y0 + lerpEdge(vTL, vBL, T) * cellH;

        const pushSeg = (ax: number, ay: number, bx: number, by: number) => {
          coords.push(ax, ay, bx, by);
        };

        switch (mask) {
          case 1:
          case 14:
            pushSeg(leftX, leftY, bottomX, bottomY);
            break;
          case 2:
          case 13:
            pushSeg(bottomX, bottomY, rightX, rightY);
            break;
          case 3:
          case 12:
            pushSeg(leftX, leftY, rightX, rightY);
            break;
          case 4:
          case 11:
            pushSeg(topX, topY, rightX, rightY);
            break;
          case 5: {
            const avg = 0.25 * (vTL + vTR + vBR + vBL);
            if (avg >= T) {
              pushSeg(topX, topY, leftX, leftY);
              pushSeg(bottomX, bottomY, rightX, rightY);
            } else {
              pushSeg(topX, topY, rightX, rightY);
              pushSeg(leftX, leftY, bottomX, bottomY);
            }
            break;
          }
          case 6:
          case 9:
            pushSeg(topX, topY, bottomX, bottomY);
            break;
          case 7:
          case 8:
            pushSeg(topX, topY, leftX, leftY);
            break;
          case 10: {
            const avg = 0.25 * (vTL + vTR + vBR + vBL);
            if (avg >= T) {
              pushSeg(topX, topY, rightX, rightY);
              pushSeg(leftX, leftY, bottomX, bottomY);
            } else {
              pushSeg(topX, topY, leftX, leftY);
              pushSeg(bottomX, bottomY, rightX, rightY);
            }
            break;
          }
        }
      }
    }

    const segArr = new Float32Array(coords);
    contours.push({ threshold: T, segments: segArr.buffer });
    transferables.push(segArr.buffer);
  }

  const reply: ThermalWorkerResponse = {
    seq,
    cols,
    rows,
    widthPx,
    heightPx,
    zoomFillScale,
    rgbaBuffer: rgba.buffer,
    contours,
  };

  (self as unknown as { postMessage: (msg: unknown, transfer: Transferable[]) => void }).postMessage(
    reply,
    transferables
  );
};
