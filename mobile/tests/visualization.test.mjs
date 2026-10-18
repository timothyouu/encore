import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore, fixtureAnalysis, fixtureCoaching } from '../src/session.ts';
import { passages } from '../src/passages.ts';
import { keyboardRange, resolveDurationEvidence, resolveMistakeVisualization } from '../src/visualization.ts';

function memory(initial = null) {
  let value = initial;
  return { getItem() { return value; }, setItem(_key, next) { value = next; }, value() { return value; } };
}
function completed(passageId = 'P01', storage = memory()) {
  const store = new SessionStore(storage);
  store.selectPassage(passageId);
  store.start();
  const record = store.stop();
  assert.ok(record);
  return { store, record, passage: passages.find(item => item.id === passageId), storage };
}
function coachFor(record, findings) {
  const coach = fixtureCoaching(record);
  coach.evidenceFindingIds = findings.map(item => item.id);
  coach.visual.kind = 'keyboard';
  coach.visual.referenceNoteIds = [...new Set(findings.map(item => item.referenceNoteId).filter(Boolean))];
  coach.visual.mistakes = findings.map(item => ({ findingId: item.id, ...(item.referenceNoteId && { referenceNoteId: item.referenceNoteId }), ...(item.detectedNoteId && { detectedNoteId: item.detectedNoteId }) }));
  return coach;
}
function analyzedWith(passageId, mutate) {
  const context = completed(passageId);
  const analysis = fixtureAnalysis(context.record, 'clean');
  mutate(analysis, context.passage);
  assert.equal(context.store.applyAnalysis(context.record.attemptId, analysis), true);
  const coach = coachFor(context.record, analysis.findings);
  assert.equal(context.store.applyCoaching(context.record.attemptId, coach), true);
  return { ...context, findings: analysis.findings };
}

test('wrong key resolves reference and detection from saved notes', () => {
  const { store, record, passage } = completed();
  assert.equal(store.applyAnalysis(record.attemptId, fixtureAnalysis(record, 'mistakes')), true);
  assert.equal(store.applyCoaching(record.attemptId, fixtureCoaching(record)), true);
  const visual = resolveMistakeVisualization(record, passage, record.analysis.findings[0]);
  assert.equal(visual.expected.label, 'E4');
  assert.equal(visual.played.label, 'F4');
  assert.deepEqual(keyboardRange(visual), [60, 62, 64, 65, 67, 69, 71]);
});

test('reference quarter and half values use versioned beats and detected duration', () => {
  for (const [index, playedSeconds, expectedLabel, expectedBeats] of [[0, 1, 'Half note', 2], [1, 2, 'Quarter note', 1]]) {
    const { record, passage, findings } = analyzedWith('P04', (analysis, selected) => {
      const note = selected.notes[index];
      const detected = analysis.detectedNotes[index];
      detected.durationSec = playedSeconds;
      analysis.findings = [{ id: `duration-${index}`, kind: 'duration', referenceNoteId: note.id, detectedNoteId: detected.id, durationDeltaMs: (playedSeconds - note.durationBeats * 60 / analysis.attemptTempoBpm) * 1000 }];
    });
    const visual = resolveMistakeVisualization(record, passage, findings[0]);
    assert.equal(visual.duration.referenceValue, expectedLabel);
    assert.equal(visual.duration.expectedBeats, expectedBeats);
    assert.equal(visual.duration.playedBeats, playedSeconds);
  }
});

test('review keeps measured duration for a finding the coach did not select', () => {
  const { store, record, passage } = completed('P04');
  const analysis = fixtureAnalysis(record, 'clean');
  analysis.detectedNotes[0].midiPitch = 61;
  analysis.detectedNotes[1].durationSec = 2;
  const wrong = { id: 'wrong-1', kind: 'wrong_note', referenceNoteId: passage.notes[0].id, detectedNoteId: 'detected-1' };
  const duration = { id: 'duration-2', kind: 'duration', referenceNoteId: passage.notes[1].id, detectedNoteId: 'detected-2', durationDeltaMs: 1000 };
  analysis.findings = [wrong, duration];
  assert.equal(store.applyAnalysis(record.attemptId, analysis), true);
  assert.equal(store.applyCoaching(record.attemptId, fixtureCoaching(record)), true);
  assert.ok(resolveMistakeVisualization(record, passage, wrong));
  assert.equal(resolveMistakeVisualization(record, passage, duration), null);
  const measured = resolveDurationEvidence(record, passage, duration);
  assert.equal(measured.referenceValue, 'Quarter note');
  assert.equal(measured.expectedBeats, 1);
  assert.equal(measured.playedBeats, 2);
});

test('missing and extra notes do not invent opposite events', () => {
  const { record, passage, findings } = analyzedWith('P01', (analysis, selected) => {
    const missing = selected.notes[2];
    analysis.detectedNotes.splice(2, 1);
    analysis.detectedNotes.push({ id: 'extra-1', midiPitch: 69, onsetSec: 8, durationSec: 1 });
    analysis.findings = [
      { id: 'missing-1', kind: 'missing_note', referenceNoteId: missing.id },
      { id: 'extra-1', kind: 'extra_note', detectedNoteId: 'extra-1' },
    ];
  });
  const missing = resolveMistakeVisualization(record, passage, findings[0]);
  const extra = resolveMistakeVisualization(record, passage, findings[1]);
  assert.equal(missing.expected.label, 'E4');
  assert.equal(missing.played, undefined);
  assert.equal(extra.expected, undefined);
  assert.equal(extra.played.label, 'A4');
  assert.equal(missing.duration, undefined);
  assert.equal(extra.duration, undefined);
});

test('uncertain evidence and conflicting durations cannot produce a hold animation', () => {
  const context = analyzedWith('P04', (analysis, passage) => {
    const note = passage.notes[0];
    analysis.detectedNotes[0].durationSec = 1;
    analysis.findings = [{ id: 'duration-1', kind: 'duration', referenceNoteId: note.id, detectedNoteId: 'detected-1', durationDeltaMs: -1000 }];
  });
  const finding = context.findings[0];
  assert.ok(resolveMistakeVisualization(context.record, context.passage, finding)?.duration);
  context.record.analysis.alignment.reliable = false;
  assert.equal(resolveMistakeVisualization(context.record, context.passage, finding), null);
  context.record.analysis.alignment.reliable = true;
  context.record.analysis.detectedNotes[0].durationSec = 1.5;
  assert.equal(resolveMistakeVisualization(context.record, context.passage, finding), null);
});

test('forged coach references and altered finding cannot select another note', () => {
  const { record, passage, findings } = analyzedWith('P01', analysis => {
    analysis.detectedNotes[0].midiPitch = 61;
    analysis.findings = [{ id: 'wrong-1', kind: 'wrong_note', referenceNoteId: 'P01-N01', detectedNoteId: 'detected-1' }];
  });
  const finding = findings[0];
  assert.ok(resolveMistakeVisualization(record, passage, finding));
  record.coaching.visual.mistakes[0].referenceNoteId = 'P01-N02';
  assert.equal(resolveMistakeVisualization(record, passage, finding), null);
  record.coaching.visual.mistakes[0].referenceNoteId = 'P01-N01';
  assert.equal(resolveMistakeVisualization(record, passage, { ...finding, kind: 'duration', durationDeltaMs: 0 }), null);
});

test('History reopens the same saved visual without running analysis or coaching', () => {
  const storage = memory();
  const { store, record, passage } = completed('P01', storage);
  store.applyAnalysis(record.attemptId, fixtureAnalysis(record, 'mistakes'));
  store.applyCoaching(record.attemptId, fixtureCoaching(record));
  const original = resolveMistakeVisualization(record, passage, record.analysis.findings[0]);
  const restored = new SessionStore(storage);
  restored.showHistory();
  restored.openAttempt(record.attemptId);
  assert.equal(restored.state.screen, 'review');
  assert.equal(restored.count(), 1);
  const saved = restored.records[0];
  assert.deepEqual(resolveMistakeVisualization(saved, passage, saved.analysis.findings[0]), original);
});
