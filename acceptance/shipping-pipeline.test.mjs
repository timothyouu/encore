/** Independent shared-session G2 source → phone pipeline → actual HTTP acceptance.
 * The detector response is a fixture; this is not hardware or Basic Pitch evidence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoachServer, loadLibrary } from '../server/src/http.ts';
import { SessionStore, fixtureAnalysis } from '../mobile/src/session.ts';
import { PhoneCapture } from '../mobile/src/capture.ts';
import { G2Capture } from '../g2/src/g2capture.ts';
import { Recorder } from '../g2/src/recorder.ts';
import { fakeGlasses, settle, textByName } from '../g2/tests/fakes.mjs';
import { startController } from '../g2/src/controller.ts';
import { reviewData } from '../g2/src/feedback.ts';
import { replaySteps } from '../g2/src/review/art.ts';
import { PASSAGES } from '../g2/src/passages.ts';

const library = await loadLibrary();
const originalAudioContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
function installWavDecoder() {
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: class {
    async decodeAudioData(buffer) {
      const bytes = new Uint8Array(buffer);
      const view = new DataView(buffer);
      assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'RIFF');
      assert.equal(view.getUint32(24, true), 16000);
      assert.equal(view.getUint16(22, true), 1);
      assert.equal(view.getUint16(34, true), 16);
      const length = view.getUint32(40, true) / 2;
      const samples = Float32Array.from({ length }, (_, i) => view.getInt16(44 + i * 2, true) / 32768);
      return { sampleRate: 16000, numberOfChannels: 1, getChannelData: () => samples };
    }
    async close() {}
  } });
}
function restoreWavDecoder() {
  if (originalAudioContext) Object.defineProperty(globalThis, 'AudioContext', originalAudioContext);
  else delete globalThis.AudioContext;
}
function pcmTone() {
  const bytes = new Uint8Array(16000 * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < 16000; i++) view.setInt16(i * 2, Math.round(10000 * Math.sin(2 * Math.PI * 440 * i / 16000)), true);
  return bytes;
}
function memory() { return { getItem() { return null; }, setItem() {} }; }
async function setup(t) {
  installWavDecoder();
  t.after(restoreWavDecoder);
  const store = new SessionStore(memory());
  const { glasses, bridge } = fakeGlasses();
  let detectorCalls = 0;
  let observed = null;
  const server = createCoachServer({ library, chooser: null,
    fetchImpl: async (_url, init) => {
      detectorCalls++;
      const body = init.body;
      assert.ok(body instanceof FormData);
      const metadata = JSON.parse(String(body.get('metadata')));
      const bytes = Buffer.from(await body.get('audio').arrayBuffer());
      observed = { metadata, bytes };
      const record = store.records.find(item => item.attemptId === metadata.attemptId);
      assert.ok(record);
      return new Response(JSON.stringify(fixtureAnalysis(record, 'mistakes')), { status: 200 });
    } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const endpoints = { upload: base + '/api/recordings', analysis: base + '/api/analyze', coaching: base + '/api/coach' };
  const phone = new PhoneCapture(store, endpoints);
  const g2 = new G2Capture({ store, submit: (record, audio) => phone.processRecording(record, audio), onChange() {} }, () => glasses);
  t.after(() => { g2.dispose(); phone.dispose(); });
  return { store, glasses, bridge, phone, g2, calls: () => detectorCalls, observed: () => observed };
}

test('G2 fake-bridge take keeps one ID through 16k WAV, normalized HTTP receipt, Review and read-only History', async t => {
  const h = await setup(t);
  h.store.selectPassage('P01');
  await h.g2.start();
  const id = h.store.records[0].attemptId;
  Recorder.feed(pcmTone());
  await Promise.all([h.g2.stop(), h.g2.stop()]);
  assert.equal(h.store.records.length, 1);
  assert.equal(h.store.count(), 1);
  assert.equal(h.store.records[0].attemptId, id);
  assert.equal(h.store.records[0].captureSource, 'g2');
  assert.equal(h.store.records[0].processingStatus, 'result');
  assert.equal(h.store.state.screen, 'review');
  assert.equal(h.calls(), 1);
  const { metadata, bytes } = h.observed();
  assert.equal(metadata.attemptId, id);
  assert.equal(metadata.captureSource, 'g2');
  assert.equal(metadata.sourceSampleRate, 16000);
  assert.equal(metadata.sampleRate, 22050);
  assert.equal(metadata.durationSec, 1);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.readUInt32LE(24), 22050);
  assert.equal(bytes.readUInt32LE(40), 22050 * 2);
  assert.ok(bytes.subarray(44).some(byte => byte !== 0));
  assert.deepEqual(h.bridge.callsTo('audioControl').map(call => call.isOpen), [true, false]);
  const views = reviewData(h.store.records[0], PASSAGES[0]).views;
  assert.ok(views.length >= 2, 'fixture detector yields multiple bounded evidence cards');
  const rendered = [];
  const controller = startController({ glasses: h.glasses, store: h.store,
    actions: { start: () => h.g2.start(), stop: () => h.g2.stop(), cancel: () => h.g2.cancel() },
    sheetMusic: () => true, menu: () => undefined, onExit() {},
    renderArt: async () => new Uint8Array([83]),
    renderFrame: async (_card, step, context) => {
      rendered.push({ step, context });
      return new Uint8Array([step.art === 'context' ? 67 : step.layer === 'played' ? 80 : 87]);
    },
    frameDwellMs: 0 });
  t.after(() => controller.dispose());
  await settle();
  assert.equal(controller.current.name, 'review');
  assert.match(textByName(h.bridge).counter, /G2 · local cue/);
  controller.onInput({ kind: 'tap' });
  await settle();
  assert.equal(h.store.state.screen, 'guide');
  const beforeReplay = h.bridge.callsTo('updateImageRawData').length;
  controller.onInput({ kind: 'tap' });
  controller.onInput({ kind: 'tap' });
  await settle();
  const frames = h.bridge.callsTo('updateImageRawData').slice(beforeReplay);
  assert.equal(frames.length, replaySteps(views[0].card).length + 1, 'one supplemental context frame; duplicate tap must not replay twice');
  assert.equal(frames.filter(frame => frame.imageData[0] === 67).length, 1);
  const contextFrame = rendered.find(frame => frame.step.art === 'context');
  assert.ok(views[0].card.evidence.findingIds.includes(contextFrame?.context?.findingId), 'context belongs to this saved finding');
  assert.deepEqual(rendered.at(-1).step, replaySteps(views[0].card).at(-1), 'latest final correction remains intact');
  assert.ok(frames.some(frame => frame.imageData[0] === 80));
  controller.onInput({ kind: 'swipeDown' });
  await settle();
  assert.equal(controller.current.name, 'review');
  assert.equal(h.store.state.screen, 'review');
  assert.match(textByName(h.bridge).counter, /2 \/ 3/);
  controller.onInput({ kind: 'doubleTap' });
  await settle();
  assert.equal(h.store.state.screen, 'library');
  assert.equal(controller.current.name, 'selection');
  const prior = { detectorCalls: h.calls(), count: h.store.count() };
  h.store.showHistory();
  h.store.openAttempt(id);
  await settle();
  assert.equal(h.store.records[0].attemptId, id);
  assert.equal(controller.current.name, 'review');
  assert.deepEqual({ detectorCalls: h.calls(), count: h.store.count() }, prior);
});

test('canceling a G2 take before mic-off completes never uploads or increments count', async t => {
  const h = await setup(t);
  h.store.selectPassage('P01');
  await h.g2.start();
  Recorder.feed(pcmTone());
  const normalControl = h.bridge.audioControl.bind(h.bridge);
  let releaseMic;
  h.bridge.audioControl = (isOpen, source) => isOpen ? normalControl(isOpen, source) :
    new Promise(resolve => { releaseMic = async () => resolve(await normalControl(isOpen, source)); });
  const stopping = h.g2.stop();
  await settle();
  assert.equal(typeof releaseMic, 'function');
  h.g2.cancel();
  await releaseMic();
  await stopping;
  assert.equal(h.store.count(), 0);
  assert.equal(h.store.records[0].captureStatus, 'canceled');
  assert.equal(h.calls(), 0);
});
