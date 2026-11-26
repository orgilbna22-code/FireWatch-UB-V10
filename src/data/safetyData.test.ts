import test from 'node:test';
import assert from 'node:assert/strict';
import { SAFETY_GUIDES } from './safetyData';
import { EMERGENCY_DISPATCH } from './emergencyContacts';
import { UB_DISTRICT_SEEDS, UB_DISTRICT_COORDS_MAP } from './districtCenters';
import { UB_DISTRICTS, UB_KHOROOS, DEMO_HISTORICAL_INCIDENTS, MONTH_RISK_CALENDAR } from './ubGeoData';

test('SAFETY_GUIDES includes required 7 preparedness guides including citizen lookup keys', () => {
  assert.equal(SAFETY_GUIDES.length, 7);
  const ids = new Set(SAFETY_GUIDES.map((g) => g.id));
  assert.ok(ids.has('guide-ger'));
  assert.ok(ids.has('guide-spring'));
  assert.ok(ids.has('guide-apartments'));
  for (const g of SAFETY_GUIDES) {
    assert.ok(g.keySteps.length >= 3, `Guide ${g.id} must have >= 3 actionable steps`);
    assert.ok(g.criticalRulesMn.length >= 1 && g.criticalRulesEn.length >= 1);
  }
});

test('EMERGENCY_DISPATCH and UB_DISTRICT_SEEDS cover standard UB dispatch & 9 districts', () => {
  assert.equal(EMERGENCY_DISPATCH.fire, '101');
  assert.equal(EMERGENCY_DISPATCH.police, '102');
  assert.equal(EMERGENCY_DISPATCH.ambulance, '103');
  assert.equal(EMERGENCY_DISPATCH.rescue, '105');
  assert.equal(UB_DISTRICT_SEEDS.length, 9);
  for (const d of UB_DISTRICTS) {
    assert.ok(Array.isArray(UB_DISTRICT_COORDS_MAP[d.id]));
  }
});

test('DEMO_HISTORICAL_INCIDENTS are strictly tagged isDemo and dataOrigin=demo', () => {
  assert.equal(DEMO_HISTORICAL_INCIDENTS.length, 12);
  for (const inc of DEMO_HISTORICAL_INCIDENTS) {
    assert.equal(inc.isDemo, true);
    assert.equal(inc.dataOrigin, 'demo');
  }
  assert.equal(MONTH_RISK_CALENDAR.length, 12);
  assert.equal(UB_KHOROOS.length, 204);
});
