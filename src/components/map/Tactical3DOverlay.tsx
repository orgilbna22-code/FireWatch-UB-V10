import React, { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import { DistrictData, FireStation, KhorooData } from '../../types';
import {
  BuildingFootprint,
  buildTactical3DScene,
  clipPointAlongRayToBounds,
  computeEdgeLitFactor,
  generateCityBlueFootprints,
  polygonSignedAreaScreen,
  type RectBox,
  resolveSafeCardPosition,
  type SafeBounds,
  selectFocusedOsm3DBuildings,
  Tactical3DScene,
} from '../../utils/tactical3dData';
import {
  fetchOsmVectorTile,
  getCachedTileSync,
  latLngToTile,
  type OsmBuildingPoly,
  type OsmRoadLine,
} from '../../utils/osmVectorBuildings';
import { radiusMetersToPixels } from '../../utils/riskEngine';
import {
  TACTICAL_RENDER_CONFIG,
  type TacticalScenarioAssumptions,
} from '../../data/tacticalScenarioConfig';
import { khorooLabel } from '../../i18n/labels';

interface Tactical3DOverlayProps {
  map: L.Map | null;
  active: boolean;
  is3DExtruded: boolean;
  isPanelOpen: boolean;
  scenarioStarted: boolean;
  assumptions: TacticalScenarioAssumptions;
  activeDistrict: DistrictData | null;
  selectedKhoroo: KhorooData | null;
  khoroos: KhorooData[];
  stations: FireStation[];
  isMn: boolean;
  onSelectKhoroo?: (kh: KhorooData) => void;
  onOsmCountChange?: (count: number) => void;
}

interface BuildingPalette {
  litRgb: [number, number, number];
  darkRgb: [number, number, number];
  roofFill: string;
  roofStroke: string;
  wallStroke: string;
}

/**
 * Neutral architectural palettes — never attribute unverified OSM buildings
 * with fabricated "red danger house" status.
 */
const PALETTES: Record<Exclude<BuildingFootprint['tone'], 'blue_footprint'>, BuildingPalette> = {
  slate_context: {
    litRgb: [118, 152, 198],
    darkRgb: [44, 64, 96],
    roofFill: 'rgba(148, 182, 224, 0.68)',
    roofStroke: 'rgba(191, 219, 254, 0.72)',
    wallStroke: 'rgba(148, 182, 224, 0.36)',
  },
  slate_landmark: {
    litRgb: [138, 174, 224],
    darkRgb: [56, 80, 120],
    roofFill: 'rgba(176, 206, 245, 0.76)',
    roofStroke: 'rgba(219, 234, 254, 0.84)',
    wallStroke: 'rgba(191, 219, 254, 0.42)',
  },
  zone_focus: {
    litRgb: [96, 200, 242],
    darkRgb: [32, 92, 138],
    roofFill: 'rgba(147, 226, 255, 0.72)',
    roofStroke: 'rgba(255, 138, 101, 0.96)',
    wallStroke: 'rgba(147, 226, 255, 0.56)',
  },
};

function lerpRgb(
  dark: [number, number, number],
  lit: [number, number, number],
  t: number,
  alpha: number
): string {
  const r = Math.round(dark[0] + (lit[0] - dark[0]) * t);
  const g = Math.round(dark[1] + (lit[1] - dark[1]) * t);
  const b = Math.round(dark[2] + (lit[2] - dark[2]) * t);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function drawCalloutCard(
  ctx: CanvasRenderingContext2D,
  anchorX: number,
  anchorY: number,
  stemH: number,
  title: string,
  subtitle: string | null,
  accentColor: string,
  badgeText: string | null,
  placed: RectBox[],
  bounds: SafeBounds
) {
  ctx.save();
  ctx.font = '700 11.5px "Plus Jakarta Sans", system-ui, sans-serif';
  const titleW = ctx.measureText(title).width;

  ctx.font = '600 9.5px "JetBrains Mono", ui-monospace, monospace';
  const subW = subtitle ? ctx.measureText(subtitle).width : 0;
  const badgeW = badgeText ? ctx.measureText(badgeText).width + 12 : 0;

  const padX = 10;
  const contentTopW = titleW + (badgeText ? 8 + badgeW : 0);
  const totalW = Math.min(276, Math.max(contentTopW, subW) + padX * 2);
  const cardH = subtitle ? 40 : 26;

  const desiredX = anchorX - totalW * 0.5;
  const desiredY = anchorY - stemH - cardH;

  const { x: cardX, y: cardY } = resolveSafeCardPosition(
    desiredX,
    desiredY,
    totalW,
    cardH,
    placed,
    bounds,
    [
      [0, 0],
      [0, -34],
      [88, -20],
      [-88, -20],
      [0, stemH + cardH + 26],
      [115, 18],
      [-115, 18],
    ]
  );

  // Leader stem connecting card center-bottom to ground anchor
  const stemStartX = Math.max(cardX + 10, Math.min(cardX + totalW - 10, anchorX));
  const stemStartY = cardY + cardH;
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(anchorX, anchorY);
  ctx.lineTo(stemStartX, stemStartY);
  ctx.stroke();

  // Ground anchor ring
  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.arc(anchorX, anchorY, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Drop shadow & dark frosted card
  ctx.fillStyle = 'rgba(2, 6, 23, 0.62)';
  drawRoundedRectPath(ctx, cardX + 2, cardY + 3, totalW, cardH, 9);
  ctx.fill();

  ctx.fillStyle = 'rgba(9, 17, 36, 0.96)';
  drawRoundedRectPath(ctx, cardX, cardY, totalW, cardH, 9);
  ctx.fill();

  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.1;
  ctx.stroke();

  const textY = subtitle ? cardY + 13 : cardY + cardH * 0.5 + 0.5;
  ctx.fillStyle = '#F8FAFC';
  ctx.font = '700 11.5px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(title, cardX + padX, textY, totalW - padX * 2 - (badgeW > 0 ? badgeW + 6 : 0));

  if (badgeText) {
    const bx = cardX + totalW - padX - badgeW;
    ctx.fillStyle = accentColor;
    drawRoundedRectPath(ctx, bx, textY - 8.5, badgeW, 17, 5);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 9.5px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(badgeText, bx + badgeW * 0.5, textY + 0.5);
  }

  if (subtitle) {
    ctx.fillStyle = '#CBD5E1';
    ctx.font = '600 9.5px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(subtitle, cardX + padX, cardY + 29, totalW - padX * 2);
  }

  ctx.restore();
}

function drawFireStationBeacon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  clippedSubtitle: string | null,
  placed: RectBox[],
  bounds: SafeBounds,
  showCard = true
) {
  ctx.save();
  ctx.fillStyle = 'rgba(16, 185, 129, 0.28)';
  ctx.beginPath();
  ctx.arc(x, y, 16, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#059669';
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🚒', x, y + 0.5);
  ctx.restore();

  if (showCard) {
    drawCalloutCard(
      ctx,
      x,
      y - 11,
      18,
      label,
      clippedSubtitle,
      '#10B981',
      null,
      placed,
      bounds
    );
  }
}

export const Tactical3DOverlay: React.FC<Tactical3DOverlayProps> = React.memo(
  ({
    map,
    active,
    is3DExtruded,
    isPanelOpen,
    scenarioStarted,
    assumptions,
    activeDistrict,
    selectedKhoroo,
    khoroos,
    stations,
    isMn,
    onSelectKhoroo,
    onOsmCountChange,
  }) => {
    const baseFootprints = useMemo(() => generateCityBlueFootprints(khoroos), [khoroos]);

    const scene = useMemo<Tactical3DScene | null>(() => {
      if (!active || khoroos.length === 0 || stations.length === 0) return null;
      return buildTactical3DScene({
        activeDistrict,
        selectedKhoroo,
        khoroos,
        stations,
        baseFootprints,
        assumptions,
      });
    }, [active, activeDistrict, selectedKhoroo, khoroos, stations, baseFootprints, assumptions]);

    const drawRef = useRef<(() => void) | null>(null);
    const frameRef = useRef<number | null>(null);
    const tileBatchTimerRef = useRef<number | null>(null);
    const requestedTilesRef = useRef<Set<string>>(new Set());
    const lastReportedOsmCountRef = useRef<number>(-1);
    const khorooHitTargetsRef = useRef<Array<{ kh: KhorooData; cx: number; cy: number }>>([]);
    const hoveredKhorooIdRef = useRef<string | null>(null);

    const latest = useRef({
      map,
      active,
      is3DExtruded,
      isPanelOpen,
      scenarioStarted,
      scene,
      khoroos,
      activeDistrict,
      isMn,
      onSelectKhoroo,
      onOsmCountChange,
    });

    useEffect(() => {
      latest.current = {
        map,
        active,
        is3DExtruded,
        isPanelOpen,
        scenarioStarted,
        scene,
        khoroos,
        activeDistrict,
        isMn,
        onSelectKhoroo,
        onOsmCountChange,
      };
    }, [
      map,
      active,
      is3DExtruded,
      isPanelOpen,
      scenarioStarted,
      scene,
      khoroos,
      activeDistrict,
      isMn,
      onSelectKhoroo,
      onOsmCountChange,
    ]);

    // Interactive Target Reticle Marker on Scenario Khoroo (CSS pulse, 0 JS timer cost)
    useEffect(() => {
      if (!map || !active || !scene) return;

      const color = scenarioStarted ? '#FF633C' : '#38BDF8';
      const ringAlpha = scenarioStarted ? '0.28' : '0.22';
      const coreIcon = L.divIcon({
        className: 'fw-tactical-target-core',
        html: `
          <div style="position:relative;width:42px;height:42px;display:flex;align-items:center;justify-content:center;pointer-events:none;">
            <span style="position:absolute;inset:2px;border-radius:9999px;background:rgba(255,99,60,${ringAlpha});border:1.5px dashed ${color};"></span>
            <span style="position:relative;width:14px;height:14px;border-radius:9999px;background:${color};border:2.5px solid #FFFFFF;box-shadow:0 0 12px ${color};"></span>
          </div>
        `,
        iconSize: [42, 42],
        iconAnchor: [21, 21],
      });

      const marker = L.marker(scene.targetCoord, {
        icon: coreIcon,
        interactive: false,
        zIndexOffset: 650,
      }).addTo(map);

      return () => {
        marker.remove();
      };
    }, [map, active, scene, scenarioStarted]);

    // Direct Canvas Click / Hover Support for Khoroo Pins (zero CSS-tilt coordinate offset!)
    useEffect(() => {
      if (!map || !active) return;

      const findHit = (pt: L.Point) => {
        let best: KhorooData | null = null;
        let bestDist = 20;
        for (const item of khorooHitTargetsRef.current) {
          const d = Math.hypot(item.cx - pt.x, item.cy - pt.y);
          if (d < bestDist) {
            bestDist = d;
            best = item.kh;
          }
        }
        return best;
      };

      const onMapMouseMove = (ev: L.LeafletMouseEvent) => {
        const hit = findHit(ev.containerPoint);
        map.getContainer().style.cursor = hit ? 'pointer' : '';
        const nextHoverId = hit ? hit.id : null;
        if (hoveredKhorooIdRef.current !== nextHoverId) {
          hoveredKhorooIdRef.current = nextHoverId;
          drawRef.current?.();
        }
      };

      const onMapClick = (ev: L.LeafletMouseEvent) => {
        const hit = findHit(ev.containerPoint);
        if (hit && latest.current.onSelectKhoroo) {
          latest.current.onSelectKhoroo(hit);
        }
      };

      map.on('mousemove', onMapMouseMove);
      map.on('click', onMapClick);
      return () => {
        map.off('mousemove', onMapMouseMove);
        map.off('click', onMapClick);
        map.getContainer().style.cursor = '';
        hoveredKhorooIdRef.current = null;
      };
    }, [map, active]);

    // HiDPI Overscanned Axonometric 2.5D Tactical Canvas Layer
    useEffect(() => {
      if (!map) return;

      const canvas = document.createElement('canvas');
      canvas.className = 'fw-tactical-canvas leaflet-layer leaflet-zoom-animated';
      canvas.style.transformOrigin = '0 0';
      canvas.style.pointerEvents = 'none';

      const overlayPane = map.getPanes().overlayPane;
      overlayPane.insertBefore(canvas, overlayPane.firstChild);
      const ctx = canvas.getContext('2d');

      let live = true;
      const OVERSCAN = 0.22;
      let renderedZoom: number | null = null;
      let renderedTopLeftLatLng: L.LatLng | null = null;
      let renderedBounds: L.LatLngBounds | null = null;

      const applyTransform = (targetTopLeft: L.Point, scale: number) => {
        L.DomUtil.setTransform(canvas, targetTopLeft, scale);
      };

      const scheduleRedraw = () => {
        if (frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          draw();
        });
      };

      const scheduleBatchedTileRedraw = () => {
        if (tileBatchTimerRef.current !== null) return;
        tileBatchTimerRef.current = window.setTimeout(() => {
          tileBatchTimerRef.current = null;
          scheduleRedraw();
        }, 45);
      };

      const ensureVisibleOsmTiles = (bounds: L.LatLngBounds, zoom: number) => {
        if (zoom < 12.2) return;
        const tz = 14;
        const nw = latLngToTile(bounds.getNorth(), bounds.getWest(), tz);
        const se = latLngToTile(bounds.getSouth(), bounds.getEast(), tz);

        const maxSpan = 2;
        const cx = Math.floor((nw.x + se.x) * 0.5);
        const cy = Math.floor((nw.y + se.y) * 0.5);
        const minX = Math.max(nw.x, cx - maxSpan);
        const maxX = Math.min(se.x, cx + maxSpan);
        const minY = Math.max(nw.y, cy - maxSpan);
        const maxY = Math.min(se.y, cy + maxSpan);

        for (let ty = minY; ty <= maxY; ty++) {
          for (let tx = minX; tx <= maxX; tx++) {
            const key = `${tz}/${tx}/${ty}`;
            if (getCachedTileSync(tz, tx, ty) || requestedTilesRef.current.has(key)) continue;
            requestedTilesRef.current.add(key);
            void fetchOsmVectorTile(tz, tx, ty).then((tile) => {
              if (!tile) {
                requestedTilesRef.current.delete(key);
              } else if (live) {
                scheduleBatchedTileRedraw();
              }
            });
          }
        }
      };

      const draw = () => {
        if (!live || !ctx) return;
        const current = latest.current;
        const m = current.map;
        if (!m) return;

        const size = m.getSize();
        if (!size || size.x < 8 || size.y < 8) return;

        if (!current.active || !current.scene) {
          canvas.width = 0;
          canvas.height = 0;
          canvas.style.width = '0px';
          canvas.style.height = '0px';
          renderedZoom = null;
          renderedTopLeftLatLng = null;
          renderedBounds = null;
          khorooHitTargetsRef.current = [];
          return;
        }

        const dpr = Math.min(
          TACTICAL_RENDER_CONFIG.maxDpr,
          typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
        );
        const padX = Math.round(size.x * OVERSCAN);
        const padY = Math.round(size.y * OVERSCAN);
        const canvasW = size.x + padX * 2;
        const canvasH = size.y + padY * 2;
        const pixelW = Math.round(canvasW * dpr);
        const pixelH = Math.round(canvasH * dpr);

        if (canvas.width !== pixelW || canvas.height !== pixelH) {
          canvas.width = pixelW;
          canvas.height = pixelH;
          canvas.style.width = `${canvasW}px`;
          canvas.style.height = `${canvasH}px`;
        }

        const topLeftLayerPt = m.containerPointToLayerPoint([-padX, -padY]);
        const zoom = m.getZoom();
        renderedZoom = zoom;
        renderedTopLeftLatLng = m.containerPointToLatLng([-padX, -padY]);
        renderedBounds = L.latLngBounds(
          m.containerPointToLatLng([size.x + padX, -padY]),
          m.containerPointToLatLng([-padX, size.y + padY])
        );
        applyTransform(topLeftLayerPt, 1);

        ensureVisibleOsmTiles(renderedBounds, zoom);

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, canvasW, canvasH);

        const toPt = (coord: [number, number]): [number, number] => {
          const p = m.latLngToContainerPoint(coord);
          return [p.x + padX, p.y + padY];
        };
        const toContainerPt = (coord: [number, number]): [number, number] => {
          const p = m.latLngToContainerPoint(coord);
          return [p.x, p.y];
        };

        const inCanvas = (x: number, y: number, margin = 56): boolean =>
          x >= -margin && x <= canvasW + margin && y >= -margin && y <= canvasH + margin;

        const sc = current.scene;
        const zoomScale =
          zoom >= 16 ? 1.26 : zoom >= 15 ? 1.0 : zoom >= 14 ? 0.68 : zoom >= 13 ? 0.36 : 0.18;
        const extrudeMult = current.is3DExtruded ? 1 : 0;

        // Collect real cached OSM vector tiles
        const osmBuildings: OsmBuildingPoly[] = [];
        const osmRoads: OsmRoadLine[] = [];
        if (zoom >= 12.2) {
          const nw = latLngToTile(renderedBounds.getNorth(), renderedBounds.getWest(), 14);
          const se = latLngToTile(renderedBounds.getSouth(), renderedBounds.getEast(), 14);
          const cx = Math.floor((nw.x + se.x) * 0.5);
          const cy = Math.floor((nw.y + se.y) * 0.5);
          for (let ty = Math.max(nw.y, cy - 2); ty <= Math.min(se.y, cy + 2); ty++) {
            for (let tx = Math.max(nw.x, cx - 2); tx <= Math.min(se.x, cx + 2); tx++) {
              const cached = getCachedTileSync(14, tx, ty);
              if (!cached) continue;
              for (let i = 0; i < cached.buildings.length; i++) {
                const b = cached.buildings[i];
                if (renderedBounds.contains(b.center)) {
                  osmBuildings.push(b);
                }
              }
              if (zoom >= 13.0) {
                for (let i = 0; i < cached.roads.length; i++) {
                  osmRoads.push(cached.roads[i]);
                }
              }
            }
          }
        }

        if (lastReportedOsmCountRef.current !== osmBuildings.length) {
          lastReportedOsmCountRef.current = osmBuildings.length;
          current.onOsmCountChange?.(osmBuildings.length);
        }

        // 1. Crisp OSM Arterial Road Network (major = luminous sky, secondary = slate)
        if (osmRoads.length > 0 && zoom >= 13.0) {
          ctx.save();
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          ctx.strokeStyle = 'rgba(96, 165, 250, 0.26)';
          ctx.lineWidth = zoom >= 15 ? 1.6 : 1.0;
          ctx.beginPath();
          for (let i = 0; i < osmRoads.length; i++) {
            const road = osmRoads[i];
            if (road.isMajor) continue;
            const p0 = toPt(road.pts[0]);
            ctx.moveTo(p0[0], p0[1]);
            for (let j = 1; j < road.pts.length; j++) {
              const pj = toPt(road.pts[j]);
              ctx.lineTo(pj[0], pj[1]);
            }
          }
          ctx.stroke();

          ctx.strokeStyle = 'rgba(56, 189, 248, 0.48)';
          ctx.lineWidth = zoom >= 15 ? 2.8 : 1.8;
          ctx.beginPath();
          for (let i = 0; i < osmRoads.length; i++) {
            const road = osmRoads[i];
            if (!road.isMajor) continue;
            const p0 = toPt(road.pts[0]);
            ctx.moveTo(p0[0], p0[1]);
            for (let j = 1; j < road.pts.length; j++) {
              const pj = toPt(road.pts[j]);
              ctx.lineTo(pj[0], pj[1]);
            }
          }
          ctx.stroke();
          ctx.restore();
        }

        // 2. Flat Cobalt GIS Footprints (real OSM or deterministic context fallback)
        if (osmBuildings.length > 0) {
          ctx.save();
          ctx.fillStyle = zoom >= 14.5 ? 'rgba(37, 99, 235, 0.30)' : 'rgba(37, 99, 235, 0.36)';
          ctx.strokeStyle = zoom >= 14.5 ? 'rgba(96, 165, 250, 0.68)' : 'rgba(96, 165, 250, 0.80)';
          ctx.lineWidth = 1.05;
          ctx.beginPath();
          for (let i = 0; i < osmBuildings.length; i++) {
            const c = osmBuildings[i].corners;
            if (c.length < 3) continue;
            const p0 = toPt(c[0]);
            if (!inCanvas(p0[0], p0[1], 80)) continue;
            ctx.moveTo(p0[0], p0[1]);
            for (let k = 1; k < c.length; k++) {
              const pk = toPt(c[k]);
              ctx.lineTo(pk[0], pk[1]);
            }
            ctx.closePath();
          }
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        } else {
          ctx.save();
          ctx.fillStyle = 'rgba(29, 78, 216, 0.18)';
          ctx.strokeStyle = 'rgba(96, 165, 250, 0.50)';
          ctx.lineWidth = 0.95;
          ctx.beginPath();
          for (const b of sc.buildings) {
            if (b.tone !== 'blue_footprint') continue;
            const p0 = toPt(b.corners[0]);
            if (!inCanvas(p0[0], p0[1], 80)) continue;
            ctx.moveTo(p0[0], p0[1]);
            for (let i = 1; i < b.corners.length; i++) {
              const pi = toPt(b.corners[i]);
              ctx.lineTo(pi[0], pi[1]);
            }
            ctx.closePath();
          }
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }

        // 3. Target Selection / Assumed Scenario Zone Circle
        const targetScreen = toPt(sc.targetCoord);
        const radiusPx = radiusMetersToPixels(sc.scenarioRadiusMeters, sc.targetCoord[0], zoom);

        if (current.scenarioStarted) {
          // Warm analytical glow inside assumed scenario circle
          ctx.save();
          const grad = ctx.createRadialGradient(
            targetScreen[0],
            targetScreen[1],
            4,
            targetScreen[0],
            targetScreen[1],
            Math.max(24, radiusPx)
          );
          grad.addColorStop(0, 'rgba(255, 99, 60, 0.34)');
          grad.addColorStop(0.55, 'rgba(255, 99, 60, 0.14)');
          grad.addColorStop(1, 'rgba(255, 99, 60, 0.02)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(targetScreen[0], targetScreen[1], radiusPx, 0, Math.PI * 2);
          ctx.fill();

          // Outer assumed scenario boundary (dashed coral)
          ctx.setLineDash([8, 5]);
          ctx.strokeStyle = 'rgba(255, 138, 101, 0.92)';
          ctx.lineWidth = 2.0;
          ctx.beginPath();
          ctx.arc(targetScreen[0], targetScreen[1], radiusPx, 0, Math.PI * 2);
          ctx.stroke();

          // Inner 0.5x reference ring (subtle amber)
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.arc(targetScreen[0], targetScreen[1], radiusPx * 0.5, 0, Math.PI * 2);
          ctx.stroke();

          // Perimeter radius badge right on eastern edge of the zone ring (only when ring is wide enough)
          if (radiusPx >= 52) {
            ctx.setLineDash([]);
            const badgeLabel = `r = ${sc.scenarioRadiusMeters}${current.isMn ? 'м' : 'm'}`;
            ctx.font = '700 9.5px "JetBrains Mono", ui-monospace, monospace';
            const bw = ctx.measureText(badgeLabel).width + 12;
            const bx = targetScreen[0] + radiusPx - bw * 0.5;
            const by = targetScreen[1] - 9;
            ctx.fillStyle = 'rgba(9, 17, 36, 0.92)';
            drawRoundedRectPath(ctx, bx, by, bw, 18, 6);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 138, 101, 0.9)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = '#FED7AA';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(badgeLabel, bx + bw * 0.5, by + 9.5);
          }
          ctx.restore();
        } else {
          // Preview ring before user clicks Start Scenario
          ctx.save();
          ctx.setLineDash([5, 5]);
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.72)';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(targetScreen[0], targetScreen[1], Math.min(80, radiusPx * 0.55), 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // 4. Neutral 2.5D Axonometric Building Extrusions (with true outward edge normals & AO shadows)
        const pickedOsm = selectFocusedOsm3DBuildings(
          osmBuildings,
          sc,
          TACTICAL_RENDER_CONFIG.maxContextExtrusions
        );
        const extrudedList = pickedOsm.extruded
          .filter((b) => zoom >= 13.4 || b.tier >= 2)
          .map((b) => {
            const c = toPt(b.center);
            return { b, cx: c[0], cy: c[1] };
          })
          .filter(({ cx, cy }) => inCanvas(cx, cy, 120))
          .sort((a, b) => a.cy - b.cy);

        const shiftXRatio = TACTICAL_RENDER_CONFIG.obliqueShiftX * extrudeMult;
        const shiftYRatio = TACTICAL_RENDER_CONFIG.obliqueShiftY * extrudeMult;

        for (let tIdx = 0; tIdx < extrudedList.length; tIdx++) {
          const { b } = extrudedList[tIdx];
          const toneKey = (b.tone === 'blue_footprint' ? 'slate_context' : b.tone) as Exclude<
            BuildingFootprint['tone'],
            'blue_footprint'
          >;
          const pal = PALETTES[toneKey];
          const h = b.heightPx * zoomScale * extrudeMult;
          const basePts = b.corners.map(toPt);
          const signedArea = polygonSignedAreaScreen(basePts);

          // In 2D plan mode, draw highlighted footprints cleanly
          if (h < 1.2) {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(basePts[0][0], basePts[0][1]);
            for (let i = 1; i < basePts.length; i++) ctx.lineTo(basePts[i][0], basePts[i][1]);
            ctx.closePath();
            ctx.fillStyle = pal.roofFill;
            ctx.fill();
            ctx.strokeStyle = pal.roofStroke;
            ctx.lineWidth = 1.1;
            ctx.stroke();
            ctx.restore();
            continue;
          }

          const roofPts: [number, number][] = basePts.map(([px, py]) => [
            px + h * shiftXRatio,
            py + h * shiftYRatio,
          ]);

          ctx.save();

          // Soft southeast cast ground shadow (depth realism)
          const shadowDx = h * 0.28;
          const shadowDy = h * 0.16;
          ctx.beginPath();
          ctx.moveTo(basePts[0][0] + shadowDx, basePts[0][1] + shadowDy);
          for (let i = 1; i < basePts.length; i++) {
            ctx.lineTo(basePts[i][0] + shadowDx, basePts[i][1] + shadowDy);
          }
          ctx.closePath();
          ctx.fillStyle = 'rgba(2, 6, 23, 0.42)';
          ctx.fill();

          // Sort walls back-to-front by edge midpoint Y
          const edges = basePts.map((pt, i) => {
            const next = (i + 1) % basePts.length;
            const midY = (pt[1] + basePts[next][1]) * 0.5;
            const litFactor = computeEdgeLitFactor(pt, basePts[next], signedArea);
            return { i, next, midY, litFactor };
          });
          edges.sort((e1, e2) => e1.midY - e2.midY);

          const wallAlpha = b.tier >= 2 ? 0.86 : 0.72;
          for (let eIdx = 0; eIdx < edges.length; eIdx++) {
            const edge = edges[eIdx];
            const b0 = basePts[edge.i];
            const b1 = basePts[edge.next];
            const r1 = roofPts[edge.next];
            const r0 = roofPts[edge.i];

            ctx.beginPath();
            ctx.moveTo(b0[0], b0[1]);
            ctx.lineTo(b1[0], b1[1]);
            ctx.lineTo(r1[0], r1[1]);
            ctx.lineTo(r0[0], r0[1]);
            ctx.closePath();
            ctx.fillStyle = lerpRgb(pal.darkRgb, pal.litRgb, edge.litFactor, wallAlpha);
            ctx.fill();
            ctx.strokeStyle = pal.wallStroke;
            ctx.lineWidth = 0.85;
            ctx.stroke();

            // Mid-story architectural line on tall buildings
            if (h >= 24) {
              ctx.beginPath();
              ctx.moveTo((b0[0] + r0[0]) * 0.5, (b0[1] + r0[1]) * 0.5);
              ctx.lineTo((b1[0] + r1[0]) * 0.5, (b1[1] + r1[1]) * 0.5);
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
              ctx.lineWidth = 0.6;
              ctx.stroke();
            }
          }

          // Crisp roof cap with bevel rim
          ctx.beginPath();
          ctx.moveTo(roofPts[0][0], roofPts[0][1]);
          for (let i = 1; i < roofPts.length; i++) ctx.lineTo(roofPts[i][0], roofPts[i][1]);
          ctx.closePath();
          ctx.fillStyle = pal.roofFill;
          ctx.fill();
          ctx.strokeStyle = pal.roofStroke;
          ctx.lineWidth = b.tier >= 2 ? 1.3 : 0.95;
          ctx.stroke();

          ctx.restore();
        }

        // 5. Selectable Khoroo Context Pins (click any khoroo directly on 3D canvas!)
        const hitTargets: Array<{ kh: KhorooData; cx: number; cy: number }> = [];
        const districtKhoroos = current.activeDistrict
          ? current.khoroos.filter((k) => k.districtId === current.activeDistrict!.id)
          : current.khoroos.slice(0, 40);

        for (const kh of districtKhoroos) {
          const [kx, ky] = toPt(kh.center);
          if (!inCanvas(kx, ky, 24)) continue;
          const [cx, cy] = toContainerPt(kh.center);
          hitTargets.push({ kh, cx, cy });

          if (kh.id === sc.targetKhorooId) continue;

          const isHovered = hoveredKhorooIdRef.current === kh.id;
          const pinColor =
            kh.riskScore >= 75 ? '#EF4444' : kh.riskScore >= 55 ? '#FF633C' : '#12B89A';
          ctx.save();
          if (isHovered) {
            ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
            ctx.beginPath();
            ctx.arc(kx, ky, 16, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = isHovered ? 'rgba(15, 23, 42, 0.98)' : 'rgba(9, 17, 36, 0.88)';
          ctx.beginPath();
          ctx.arc(kx, ky, isHovered ? 12 : 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = isHovered ? '#38BDF8' : pinColor;
          ctx.lineWidth = isHovered ? 2.2 : 1.8;
          ctx.stroke();

          ctx.fillStyle = '#F8FAFC';
          ctx.font = '800 9px "JetBrains Mono", ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(kh.khorooNumber), kx, ky + 0.5);

          if (isHovered) {
            const hoverTag = `${khorooLabel(kh.khorooNumber, current.isMn)} · ${kh.riskScore}/100`;
            ctx.font = '700 10px "Plus Jakarta Sans", system-ui, sans-serif';
            const tw = ctx.measureText(hoverTag).width + 14;
            const tx = kx - tw * 0.5;
            const ty = ky - 34;
            ctx.fillStyle = 'rgba(9, 17, 36, 0.96)';
            drawRoundedRectPath(ctx, tx, ty, tw, 20, 6);
            ctx.fill();
            ctx.strokeStyle = '#38BDF8';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = '#F8FAFC';
            ctx.fillText(hoverTag, kx, ty + 10.5);
          }
          ctx.restore();
        }
        khorooHitTargetsRef.current = hitTargets;

        // Safe UI viewport bounds (so callouts NEVER touch top bars, zoom buttons, bottom dock, or right drawer)
        const isSmallPhone = size.x < 640;
        const isMobile = size.x < 1024;
        const rightClear = current.isPanelOpen && !isMobile ? 416 : isSmallPhone ? 52 : 16;
        const bottomClear = isSmallPhone
          ? current.isPanelOpen
            ? 275
            : 115
          : isMobile
          ? current.isPanelOpen
            ? 290
            : 145
          : 124;
        const safeBounds: SafeBounds = {
          minX: padX + (isMobile ? 54 : 58),
          maxX: padX + size.x - rightClear,
          minY: padY + (isMobile ? 148 : 156),
          maxY: padY + size.y - bottomClear,
        };
        const placedRects: RectBox[] = [];

        // 6. Active Scenario Dispatch Corridor & Viewport-Safe Callouts
        if (current.scenarioStarted) {
          const corridorScreen = sc.corridorPoints.map(toPt);
          if (corridorScreen.length >= 2) {
            ctx.save();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            // Road casing
            ctx.strokeStyle = 'rgba(6, 11, 22, 0.88)';
            ctx.lineWidth = 7.5;
            ctx.beginPath();
            ctx.moveTo(corridorScreen[0][0], corridorScreen[0][1]);
            for (let i = 1; i < corridorScreen.length; i++) {
              ctx.lineTo(corridorScreen[i][0], corridorScreen[i][1]);
            }
            ctx.stroke();

            // Outer glow halo
            ctx.strokeStyle = 'rgba(16, 185, 129, 0.25)';
            ctx.lineWidth = 10;
            ctx.stroke();

            // Dashed directional corridor line (honestly schematic, not street routing)
            ctx.setLineDash([10, 6]);
            ctx.strokeStyle = '#34D399';
            ctx.lineWidth = 3.2;
            ctx.stroke();

            // Directional arrowheads pointing from Fire Station toward Target Khoroo
            ctx.setLineDash([]);
            ctx.fillStyle = '#6EE7B7';
            for (const fracIdx of [3, 6, 9]) {
              const pA = corridorScreen[fracIdx - 1];
              const pB = corridorScreen[fracIdx];
              if (!pA || !pB) continue;
              const ang = Math.atan2(pB[1] - pA[1], pB[0] - pA[0]);
              const mx = (pA[0] + pB[0]) * 0.5;
              const my = (pA[1] + pB[1]) * 0.5;
              ctx.save();
              ctx.translate(mx, my);
              ctx.rotate(ang);
              ctx.beginPath();
              ctx.moveTo(5, 0);
              ctx.lineTo(-4, -4);
              ctx.lineTo(-2.5, 0);
              ctx.lineTo(-4, 4);
              ctx.closePath();
              ctx.fill();
              ctx.restore();
            }
            ctx.restore();
          }

          // Station beacon (clipped cleanly to viewport edge if off-screen)
          const rawStationPt = toPt(sc.nearestStation.coordinates);
          const stationEdge = clipPointAlongRayToBounds(targetScreen, rawStationPt, safeBounds);
          const stationTitle = current.isMn
            ? sc.nearestStation.nameMn
            : sc.nearestStation.nameEn;

          drawFireStationBeacon(
            ctx,
            stationEdge.point[0],
            stationEdge.point[1],
            stationTitle,
            stationEdge.clipped
              ? current.isMn
                ? '↗ Хүрээний гаднаас чиглэсэн анги'
                : '↗ Off-view station direction'
              : null,
            placedRects,
            safeBounds,
            !isSmallPhone
          );

          // Corridor midpoint rough ETA callout (on tablet/desktop; small phones read it cleanly from the HUD bar)
          if (!isSmallPhone) {
            const midPt = [
              (targetScreen[0] + stationEdge.point[0]) * 0.5,
              (targetScreen[1] + stationEdge.point[1]) * 0.5,
            ];
            drawCalloutCard(
              ctx,
              midPt[0],
              midPt[1],
              14,
              current.isMn
                ? `Ойролцоо ~${sc.etaMin} мин · ~${sc.distanceKm} км`
                : `Rough est ~${sc.etaMin} min · ~${sc.distanceKm} km`,
              current.isMn
                ? `Шулуун ${sc.straightKm.toFixed(1)} км × ${sc.assumptions.detourFactor.toFixed(2)}`
                : `Straight ${sc.straightKm.toFixed(1)} km × ${sc.assumptions.detourFactor.toFixed(2)}`,
              '#10B981',
              null,
              placedRects,
              safeBounds
            );
          }

          // Scenario Target Khoroo Callout
          const khNumberText = khorooLabel(
            current.khoroos.find((k) => k.id === sc.targetKhorooId)?.khorooNumber ?? 1,
            current.isMn
          );
          drawCalloutCard(
            ctx,
            targetScreen[0],
            targetScreen[1] - 6,
            26,
            `${sc.targetLabelMn ? (current.isMn ? sc.targetLabelMn : sc.targetLabelEn) : khNumberText}`,
            current.isMn
              ? `Таамагласан бүс · r = ${sc.scenarioRadiusMeters} м`
              : `Assumed zone · r = ${sc.scenarioRadiusMeters} m`,
            '#FF633C',
            `${sc.targetScore}/100`,
            placedRects,
            safeBounds
          );
        } else {
          // Preview target label before starting scenario
          drawCalloutCard(
            ctx,
            targetScreen[0],
            targetScreen[1] - 6,
            24,
            current.isMn ? sc.targetLabelMn : sc.targetLabelEn,
            current.isMn ? 'Сонгосон хороо (урьдчилсан харагдац)' : 'Selected khoroo (preview)',
            '#38BDF8',
            `${sc.targetScore}/100`,
            placedRects,
            safeBounds
          );
        }
      };

      drawRef.current = draw;

      const handleZoomAnim = (ev: L.ZoomAnimEvent) => {
        if (renderedZoom === null || !renderedTopLeftLatLng || !latest.current.active) return;
        const scale = map.getZoomScale(ev.zoom, renderedZoom);
        const leafletMap = map as unknown as {
          _latLngToNewLayerPoint: (latlng: L.LatLng, zoom: number, center: L.LatLng) => L.Point;
        };
        const offset = leafletMap._latLngToNewLayerPoint(renderedTopLeftLatLng, ev.zoom, ev.center);
        applyTransform(offset, scale);
      };

      const handleZoom = () => {
        if (renderedZoom === null || !renderedTopLeftLatLng || !latest.current.active) return;
        const curZoom = map.getZoom();
        const scale = map.getZoomScale(curZoom, renderedZoom);
        const offset = map.latLngToLayerPoint(renderedTopLeftLatLng);
        applyTransform(offset, scale);
        const animatingCss = (map as unknown as { _animatingZoom?: boolean })._animatingZoom;
        if (!animatingCss && (scale < 0.7 || scale > 1.45)) {
          scheduleRedraw();
        }
      };

      const handleMove = () => {
        if (!latest.current.active) return;
        const animatingCss = (map as unknown as { _animatingZoom?: boolean })._animatingZoom;
        if (animatingCss) return;
        if (!renderedBounds || !renderedBounds.contains(map.getBounds())) {
          scheduleRedraw();
        }
      };

      draw();
      map.on('zoomanim', handleZoomAnim);
      map.on('zoom', handleZoom);
      map.on('move', handleMove);
      map.on('zoomend', scheduleRedraw);
      map.on('moveend', scheduleRedraw);
      map.on('viewreset', scheduleRedraw);
      map.on('resize', scheduleRedraw);

      return () => {
        live = false;
        map.off('zoomanim', handleZoomAnim);
        map.off('zoom', handleZoom);
        map.off('move', handleMove);
        map.off('zoomend', scheduleRedraw);
        map.off('moveend', scheduleRedraw);
        map.off('viewreset', scheduleRedraw);
        map.off('resize', scheduleRedraw);
        if (frameRef.current !== null) {
          cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
        }
        if (tileBatchTimerRef.current !== null) {
          window.clearTimeout(tileBatchTimerRef.current);
          tileBatchTimerRef.current = null;
        }
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        if (drawRef.current === draw) drawRef.current = null;
      };
    }, [map]);

    useEffect(() => {
      drawRef.current?.();
    }, [active, is3DExtruded, isPanelOpen, scenarioStarted, scene, isMn]);

    return null;
  }
);
