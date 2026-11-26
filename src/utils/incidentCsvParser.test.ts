import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NEMA_CSV_TEMPLATE,
  containsCitizenPii,
  parseCsvRealIncidents,
  parseRfc4180Csv,
} from './incidentCsvParser';

test('parseRfc4180Csv strips UTF-8 BOM, handles quoted commas, and doubled quotes', () => {
  const csv = [
    '\uFEFFdate,district,khoroo,category,severity,cause,response_time_min,lat,lng',
    '2025-11-18,bayanzurkh,27,residential_ger,critical,"Яндангийн цонолт, ""хэт халсан"" хэсэг",11,47.9408,107.0112',
  ].join('\n');
  const rows = parseRfc4180Csv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0][0], 'date');
  assert.equal(rows[1][5], 'Яндангийн цонолт, "хэт халсан" хэсэг');
});

test('containsCitizenPii detects Mongolian phone numbers, register IDs, and emails', () => {
  assert.equal(containsCitizenPii('Иргэн Дорж утас 99112233'), true);
  assert.equal(containsCitizenPii('Регистр АБ91021415'), true);
  assert.equal(containsCitizenPii('contact: citizen@example.mn'), true);
  assert.equal(containsCitizenPii('Зуухны яндангийн цонолт, 27-р хороо'), false);
});

test('parseCsvRealIncidents accepts valid MN/EN headers and rejects bad coordinates, future dates, and PII without coercion', () => {
  const csv = [
    'огноо,дүүрэг,хороо,ангилал,зэрэг,шалтгаан,хүрэх_хугацаа,өргөрөг,уртраг',
    // Valid row (Mongolian district alias)
    '2025-12-01,БЗД,27,гэр хороолол,хүнд,Зуухны яндангийн гал,11,47.9408,107.0112',
    // Exact duplicate of first row -> flagged duplicateInBatchCount
    '2025-12-01,bayanzurkh,27,residential_ger,critical,Зуухны яндангийн гал,11,47.9408,107.0112',
    // Missing coordinates -> must reject cleanly (zero centroid fallback!)
    '2025-12-02,СХД,24,цахилгаан,дунд,Богино холболт,12,,',
    // Out-of-bounds coordinates
    '2025-12-02,СБД,10,орон сууц,хөнгөн,Цахилгаан утас,9,52.0000,106.9000',
    // Future date
    '2029-05-01,ЧД,5,цахилгаан,дунд,Ирээдүйн бичлэг,10,47.9450,106.9050',
    // Contains citizen PII (phone)
    '2025-12-03,БГД,12,орон сууц,дунд,Утас 88119922 дуудлага,8,47.9180,106.8750',
  ].join('\n');

  const report = parseCsvRealIncidents(csv, {
    defaultSource: 'NEMA-TEST',
    maxDateIso: '2026-04-01',
  });

  assert.equal(report.totalRows, 6);
  assert.equal(report.validRows.length, 1);
  assert.equal(report.validRows[0].districtId, 'bayanzurkh');
  assert.equal(report.validRows[0].khorooNumber, 27);
  assert.equal(report.validRows[0].dataOrigin, 'real');
  assert.equal(report.duplicateInBatchCount, 1);
  assert.equal(report.rejectedRows.length, 4);
  assert.equal(report.piiRejectedCount, 1);
  assert.ok(report.rejectedRows[0].reasons.includes('invalid_or_out_of_bounds_coordinates'));
  assert.ok(report.rejectedRows[1].reasons.includes('invalid_or_out_of_bounds_coordinates'));
  assert.ok(report.rejectedRows[2].reasons.includes('invalid_or_future_date'));
  assert.ok(report.rejectedRows[3].reasons.includes('contains_pii_phone_or_id'));
});

test('NEMA_CSV_TEMPLATE parses cleanly with zero rejections', () => {
  const report = parseCsvRealIncidents(NEMA_CSV_TEMPLATE, { maxDateIso: '2026-12-31' });
  assert.equal(report.validRows.length, 2);
  assert.equal(report.rejectedRows.length, 0);
  assert.equal(report.piiRejectedCount, 0);
});
