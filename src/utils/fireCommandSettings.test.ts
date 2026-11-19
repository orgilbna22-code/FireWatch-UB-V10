import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCommandDataQuality,
  getEffectivePilotPartner,
} from './fireCommandSettings';

test('getEffectivePilotPartner returns configurable default when unset', () => {
  const mn = getEffectivePilotPartner('mn', '');
  assert.equal(mn.isConfigured, false);
  assert.ok(mn.label.includes('Тохируулах боломжтой'));

  const custom = getEffectivePilotPartner('en', 'District Unit 10 Pilot');
  assert.equal(custom.isConfigured, true);
  assert.equal(custom.label, 'District Unit 10 Pilot');
});

test('computeCommandDataQuality flags invalid coordinates and unknown causes accurately', () => {
  const summary = computeCommandDataQuality(
    [
      {
        districtId: 'bayanzurkh',
        causeGuessMn: 'Зуухны яндан хэт халсан',
        lat: 47.92,
        lng: 107.01,
      },
      {
        districtId: 'songinokhairkhan',
        causeGuessMn: 'тодорхойгүй',
        lat: 0,
        lng: 0,
      },
    ],
    []
  );

  assert.equal(summary.importedCount, 2);
  assert.equal(summary.missingCoordsCount, 1);
  assert.equal(summary.unknownCauseCount, 1);
  assert.equal(summary.distinctDistrictsCovered, 2);
  assert.ok(summary.metadataReadinessPct > 0 && summary.metadataReadinessPct < 100);
});
