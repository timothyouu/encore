import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore, fixtureAnalysis, fixtureCoaching, SESSION_STORAGE_KEY } from '../src/session.ts';
import { passages } from '../src/passages.ts';
import { calculateDisplaySegments } from '../../shared/segments.ts';
import { buildVisualPlan } from '../../shared/visual-plan.ts';
import { notationWindow, clipVisualCard } from '../src/segments.ts';
import { locationLabel } from '../src/feedback.ts';

function memory() {
  let raw = null;
  return { getItem: () => raw, setItem: (_key, value) => { raw = value; } };
}
function pending() {
  const store = new SessionStore(memory());
  store.selectPassage('P01');
  const record = store.start('test');
  store.stop();
  return { store, record, passage: passages[0] };
}
function versionTwo(record, passage) {
  const analysis = fixtureAnalysis(record, 'clean', '2');
  analysis.detectedNotes.push({ id: 'outside', midiPitch: 80, onsetSec: 10, durationSec: 0.5 });
  const findings = [
    { id: 'wrong', kind: 'wrong_note', referenceNoteId: passage.notes[0].id, detectedNoteId: 'detected-1' },
    { id: 'hold', kind: 'duration', referenceNoteId: passage.notes[1].id, detectedNoteId: 'detected-2', durationDeltaMs: -250 },
    { id: 'missing', kind: 'missing_note', referenceNoteId: passage.notes[2].id },
    { id: 'late', kind: 'timing', referenceNoteId: passage.notes[4].id, detectedNoteId: 'detected-5', timingDeltaMs: 250 },
    { id: 'outside', kind: 'extra_note', detectedNoteId: 'outside' },
  ];
  return { ...analysis, ...calculateDisplaySegments(passage, findings, analysis.detectedNotes, analysis.attemptTempoBpm, analysis.alignment) };
}
function result() {
  const setup = pending();
  const analysis = versionTwo(setup.record, setup.passage);
  assert.equal(setup.store.applyAnalysis(setup.record.attemptId, analysis), true);
  assert.equal(setup.store.applyCoaching(setup.record.attemptId, fixtureCoaching(setup.record)), true);
  return setup;
}

test('v2 exposes every finding/bar pair beyond the three priority cards, including unlocated evidence', () => {
  const { store, record } = result();
  assert.equal(store.entries().length, 5);
  assert.deepEqual(new Set(store.entries().map(entry => entry.finding.id)), new Set(record.analysis.findings.map(finding => finding.id)));
  assert.deepEqual(new Set(store.entries().flatMap(entry => entry.segment ? [entry.segment.startBar] : [])), new Set([1, 2]));
  assert.equal(store.entries().at(-1).finding.id, 'outside');
  assert.equal(store.entries().at(-1).segment, null);
  assert.equal(locationLabel(store.entries().at(-1).finding, null, false), 'Outside reference · No located bar');
});

test('Review and Guide pair traversal is reversible and bounded, preserving saved evidence', () => {
  const { store, record } = result();
  const saved = JSON.stringify(record);
  const identities = store.entries().map(entry => `${entry.finding.id}/${entry.segment?.id ?? 'unlocated'}`);
  const traversed = [];
  for (let step = 0; step < identities.length * 2; step++) {
    const entry = store.selectedEntry();
    traversed.push(`${store.state.screen}:${entry.finding.id}/${entry.segment?.id ?? 'unlocated'}`);
    store.moveFeedback(1);
  }
  assert.deepEqual(traversed, identities.flatMap(id => [`review:${id}`, `guide:${id}`]));
  assert.equal(store.state.findingIndex, identities.length - 1);
  assert.equal(store.state.screen, 'guide');
  for (let step = 0; step < identities.length * 2; step++) store.moveFeedback(-1);
  assert.equal(store.state.findingIndex, 0);
  assert.equal(store.state.screen, 'review');
  assert.equal(JSON.stringify(record), saved);
});

test('bar selection and sheet overlay retain the exact pair and return origin', () => {
  const { store } = result();
  const barTwo = store.entries().findIndex(entry => entry.segment?.startBar === 2);
  store.selectEntry(barTwo);
  assert.equal(store.selectedEntry().segment.startBar, 2);
  const selected = store.selectedEntry();
  store.showGuide();
  store.showSheet();
  store.selectEntry(0); // The modal owns its navigation until closed.
  assert.deepEqual(store.selectedEntry(), selected);
  store.closeSheet();
  assert.equal(store.state.screen, 'guide');
  assert.deepEqual(store.selectedEntry(), selected);
  store.moveFeedback(-1);
  assert.equal(store.state.screen, 'review');
  assert.deepEqual(store.selectedEntry(), selected);
  store.selectEntry(-1);
  store.selectEntry(Number.NaN);
  assert.deepEqual(store.selectedEntry(), selected);
});

test('v2 history hydrates and reopens the same pairs with saved coaching and no pipeline work', async () => {
  const { store, record } = result();
  const snapshot = JSON.stringify({ version: 1, records: store.records });
  const persistence = { warning: null, load: async (key, valid) => {
    assert.equal(key, SESSION_STORAGE_KEY); assert.equal(valid(snapshot), true); return snapshot;
  }, save: async () => { throw new Error('Read-only navigation must not save'); } };
  const restored = new SessionStore(memory());
  await restored.hydrate(persistence);
  restored.showHistory();
  restored.openAttempt(record.attemptId);
  assert.equal(restored.state.historyOrigin, true);
  assert.equal(restored.state.screen, 'review');
  assert.deepEqual(restored.records[0], record);
  assert.deepEqual(restored.entries(), store.entries());
  restored.moveFeedback(1); restored.showSheet(); restored.closeSheet();
  assert.equal(restored.processingStage, null);
});

test('legacy v1 history stays explicit and full passage, without invented locations', () => {
  const { store, record } = pending();
  assert.equal(store.applyAnalysis(record.attemptId, fixtureAnalysis(record, 'mistakes')), true);
  assert.equal(store.applyCoaching(record.attemptId, fixtureCoaching(record)), true);
  assert.ok(store.entries().every(entry => entry.segment === null && entry.finding.location === undefined));
  assert.equal(locationLabel(store.selectedEntry().finding, null, true), 'Legacy result · Full passage');
  const restored = new SessionStore({ getItem: () => JSON.stringify({ version: 1, records: store.records }), setItem: () => {} });
  assert.equal(restored.records[0].analysis.schemaVersion, '1');
  assert.equal(restored.records[0].analysis.displaySegments, undefined);
});

test('every computed v2 location, geometry, and reciprocal link is validated before acceptance and restore', () => {
  const mutations = [
    a => { a.displaySegments[0].startBar += 1; }, a => { a.displaySegments[0].endBar += 1; },
    a => { a.displaySegments[0].startBeat += 0.25; }, a => { a.displaySegments[0].endBeat -= 0.25; },
    a => { a.displaySegments[0].referenceNoteIds.pop(); }, a => { a.displaySegments[0].findingIds.pop(); },
    a => { a.findings[0].location.barNumber += 1; }, a => { a.findings[0].location.beatInBar += 0.25; },
    a => { a.findings[0].location.passageBeat += 0.25; }, a => { a.findings[0].segmentIds = []; },
    a => { a.findings[0].location = null; }, a => { delete a.findings[0].location; },
    a => { a.displaySegments[1].id = a.displaySegments[0].id; }, a => { a.schemaVersion = '1'; },
    a => { a.findings.at(-1).location = { barNumber: 2, beatInBar: 3, passageBeat: 6 }; },
  ];
  for (const mutate of mutations) {
    const { store, record, passage } = pending();
    const bad = versionTwo(record, passage);
    mutate(bad);
    assert.equal(store.applyAnalysis(record.attemptId, bad), false);
    const raw = JSON.stringify({ version: 1, records: [{ ...record, analysis: bad }] });
    const restored = new SessionStore({ getItem: () => raw, setItem: () => {} });
    assert.equal(restored.records.length, 0);
    assert.equal(restored.storageWarning, 'Saved history could not be loaded.');
  }
});

test('v2 coach primary segment must exist and contain evidence; input mutation cannot poison saved results', () => {
  const { store, record, passage } = pending();
  const analysis = versionTwo(record, passage);
  assert.equal(store.applyAnalysis(record.attemptId, analysis), true);
  analysis.displaySegments[0].startBeat = 99;
  assert.equal(record.analysis.displaySegments[0].startBeat, 0);
  const coach = fixtureCoaching(record);
  coach.primarySegmentId = 'unknown';
  assert.equal(store.applyCoaching(record.attemptId, coach), false);
  coach.primarySegmentId = record.analysis.displaySegments[1].id;
  assert.equal(store.applyCoaching(record.attemptId, coach), false);
  coach.primarySegmentId = record.analysis.displaySegments[0].id;
  assert.equal(store.applyCoaching(record.attemptId, coach), true);
  coach.cue = 'Changed after validation';
  assert.notEqual(record.coaching.cue, coach.cue);
});

test('notation and Paper context clip crossing sustained notes and never include other bars', () => {
  const passage = { ...passages[0], notes: [
    { ...passages[0].notes[0], id: 'before', onsetBeat: 0, durationBeats: 1 },
    { ...passages[0].notes[1], id: 'crossing', onsetBeat: 3, durationBeats: 2 },
    { ...passages[0].notes[2], id: 'inside', onsetBeat: 5, durationBeats: 1 },
  ] };
  const analysis = { ...fixtureAnalysis({ attemptId: 'test', passageId: passage.id, passageVersion: passage.version }, 'clean', '2'),
    detectedNotes: [{ id: 'detected-crossing', midiPitch: 62, onsetSec: 3, durationSec: 1.5 }],
    findings: [{ id: 'crossing-hold', kind: 'duration', referenceNoteId: 'crossing', detectedNoteId: 'detected-crossing', durationDeltaMs: -500 }] };
  const segments = calculateDisplaySegments(passage, analysis.findings, analysis.detectedNotes, 60, analysis.alignment).displaySegments;
  assert.equal(segments.length, 2);
  const segment = segments[1];
  const window = notationWindow(passage, segment);
  assert.deepEqual(window.notes.map(note => [note.id, note.onsetBeat, note.durationBeats]), [['crossing', 4, 1], ['inside', 5, 1]]);
  assert.equal(notationWindow(passage).notes.length, 3);
  const card = buildVisualPlan(analysis, passage).cards[0];
  const clipped = clipVisualCard(card, segment);
  assert.ok(clipped);
  assert.deepEqual(clipped.focus, { startBeat: 4, endBeat: 8 });
  assert.ok([...clipped.expected.notes, ...clipped.detected.notes].every(note => note.onsetBeat >= 4 && note.onsetBeat + note.durationBeats <= 8));
  assert.equal(clipped.metrics.expectedDurationBeats, 1);
  assert.equal(clipped.metrics.detectedDurationBeats, 0.5);
  assert.equal(card.expected.notes.find(note => note.id === 'crossing').durationBeats, 2);
  const past = { ...card, detected: { ...card.detected, notes: [{ ...card.detected.notes[0], onsetBeat: 9 }] } };
  assert.equal(clipVisualCard(past, segment), null);
});


test('actual server fallback for an unlocated priority finding accepts null primary alongside located findings', async () => {
  const { tsImport } = await import('../../server/node_modules/tsx/dist/esm/api/index.mjs');
  const { fallback } = await tsImport('../../server/src/coaching.ts', import.meta.url);
  const { store, record, passage } = pending();
  const analysis = fixtureAnalysis(record, 'clean', '2');
  analysis.detectedNotes.push({ id: 'outside', midiPitch: 80, onsetSec: 10, durationSec: 0.5 });
  const findings = [
    { id: 'late', kind: 'timing', referenceNoteId: passage.notes[4].id, detectedNoteId: 'detected-5', timingDeltaMs: 250 },
    { id: 'outside', kind: 'extra_note', detectedNoteId: 'outside' },
  ];
  Object.assign(analysis, calculateDisplaySegments(passage, findings, analysis.detectedNotes, analysis.attemptTempoBpm, analysis.alignment));
  assert.equal(analysis.displaySegments.length, 1);
  assert.equal(store.applyAnalysis(record.attemptId, analysis), true);
  const coach = fallback(record.analysis, passage);
  assert.equal(coach.primarySegmentId, null);
  assert.deepEqual(coach.evidenceFindingIds, ['outside']);
  assert.equal(store.applyCoaching(record.attemptId, coach), true);
  assert.equal(store.state.screen, 'review');
  assert.equal(store.entries().at(-1).finding.id, 'outside');

  const located = pending();
  const locatedAnalysis = versionTwo(located.record, located.passage);
  assert.equal(located.store.applyAnalysis(located.record.attemptId, locatedAnalysis), true);
  const bad = fixtureCoaching(located.record);
  bad.primarySegmentId = null;
  assert.equal(located.store.applyCoaching(located.record.attemptId, bad), false);
  const noFindings = pending();
  assert.equal(noFindings.store.applyAnalysis(noFindings.record.attemptId, fixtureAnalysis(noFindings.record, 'clean', '2')), true);
  assert.equal(noFindings.store.applyCoaching(noFindings.record.attemptId, fallback(noFindings.record.analysis, noFindings.passage)), true);
});
