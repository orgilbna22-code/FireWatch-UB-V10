import { DistrictData, FireStation, KhorooData } from '../types';
import type { OsmBuildingPoly } from './osmVectorBuildings';
import {
  DEFAULT_TACTICAL_ASSUMPTIONS,
  type TacticalScenarioAssumptions,
} from '../data/tacticalScenarioConfig';

export interface BuildingFootprint {
  id: string;
  /** Center [lat, lng] */
  center: [number, number];
  /** Polygon ring [lat, lng][] */
  corners: [number, number][];
  /** Extruded height in screen units at reference zoom Z15 (0 = flat footprint only) */
  heightPx: number;
  /**
   * Honest analytical building tones (never fabricate "burning" or "hazard" labels
   * on unverified footprints):
   * - blue_footprint: flat citywide GIS context outline
   * - slate_context: subtle surrounding urban massing
   * - slate_landmark: prominent surrounding structure
   * - zone_focus: neutral structure inside the assumed scenario circle
   */
  tone: 'blue_footprint' | 'slate_context' | 'slate_landmark' | 'zone_focus';
  /** Screen-space priority (0 = flat outline, 1 = context massing, 2 = inside scenario zone) */
  tier: number;
}

export interface DispatchCorridorPoint {
  coord: [number, number];
}

export interface Tactical3DScene {
  targetKhorooId: string;
  targetCoord: [number, number];
  targetLabelMn: string;
  targetLabelEn: string;
  targetScore: number;
  districtId: string;
  districtNameMn: string;
  districtNameEn: string;
  scenarioRadiusMeters: number;
  nearestStation: FireStation;
  straightKm: number;
  distanceKm: number;
  etaMin: number;
  assumptions: TacticalScenarioAssumptions;
  /** Straight/corridor indicator from real nearest station to scenario center */
  corridorPoints: [number, number][];
  buildings: BuildingFootprint[];
}

export function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function clampAssumptions(
  partial?: Partial<TacticalScenarioAssumptions>
): TacticalScenarioAssumptions {
  const r = Number(partial?.radiusMeters ?? DEFAULT_TACTICAL_ASSUMPTIONS.radiusMeters);
  const detour = Number(partial?.detourFactor ?? DEFAULT_TACTICAL_ASSUMPTIONS.detourFactor);
  const speed = Number(partial?.avgSpeedKmh ?? DEFAULT_TACTICAL_ASSUMPTIONS.avgSpeedKmh);
  const turnout = Number(partial?.turnoutDelayMin ?? DEFAULT_TACTICAL_ASSUMPTIONS.turnoutDelayMin);

  return {
    radiusMeters: Math.max(100, Math.min(600, Math.round(Number.isFinite(r) ? r : 250))),
    detourFactor: Math.max(1.0, Math.min(1.8, +(Number.isFinite(detour) ? detour : 1.28).toFixed(2))),
    avgSpeedKmh: Math.max(15, Math.min(50, Math.round(Number.isFinite(speed) ? speed : 28))),
    turnoutDelayMin: Math.max(0, Math.min(6, Math.round(Number.isFinite(turnout) ? turnout : 2))),
  };
}

export function computeRoughDispatchEstimate(
  straightKm: number,
  assumptions: TacticalScenarioAssumptions = DEFAULT_TACTICAL_ASSUMPTIONS
): { routeKm: number; etaMin: number } {
  const safeAssumptions = clampAssumptions(assumptions);
  const routeKm = Math.max(0.3, +(straightKm * safeAssumptions.detourFactor).toFixed(1));
  const travelMin = (routeKm / safeAssumptions.avgSpeedKmh) * 60;
  const etaMin = Math.max(2, Math.round(safeAssumptions.turnoutDelayMin + travelMin));
  return { routeKm, etaMin };
}

/** Deterministic PRNG so context footprints never jitter across renders */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRotatedRect(
  lat: number,
  lng: number,
  halfW: number,
  halfH: number,
  angleRad: number
): [number, number][] {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const lngScale = 1.48; // UB latitude (~47.9 deg) longitude projection compensation
  const pts: [number, number][] = [
    [-halfW, -halfH],
    [halfW, -halfH],
    [halfW, halfH],
    [-halfW, halfH],
  ];
  return pts.map(([dx, dy]) => [
    lat + (dx * sin + dy * cos),
    lng + (dx * cos - dy * sin) * lngScale,
  ]);
}

export function findNearestStation(
  target: [number, number],
  stations: FireStation[],
  assumptions: TacticalScenarioAssumptions = DEFAULT_TACTICAL_ASSUMPTIONS
): { station: FireStation; straightKm: number; routeKm: number; etaMin: number } {
  let best = stations[0];
  let bestDist = Infinity;
  for (const s of stations) {
    const d = haversineKm(target, s.coordinates);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  const { routeKm, etaMin } = computeRoughDispatchEstimate(bestDist, assumptions);
  return { station: best, straightKm: bestDist, routeKm, etaMin };
}

/**
 * Generates an honest straight-line-plus-detour schematic corridor between
 * the nearest station and the selected scenario center (explicitly labelled
 * in UI as a rough directional line, not live turn-by-turn street navigation).
 */
export function buildCorridorArc(
  from: [number, number],
  to: [number, number]
): [number, number][] {
  const midLat = (from[0] + to[0]) * 0.5;
  const midLng = (from[1] + to[1]) * 0.5;
  const dLat = to[0] - from[0];
  const dLng = to[1] - from[1];
  // Gentle orthographic bow toward the arterial center without inventing fake street turns
  const ctrl: [number, number] = [
    midLat - dLng * 0.04,
    midLng + dLat * 0.06,
  ];
  const pts: [number, number][] = [];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const inv = 1 - t;
    pts.push([
      inv * inv * from[0] + 2 * inv * t * ctrl[0] + t * t * to[0],
      inv * inv * from[1] + 2 * inv * t * ctrl[1] + t * t * to[1],
    ]);
  }
  return pts;
}

export function generateCityBlueFootprints(khoroos: KhorooData[]): BuildingFootprint[] {
  const buildings: BuildingFootprint[] = [];

  for (let idx = 0; idx < khoroos.length; idx++) {
    const kh = khoroos[idx];
    const rand = mulberry32(idx * 9301 + kh.khorooNumber * 497);
    const clusterCount = kh.riskScore >= 70 ? 5 : 3;
    const baseAngle = (rand() - 0.5) * 0.25;

    for (let b = 0; b < clusterCount; b++) {
      const latOff = (rand() - 0.5) * 0.0068;
      const lngOff = (rand() - 0.5) * 0.0102;
      const halfW = 0.00022 + rand() * 0.00028;
      const halfH = 0.00016 + rand() * 0.00022;
      const center: [number, number] = [kh.center[0] + latOff, kh.center[1] + lngOff];
      buildings.push({
        id: `fp-${kh.id}-${b}`,
        center,
        corners: makeRotatedRect(center[0], center[1], halfW, halfH, baseAngle + (b % 2) * 0.05),
        heightPx: 0,
        tone: 'blue_footprint',
        tier: 0,
      });
    }
  }
  return buildings;
}

function shortKhorooTitle(name: string): string {
  const cleaned = name.replace(/\s*\([^)]*\)/g, '').trim();
  const paren = name.match(/\(([^)]+)\)/);
  if (paren && paren[1]) {
    const firstTag = paren[1].split(',')[0].trim();
    const combined = `${cleaned} · ${firstTag}`;
    return combined.length <= 24 ? combined : cleaned;
  }
  return cleaned;
}

export function buildTactical3DScene(params: {
  activeDistrict: DistrictData | null;
  selectedKhoroo: KhorooData | null;
  khoroos: KhorooData[];
  stations: FireStation[];
  baseFootprints: BuildingFootprint[];
  assumptions?: Partial<TacticalScenarioAssumptions>;
}): Tactical3DScene {
  const { activeDistrict, selectedKhoroo, khoroos, stations, baseFootprints } = params;
  const assumptions = clampAssumptions(params.assumptions);

  const districtKhoroos = activeDistrict
    ? khoroos
        .filter((k) => k.districtId === activeDistrict.id)
        .sort((a, b) => b.riskScore - a.riskScore)
    : [...khoroos].sort((a, b) => b.riskScore - a.riskScore);

  const primaryKhoroo = selectedKhoroo ?? districtKhoroos[0] ?? khoroos[0];
  const targetCoord = primaryKhoroo.center;
  const nearest = findNearestStation(targetCoord, stations, assumptions);
  const corridorPoints = buildCorridorArc(nearest.station.coordinates, targetCoord);

  return {
    targetKhorooId: primaryKhoroo.id,
    targetCoord,
    targetLabelMn: shortKhorooTitle(primaryKhoroo.nameMn),
    targetLabelEn: shortKhorooTitle(primaryKhoroo.nameEn),
    targetScore: primaryKhoroo.riskScore,
    districtId: activeDistrict?.id ?? primaryKhoroo.districtId,
    districtNameMn: activeDistrict?.nameMn ?? '',
    districtNameEn: activeDistrict?.nameEn ?? '',
    scenarioRadiusMeters: assumptions.radiusMeters,
    nearestStation: nearest.station,
    straightKm: nearest.straightKm,
    distanceKm: nearest.routeKm,
    etaMin: nearest.etaMin,
    assumptions,
    corridorPoints,
    buildings: baseFootprints,
  };
}

/**
 * Selects real OpenStreetMap building footprints cleanly without inventing
 * "red danger houses" or fake attributes:
 * - Structures inside the user's Assumed Scenario Radius get neutral focal slate/cyan tone (`zone_focus`)
 * - Up to `maxContextExtrusions` prominent surrounding structures get `slate_landmark` / `slate_context`
 * - Remaining footprints stay as crisp flat GIS outlines
 */
export function selectFocusedOsm3DBuildings(
  osmBuildings: OsmBuildingPoly[],
  scene: Tactical3DScene,
  maxContextExtrusions = 24
): { extruded: BuildingFootprint[]; osmOutlines: OsmBuildingPoly[]; hasRealZoneBuildings: boolean } {
  if (osmBuildings.length === 0) {
    return { extruded: [], osmOutlines: [], hasRealZoneBuildings: false };
  }

  const radiusKm = scene.scenarioRadiusMeters / 1000;
  const contextRadiusKm = Math.max(0.55, radiusKm * 2.2);

  const zoneBuildings: Array<{ b: OsmBuildingPoly; dist: number }> = [];
  const contextCandidates: Array<{ b: OsmBuildingPoly; dist: number }> = [];

  for (let i = 0; i < osmBuildings.length; i++) {
    const b = osmBuildings[i];
    const dist = haversineKm(b.center, scene.targetCoord);

    if (dist <= radiusKm) {
      zoneBuildings.push({ b, dist });
    } else if (dist <= contextRadiusKm && b.areaScore >= 10) {
      contextCandidates.push({ b, dist });
    }
  }

  zoneBuildings.sort((a, b) => a.dist - b.dist || b.b.areaScore - a.b.areaScore);
  const focalExtruded: BuildingFootprint[] = zoneBuildings.slice(0, 32).map(({ b }) => ({
    id: b.id,
    center: b.center,
    corners: b.corners,
    heightPx: Math.max(16, Math.min(54, b.heightPx + 4)),
    tone: 'zone_focus',
    tier: 2,
  }));

  contextCandidates.sort((a, b) => b.b.areaScore - a.b.areaScore);
  const contextExtruded: BuildingFootprint[] = contextCandidates
    .slice(0, maxContextExtrusions)
    .map(({ b }) => ({
      id: b.id,
      center: b.center,
      corners: b.corners,
      heightPx: Math.max(12, Math.min(44, b.heightPx)),
      tone: b.areaScore >= 160 ? 'slate_landmark' : 'slate_context',
      tier: 1,
    }));

  return {
    extruded: [...focalExtruded, ...contextExtruded],
    osmOutlines: osmBuildings,
    hasRealZoneBuildings: focalExtruded.length >= 1,
  };
}

/**
 * Signed 2D screen-space polygon area (positive = clockwise in screen Y-down coordinates).
 * Used to determine true outward edge normals for accurate 3D wall shading.
 */
export function polygonSignedAreaScreen(pts: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    sum += x0 * y1 - x1 * y0;
  }
  return sum * 0.5;
}

/**
 * Returns directional lighting factor [0..1] for a wall segment from p0 -> p1
 * against a normalized upper-left sun direction.
 */
export function computeEdgeLitFactor(
  p0: [number, number],
  p1: [number, number],
  signedArea: number
): number {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return 0.5;

  // In screen coordinates (X right, Y down), CW polygon (signedArea > 0) has outward normal (dy, -dx).
  const sign = signedArea >= 0 ? 1 : -1;
  const nx = (dy * sign) / len;
  const ny = (-dx * sign) / len;

  // Light source from upper-left (-0.64, -0.77)
  const dot = nx * -0.64 + ny * -0.77;
  return Math.max(0, Math.min(1, (dot + 1) * 0.5));
}

export interface RectBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SafeBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function resolveSafeCardPosition(
  desiredX: number,
  desiredY: number,
  w: number,
  h: number,
  placed: RectBox[],
  bounds: SafeBounds,
  candidates: Array<[number, number]>
): { x: number; y: number } {
  const clampRect = (rx: number, ry: number): RectBox => ({
    x: Math.max(bounds.minX, Math.min(Math.max(bounds.minX, bounds.maxX - w), rx)),
    y: Math.max(bounds.minY, Math.min(Math.max(bounds.minY, bounds.maxY - h), ry)),
    w,
    h,
  });

  const overlaps = (a: RectBox, b: RectBox, pad = 6) =>
    !(
      a.x + a.w + pad < b.x ||
      b.x + b.w + pad < a.x ||
      a.y + a.h + pad < b.y ||
      b.y + b.h + pad < a.y
    );

  for (const [dx, dy] of candidates) {
    const rect = clampRect(desiredX + dx, desiredY + dy);
    if (!placed.some((p) => overlaps(rect, p))) {
      placed.push(rect);
      return { x: rect.x, y: rect.y };
    }
  }
  const fallback = clampRect(desiredX, desiredY - 36);
  placed.push(fallback);
  return { x: fallback.x, y: fallback.y };
}

/**
 * Clips a segment [start -> end] into the visible rectangle [bounds] using Cohen-Sutherland / Liang-Barsky
 * so off-screen nearest fire stations still anchor an accurate directional badge at the viewport edge.
 */
export function clipPointAlongRayToBounds(
  insidePt: [number, number],
  outsidePt: [number, number],
  bounds: SafeBounds
): { point: [number, number]; clipped: boolean } {
  const [x0, y0] = insidePt;
  const [x1, y1] = outsidePt;
  if (x1 >= bounds.minX && x1 <= bounds.maxX && y1 >= bounds.minY && y1 <= bounds.maxY) {
    return { point: outsidePt, clipped: false };
  }

  const dx = x1 - x0;
  const dy = y1 - y0;
  let tBest = 1;

  if (dx < -1e-6) tBest = Math.min(tBest, (bounds.minX - x0) / dx);
  if (dx > 1e-6) tBest = Math.min(tBest, (bounds.maxX - x0) / dx);
  if (dy < -1e-6) tBest = Math.min(tBest, (bounds.minY - y0) / dy);
  if (dy > 1e-6) tBest = Math.min(tBest, (bounds.maxY - y0) / dy);

  tBest = Math.max(0.05, Math.min(1, tBest));
  return {
    point: [x0 + dx * tBest, y0 + dy * tBest],
    clipped: true,
  };
}

export function mapScaleLabel(zoom: number): string {
  const z = Math.round(zoom);
  if (z >= 16) return '1:5,000';
  if (z === 15) return '1:10,000';
  if (z === 14) return '1:18,000';
  if (z === 13) return '1:35,000';
  if (z === 12) return '1:50,000';
  if (z === 11) return '1:100,000';
  return '1:250,000';
}
