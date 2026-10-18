/** Independent PR18/19 navigation contract; fake transport, no provider calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore, fixtureAnalysis, fixtureCoaching } from '../mobile/src/session.ts';
import { startController } from '../g2/src/controller.ts';
import { fakeGlasses, settle, textByName } from '../g2/tests/fakes.mjs';

function setup(t) {
  const store = new SessionStore({ getItem() { return null; }, setItem() {} });
  store.selectPassage('P01');
  const record = store.start('g2');
  store.stop();
  assert.equal(store.applyAnalysis(record.attemptId, fixtureAnalysis(record, 'mistakes')), true);
  assert.equal(store.applyCoaching(record.attemptId, fixtureCoaching(record)), true);
  const { glasses, bridge } = fakeGlasses();
  let actions = 0;
  const controller = startController({ glasses, store,
    actions: { async start() { actions++; }, async stop() { actions++; }, cancel() { actions++; } },
    sheetMusic: () => true, menu: () => undefined, onExit() {},
    renderArt: async () => new Uint8Array([1]),
    renderFrame: async () => new Uint8Array([2]), frameDwellMs: 0 });
  t.after(() => controller.dispose());
  return { store, record, controller, bridge, actions: () => actions };
}

test('G2 paired paging closes a phone sheet and synchronizes the next Review', async t => {
  const h = setup(t);
  await settle();
  h.store.showGuide();
  h.store.showSheet();
  await settle();
  assert.equal(h.store.state.screen, 'sheet');
  const review = h.controller.current;
  const rebuilds = h.bridge.callsTo('rebuildPageContainer').length;
  h.controller.onInput({ kind: 'swipeDown' });
  await settle();
  assert.equal(h.store.state.screen, 'review');
  assert.equal(h.store.state.findingIndex, 1);
  assert.notEqual(h.controller.current, review);
  assert.ok(h.bridge.callsTo('rebuildPageContainer').length > rebuilds, 'new Review phase is declared after leaving Guide/sheet');
  h.controller.onInput({ kind: 'swipeUp' });
  await settle();
  assert.equal(h.store.state.findingIndex, 0);
  assert.equal(h.store.count(), 1);
  assert.equal(h.actions(), 0);
});

test('historical G2 card navigation remains read-only and clamps at either edge', async t => {
  const h = setup(t);
  h.store.showHistory();
  h.store.openAttempt(h.record.attemptId);
  await settle();
  const saved = JSON.stringify(h.store.records);
  h.controller.onInput({ kind: 'swipeUp' });
  assert.equal(h.store.state.findingIndex, 0);
  for (let i = 0; i < 5; i++) h.controller.onInput({ kind: 'swipeDown' });
  await settle();
  assert.equal(h.store.state.findingIndex, 2);
  assert.equal(h.store.state.historyOrigin, true);
  assert.equal(h.store.state.attemptId, h.record.attemptId);
  assert.equal(JSON.stringify(h.store.records), saved);
  assert.equal(h.store.count(), 1);
  assert.equal(h.actions(), 0);
});

test('processing labels stay readable and Demo provenance remains visible', async t => {
  for (const source of ['g2', 'demo']) {
    const store = new SessionStore({ getItem() { return null; }, setItem() {} });
    store.selectPassage('P01');
    const record = store.start(source);
    store.stop();
    const { glasses, bridge } = fakeGlasses();
    const controller = startController({ glasses, store,
      actions: { async start() {}, async stop() {}, cancel() {} },
      sheetMusic: () => true, menu: () => undefined, onExit() {} });
    t.after(() => controller.dispose());
    await settle();
    assert.equal(textByName(bridge).stage, source === 'demo' ? 'Demo · prepared result' : 'Saving WAV');
    const screen = controller.current;
    for (const [stage, label] of [['upload', 'Uploading recording'], ['analysis', 'Analyzing notes'], ['coaching', 'Preparing coaching']]) {
      store.setProcessingStage(record.attemptId, stage);
      await settle();
      assert.equal(controller.current, screen);
      assert.equal(textByName(bridge).stage, source === 'demo' ? 'Demo · prepared result' : label);
    }
  }
});
