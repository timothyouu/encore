import test from 'node:test';
import assert from 'node:assert/strict';
import { connectDisplay, createLatestTextQueue, eventTypeOf, interpretEvenEvent, renderDisplay } from '../src/display.ts';
import { SessionStore, fixtureAnalysis, fixtureCoaching } from '../src/session.ts';

function memory() {
  let value = null;
  return {
    getItem() { return value; },
    setItem(_key, next) { value = next; },
    value() { return value; },
  };
}
function tick() { return new Promise(resolve => setImmediate(resolve)); }
function fakeBridge() {
  let listener;
  const upgrades = [];
  const shutdown = [];
  const initial = [];
  const bridge = {
    createStartUpPageContainer(container) { initial.push(container); return Promise.resolve(0); },
    textContainerUpgrade(container) { upgrades.push(container); return Promise.resolve(true); },
    onEvenHubEvent(callback) { listener = callback; return () => { listener = undefined; }; },
    shutDownPageContainer(mode) { shutdown.push(mode); return Promise.resolve(true); },
    emit(event) { listener?.(event); },
    upgrades, shutdown, initial,
    subscribed() { return !!listener; },
  };
  return bridge;
}
function harness(source = 'demo') {
  const store = new SessionStore(memory());
  const bridge = fakeBridge();
  let clock = 1000;
  let starts = 0;
  let stops = 0;
  let cancels = 0;
  const actions = {
    start() { starts += 1; store.start(source); },
    stop() { stops += 1; store.stop(); },
    cancel() { cancels += 1; store.cancel(); },
  };
  const display = connectDisplay(store, actions, {
    waitForBridge: async () => bridge,
    now: () => clock,
  });
  function emit(event) { clock += 300; bridge.emit(event); }
  function tap() { emit({ sysEvent: {} }); }
  function double() { emit({ sysEvent: { eventType: 3 } }); }
  function down() { emit({ textEvent: { eventType: 2 } }); }
  function up() { emit({ textEvent: { eventType: 1 } }); }
  return { store, bridge, display, emit, tap, double, down, up,
    counts: () => ({ starts, stops, cancels }) };
}
function result(store) {
  store.selectPassage('P01');
  store.start();
  const record = store.stop();
  store.applyAnalysis(record.attemptId, fixtureAnalysis(record, 'mistakes'));
  store.applyCoaching(record.attemptId, fixtureCoaching(record));
  return record;
}

test('missing eventType is click only inside an actual event envelope', () => {
  assert.equal(eventTypeOf(undefined), null);
  assert.equal(eventTypeOf({}), 0);
  assert.equal(eventTypeOf({ eventType: 0 }), 0);
  assert.equal(interpretEvenEvent({ audioEvent: { audioPcm: new Uint8Array([1]) } }), null);
  assert.equal(interpretEvenEvent({}), null);
  assert.equal(interpretEvenEvent({ sysEvent: {} }), 'tap');
  assert.equal(interpretEvenEvent({ textEvent: {} }), 'tap');
});
test('double, scroll, and lifecycle envelopes are distinct', () => {
  assert.equal(interpretEvenEvent({ sysEvent: { eventType: 3 } }), 'double');
  assert.equal(interpretEvenEvent({ textEvent: { eventType: 1 } }), 'up');
  assert.equal(interpretEvenEvent({ textEvent: { eventType: 2 } }), 'down');
  assert.equal(interpretEvenEvent({ sysEvent: { eventType: 5 } }), 'lifecycle');
  assert.equal(interpretEvenEvent({ sysEvent: { eventType: 7 } }), 'lifecycle');
  assert.equal(interpretEvenEvent({ sysEvent: { eventType: 6 } }), 'lifecycle');
});
test('connectDisplay returns before bridge is ready and dispose prevents later setup', async () => {
  const store = new SessionStore(memory());
  let resolveBridge;
  const waiting = new Promise(resolve => { resolveBridge = resolve; });
  const bridge = fakeBridge();
  const display = connectDisplay(store, { start() {}, stop() {}, cancel() {} },
    { waitForBridge: () => waiting });
  assert.equal(bridge.initial.length, 0);
  display.dispose();
  resolveBridge(bridge);
  await tick();
  assert.equal(bridge.initial.length, 0);
});
test('initial page uses one text container and later content upgrades', async () => {
  const h = harness();
  await tick();
  assert.equal(h.bridge.initial.length, 1);
  assert.equal(h.bridge.initial[0].containerTotalNum, 1);
  assert.equal(h.bridge.initial[0].textObject[0].content, renderDisplay(h.store));
  h.store.selectPassage('P01');
  await tick();
  assert.equal(h.bridge.upgrades.at(-1).containerID, 1);
  assert.match(h.bridge.upgrades.at(-1).content, /First Steps/);
  h.display.dispose();
});
test('serialized queue retains only latest waiting content', async () => {
  const writes = [];
  let releaseFirst;
  const first = new Promise(resolve => { releaseFirst = resolve; });
  const queue = createLatestTextQueue(async content => {
    writes.push(content);
    if (content === 'first') await first;
  });
  queue.update('first');
  queue.update('middle');
  queue.update('latest');
  assert.deepEqual(writes, ['first']);
  releaseFirst();
  await queue.idle();
  assert.deepEqual(writes, ['first', 'latest']);
});
test('queue stops after dispose and no later update is written', async () => {
  const writes = [];
  const queue = createLatestTextQueue(async content => { writes.push(content); });
  queue.update('one');
  await queue.idle();
  queue.dispose();
  queue.update('two');
  assert.deepEqual(writes, ['one']);
});
test('tap starts only from ready and stops once from recording', async () => {
  const h = harness('phone');
  await tick();
  h.tap();
  assert.deepEqual(h.counts(), { starts: 0, stops: 0, cancels: 0 });
  h.store.selectPassage('P01');
  h.tap();
  assert.equal(h.store.state.screen, 'recording');
  assert.equal(h.store.records[0].captureSource, 'phone');
  h.tap();
  assert.equal(h.store.state.screen, 'processing');
  assert.equal(h.store.count(), 1);
  assert.deepEqual(h.counts(), { starts: 1, stops: 1, cancels: 0 });
  h.display.dispose();
});
test('live recording shows only a small indicator', () => {
  const store = new SessionStore(memory());
  store.selectPassage('P01');
  store.start('phone');
  assert.equal(renderDisplay(store), '● Recording');
});
test('demo recording and selection are visibly labeled', () => {
  const store = new SessionStore(memory());
  store.selectPassage('P01');
  assert.match(renderDisplay(store), /^DEMO/);
  store.start();
  assert.match(renderDisplay(store), /^DEMO/);
});
test('double tap while recording asks before cancellation', async () => {
  const h = harness();
  await tick();
  h.store.selectPassage('P01');
  h.tap();
  h.double();
  await tick();
  assert.match(h.bridge.upgrades.at(-1).content, /Cancel recording/);
  assert.equal(h.store.state.screen, 'recording');
  assert.equal(h.counts().cancels, 0);
  h.tap();
  assert.equal(h.store.state.screen, 'library');
  assert.equal(h.counts().cancels, 1);
  assert.equal(h.store.count(), 0);
  h.display.dispose();
});
test('second double tap dismisses cancel prompt', async () => {
  const h = harness();
  await tick();
  h.store.selectPassage('P01');
  h.tap();
  h.double();
  h.double();
  assert.equal(h.store.state.screen, 'recording');
  assert.equal(h.counts().cancels, 0);
  h.tap();
  assert.equal(h.store.state.screen, 'processing');
  h.display.dispose();
});
test('same gesture within 250 ms is debounced', async () => {
  const h = harness();
  await tick();
  h.store.selectPassage('P01');
  h.tap();
  h.bridge.emit({ sysEvent: {} });
  assert.equal(h.counts().stops, 0);
  assert.equal(h.store.state.screen, 'recording');
  h.display.dispose();
});
test('review shows grounded finding and cue; guide identifies authored finger', () => {
  const store = new SessionStore(memory());
  result(store);
  const review = renderDisplay(store);
  assert.match(review, /REVIEW 1\/3/);
  assert.match(review, /Expected E4; heard F4/);
  assert.match(review, /Try the highlighted key/);
  store.showGuide();
  const guide = renderDisplay(store);
  assert.match(guide, /Keyboard:/);
  assert.match(guide, /Suggested finger/);
  assert.match(guide, /Static key guide/);
});
test('later finding does not reuse unrelated coaching cue', () => {
  const store = new SessionStore(memory());
  result(store);
  store.moveFinding(1);
  const text = renderDisplay(store);
  assert.match(text, /250 ms late/);
  assert.doesNotMatch(text, /Try the highlighted key/);
});
test('uncertainty never presents a musical mistake', () => {
  const store = new SessionStore(memory());
  store.selectPassage('P01');
  store.start();
  const record = store.stop();
  store.applyAnalysis(record.attemptId, fixtureAnalysis(record, 'uncertain'));
  const text = renderDisplay(store);
  assert.match(text, /couldn't hear that clearly/);
  assert.doesNotMatch(text, /Expected/);
});
test('history result is labeled saved and remains read-only on tap', async () => {
  const h = harness();
  await tick();
  const record = result(h.store);
  h.store.showHistory();
  h.store.openAttempt(record.attemptId);
  assert.match(renderDisplay(h.store), /SAVED ATTEMPT/);
  h.tap();
  assert.equal(h.store.count(), 1);
  assert.equal(h.counts().starts, 0);
  h.double();
  assert.equal(h.store.state.screen, 'history');
  h.display.dispose();
});
test('review swipes to guide and across findings', async () => {
  const h = harness();
  await tick();
  result(h.store);
  h.down();
  assert.equal(h.store.state.screen, 'guide');
  h.down();
  assert.equal(h.store.state.screen, 'review');
  assert.equal(h.store.state.findingIndex, 1);
  h.up();
  assert.equal(h.store.state.screen, 'guide');
  assert.equal(h.store.state.findingIndex, 0);
  h.display.dispose();
});
test('lifecycle exit interrupts active capture and unsubscribes', async () => {
  const h = harness();
  await tick();
  h.store.selectPassage('P01');
  h.tap();
  h.emit({ sysEvent: { eventType: 5 } });
  assert.equal(h.store.records[0].captureStatus, 'interrupted');
  assert.equal(h.store.count(), 0);
  assert.equal(h.bridge.subscribed(), false);
});
test('double tap at root shuts down the display page', async () => {
  const h = harness();
  await tick();
  h.double();
  await tick();
  assert.deepEqual(h.bridge.shutdown, [0]);
  assert.equal(h.bridge.subscribed(), false);
});
test('start source is persisted immediately as phone or G2', () => {
  for (const source of ['phone', 'g2']) {
    const storage = memory();
    const store = new SessionStore(storage);
    store.selectPassage('P01');
    const record = store.start(source);
    assert.equal(record.captureSource, source);
    assert.equal(JSON.parse(storage.value()).records[0].captureSource, source);
  }
});

test('bridge readiness and disposal notify phone connection state', async () => {
  const priorDocument = globalThis.document;
  const priorCustomEvent = globalThis.CustomEvent;
  const events = [];
  globalThis.document = { querySelector() { return { dispatchEvent(event) { events.push(event.detail.connected); } }; } };
  globalThis.CustomEvent = class { constructor(_name, options) { this.detail = options.detail; } };
  try {
    const h = harness();
    await tick();
    assert.deepEqual(events, [true]);
    h.display.dispose();
    assert.deepEqual(events, [true, false]);
  } finally {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
    if (priorCustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = priorCustomEvent;
  }
});


test('lifecycle interrupts the attempt and tears down the actual capture driver', async () => {
  const h = harness('phone');
  await tick();
  h.store.selectPassage('P01');
  h.tap();
  h.emit({sysEvent:{eventType:5}});
  assert.equal(h.store.records[0].captureStatus, 'interrupted');
  assert.equal(h.counts().cancels, 1);
  assert.equal(h.store.count(), 0);
});

test('G2 sorts service findings by reference beat to match phone selection', () => {
  const store = new SessionStore(memory());
  store.selectPassage('P01'); store.start();
  const record = store.stop();
  const analysis = fixtureAnalysis(record, 'mistakes');
  analysis.findings.reverse();
  assert.equal(store.applyAnalysis(record.attemptId, analysis), true);
  assert.equal(store.applyCoaching(record.attemptId, fixtureCoaching(record)), true);
  assert.match(renderDisplay(store), /Expected E4; heard F4/);
  store.moveFinding(1);
  assert.match(renderDisplay(store), /250 ms late/);
});
