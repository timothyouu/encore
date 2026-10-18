import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore, fixtureAnalysis, fixtureCoaching } from '../src/session.ts';
import { passages, noteName } from '../src/passages.ts';

function memory(initial = null) {
  let value = initial;
  return {
    getItem() { return value; },
    setItem(_key, next) { value = next; },
    value() { return value; },
  };
}
function ready(store, passageId = 'P01') {
  store.selectPassage(passageId);
  assert.equal(store.state.screen, 'ready');
}
function recording(store, passageId = 'P01') {
  ready(store, passageId);
  const record = store.start();
  assert.ok(record);
  return record;
}
function completed(store, passageId = 'P01') {
  recording(store, passageId);
  const record = store.stop();
  assert.ok(record);
  return record;
}
function analyzed(store, scenario = 'mistakes') {
  const record = completed(store);
  assert.equal(store.applyAnalysis(record.attemptId, fixtureAnalysis(record, scenario)), true);
  return record;
}
function result(store) {
  const record = analyzed(store);
  assert.equal(store.applyCoaching(record.attemptId, fixtureCoaching(record)), true);
  return record;
}

test('seed library exactly matches approved pitches and titles', () => {
  assert.deepEqual(passages.map(p => [p.id, p.title, p.tempoBpm]), [
    ['P01','First Steps',60], ['P02','Little Echo',60], ['P03','Open Windows',60],
    ['P04','Hold the Moment',60], ['P05','Room to Breathe',60], ['P06','Small Climb',72],
  ]);
  assert.deepEqual(passages.map(p => p.notes.map(n => n.midiPitch)), [
    [60,62,64,65,67,65,64,60], [64,64,67,67,65,65,62,62],
    [60,64,67,64,62,65,69,65], [60,64,67,65,64,62],
    [60,64,67,65,64,60], [60,62,64,67,69,67,64,62],
  ]);
});
test('durations and rests use the approved beat positions', () => {
  assert.deepEqual(passages[3].notes.map(n => n.durationBeats), [2,1,1,2,1,1]);
  assert.deepEqual(passages[3].notes.map(n => n.onsetBeat), [0,2,3,4,6,7]);
  assert.deepEqual(passages[4].notes.map(n => n.onsetBeat), [0,2,3,4,5,7]);
});
test('all passage notes have unique IDs and authored right hand metadata', () => {
  for (const passage of passages) {
    assert.equal(new Set(passage.notes.map(n => n.id)).size, passage.notes.length);
    assert.ok(passage.notes.every(n => n.hand === 'right' && n.suggestedFinger >= 1 && n.suggestedFinger <= 5));
  }
});
test('note names use MIDI C4 = 60 and reject invalid pitches', () => {
  assert.equal(noteName(60), 'C4');
  assert.equal(noteName(69), 'A4');
  assert.equal(noteName(-1), 'Unknown');
  assert.equal(noteName(60.5), 'Unknown');
});
test('selection requires a known passage', () => {
  const store = new SessionStore(memory());
  store.selectPassage('fake');
  assert.equal(store.state.screen, 'library');
  store.selectPassage('P01');
  assert.equal(store.state.passageId, 'P01');
});
test('capture only starts from ready and creates a unique record', () => {
  const store = new SessionStore(memory());
  assert.equal(store.start(), null);
  const first = recording(store);
  assert.equal(store.start(), null);
  assert.equal(store.records.length, 1);
  assert.equal(first.captureStatus, 'recording');
  assert.equal(first.captureSource, 'demo');
  assert.ok(first.attemptId);
  assert.equal(store.count(), 0);
});
test('stop persists completed capture before processing', () => {
  const snapshots = [];
  const storage = {
    getItem() { return null; },
    setItem(_key, value) { snapshots.push(JSON.parse(value)); },
  };
  const store = new SessionStore(storage);
  recording(store);
  store.stop();
  assert.equal(snapshots.at(-2).records[0].captureStatus, 'completed');
  assert.equal(snapshots.at(-2).records[0].processingStatus, 'not_started');
  assert.equal(snapshots.at(-1).records[0].processingStatus, 'processing');
});
test('completed attempt counts once and duplicate stop is ignored', () => {
  const store = new SessionStore(memory());
  const record = completed(store);
  assert.equal(store.stop(), null);
  assert.equal(store.count(), 1);
  assert.equal(store.count('P01'), 1);
  assert.equal(store.count('P02'), 0);
  assert.equal(store.records.length, 1);
  assert.ok(record.completedAt);
});
test('cancel excludes capture from count and returns to library', () => {
  const store = new SessionStore(memory());
  const record = recording(store);
  store.cancel();
  assert.equal(record.captureStatus, 'canceled');
  assert.equal(store.state.screen, 'library');
  assert.equal(store.count(), 0);
  assert.equal(store.stop(), null);
});
test('cancel outside recording has no effect', () => {
  const store = new SessionStore(memory());
  const record = completed(store);
  store.cancel();
  assert.equal(record.captureStatus, 'completed');
  assert.equal(store.count(), 1);
});
test('interrupt preserves explicit capture error without counting', () => {
  const store = new SessionStore(memory());
  const record = recording(store);
  store.interrupt();
  assert.equal(record.captureStatus, 'interrupted');
  assert.equal(record.error.stage, 'capture');
  assert.equal(store.state.screen, 'error');
  assert.equal(store.count(), 0);
});
test('completed capture remains counted after analysis failure', () => {
  const store = new SessionStore(memory());
  const record = completed(store);
  store.fail(record.attemptId, 'analysis', 'Service unavailable');
  assert.equal(record.processingStatus, 'error');
  assert.equal(record.error.message, 'Service unavailable');
  assert.equal(store.state.screen, 'error');
  assert.equal(store.count(), 1);
});
test('coaching failure preserves validated analysis', () => {
  const store = new SessionStore(memory());
  const record = analyzed(store);
  store.fail(record.attemptId, 'coaching', 'Timeout');
  assert.equal(record.analysis.findings.length, 3);
  assert.equal(record.processingStatus, 'error');
  assert.equal(store.count(), 1);
});
test('unknown or repeated failure cannot overwrite terminal result', () => {
  const store = new SessionStore(memory());
  const record = result(store);
  store.fail('unknown', 'analysis', 'bad');
  store.fail(record.attemptId, 'analysis', 'bad');
  assert.equal(record.processingStatus, 'result');
  assert.equal(record.error, null);
});
test('valid analysis stays processing until coaching arrives', () => {
  const store = new SessionStore(memory());
  const record = analyzed(store);
  assert.equal(store.state.screen, 'processing');
  assert.equal(record.processingStatus, 'processing');
  assert.equal(record.analysis.status, 'ok');
});
test('valid coaching completes result and moves to review', () => {
  const store = new SessionStore(memory());
  const record = result(store);
  assert.equal(record.processingStatus, 'result');
  assert.equal(store.state.screen, 'review');
  assert.equal(store.count(), 1);
});
test('uncertain analysis presents result without coaching', () => {
  const store = new SessionStore(memory());
  const record = analyzed(store, 'uncertain');
  assert.equal(record.processingStatus, 'result');
  assert.equal(store.state.screen, 'review');
  assert.equal(store.applyCoaching(record.attemptId, fixtureCoaching(record)), false);
});
test('error analysis keeps backend error separate from musical result', () => {
  const store = new SessionStore(memory());
  const record = analyzed(store, 'error');
  assert.equal(record.processingStatus, 'error');
  assert.equal(record.error.stage, 'analysis');
  assert.equal(store.state.screen, 'error');
});
test('mistake fixture cites the reference and detected note', () => {
  const store = new SessionStore(memory());
  const record = analyzed(store);
  const finding = record.analysis.findings[0];
  assert.equal(finding.kind, 'wrong_note');
  assert.equal(finding.referenceNoteId, passages[0].notes[2].id);
  assert.equal(finding.detectedNoteId, record.analysis.detectedNotes[2].id);
  assert.deepEqual(record.analysis.findings.map(f => f.kind), ['wrong_note', 'timing', 'missing_note']);
  assert.equal(record.analysis.findings[1].timingDeltaMs, 250);
});
test('duplicate analysis or coaching callback does not update result twice', () => {
  const store = new SessionStore(memory());
  const record = result(store);
  const saved = structuredClone(record);
  assert.equal(store.applyAnalysis(record.attemptId, fixtureAnalysis(record, 'clean')), false);
  assert.equal(store.applyCoaching(record.attemptId, fixtureCoaching(record)), false);
  assert.deepEqual(record, saved);
});
test('mismatched attempt ID is ignored', () => {
  const store = new SessionStore(memory());
  const record = completed(store);
  const response = fixtureAnalysis(record, 'mistakes');
  response.attemptId = 'other';
  assert.equal(store.applyAnalysis(record.attemptId, response), false);
  assert.equal(record.analysis, null);
});
test('mismatched passage identity and version are ignored', () => {
  for (const field of ['passageId', 'passageVersion']) {
    const store = new SessionStore(memory());
    const record = completed(store);
    const response = fixtureAnalysis(record, 'mistakes');
    response[field] = 'wrong';
    assert.equal(store.applyAnalysis(record.attemptId, response), false);
  }
});
test('hostile reference and detected note IDs are rejected', () => {
  const store = new SessionStore(memory());
  const record = completed(store);
  const response = fixtureAnalysis(record, 'mistakes');
  response.findings[0].referenceNoteId = 'made-up';
  assert.equal(store.applyAnalysis(record.attemptId, response), false);
  response.findings[0].referenceNoteId = passages[0].notes[2].id;
  response.findings[0].detectedNoteId = 'made-up';
  assert.equal(store.applyAnalysis(record.attemptId, response), false);
});
test('malformed analysis numbers and duplicate note IDs are rejected', () => {
  const store = new SessionStore(memory());
  const record = completed(store);
  const response = fixtureAnalysis(record, 'clean');
  response.detectedNotes[0].midiPitch = 999;
  assert.equal(store.applyAnalysis(record.attemptId, response), false);
  response.detectedNotes[0].midiPitch = 60;
  response.detectedNotes[0].id = response.detectedNotes[1].id;
  assert.equal(store.applyAnalysis(record.attemptId, response), false);
});
test('invalid analysis shape is safely ignored', () => {
  const store = new SessionStore(memory());
  const record = completed(store);
  assert.equal(store.applyAnalysis(record.attemptId, { schemaVersion: '1', attemptId: record.attemptId }), false);
  assert.equal(store.applyAnalysis(record.attemptId, null), false);
  assert.equal(store.state.screen, 'processing');
});
test('coaching rejects invented evidence and passage references', () => {
  const store = new SessionStore(memory());
  const record = analyzed(store);
  const response = fixtureCoaching(record);
  response.evidenceFindingIds = ['invented'];
  assert.equal(store.applyCoaching(record.attemptId, response), false);
  response.evidenceFindingIds = ['finding-1'];
  response.visual.referenceNoteIds = ['invented'];
  assert.equal(store.applyCoaching(record.attemptId, response), false);
});
test('coaching rejects unknown pose and overlong cue', () => {
  const store = new SessionStore(memory());
  const record = analyzed(store);
  const response = fixtureCoaching(record);
  response.visual.poseIds = ['remote-url'];
  assert.equal(store.applyCoaching(record.attemptId, response), false);
  response.visual.poseIds = ['finger-3'];
  response.cue = 'x'.repeat(121);
  assert.equal(store.applyCoaching(record.attemptId, response), false);
});
test('late prior response updates only prior record and leaves current view', () => {
  const store = new SessionStore(memory());
  const old = completed(store);
  store.showLibrary();
  const current = completed(store, 'P02');
  const before = structuredClone(store.state);
  assert.equal(store.applyAnalysis(old.attemptId, fixtureAnalysis(old, 'uncertain')), true);
  assert.deepEqual(store.state, before);
  assert.equal(current.analysis, null);
  assert.equal(store.count(), 2);
});
test('history reopen is read-only and returns to History', () => {
  const store = new SessionStore(memory());
  const record = result(store);
  store.showHistory();
  store.openAttempt(record.attemptId);
  assert.equal(store.state.screen, 'review');
  assert.equal(store.state.historyOrigin, true);
  assert.equal(store.start(), null);
  store.showHistory();
  assert.equal(store.state.screen, 'history');
  assert.equal(store.count(), 1);
});
test('history error entry shows status without fabricating a result', () => {
  const store = new SessionStore(memory());
  const record = completed(store);
  store.fail(record.attemptId, 'upload', 'offline');
  store.showHistory();
  store.openAttempt(record.attemptId);
  assert.equal(store.state.screen, 'error');
  assert.equal(record.analysis, null);
  assert.equal(store.count(), 1);
});
test('play again returns to library and requires fresh selection and start', () => {
  const store = new SessionStore(memory());
  result(store);
  store.showLibrary();
  assert.equal(store.state.screen, 'library');
  assert.equal(store.state.passageId, null);
  assert.equal(store.start(), null);
  ready(store, 'P02');
  const next = store.start();
  assert.equal(next.passageId, 'P02');
  assert.equal(store.count(), 1);
});
test('review, guide, and sheet transitions preserve origin', () => {
  const store = new SessionStore(memory());
  result(store);
  store.showGuide();
  assert.equal(store.state.screen, 'guide');
  store.showSheet();
  assert.equal(store.state.screen, 'sheet');
  assert.equal(store.state.sheetOrigin, 'guide');
  store.closeSheet();
  assert.equal(store.state.screen, 'guide');
  store.showReview();
  assert.equal(store.state.screen, 'review');
});
test('finding selection clamps to available findings', () => {
  const store = new SessionStore(memory());
  result(store);
  store.moveFinding(10);
  assert.equal(store.state.findingIndex, 2);
  store.moveFinding(-10);
  assert.equal(store.state.findingIndex, 0);
});
test('saved completed history survives reload', () => {
  const storage = memory();
  const store = new SessionStore(storage);
  const record = result(store);
  const restored = new SessionStore(storage);
  assert.equal(restored.count(), 1);
  assert.equal(restored.records[0].attemptId, record.attemptId);
  assert.equal(restored.records[0].coaching.cue, record.coaching.cue);
});
test('restored active recording is marked interrupted and excluded', () => {
  const storage = memory();
  const store = new SessionStore(storage);
  recording(store);
  const restored = new SessionStore(storage);
  assert.equal(restored.records[0].captureStatus, 'interrupted');
  assert.equal(restored.count(), 0);
  assert.equal(restored.records[0].error.stage, 'capture');
});
test('restored processing becomes recoverable error and stays counted', () => {
  const storage = memory();
  const store = new SessionStore(storage);
  completed(store);
  const restored = new SessionStore(storage);
  assert.equal(restored.records[0].processingStatus, 'error');
  assert.equal(restored.records[0].error.stage, 'analysis');
  assert.equal(restored.count(), 1);
});
test('restored analysis waiting for coaching retains analysis on recovery', () => {
  const storage = memory();
  const store = new SessionStore(storage);
  analyzed(store);
  const restored = new SessionStore(storage);
  assert.equal(restored.records[0].processingStatus, 'error');
  assert.equal(restored.records[0].error.stage, 'coaching');
  assert.equal(restored.records[0].analysis.status, 'ok');
});
test('corrupt storage is ignored with a visible warning', () => {
  const store = new SessionStore(memory('{bad json'));
  assert.equal(store.records.length, 0);
  assert.match(store.storageWarning, /could not be loaded/);
});
test('storage read and write failure do not crash session', () => {
  const broken = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  };
  const store = new SessionStore(broken);
  assert.match(store.storageWarning, /could not be loaded/);
  completed(store);
  assert.equal(store.count(), 1);
  assert.match(store.storageWarning, /could not be saved/);
});
test('subscribe receives changes and unsubscribe stops notifications', () => {
  const store = new SessionStore(memory());
  let updates = 0;
  const unsubscribe = store.subscribe(() => { updates += 1; });
  store.selectPassage('P01');
  assert.equal(updates, 1);
  unsubscribe();
  store.start();
  assert.equal(updates, 1);
});

test('uncertain or clipped audio cannot claim a firm finding', () => {
  const store = new SessionStore(memory());
  const record = completed(store);
  const uncertain = fixtureAnalysis(record, 'mistakes');
  uncertain.status = 'uncertain';
  assert.equal(store.applyAnalysis(record.attemptId, uncertain), false);
  const clipped = fixtureAnalysis(record, 'mistakes');
  clipped.audioQuality.clipped = true;
  assert.equal(store.applyAnalysis(record.attemptId, clipped), false);
  const unreliable = fixtureAnalysis(record, 'mistakes');
  unreliable.alignment.reliable = false;
  assert.equal(store.applyAnalysis(record.attemptId, unreliable), false);
});
test('nonempty findings require evidence in coaching', () => {
  const store = new SessionStore(memory());
  const record = analyzed(store);
  const coaching = fixtureCoaching(record);
  coaching.evidenceFindingIds = [];
  assert.equal(store.applyCoaching(record.attemptId, coaching), false);
});
test('saved completed capture before processing recovers as error', () => {
  const storage = memory();
  const store = new SessionStore(storage);
  recording(store);
  const record = store.stop();
  const saved = JSON.parse(storage.value());
  saved.records[0].processingStatus = 'not_started';
  storage.setItem('encore.attempts.v1', JSON.stringify(saved));
  const restored = new SessionStore(storage);
  assert.equal(restored.records[0].processingStatus, 'error');
  assert.equal(restored.count(), 1);
  assert.equal(restored.records[0].attemptId, record.attemptId);
});
test('live processing entry opened from history updates its own status on response', () => {
  const store = new SessionStore(memory());
  const record = completed(store);
  store.showHistory();
  store.openAttempt(record.attemptId);
  assert.equal(store.state.screen, 'processing');
  assert.equal(store.applyAnalysis(record.attemptId, fixtureAnalysis(record, 'uncertain')), true);
  assert.equal(store.state.screen, 'review');
  assert.equal(store.state.historyOrigin, true);
  store.showHistory();
  assert.equal(store.state.screen, 'history');
});


test('general library navigation cannot abandon active capture silently', () => {
  const store = new SessionStore(memory());
  const record = recording(store);
  store.showLibrary();
  assert.equal(store.state.screen, 'recording');
  assert.equal(record.captureStatus, 'recording');
  store.cancel();
  assert.equal(store.state.screen, 'library');
});
