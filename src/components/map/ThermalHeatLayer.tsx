import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import {
  computeThermalGridField,
  createThermalGridScratch,
  interpolateHeatValueAtPoint,
  radiusMetersToPixels,
  thermalZoomFillFactor,
  type HeatSampleResult,
  type ThermalGridScratchBuffers,
} from '../../utils/riskEngine';
import type {
  ThermalWorkerRequest,
  ThermalWorkerResponse,
  WorkerProjectedPoint,
} from './thermalHeatWorker';

/**
 * 60 FPS Precision Cartographic Thermal + Isoline Risk Layer (0–100 absolute index scale).
 *
 * Key upgrades:
 *  1) Dedicated Web Worker offloads Wendland C2 IDW evaluation, RGBA ramp rasterization,
 *     and Marching-Squares isoline extraction off the main UI thread.
 *  2) Double-buffered canvas swapping prevents mid-pan or mid-zoom blank frames / flicker.
 *  3) Fixed ground-locked EPSG:3857 metric radii without zoom-space blurring so hotspots
 *     never shrink, drift, or balloon when zooming across z10..z16.
 *  4) Sequence-tagged async completion re-projects to the live map camera so panning while
 *     a raster frame is in-flight aligns cleanly without lag artifacts.
 */

export interface HeatPoint {
  lat: number;
  lng: number;
  /** 0-100 composite risk index */
  score: number;
  /** spatial influence radius in metres */
  radiusMeters: number;
  label?: string;
  labelValue?: string;
  isModelled?: boolean;
}

export interface HeatHoverSample {
  lat: number;
  lng: number;
  result: HeatSampleResult;
}

interface ThermalHeatLayerProps {
  map: L.Map | null;
  points: HeatPoint[];
  visible: boolean;
  darkBasemap?: boolean;
  onHoverSample?: (sample: HeatHoverSample | null) => void;
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

function sampleAbsoluteRamp(score: number): [number, number, number, number] {
  const s = Math.max(0, Math.min(100, score));
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

export const HEAT_LEGEND_GRADIENT =
  'linear-gradient(to right, rgba(20,184,166,0.28) 0%, rgba(250,204,21,0.68) 40%, rgba(244,82,26,0.88) 68%, rgba(232,42,34,0.95) 84%, rgba(172,12,24,0.98) 100%)';

const CONTOUR_STYLES: Record<number, { stroke: string; lineWidth: number }> = {
  56: { stroke: 'rgba(234, 128, 18, 0.52)', lineWidth: 1.05 },
  68: { stroke: 'rgba(220, 56, 24, 0.74)', lineWidth: 1.35 },
  78: { stroke: 'rgba(178, 16, 24, 0.90)', lineWidth: 1.75 },
};

interface DispatchedMeta {
  zoom: number;
  topLeftLatLng: L.LatLng;
  bounds: L.LatLngBounds;
}

export const ThermalHeatLayer: React.FC<ThermalHeatLayerProps> = ({
  map,
  points,
  visible,
  darkBasemap = false,
  onHoverSample,
}) => {
  const drawRef = useRef<(() => void) | null>(null);
  const frameRef = useRef<number | null>(null);
  const swapFrameRef = useRef<number | null>(null);
  const hoverFrameRef = useRef<number | null>(null);

  const latest = useRef({ map, points, visible, darkBasemap, onHoverSample });
  useEffect(() => {
    latest.current = { map, points, visible, darkBasemap, onHoverSample };
  }, [map, points, visible, darkBasemap, onHoverSample]);

  useEffect(() => {
    if (!map) return;

    const canvas = document.createElement('canvas');
    canvas.className = 'fw-thermal-canvas leaflet-layer leaflet-zoom-animated';
    canvas.style.transformOrigin = '0 0';
    canvas.style.pointerEvents = 'none';
    const overlayPane = map.getPanes().overlayPane;
    overlayPane.insertBefore(canvas, overlayPane.firstChild);
    const ctx = canvas.getContext('2d');

    // Back-buffer canvases for double-buffered atomic GPU swap
    const offscreenImg = document.createElement('canvas');
    const imgCtx = offscreenImg.getContext('2d');
    const backComposite = document.createElement('canvas');
    const backCtx = backComposite.getContext('2d');

    let live = true;
    const OVERSCAN = 0.22;

    let renderedZoom: number | null = null;
    let renderedTopLeftLatLng: L.LatLng | null = null;
    let renderedBounds: L.LatLngBounds | null = null;

    let latestSeq = 0;
    const pendingMeta = new Map<number, DispatchedMeta>();

    let worker: Worker | null = null;
    if (typeof Worker !== 'undefined') {
      try {
        worker = new Worker(new URL('./thermalHeatWorker.ts', import.meta.url), { type: 'module' });
      } catch {
        worker = null;
      }
    }

    // Fallback sync scratch only used when Workers are unavailable (e.g., restricted tests)
    let syncScratch: ThermalGridScratchBuffers = createThermalGridScratch(256 * 192);
    let syncImgData: ImageData | null = null;

    const applyTransform = (targetTopLeft: L.Point, scale: number) => {
      L.DomUtil.setTransform(canvas, targetTopLeft, scale);
    };

    const commitBackBufferToScreen = (
      meta: DispatchedMeta,
      widthPx: number,
      heightPx: number,
      cols: number,
      rows: number,
      zoomFillScale: number,
      rgbaBytes: Uint8ClampedArray,
      contours: Array<{ threshold: number; segments: Float32Array }>
    ) => {
      if (!live || !ctx || !imgCtx || !backCtx) return;
      const m = latest.current.map;
      if (!m || !latest.current.visible) return;

      if (offscreenImg.width !== cols || offscreenImg.height !== rows) {
        offscreenImg.width = cols;
        offscreenImg.height = rows;
      }
      const imgData = new ImageData(new Uint8ClampedArray(rgbaBytes), cols, rows);
      imgCtx.putImageData(imgData, 0, 0);

      if (backComposite.width !== widthPx || backComposite.height !== heightPx) {
        backComposite.width = widthPx;
        backComposite.height = heightPx;
      }
      backCtx.clearRect(0, 0, widthPx, heightPx);

      const cellW = widthPx / cols;
      const cellH = heightPx / rows;
      backCtx.imageSmoothingEnabled = true;
      backCtx.imageSmoothingQuality = 'high';
      backCtx.drawImage(offscreenImg, -cellW * 0.5, -cellH * 0.5, widthPx + cellW, heightPx + cellH);

      // Stroke pre-extracted Marching Squares contour segments from Worker
      for (const c of contours) {
        const segs = c.segments;
        if (segs.length < 4) continue;
        const style = CONTOUR_STYLES[c.threshold] ?? {
          stroke: 'rgba(220, 56, 24, 0.7)',
          lineWidth: 1.25,
        };
        backCtx.save();
        backCtx.beginPath();
        backCtx.strokeStyle = style.stroke;
        backCtx.lineWidth = style.lineWidth;
        backCtx.lineCap = 'round';
        backCtx.lineJoin = 'round';
        backCtx.globalAlpha = Math.min(1, 0.74 + zoomFillScale * 0.26);
        for (let i = 0; i < segs.length; i += 4) {
          backCtx.moveTo(segs[i], segs[i + 1]);
          backCtx.lineTo(segs[i + 2], segs[i + 3]);
        }
        backCtx.stroke();
        backCtx.restore();
      }

      const swapToFront = () => {
        if (!live || !ctx || !latest.current.visible) return;
        const animatingCss = (m as unknown as { _animatingZoom?: boolean })._animatingZoom;
        if (canvas.width !== widthPx || canvas.height !== heightPx) {
          canvas.width = widthPx;
          canvas.height = heightPx;
        }
        ctx.clearRect(0, 0, widthPx, heightPx);
        ctx.drawImage(backComposite, 0, 0);

        renderedZoom = meta.zoom;
        renderedTopLeftLatLng = meta.topLeftLatLng;
        renderedBounds = meta.bounds;

        if (!animatingCss) {
          const curZoom = m.getZoom();
          const scale = m.getZoomScale(curZoom, renderedZoom);
          const offset = m.latLngToLayerPoint(renderedTopLeftLatLng);
          applyTransform(offset, scale);
        }
      };

      if (swapFrameRef.current !== null) cancelAnimationFrame(swapFrameRef.current);
      swapFrameRef.current = requestAnimationFrame(() => {
        swapFrameRef.current = null;
        swapToFront();
      });
    };

    if (worker) {
      worker.onmessage = (event: MessageEvent<ThermalWorkerResponse>) => {
        const data = event.data;
        const meta = pendingMeta.get(data.seq);
        pendingMeta.delete(data.seq);
        // Drop any out-of-order stale frame superseded by newer camera/point state
        if (!meta || data.seq !== latestSeq || !live) return;

        commitBackBufferToScreen(
          meta,
          data.widthPx,
          data.heightPx,
          data.cols,
          data.rows,
          data.zoomFillScale,
          new Uint8ClampedArray(data.rgbaBuffer),
          data.contours.map((c) => ({
            threshold: c.threshold,
            segments: new Float32Array(c.segments),
          }))
        );
      };
    }

    const draw = () => {
      if (!live || !ctx || !imgCtx) return;
      const current = latest.current;
      const m = current.map;
      if (!m) return;

      const size = m.getSize();
      if (!size || size.x < 8 || size.y < 8) return;

      if (!current.visible || current.points.length === 0) {
        latestSeq += 1;
        pendingMeta.clear();
        canvas.width = 0;
        canvas.height = 0;
        renderedZoom = null;
        renderedTopLeftLatLng = null;
        renderedBounds = null;
        return;
      }

      const padX = Math.round(size.x * OVERSCAN);
      const padY = Math.round(size.y * OVERSCAN);
      const canvasW = size.x + padX * 2;
      const canvasH = size.y + padY * 2;

      const zoom = m.getZoom();
      const topLeftLatLng = m.containerPointToLatLng([-padX, -padY]);
      const bounds = L.latLngBounds(
        m.containerPointToLatLng([size.x + padX, -padY]),
        m.containerPointToLatLng([-padX, size.y + padY])
      );
      const zoomFillScale = thermalZoomFillFactor(zoom, current.darkBasemap);

      const cols = Math.min(240, Math.max(128, Math.round(canvasW / 6.5)));
      const cellW = canvasW / cols;
      const rows = Math.max(76, Math.ceil(canvasH / cellW));

      const projected: WorkerProjectedPoint[] = [];
      for (let i = 0; i < current.points.length; i++) {
        const pt = current.points[i];
        const radiusPx = radiusMetersToPixels(pt.radiusMeters, pt.lat, zoom);
        const center = m.latLngToContainerPoint([pt.lat, pt.lng]);
        const x = center.x + padX;
        const y = center.y + padY;
        if (x + radiusPx < 0 || x - radiusPx > canvasW || y + radiusPx < 0 || y - radiusPx > canvasH) {
          continue;
        }
        projected.push({
          x,
          y,
          radiusPx,
          score: pt.score,
          weightScale: pt.isModelled ? 0.8 : 1.25,
        });
      }

      latestSeq += 1;
      const seq = latestSeq;
      const meta: DispatchedMeta = { zoom, topLeftLatLng, bounds };

      if (worker) {
        // Prune old pending metadata entries so map stays bounded
        if (pendingMeta.size > 6) {
          for (const key of pendingMeta.keys()) {
            if (key < seq - 4) pendingMeta.delete(key);
          }
        }
        pendingMeta.set(seq, meta);
        const msg: ThermalWorkerRequest = {
          seq,
          cols,
          rows,
          widthPx: canvasW,
          heightPx: canvasH,
          zoomFillScale,
          points: projected,
        };
        worker.postMessage(msg);
        return;
      }

      // Synchronous fallback when Web Worker is unavailable
      const gridResult = computeThermalGridField(cols, rows, canvasW, canvasH, projected, syncScratch);
      syncScratch = gridResult.scratch;
      const { scores, coverages } = gridResult;
      const total = cols * rows;
      if (!syncImgData || syncImgData.width !== cols || syncImgData.height !== rows) {
        syncImgData = imgCtx.createImageData(cols, rows);
      }
      const bytes = syncImgData.data;
      for (let i = 0; i < total; i++) {
        const cov = coverages[i];
        if (cov <= 0.02) {
          bytes[i * 4 + 3] = 0;
          continue;
        }
        const [r, g, b, baseAlpha] = sampleAbsoluteRamp(scores[i]);
        const idx4 = i * 4;
        bytes[idx4] = r;
        bytes[idx4 + 1] = g;
        bytes[idx4 + 2] = b;
        bytes[idx4 + 3] = Math.min(235, Math.round(baseAlpha * cov * zoomFillScale));
      }
      commitBackBufferToScreen(meta, canvasW, canvasH, cols, rows, zoomFillScale, bytes, []);
    };

    drawRef.current = draw;

    const scheduleRedraw = () => {
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        draw();
      });
    };

    // GPU-synchronized zoom animation (keeps previous rendered bitmap glued to Leaflet camera)
    const handleZoomAnim = (ev: L.ZoomAnimEvent) => {
      if (renderedZoom === null || !renderedTopLeftLatLng || !latest.current.visible) return;
      const scale = map.getZoomScale(ev.zoom, renderedZoom);
      const leafletMap = map as unknown as {
        _latLngToNewLayerPoint?: (latlng: L.LatLng, zoom: number, center: L.LatLng) => L.Point;
      };
      if (typeof leafletMap._latLngToNewLayerPoint === 'function') {
        const offset = leafletMap._latLngToNewLayerPoint(renderedTopLeftLatLng, ev.zoom, ev.center);
        applyTransform(offset, scale);
      } else {
        const origin = map.getPixelOrigin();
        const nextPt = map.project(renderedTopLeftLatLng, ev.zoom).subtract(origin);
        applyTransform(nextPt, scale);
      }
    };

    const handleZoom = () => {
      if (renderedZoom === null || !renderedTopLeftLatLng || !latest.current.visible) return;
      const curZoom = map.getZoom();
      const scale = map.getZoomScale(curZoom, renderedZoom);
      const offset = map.latLngToLayerPoint(renderedTopLeftLatLng);
      applyTransform(offset, scale);

      const animatingCss = (map as unknown as { _animatingZoom?: boolean })._animatingZoom;
      if (!animatingCss && (scale < 0.55 || scale > 1.85)) {
        scheduleRedraw();
      }
    };

    const handleMove = () => {
      if (!latest.current.visible) return;
      const animatingCss = (map as unknown as { _animatingZoom?: boolean })._animatingZoom;
      if (animatingCss) return;
      if (!renderedBounds || !renderedBounds.contains(map.getBounds())) {
        scheduleRedraw();
      }
    };

    const handleMouseMove = (ev: L.LeafletMouseEvent) => {
      const cb = latest.current.onHoverSample;
      if (!cb || !latest.current.visible) return;
      if (hoverFrameRef.current !== null) cancelAnimationFrame(hoverFrameRef.current);
      hoverFrameRef.current = requestAnimationFrame(() => {
        hoverFrameRef.current = null;
        const result = interpolateHeatValueAtPoint(
          ev.latlng.lat,
          ev.latlng.lng,
          latest.current.points
        );
        cb({
          lat: +ev.latlng.lat.toFixed(4),
          lng: +ev.latlng.lng.toFixed(4),
          result,
        });
      });
    };

    const handleMouseOut = () => {
      latest.current.onHoverSample?.(null);
    };

    draw();
    map.on('zoomanim', handleZoomAnim);
    map.on('zoom', handleZoom);
    map.on('move', handleMove);
    map.on('zoomend', scheduleRedraw);
    map.on('moveend', scheduleRedraw);
    map.on('viewreset', scheduleRedraw);
    map.on('resize', scheduleRedraw);
    map.on('mousemove', handleMouseMove);
    map.on('mouseout', handleMouseOut);

    return () => {
      live = false;
      map.off('zoomanim', handleZoomAnim);
      map.off('zoom', handleZoom);
      map.off('move', handleMove);
      map.off('zoomend', scheduleRedraw);
      map.off('moveend', scheduleRedraw);
      map.off('viewreset', scheduleRedraw);
      map.off('resize', scheduleRedraw);
      map.off('mousemove', handleMouseMove);
      map.off('mouseout', handleMouseOut);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      if (swapFrameRef.current !== null) {
        cancelAnimationFrame(swapFrameRef.current);
        swapFrameRef.current = null;
      }
      if (hoverFrameRef.current !== null) {
        cancelAnimationFrame(hoverFrameRef.current);
        hoverFrameRef.current = null;
      }
      if (worker) {
        worker.terminate();
        worker = null;
      }
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      if (drawRef.current === draw) drawRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    drawRef.current?.();
  }, [points, visible, darkBasemap]);

  return null;
};
