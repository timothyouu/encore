import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import type { AnalysisResult, Passage } from './contracts.js';
import { coach, validateChoice } from './coaching.js';
import { loadLibrary } from './http.js';
import { buildVisualPlan, validateVisualCard, validateVisualPlan, VISUAL_KINDS } from '../../shared/visual-plan.ts';

const passage: Passage = (await loadLibrary())[0];
const examples = JSON.parse(await readFile(new URL('../../shared/visual-examples.json', import.meta.url), 'utf8')) as unknown;
const schema = JSON.parse(await readFile(new URL('../../shared/visual-plan.schema.json', import.meta.url), 'utf8')) as unknown;

function analysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    schemaVersion: '1', attemptId: 'take-1', passageId: passage.id, passageVersion: passage.version,
    attemptTempoBpm: 60, status: 'ok', detectorVersion: 'test', scoringVersion: 'test',
    audioQuality: { clipped: false, hasDropouts: false, warnings: [] },
    alignment: { offsetSec: 0, reliable: true },
    detectedNotes: [
      { id: 'wrong', midiPitch: 61, onsetSec: 0, durationSec: 1 },
      { id: 'extra', midiPitch: 67, onsetSec: 1.5, durationSec: 0.25 },
      { id: 'timed', midiPitch: 64, onsetSec: 2.25, durationSec: 1 }
    ],
    findings: [
      { id: 'late', kind: 'timing', referenceNoteId: 'P01-N03', detectedNoteId: 'timed', timingDeltaMs: 250 },
      { id: 'wrong-finding', kind: 'wrong_note', referenceNoteId: 'P01-N01', detectedNoteId: 'wrong' },
      { id: 'extra-finding', kind: 'extra_note', detectedNoteId: 'extra' },
      { id: 'missing-finding', kind: 'missing_note', referenceNoteId: 'P01-N02' }
    ],
    metrics: { matchedNotes: 6, expectedNotes: passage.notes.length, medianAbsTimingErrorMs: 250 },
    ...overrides
  };
}

test('versioned fixtures cover each kind and variant and validate as fixtures', () => {
  assert.ok(schema && typeof schema === 'object');
  assert.ok(examples && typeof examples === 'object');
  const catalog = examples as { schemaVersion: string; examples: { name: string; plan: unknown }[] };
  assert.equal(catalog.schemaVersion, '1');
  const seen = new Set<string>();
  for (const entry of catalog.examples) {
    assert.ok(validateVisualPlan(entry.plan), entry.name);
    const plan = entry.plan as { source: string; cards: { kind: string; variant: string }[] };
    assert.equal(plan.source, 'fixture');
    for (const card of plan.cards) seen.add(card.kind + '/' + card.variant);
  }
  for (const [kind, spec] of Object.entries(VISUAL_KINDS)) {
    for (const variant of spec.variants) assert.ok(seen.has(kind + '/' + variant), kind + '/' + variant);
  }
});

test('validated plan is bounded, sorted and tied to measured note IDs', () => {
  const result = buildVisualPlan(analysis(), passage);
  assert.ok(validateVisualPlan(result));
  assert.deepEqual(result.cards.map(card => card.id), ['missing-finding', 'extra-finding', 'wrong-finding']);
  assert.deepEqual(result.cards.map(card => card.priority), [2, 2, 3]);
  assert.equal(result.cards[1].detected.notes.find(note => note.id === 'extra')?.onsetBeat, 1.5);
  assert.deepEqual(result.cards[2].evidence.referenceNoteIds, ['P01-N01']);
  assert.ok(result.cards.every(card => card.evidence.source === 'analysis'));
});

test('visuals and coach focus rank a missing note above 300 ms timing and larger offsets above smaller ones', () => {
  const value = analysis({ findings: [
    { id: 'small', kind: 'timing', referenceNoteId: 'P01-N03', detectedNoteId: 'timed', timingDeltaMs: 160 },
    { id: 'large', kind: 'timing', referenceNoteId: 'P01-N03', detectedNoteId: 'timed', timingDeltaMs: -300 },
    { id: 'missing', kind: 'missing_note', referenceNoteId: 'P01-N02' },
  ] });
  const plan = buildVisualPlan(value, passage);
  assert.deepEqual(plan.cards.map(card => card.id), ['missing', 'large', 'small']);
});

test('uncertain audio overrides findings without invented quality meters or blame', () => {
  const result = buildVisualPlan(analysis({ status: 'uncertain' }), passage);
  assert.ok(validateVisualPlan(result));
  assert.deepEqual(result.cards.map(card => card.kind), ['unclear_audio']);
  assert.deepEqual(result.cards[0].metrics, {});
  assert.deepEqual(result.cards[0].evidence.findingIds, []);
  assert.deepEqual(result.cards[0].detected.notes, []);
  const insufficient = buildVisualPlan(analysis({ status: 'insufficient_audio' }), passage);
  assert.equal(insufficient.cards[0].variant, 'no_piano');
});

test('forged render payloads, fixture-origin claims and unsupported schema are rejected', () => {
  const base = buildVisualPlan(analysis(), passage);
  const clone = (): typeof base => structuredClone(base);
  const html = clone();
  (html.cards[0] as unknown as Record<string, unknown>).html = '<script>alert(1)</script>';
  assert.equal(validateVisualPlan(html), false);
  const metric = clone();
  metric.cards[0].metrics.timingDeltaBeats = Number.NaN;
  assert.equal(validateVisualPlan(metric), false);
  const fixtureOnly = clone();
  fixtureOnly.cards[0].kind = 'tempo_drift';
  fixtureOnly.cards[0].variant = 'rushing';
  fixtureOnly.cards[0].priority = 4;
  assert.equal(validateVisualCard(fixtureOnly.cards[0]), false);
  const noisy = clone();
  noisy.cards = [buildVisualPlan(analysis({ status: 'uncertain' }), passage).cards[0]];
  noisy.cards[0].variant = 'noisy';
  assert.equal(validateVisualPlan(noisy), false);
  const oversized = clone();
  oversized.cards.push(structuredClone(oversized.cards[0]));
  assert.equal(validateVisualPlan(oversized), false);
  const version = clone();
  (version as unknown as Record<string, unknown>).schemaVersion = '2';
  assert.equal(validateVisualPlan(version), false);
  for (const forgedKind of ['constructor', 'toString', '__proto__']) {
    const forged = clone();
    (forged.cards[0] as unknown as Record<string, unknown>).kind = forgedKind;
    assert.equal(validateVisualCard(forged.cards[0]), false);
  }
});

test('dense context retains the actual focal detection', () => {
  const crowded = analysis({
    detectedNotes: [
      ...Array.from({ length: 20 }, (_item, index) => ({ id: 'd' + String(index), midiPitch: 60,
        onsetSec: index * 0.01, durationSec: 0.1 })),
      { id: 'focal', midiPitch: 61, onsetSec: 0.3, durationSec: 1 }
    ],
    findings: [{ id: 'focal-finding', kind: 'wrong_note', referenceNoteId: 'P01-N01', detectedNoteId: 'focal' }]
  });
  const plan = buildVisualPlan(crowded, passage);
  assert.ok(validateVisualPlan(plan));
  assert.ok(plan.cards[0].detected.notes.some(note => note.id === 'focal'));
});

test('kind-specific evidence cannot be omitted or detached from shown notes', () => {
  const catalog = examples as { examples: { name: string; plan: { cards: Record<string, unknown>[] } }[] };
  const fixture = (name: string): { cards: Record<string, unknown>[] } => {
    const found = catalog.examples.find(entry => entry.name === name);
    assert.ok(found, name);
    return structuredClone(found.plan);
  };
  const wrong = fixture('wrong_note-pitch');
  (wrong.cards[0].expected as { notes: unknown[] }).notes = [];
  assert.equal(validateVisualPlan(wrong), false);
  const detached = fixture('wrong_note-pitch');
  (detached.cards[0].evidence as { detectedNoteIds: string[] }).detectedNoteIds = ['invented'];
  assert.equal(validateVisualPlan(detached), false);
  const misplaced = fixture('wrong_note-pitch');
  misplaced.cards[0].focus = { startBeat: 20, endBeat: 21 };
  assert.equal(validateVisualPlan(misplaced), false);
  const timing = fixture('timing-early');
  timing.cards[0].metrics = {};
  assert.equal(validateVisualPlan(timing), false);
  const duration = fixture('duration-short');
  duration.cards[0].metrics = { expectedDurationBeats: 2 };
  assert.equal(validateVisualPlan(duration), false);
  const section = fixture('section_repeat_skip-repeated');
  delete section.cards[0].segments;
  assert.equal(validateVisualPlan(section), false);
  const recurring = fixture('recurring_trouble-recurring');
  (recurring.cards[0].metrics as { recurrenceCount: number }).recurrenceCount = 2;
  assert.equal(validateVisualPlan(recurring), false);
});

test('model may choose an allowed component/action only for the primary finding', async () => {
  const measured = analysis();
  const request = { artifactId: 'fixture-artifact', passageId: passage.id, passageVersion: passage.version, analysis: measured };
  assert.equal(validateChoice({ findingId: 'missing-finding', actionId: 'count_missing', componentKind: 'timing' }, measured), null);
  assert.equal(validateChoice({ findingId: 'missing-finding', actionId: 'count_missing', componentKind: 'missing_note', html: '<p>forge</p>' }, measured), null);
  const bytes = new Uint8Array([1, 2, 3]);
  const chosen = await coach(request, passage, bytes, async () => ({ findingId: 'missing-finding', actionId: 'count_missing', componentKind: 'missing_note' }));
  assert.equal(chosen.coachingSource, 'gemini');
  assert.equal(chosen.visualPlan?.cards[0].id, 'missing-finding');
  const secondary = await coach(request, passage, bytes, async () => ({ findingId: 'wrong-finding', actionId: 'slow_key', componentKind: 'wrong_note' }));
  assert.equal(secondary.coachingSource, 'fallback');
  assert.equal(secondary.fallbackReason, 'invalid_response');
  assert.equal(secondary.visualPlan?.cards[0].id, 'missing-finding');
});
