/** Independent SessionStore → G2 Review acceptance with a fake BLE bridge. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore, fixtureAnalysis, fixtureCoaching } from '../mobile/src/session.ts';
import { startController } from '../g2/src/controller.ts';
import { fakeGlasses, settle, textByName } from '../g2/tests/fakes.mjs';

function result(scenario) {
  const store = new SessionStore({ getItem() { return null; }, setItem() {} });
  store.selectPassage('P01');
  const record = store.start('g2');
  store.stop();
  assert.equal(store.applyAnalysis(record.attemptId, fixtureAnalysis(record, scenario)), true);
  if (scenario === 'mistakes') assert.equal(store.applyCoaching(record.attemptId, fixtureCoaching(record)), true);
  return { store, record };
}
function controllerFor(t, store, { renderFrame = async () => new Uint8Array([80]) } = {}) {
  const { glasses, bridge } = fakeGlasses();
  let actions = 0;
  const controller = startController({ glasses, store,
    actions: { async start() { actions++; }, async stop() { actions++; }, cancel() { actions++; } },
    sheetMusic: () => true, menu: () => undefined, onExit() {},
    renderTiles: async () => ({ left: new Uint8Array([1]), right: new Uint8Array([2]), hasClef: true }),
    renderArt: async () => new Uint8Array([83]), renderFrame, frameDwellMs: 0 });
  t.after(() => controller.dispose());
  return { bridge, controller, actions: () => actions };
}

test('uncertain completed attempt shows neutral Review without replay or a new action', async t => {
  const { store, record } = result('uncertain');
  const h = controllerFor(t, store);
  await settle();
  assert.equal(h.controller.current.name, 'review');
  assert.match(JSON.stringify(textByName(h.bridge)), /uncertain|clearly|another recording/i);
  assert.equal(textByName(h.bridge).replay?.trim(), '');
  const before = h.bridge.callsTo('updateImageRawData').length;
  h.controller.onInput({ kind: 'tap' });
  await settle();
  assert.equal(h.bridge.callsTo('updateImageRawData').length, before);
  assert.equal(store.records[0].attemptId, record.attemptId);
  assert.equal(store.count(), 1);
  assert.equal(h.actions(), 0);
});

test('leaving a Review card drops a late replay frame and keeps History read-only', async t => {
  const { store, record } = result('mistakes');
  let releaseFrame;
  const pendingFrame = new Promise(resolve => { releaseFrame = resolve; });
  const h = controllerFor(t, store, { renderFrame: () => pendingFrame });
  await settle();
  const initialImages = h.bridge.callsTo('updateImageRawData').length;
  h.controller.onInput({ kind: 'tap' });
  h.controller.onInput({ kind: 'swipeDown' });
  assert.equal(h.controller.current.name, 'review');
  assert.equal(store.state.screen, 'review');
  releaseFrame(new Uint8Array([80]));
  await settle();
  assert.equal(h.bridge.callsTo('updateImageRawData').filter(item => item.imageData[0] === 80).length, 0);
  assert.ok(h.bridge.callsTo('updateImageRawData').length > initialImages, 'next static card appears');
  h.controller.onInput({ kind: 'doubleTap' });
  await settle();
  assert.equal(store.state.screen, 'library');
  const before = { count: store.count(), actions: h.actions(), images: h.bridge.callsTo('updateImageRawData').length };
  store.showHistory();
  store.openAttempt(record.attemptId);
  await settle();
  assert.equal(h.controller.current.name, 'review');
  assert.equal(store.records[0].attemptId, record.attemptId);
  assert.equal(store.count(), before.count);
  assert.equal(h.actions(), before.actions);
  assert.ok(h.bridge.callsTo('updateImageRawData').length >= before.images);
});