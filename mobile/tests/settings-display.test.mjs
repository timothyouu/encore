import test from 'node:test';
import assert from 'node:assert/strict';
import { connectDisplay, interpretEvenEvent, renderDisplay } from '../src/display.ts';
import { passages } from '../src/passages.ts';
import { renderSheetImage, SHEET_HEIGHT, SHEET_WIDTH } from '../src/score-image.ts';
import { SessionStore } from '../src/session.ts';
import { DisplaySettingsStore } from '../src/settings.ts';

function memory() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
function tick() { return new Promise(resolve => setImmediate(resolve)); }
async function until(predicate) {
  for (let i = 0; i < 30; i++) {
    if (predicate()) return;
    await tick();
  }
  assert.fail('Timed out waiting for display operation');
}
function harness({ updateImageRawData, textContainerUpgrade, canOpenSettings, imageApi = true } = {}) {
  const store = new SessionStore(memory());
  const settings = new DisplaySettingsStore(memory());
  let listener;
  let clock = 1000;
  const calls = { create: [], rebuild: [], image: [], text: [], rendered: [], starts: 0, stops: 0 };
  const bridge = {
    createStartUpPageContainer(value) { calls.create.push(value); return Promise.resolve(0); },
    async rebuildPageContainer(value) {
      calls.rebuild.push(value);
      calls.rendered.push(value.textObject[0].content);
      return true;
    },
    updateImageRawData(value) { calls.image.push(value); return updateImageRawData?.(value) ?? Promise.resolve('success'); },
    async textContainerUpgrade(value) {
      calls.text.push(value);
      const success = await (textContainerUpgrade?.(value) ?? Promise.resolve(true));
      if (success) calls.rendered.push(value.content);
      return success;
    },
    onEvenHubEvent(callback) { listener = callback; return () => { listener = undefined; }; },
    shutDownPageContainer() { return Promise.resolve(true); },
  };
  if (!imageApi) {
    delete bridge.rebuildPageContainer;
    delete bridge.updateImageRawData;
  }
  const display = connectDisplay(store, {
    start() { calls.starts++; store.start('g2'); },
    stop() { calls.stops++; store.stop(); },
    cancel() { store.cancel(); },
  }, { settings, canOpenSettings, now: () => clock, waitForBridge: async () => bridge });
  function emit(kind, advance = 300) {
    clock += advance;
    const values = { tap: 0, double: 3, long: 9, release: 10 };
    listener?.({ sysEvent: { eventType: values[kind] } });
  }
  return { store, settings, calls, display, emit };
}

function pixel(image, x, y) { return image[y * SHEET_WIDTH + x]; }

test('grayscale notation is deterministic, fits all six passages, and responds to size and note-name preferences', () => {
  const settings = new DisplaySettingsStore(memory());
  const data = passages.map(passage => renderSheetImage(passage, settings.value));
  assert.equal(new Set(data.map(bytes => Buffer.from(bytes).toString('base64'))).size, 6);
  for (let index = 0; index < data.length; index++) {
    const image = data[index];
    assert.equal(image.length, SHEET_WIDTH * SHEET_HEIGHT);
    assert.ok(image.every(value => value === 0 || value === 15));
    assert.deepEqual(image, renderSheetImage(passages[index], settings.value));
    assert.ok(image.some(byte => byte === 0));
  }
  settings.update({ showNoteNames: false });
  const noNames = renderSheetImage(passages[0], settings.value);
  assert.notDeepEqual(noNames, data[0]);
  settings.update({ sheetMusicSize: 'standard' });
  assert.notDeepEqual(renderSheetImage(passages[0], settings.value), noNames);
});

test('score includes C4 ledger, a hollow half note, explicit rest, and bar line', () => {
  const settings = new DisplaySettingsStore(memory());
  const first = renderSheetImage(passages[0], settings.value);
  const hold = renderSheetImage(passages[3], settings.value);
  const rest = renderSheetImage(passages[4], settings.value);
  assert.equal(pixel(first, 39, 110), 0, 'C4 ledger line starts left of note');
  assert.equal(pixel(first, 47, 108), 0, 'quarter note head is filled');
  assert.equal(pixel(hold, 47, 108), 15, 'half note head remains hollow');
  assert.equal(pixel(rest, 218, 58), 0, 'missing sixth beat has a rest');
  assert.equal(pixel(first, 147, 55), 0, 'bar line crosses the staff');
});

test('long press opens isolated Settings; release and synthetic click cannot start capture', async () => {
  const h = harness();
  await tick();
  h.store.selectPassage('P01');
  await until(() => h.calls.image.length === 1);
  assert.equal(interpretEvenEvent({ listEvent: { eventType: 9 } }), 'long');
  h.emit('long');
  h.emit('long', 0);
  h.emit('release');
  h.emit('tap', 0);
  assert.equal(h.settings.isOpen, true);
  assert.equal(h.calls.starts, 0);
  assert.equal(h.store.state.screen, 'ready');
  h.emit('tap', 700);
  assert.equal(h.settings.value.showSheetMusicWhilePlaying, false);
  assert.equal(h.calls.starts, 0);
  assert.match(renderDisplay(h.store, false, 'phone', h.settings), /Sheet music while playing: Off/);
  h.emit('double');
  assert.equal(h.settings.isOpen, false);
  assert.equal(h.store.state.screen, 'ready');
  h.emit('tap');
  assert.equal(h.calls.starts, 1);
  h.emit('long');
  h.emit('release');
  h.emit('tap', 0);
  assert.equal(h.settings.isOpen, false);
  assert.equal(h.calls.stops, 0);
  h.display.dispose();
});

test('long press during processing or pending permission cannot open Settings or trigger capture', async () => {
  let allowed = false;
  const h = harness({ canOpenSettings: () => allowed });
  await tick();
  h.store.selectPassage('P01');
  h.emit('long'); h.emit('release'); h.emit('tap', 0);
  assert.equal(h.settings.isOpen, false);
  assert.equal(h.calls.starts, 0);
  allowed = true;
  h.emit('tap', 700);
  h.emit('tap');
  assert.equal(h.store.state.screen, 'processing');
  h.emit('long'); h.emit('release'); h.emit('tap', 0);
  assert.equal(h.settings.isOpen, false);
  assert.equal(h.calls.starts, 1);
  h.display.dispose();
});

test('preloaded score remains beside indicator while recording; no image update starts during capture', async () => {
  const h = harness();
  await tick();
  h.store.selectPassage('P04');
  await until(() => h.calls.image.length === 1);
  await tick();
  assert.equal(h.calls.rebuild.at(-1).containerTotalNum, 2);
  assert.equal(h.calls.rebuild.at(-1).imageObject[0].width, 288);
  h.emit('tap');
  await tick();
  assert.equal(h.store.state.screen, 'recording');
  assert.equal(h.calls.image.length, 1);
  assert.match(h.calls.text.at(-1).content, /Recording/);
  h.display.dispose();
});

test('capture starts while image preload is pending and clears the unfinished image after it resolves', async () => {
  let resolveUpload;
  const upload = new Promise(resolve => { resolveUpload = resolve; });
  const h = harness({ updateImageRawData: () => upload });
  await tick();
  h.store.selectPassage('P02');
  await until(() => h.calls.image.length === 1);
  h.emit('tap');
  assert.equal(h.store.state.screen, 'recording');
  assert.equal(h.calls.image.length, 1);
  await until(() => h.calls.text.some(value => value.content.includes('Recording')));
  h.emit('tap');
  assert.equal(h.store.state.screen, 'processing');
  await until(() => h.calls.text.some(value => value.content.includes('Analyzing')));
  assert.equal(h.calls.rebuild.at(-1).containerTotalNum, 2, 'upload still has not settled');
  resolveUpload('success');
  await until(() => h.calls.rebuild.at(-1).containerTotalNum === 1);
  assert.equal(h.calls.image.length, 1);
  h.display.dispose();
});

test('cancel while an image upload is pending promptly restores Library text', async () => {
  let resolveUpload;
  const upload = new Promise(resolve => { resolveUpload = resolve; });
  const h = harness({ updateImageRawData: () => upload });
  await tick();
  h.store.selectPassage('P02');
  await until(() => h.calls.image.length === 1);
  h.emit('tap');
  await until(() => h.calls.text.some(value => value.content.includes('Recording')));
  h.store.cancel();
  assert.equal(h.store.state.screen, 'library');
  await until(() => h.calls.text.at(-1)?.content.includes('Choose a passage on the phone'));
  assert.equal(h.calls.rebuild.at(-1).containerTotalNum, 2, 'image upload is still unresolved');
  resolveUpload('success');
  await until(() => h.calls.rebuild.at(-1).containerTotalNum === 1);
  assert.equal(h.calls.image.length, 1);
  h.display.dispose();
});

test('delayed priority text cannot overwrite Library after image upload settles', async () => {
  let resolveUpload;
  let resolveRecordingText;
  const upload = new Promise(resolve => { resolveUpload = resolve; });
  const recordingText = new Promise(resolve => { resolveRecordingText = resolve; });
  const h = harness({
    updateImageRawData: () => upload,
    textContainerUpgrade: value => value.content.includes('Recording') ? recordingText : Promise.resolve(true),
  });
  await tick();
  h.store.selectPassage('P02');
  await until(() => h.calls.image.length === 1);
  h.emit('tap');
  await until(() => h.calls.text.some(value => value.content.includes('Recording')));
  h.emit('tap');
  assert.equal(h.store.state.screen, 'processing');
  resolveUpload('success');
  await tick();
  h.store.showLibrary();
  assert.equal(h.store.state.screen, 'library');
  resolveRecordingText(true);
  await until(() => h.calls.rebuild.at(-1)?.containerTotalNum === 1);
  assert.match(h.calls.rebuild.at(-1).textObject[0].content, /Choose a passage on the phone/);
  await tick();
  assert.match(h.calls.rendered.at(-1), /Choose a passage on the phone/);
  h.display.dispose();
});

test('new passage replaces a pending score only after clearing the old image layout', async () => {
  let resolveFirst;
  const first = new Promise(resolve => { resolveFirst = resolve; });
  let uploadCount = 0;
  const h = harness({ updateImageRawData: () => (++uploadCount === 1 ? first : Promise.resolve('success')) });
  await tick();
  h.store.selectPassage('P01');
  await until(() => h.calls.image.length === 1);
  h.store.showLibrary();
  h.store.selectPassage('P06');
  resolveFirst('success');
  await until(() => h.calls.image.length === 2);
  const layouts = h.calls.rebuild.map(value => value.containerTotalNum);
  assert.deepEqual(layouts.slice(0, 3), [2, 1, 2]);
  assert.notDeepEqual(h.calls.image[0].imageData, h.calls.image[1].imageData);
  h.display.dispose();
});

test('failed image transport clears its container without retrying and dispose ignores later completions', async () => {
  const h = harness({ updateImageRawData: async () => 'sendFailed' });
  await tick();
  h.store.selectPassage('P03');
  await until(() => h.calls.image.length === 1 && h.calls.rebuild.at(-1).containerTotalNum === 1);
  assert.equal(h.calls.image.length, 1);
  h.settings.update({ showNoteNames: false });
  await until(() => h.calls.image.length === 2);
  h.display.dispose();
  h.settings.update({ showNoteNames: true });
  await tick();
  assert.equal(h.calls.image.length, 2);
});

test('missing optional image API keeps settings gestures and text-only capture usable', async () => {
  const h = harness({ imageApi: false });
  await tick();
  h.store.selectPassage('P01');
  await tick();
  assert.equal(h.calls.image.length, 0);
  assert.equal(h.calls.rebuild.length, 0);
  h.emit('long'); h.emit('release');
  assert.equal(h.settings.isOpen, true);
  h.emit('double');
  h.emit('tap', 700);
  assert.equal(h.store.state.screen, 'recording');
  await tick();
  assert.match(h.calls.text.at(-1).content, /Recording/);
  h.display.dispose();
});
