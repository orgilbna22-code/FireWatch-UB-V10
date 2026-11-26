export const UB_TIMEZONE = 'Asia/Ulaanbaatar';

/**
 * Returns the YYYY-MM-DD calendar date in Ulaanbaatar time (UTC+8),
 * avoiding off-by-one midnight shifts caused by UTC `.toISOString().slice(0, 10)`.
 */
export function getUbDateIso(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: UB_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Returns the 0-indexed month (0 = Jan .. 11 = Dec) in Asia/Ulaanbaatar (UTC+8).
 */
export function getUbMonthIndex(date: Date = new Date()): number {
  const monthStr = new Intl.DateTimeFormat('en-US', {
    timeZone: UB_TIMEZONE,
    month: 'numeric',
  }).format(date);
  const parsed = Number(monthStr);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 12
    ? parsed - 1
    : date.getMonth();
}

/**
 * Returns the weekday index (0 = Sun .. 6 = Sat) for an ISO YYYY-MM-DD date in UTC+8.
 */
export function getUbWeekdayIndex(dateIso: string): number {
  const safe = /^\d{4}-\d{2}-\d{2}$/.test(dateIso) ? dateIso : getUbDateIso();
  const dt = new Date(`${safe}T12:00:00+08:00`);
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: UB_TIMEZONE,
    weekday: 'short',
  }).format(dt);
  switch (day) {
    case 'Sun':
      return 0;
    case 'Mon':
      return 1;
    case 'Tue':
      return 2;
    case 'Wed':
      return 3;
    case 'Thu':
      return 4;
    case 'Fri':
      return 5;
    case 'Sat':
      return 6;
    default:
      return dt.getUTCDay();
  }
}

/**
 * Formats an ISO YYYY-MM-DD date as a short English weekday in Asia/Ulaanbaatar.
 */
export function formatUbShortWeekdayEn(dateIso: string): string {
  const safe = /^\d{4}-\d{2}-\d{2}$/.test(dateIso) ? dateIso : getUbDateIso();
  return new Date(`${safe}T12:00:00+08:00`).toLocaleDateString('en-US', {
    timeZone: UB_TIMEZONE,
    weekday: 'short',
  });
}
