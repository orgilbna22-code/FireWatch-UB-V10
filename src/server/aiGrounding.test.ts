import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAiExplanationGrounding } from './aiGrounding';

test('verifyAiExplanationGrounding passes clean grounded structured response without warnings', () => {
  const result = verifyAiExplanationGrounding(
    {
      summary: 'Баянзүрх дүүрэгт эвристик индекс 78/100 байна.',
      verifiedFactors: ['Гэр хорооллын нягтрал өндөр', 'Салхи тархалт нэмэгдүүлнэ'],
      weatherInfluence: '2026-11-20 ажиглалтаар хуурайшилт өндөр байна.',
      dataLimitations: '2024–2026 жишээ бүртгэлд суурилсан индекс, магадлал (%) биш.',
      actionableSteps: ['Янданг тогтмол хөөлөх'],
    },
    {
      language: 'mn',
      areaName: 'Баянзүрх',
      riskScore: 78,
      isModelled: false,
      weatherObservedAtIso: '2026-11-20T12:00',
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.payload.groundingWarnings.length, 0);
  assert.equal(result.payload.verifiedGrounding, true);
});

test('verifyAiExplanationGrounding strips hallucinated probability percentage and fills missing fields', () => {
  const result = verifyAiExplanationGrounding(
    {
      summary: 'There is a 84% probability of fire tonight.',
      verifiedFactors: [],
    },
    {
      language: 'en',
      areaName: 'Chingeltei K-12',
      riskScore: 71,
      isModelled: true,
      weatherObservedAtIso: null,
    }
  );

  assert.equal(result.ok, false);
  assert.ok(result.payload.groundingWarnings.includes('stripped_ungrounded_probability_claim'));
  assert.ok(!result.payload.summary.includes('84% probability'));
  assert.ok(result.payload.summary.includes('[heuristic risk index]'));
  assert.ok(result.payload.dataLimitations.includes('modelled'));
  assert.ok(result.payload.actionableSteps.length >= 1);
});
