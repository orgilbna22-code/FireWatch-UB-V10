const CSV_FORMULA_GUARD = /^[=+\-@\t\r]/;

/**
 * RFC-4180 quoting with spreadsheet formula-injection neutralization
 * (prefixes leading =, +, -, @, tab, or CR with a single quote).
 */
export function csvCell(value: string | number | boolean | null | undefined): string {
  const raw = String(value ?? '');
  const safe = CSV_FORMULA_GUARD.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * Serializes tabular rows into an Excel-compatible CSV payload with UTF-8 BOM
 * so Mongolian Cyrillic characters open reliably across desktop spreadsheet apps.
 */
export function buildCsvContent(rows: (string | number | boolean | null | undefined)[][]): string {
  const csvBody = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  return `\uFEFF${csvBody}`;
}

export function downloadCsv(
  rows: (string | number | boolean | null | undefined)[][],
  filename: string
): void {
  const content = buildCsvContent(rows);
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
