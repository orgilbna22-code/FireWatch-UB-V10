import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTactical3DScene,
  clampAssumptions,
  clipPointAlongRayToBounds,
  computeEdgeLitFactor,
  computeRoughDispatchEstimate,
  findNearestStation,
  generateCityBlueFootprints,
  mapScaleLabel,
  polygonSignedAreaScreen,
  resolveSafeCardPosition,
  selectFocusedOsm3DBuildings,
} from './tactical3dData';
import { latLngToTile, tilePxToLatLng, type OsmBuildingPoly } from './osmVectorBuildings';
import { UB_DISTRICTS, UB_FIRE_STATIONS, UB_KHOROOS } from '../data/ubGeoData';
import { DEFAULT_TACTICAL_ASSUMPTIONS } from '../data/tacticalScenarioConfig';

test('findNearestStation returns closest station with valid rough route distance and ETA', () => {
  const target = UB_KHOROOS[0].center;
  const res = findNearestStation(target, UB_FIRE_STATIONS, DEFAULT_TACTICAL_ASSUMPTIONS);
  assert.ok(res.station);
  assert.ok(res.routeKm >= 0.3);
  assert.ok(res.etaMin >= 2);
});

test('computeRoughDispatchEstimate reacts accurately to editable assumptions', () => {
  const slow = computeRoughDispatchEstimate(5, {
    radiusMeters: 250,
    detourFactor: 1.5,
    avgSpeedKmh: 20,
    turnoutDelayMin: 4,
  });
  const fast = computeRoughDispatchEstimate(5, {
    radiusMeters: 250,
    detourFactor: 1.1,
    avgSpeedKmh: 40,
    turnoutDelayMin: 1,
  });
  assert.equal(slow.routeKm, 7.5);
  assert.equal(slow.etaMin, 27);
  assert.equal(fast.routeKm, 5.5);
  assert.equal(fast.etaMin, 9);
});

test('clampAssumptions clamps out-of-range inputs safely', () => {
  const clamped = clampAssumptions({
    radiusMeters: 9999,
    detourFactor: 0.2,
    avgSpeedKmh: 120,
    turnoutDelayMin: -5,
  });
  assert.equal(clamped.radiusMeters, 600);
  assert.equal(clamped.detourFactor, 1.0);
  assert.equal(clamped.avgSpeedKmh, 50);
  assert.equal(clamped.turnoutDelayMin, 0);
});

test('generateCityBlueFootprints produces deterministic flat cobalt footprints', () => {
  const fp1 = generateCityBlueFootprints(UB_KHOROOS);
  const fp2 = generateCityBlueFootprints(UB_KHOROOS);
  assert.ok(fp1.length > 100);
  assert.deepEqual(fp1[0], fp2[0]);
  assert.equal(fp1[0].tone, 'blue_footprint');
  assert.equal(fp1[0].heightPx, 0);
});

test('buildTactical3DScene builds honest scenario circle and corridor without fabricated POIs', () => {
  const baseFootprints = generateCityBlueFootprints(UB_KHOROOS);
  const scene = buildTactical3DScene({
    activeDistrict: UB_DISTRICTS[0],
    selectedKhoroo: null,
    khoroos: UB_KHOROOS,
    stations: UB_FIRE_STATIONS,
    baseFootprints,
    assumptions: { radiusMeters: 350 },
  });

  assert.equal(scene.scenarioRadiusMeters, 350);
  assert.ok(scene.corridorPoints.length >= 6);
  assert.equal(scene.corridorPoints[0][0], scene.nearestStation.coordinates[0]);
  assert.equal(scene.corridorPoints[scene.corridorPoints.length - 1][0], scene.targetCoord[0]);
  // Ensure no fabricated POI/red-building arrays exist on scene
  assert.equal('pois' in scene, false);
  assert.equal('evacuationOrigin' in scene, false);
});

test('selectFocusedOsm3DBuildings uses neutral analytical tones without fake danger labels', () => {
  const baseFootprints = generateCityBlueFootprints(UB_KHOROOS);
  const scene = buildTactical3DScene({
    activeDistrict: UB_DISTRICTS[0],
    selectedKhoroo: null,
    khoroos: UB_KHOROOS,
    stations: UB_FIRE_STATIONS,
    baseFootprints,
    assumptions: { radiusMeters: 250 },
  });

  const fakeOsm: OsmBuildingPoly[] = [
    {
      id: 'osm-p1',
      center: [scene.targetCoord[0] + 0.0002, scene.targetCoord[1] - 0.0002],
      corners: [scene.targetCoord, scene.targetCoord, scene.targetCoord],
      heightPx: 26,
      areaScore: 180,
    },
    ...Array.from({ length: 18 }, (_, idx) => ({
      id: `osm-ctx-${idx}`,
      center: [scene.targetCoord[0] + 0.0032, scene.targetCoord[1] + 0.0003 * (idx - 9)] as [number, number],
      corners: [scene.targetCoord, scene.targetCoord, scene.targetCoord] as [number, number][],
      heightPx: 18,
      areaScore: 50 + idx * 10,
    })),
  ];

  const picked = selectFocusedOsm3DBuildings(fakeOsm, scene, 5);
  assert.equal(picked.hasRealZoneBuildings, true);
  assert.ok(picked.extruded.some((b) => b.id === 'osm-p1' && b.tone === 'zone_focus'));
  assert.ok(
    picked.extruded.every(
      (b) => b.tone === 'zone_focus' || b.tone === 'slate_landmark' || b.tone === 'slate_context'
    )
  );
  const ctxCount = picked.extruded.filter((b) => b.id.startsWith('osm-ctx-')).length;
  assert.equal(ctxCount, 5);
});

test('polygonSignedAreaScreen & computeEdgeLitFactor shade sun-facing walls brighter than opposite walls', () => {
  const rect: [number, number][] = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ];
  const area = polygonSignedAreaScreen(rect);
  assert.ok(area > 0);
  const topLit = computeEdgeLitFactor(rect[0], rect[1], area); // top faces -Y (sun!)
  const bottomLit = computeEdgeLitFactor(rect[2], rect[3], area); // bottom faces +Y (shadow!)
  const leftLit = computeEdgeLitFactor(rect[3], rect[0], area); // left faces -X (sun!)
  const rightLit = computeEdgeLitFactor(rect[1], rect[2], area); // right faces +X (shadow!)
  assert.ok(topLit > bottomLit);
  assert.ok(leftLit > rightLit);
});

test('resolveSafeCardPosition clamps cards inside viewport and avoids collisions', () => {
  const placed = [{ x: 100, y: 150, w: 140, h: 28 }];
  const pos = resolveSafeCardPosition(
    105,
    152,
    140,
    28,
    placed,
    { minX: 20, maxX: 800, minY: 140, maxY: 600 },
    [
      [0, 0],
      [0, 42],
      [160, 0],
    ]
  );
  assert.ok(pos.x >= 20 && pos.x <= 800 - 140);
  assert.ok(pos.y >= 140 && pos.y <= 600 - 28);
  assert.notEqual(pos.y, 152);
});

test('clipPointAlongRayToBounds clips off-screen station coord onto safe edge', () => {
  const res = clipPointAlongRayToBounds([400, 400], [1600, 400], {
    minX: 50,
    maxX: 900,
    minY: 100,
    maxY: 700,
  });
  assert.equal(res.clipped, true);
  assert.equal(Math.round(res.point[0]), 900);
  assert.equal(Math.round(res.point[1]), 400);
});

test('latLngToTile and tilePxToLatLng round-trip Ulaanbaatar coordinates accurately', () => {
  const ubLat = 47.9188;
  const ubLng = 106.9176;
  const tile = latLngToTile(ubLat, ubLng, 14);
  assert.equal(tile.x, 13057);
  assert.equal(tile.y, 5700);
  const centerOfTile = tilePxToLatLng(tile.x, tile.y, 2048, 2048, 4096, 14);
  assert.ok(Math.abs(centerOfTile[0] - ubLat) < 0.02);
  assert.ok(Math.abs(centerOfTile[1] - ubLng) < 0.02);
});

test('mapScaleLabel returns cartographic ratio per zoom level', () => {
  assert.equal(mapScaleLabel(12), '1:50,000');
  assert.equal(mapScaleLabel(15), '1:10,000');
  assert.equal(mapScaleLabel(9), '1:250,000');
});
