import test from 'node:test';
import assert from 'node:assert/strict';
import { correctionFor, detailFor, findingTitle, orderedFindings } from '../src/feedback.ts';
import { SessionStore, fixtureAnalysis } from '../src/session.ts';
import { passages } from '../src/passages.ts';

function analyzed() {
  const store = new SessionStore({ getItem: () => null, setItem: () => {} });
  store.selectPassage('P01');
  const record = store.start();
  store.stop();
  assert.ok(store.applyAnalysis(record.attemptId, fixtureAnalysis(record, 'mistakes')));
  return { record: store.records[0], passage: passages.find((item) => item.id === 'P01') };
}

test('findings follow the visual plan order shared by every view', () => {
  const { record, passage } = analyzed();
  assert.deepEqual(orderedFindings(record, passage).map((finding) => finding.kind), ['missing_note', 'wrong_note', 'timing']);
});

test('finding wording names the expected and heard notes', () => {
  const { record, passage } = analyzed();
  const [missing, wrong, timing] = orderedFindings(record, passage);
  assert.equal(findingTitle(wrong), 'Note mismatch');
  assert.equal(detailFor(wrong, passage, record), 'Expected E4 · Heard F4');
  assert.equal(detailFor(timing, passage, record), 'G4 · 250 ms late');
  assert.equal(detailFor(missing, passage, record), 'Expected F4 · Not detected');
  assert.equal(correctionFor(timing, passage), 'Place G4 on beat 5.');
});
