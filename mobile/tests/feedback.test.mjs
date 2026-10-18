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
  const analysis = fixtureAnalysis(record, 'mistakes');
  analysis.findings.reverse(); // services may return findings in any order
  assert.ok(store.applyAnalysis(record.attemptId, analysis));
  return { record: store.records[0], passage: passages.find((item) => item.id === 'P01') };
}

test('findings are ordered by beat regardless of service order', () => {
  const { record, passage } = analyzed();
  assert.deepEqual(orderedFindings(record, passage).map((finding) => finding.kind), ['wrong_note', 'timing', 'missing_note']);
});

test('finding wording names the expected and heard notes', () => {
  const { record, passage } = analyzed();
  const [wrong, timing, missing] = orderedFindings(record, passage);
  assert.equal(findingTitle(wrong), 'Note mismatch');
  assert.equal(detailFor(wrong, passage, record), 'Expected E4 · Heard F4');
  assert.equal(detailFor(timing, passage, record), 'G4 · 250 ms late');
  assert.equal(detailFor(missing, passage, record), 'Expected F4 · Not detected');
  assert.equal(correctionFor(timing, passage), 'Place G4 on beat 5.');
});
