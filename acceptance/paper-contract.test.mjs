import { visibleFindings } from '../mobile/src/paper-evidence.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildVisualPlan, validateVisualPlan, VISUAL_KINDS } from '../shared/visual-plan.ts';
import { renderPaperSvg } from '../mobile/src/paper-renderer.ts';
import { passages } from '../mobile/src/passages.ts';
import { SessionStore, fixtureAnalysis, fixtureCoaching } from '../mobile/src/session.ts';

const expectedKinds = ['wrong_note','missing_note','extra_note','timing','duration','unclear_audio','tempo_drift','uneven_rhythm','unexpected_pause','rest_violation','section_repeat_skip','recurring_trouble'];
const examples = JSON.parse(readFileSync(new URL('../shared/visual-examples.json', import.meta.url),'utf8')).examples;

test('Paper inventory is fully represented by validated renderable JSON examples', () => {
  assert.deepEqual(Object.keys(VISUAL_KINDS).sort(), expectedKinds.toSorted());
  const covered = new Set();
  for (const {plan} of examples) {
    assert.ok(validateVisualPlan(plan));
    for (const card of plan.cards) {
      covered.add(card.kind);
      for (const phase of ['static','detected','correction','resolved']) {
        const svg = renderPaperSvg(card, phase);
        assert.match(svg, /viewBox=["']0 0 576 288["']/);
        assert.doesNotMatch(svg, /(?:NaN|Infinity|undefined|<script|onload=|javascript:)/);
        assert.match(svg, /expected/i);
        assert.match(svg, /detected/i);
      }
    }
  }
  assert.deepEqual([...covered].sort(), expectedKinds.toSorted());
});

test('malformed plans are rejected rather than rendered as invented evidence', () => {
  const valid = examples[0].plan;
  for (const altered of [null, {}, {...valid,schemaVersion:'future'}, {...valid,cards:Array(4).fill(valid.cards[0])}]) assert.equal(validateVisualPlan(altered),false);
  const broken = structuredClone(valid);
  broken.cards[0].expected.notes[0].midiPitch = 999;
  assert.equal(validateVisualPlan(broken),false);
});

function attempt() {
  const store = new SessionStore({getItem:()=>null,setItem:()=>{}});
  store.selectPassage('P01'); store.start('test'); const record = store.stop();
  store.applyAnalysis(record.attemptId,fixtureAnalysis(record,'mistakes'));
  return {store,record};
}

test('live plans use actual passage and detection IDs, bounded cues, no later fixture claims', () => {
  const {record} = attempt();
  const plan = buildVisualPlan(record.analysis,passages[0]);
  assert.equal(plan.source,'analysis');
  assert.ok(plan.cards.length <= 3);
  assert.ok(validateVisualPlan(plan));
  for (const card of plan.cards) {
    assert.equal(card.evidence.source,'analysis');
    assert.ok(expectedKinds.slice(0,6).includes(card.kind));
    for (const id of card.evidence.findingIds) assert.ok(record.analysis.findings.some(f=>f.id===id));
    for (const id of card.evidence.referenceNoteIds) assert.ok(passages[0].notes.some(n=>n.id===id));
    for (const id of card.evidence.detectedNoteIds) assert.ok(record.analysis.detectedNotes.some(n=>n.id===id));
  }
});

test('uncertain audio overrides musical cards with neutral retry', () => {
  const {record} = attempt();
  const analysis = fixtureAnalysis(record,'uncertain');
  const plan = buildVisualPlan(analysis,passages[0]);
  assert.deepEqual(plan.cards.map(c=>c.kind),['unclear_audio']);
  assert.deepEqual(plan.cards[0].evidence.findingIds,[]);
});

test('saved JSON plan is grounded; changed measurements and fixture injection are rejected', () => {
  const {store,record} = attempt();
  const coaching = fixtureCoaching(record);
  coaching.visualPlan = buildVisualPlan(record.analysis,passages[0],coaching.evidenceFindingIds[0]);
  const forged = structuredClone(coaching);
  forged.visualPlan.cards[0].cue = 'Invented unrelated instruction';
  assert.equal(store.applyCoaching(record.attemptId,forged),false);
  assert.equal(store.applyCoaching(record.attemptId,coaching),true);
});
test('phone corrections follow the same fixed three-card priority plan', () => {
  const {record} = attempt();
  const visible = visibleFindings(record.analysis, passages[0]);
  const plan = buildVisualPlan(record.analysis, passages[0]);
  assert.ok(visible.length <= 3);
  assert.deepEqual(visible.map(f=>f.id),plan.cards.flatMap(c=>c.evidence.findingIds));
  assert.deepEqual(visibleFindings(fixtureAnalysis(record,'uncertain'),passages[0]),[]);
});