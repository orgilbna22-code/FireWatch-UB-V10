import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCleanTrainingDataset,
  validateRealIncidentRow,
} from './mlDataFoundation';

test('validateRealIncidentRow rejects invalid district, out-of-UB coords, and unrealistic response time', () => {
  const bad = validateRealIncidentRow(
    {
      id: 'bad-1',
      date: '2025-11-15',
      districtId: 'unknown-district',
      khorooNumber: 99,
      category: 'residential_ger',
      severity: 'critical',
      causeGuessMn: 'Test cause',
      responseTimeMin: 400,
      lat: 10.0,
      lng: 10.0,
    },
    '2026-11-20'
  );
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.ok(bad.reasons.includes('invalid_district'));
    assert.ok(bad.reasons.includes('out_of_ub_bounds'));
    assert.ok(bad.reasons.includes('invalid_response_time'));
  }
});

test('buildCleanTrainingDataset strictly excludes ALL demo records and deduplicates real records', () => {
  const report = buildCleanTrainingDataset(
    [
      {
        id: 'demo-1',
        date: '2025-01-12',
        districtId: 'bayanzurkh',
        khorooNumber: 27,
        category: 'residential_ger',
        severity: 'critical',
        causeGuessMn: 'Demo record should never enter ML',
        responseTimeMin: 12,
        lat: 47.9401,
        lng: 107.0112,
        dataOrigin: 'demo',
      },
      {
        id: 'demo-flag-2',
        date: '2025-02-10',
        districtId: 'bayanzurkh',
        khorooNumber: 27,
        category: 'electrical',
        severity: 'moderate',
        causeGuessMn: 'isDemo=true must also be excluded',
        responseTimeMin: 10,
        lat: 47.9401,
        lng: 107.0112,
        isDemo: true,
        dataOrigin: 'real',
      },
      {
        id: 'real-1',
        date: '2025-03-14',
        districtId: 'bayanzurkh',
        khorooNumber: 27,
        category: 'residential_ger',
        severity: 'critical',
        causeGuessMn: 'Зуухны яндангийн цонолт',
        responseTimeMin: 11,
        lat: 47.9401,
        lng: 107.0112,
        dataOrigin: 'real',
      },
      // Canonical duplicate of real-1 with slightly different ID
      {
        id: 'real-1-dup',
        date: '2025-03-14',
        districtId: 'bayanzurkh',
        khorooNumber: 27,
        category: 'residential_ger',
        severity: 'critical',
        causeGuessMn: 'Зуухны яндангийн цонолт (давхардсан)',
        responseTimeMin: 11,
        lat: 47.9401,
        lng: 107.0112,
        dataOrigin: 'real',
      },
      {
        id: 'real-2-invalid',
        date: '2025-03-18',
        districtId: 'chingeltei',
        khorooNumber: 5,
        category: 'electrical',
        severity: 'minor',
        causeGuessMn: 'Шалгалт',
        responseTimeMin: 8,
        lat: 0,
        lng: 0,
        dataOrigin: 'real',
      },
    ],
    '2026-11-20'
  );

  assert.equal(report.excludedDemoCount, 2);
  assert.equal(report.realRowCount, 3);
  assert.equal(report.cleanUniqueRealCount, 1);
  assert.equal(report.duplicateCount, 1);
  assert.equal(report.rejectedCount, 1);
  assert.equal(report.panelRows.length, 1);
  assert.equal(report.panelRows[0].khorooKey, 'bayanzurkh-27');
  assert.equal(report.panelRows[0].monthKey, '2025-03');
  assert.equal(report.readyForTraining, false);
});
