import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCsvContent, csvCell } from './exportHelpers';

test('csvCell neutralizes spreadsheet formula injection prefixes and escapes quotes', () => {
  assert.equal(csvCell('=SUM(A1:A5)'), `"'=SUM(A1:A5)"`);
  assert.equal(csvCell('+cmd|calc'), `"'${'+cmd|calc'}"`);
  assert.equal(csvCell('-2+3'), `"'-2+3"`);
  assert.equal(csvCell('@HYPERLINK'), `"'@HYPERLINK"`);
  assert.equal(csvCell('\t123'), `"'\t123"`);
  assert.equal(csvCell('Bayanzurkh "2nd" Khoroo'), `"Bayanzurkh ""2nd"" Khoroo"`);
  assert.equal(csvCell(76), `"76"`);
  assert.equal(csvCell(null), `""`);
});

test('buildCsvContent emits UTF-8 BOM and CRLF rows with Mongolian Cyrillic preserved', () => {
  const out = buildCsvContent([
    ['Дүүрэг', 'Индекс', 'Тэмдэглэл'],
    ['Баянзүрх', 76, '=1+1'],
  ]);
  assert.ok(out.startsWith('\uFEFF'), 'Must begin with UTF-8 BOM for Excel Cyrillic');
  const lines = out.slice(1).split('\r\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], '"Дүүрэг","Индекс","Тэмдэглэл"');
  assert.equal(lines[1], '"Баянзүрх","76","\'=1+1"');
});
