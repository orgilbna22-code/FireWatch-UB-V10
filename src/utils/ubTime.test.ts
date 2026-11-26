import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatUbShortWeekdayEn,
  getUbDateIso,
  getUbMonthIndex,
  getUbWeekdayIndex,
} from './ubTime';

test('getUbDateIso formats UTC+8 calendar day correctly across UTC midnight boundary', () => {
  // 2026-03-01 18:30:00Z is already 2026-03-02 02:30:00 in Ulaanbaatar (UTC+8)
  const lateUtc = new Date('2026-03-01T18:30:00Z');
  assert.equal(getUbDateIso(lateUtc), '2026-03-02');
});

test('getUbMonthIndex resolves Asia/Ulaanbaatar month cleanly at year boundary', () => {
  // 2025-12-31 20:00:00Z is 2026-01-01 04:00:00 in UB (January -> index 0)
  const nyUtc = new Date('2025-12-31T20:00:00Z');
  assert.equal(getUbMonthIndex(nyUtc), 0);
});

test('getUbWeekdayIndex and formatUbShortWeekdayEn agree in UTC+8', () => {
  // 2026-03-02 is a Monday
  assert.equal(getUbWeekdayIndex('2026-03-02'), 1);
  assert.equal(formatUbShortWeekdayEn('2026-03-02'), 'Mon');
});
