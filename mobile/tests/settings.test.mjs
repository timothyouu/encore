import test from 'node:test';
import assert from 'node:assert/strict';
import { DisplaySettingsStore, DISPLAY_SETTINGS_KEY, DEFAULT_DISPLAY_SETTINGS } from '../src/settings.ts';
import { SessionStore, fixtureAnalysis, fixtureCoaching } from '../src/session.ts';

function memory(initial = null) {
  const values = new Map(initial === null ? [] : [[DISPLAY_SETTINGS_KEY, initial]]);
  const writes = [];
  return { getItem: key => values.get(key) ?? null, setItem(key, value) { writes.push([key, value]); values.set(key, value); }, values, writes };
}

test('Paper defaults are sheet on, large size and note names on', () => {
  const store = new DisplaySettingsStore(memory());
  assert.deepEqual(store.value, { schemaVersion: '1', showSheetMusicWhilePlaying: true, sheetMusicSize: 'large', showNoteNames: true });
  assert.equal(store.isOpen, false);
  assert.equal(store.storageWarning, null);
});
test('settings and defaults cannot be mutated through getters', () => {
  const store = new DisplaySettingsStore(memory());
  assert.throws(() => { store.value.showNoteNames = false; }, TypeError);
  assert.throws(() => { DEFAULT_DISPLAY_SETTINGS.sheetMusicSize = 'standard'; }, TypeError);
});
test('each preference persists and survives a new store', () => {
  const storage = memory(); const store = new DisplaySettingsStore(storage);
  assert.equal(store.update({ showSheetMusicWhilePlaying: false }), true);
  assert.equal(store.update({ sheetMusicSize: 'standard' }), true);
  assert.equal(store.update({ showNoteNames: false }), true);
  assert.deepEqual(new DisplaySettingsStore(storage).value, store.value);
  assert.equal(storage.writes.length, 3);
  assert.ok(storage.writes.every(([key]) => key === DISPLAY_SETTINGS_KEY));
});
test('turning sheet off retains size and note-name preferences', () => {
  const store = new DisplaySettingsStore(memory());
  store.update({ sheetMusicSize: 'standard', showNoteNames: false });
  store.update({ showSheetMusicWhilePlaying: false });
  store.update({ showSheetMusicWhilePlaying: true });
  assert.equal(store.value.sheetMusicSize, 'standard'); assert.equal(store.value.showNoteNames, false);
});
for (const patch of [null, false, [], 'large', { sheetMusicSize: 'huge' }, { showNoteNames: 'false' }, { showSheetMusicWhilePlaying: 1 }, { showNoteNames: undefined }, { unknown: true }, { schemaVersion: '2' }, { __proto__: { showNoteNames: false } }]) {
  test(`reject malformed patch ${JSON.stringify(patch)} without writing`, () => {
    const storage = memory(); const store = new DisplaySettingsStore(storage);
    assert.equal(store.update(patch), false); assert.deepEqual(store.value, DEFAULT_DISPLAY_SETTINGS); assert.equal(storage.writes.length, 0);
  });
}
for (const raw of ['{', 'null', '[]', 'false', '{}', '{"schemaVersion":"2","showSheetMusicWhilePlaying":true}', '{"schemaVersion":"1","showSheetMusicWhilePlaying":"false"}', '{"schemaVersion":"1","showSheetMusicWhilePlaying":true,"sheetMusicSize":"huge"}', '{"schemaVersion":"1","showSheetMusicWhilePlaying":true,"unexpected":1}']) {
  test(`corrupt saved settings safely fall back: ${raw}`, () => {
    const storage = memory(raw); const store = new DisplaySettingsStore(storage);
    assert.deepEqual(store.value, DEFAULT_DISPLAY_SETTINGS); assert.match(store.storageWarning, /could not be loaded/);
    assert.equal(storage.writes.length, 0);
  });
}
test('original v1 toggle-only settings migrate without losing the user choice', () => {
  const store = new DisplaySettingsStore(memory('{"schemaVersion":"1","showSheetMusicWhilePlaying":false}'));
  assert.deepEqual(store.value, { ...DEFAULT_DISPLAY_SETTINGS, showSheetMusicWhilePlaying: false });
  assert.equal(store.storageWarning, null);
});
test('read failures show warning but do not crash', () => {
  const store = new DisplaySettingsStore({ getItem() { throw new Error('denied'); }, setItem() {} });
  assert.match(store.storageWarning, /could not be loaded/); assert.equal(store.open('library'), true);
});
test('failed write keeps in-session preference and warns truthfully', () => {
  const store = new DisplaySettingsStore({ getItem() { return null; }, setItem() { throw new Error('quota'); } });
  assert.equal(store.update({ showNoteNames: false }), true);
  assert.equal(store.value.showNoteNames, false); assert.match(store.storageWarning, /session only/);
});
test('a later successful write clears persistence warning', () => {
  let fail = true; const store = new DisplaySettingsStore({ getItem() { return null; }, setItem() { if (fail) throw new Error('quota'); } });
  store.update({ showNoteNames: false }); fail = false; store.update({ sheetMusicSize: 'standard' });
  assert.equal(store.storageWarning, null);
});
test('valid no-ops neither write nor notify', () => {
  const storage = memory(); const store = new DisplaySettingsStore(storage); let calls = 0; store.subscribe(() => calls++);
  assert.equal(store.update({}), true); assert.equal(store.update({ showNoteNames: true }), true);
  assert.equal(calls, 0); assert.equal(storage.writes.length, 0);
});
for (const screen of ['recording','processing','disconnected','unknown','']) {
  test(`settings cannot open from ${screen || 'empty screen'}`, () => {
    const store = new DisplaySettingsStore(memory()); assert.equal(store.open(screen), false); assert.equal(store.isOpen, false);
  });
}
test('opening and closing settings is idempotent and never writes preferences', () => {
  const storage = memory(); const store = new DisplaySettingsStore(storage); let calls = 0; const unsubscribe = store.subscribe(() => calls++);
  for (const screen of ['library','ready','review','guide','sheet','history','error']) {
    assert.equal(store.open(screen), true); store.open(screen); store.close(); store.close();
  }
  assert.equal(calls, 14); assert.equal(storage.writes.length, 0); unsubscribe(); store.open('library'); assert.equal(calls, 14);
});
test('display preferences do not alter records, selected finding, view or counts', () => {
  const storage = memory(); const session = new SessionStore(storage); const settings = new DisplaySettingsStore(storage);
  session.selectPassage('P01'); const record = session.start(); session.stop();
  session.applyAnalysis(record.attemptId, fixtureAnalysis(record,'mistakes')); session.applyCoaching(record.attemptId, fixtureCoaching(record));
  session.moveFinding(1); session.showGuide();
  const before = JSON.stringify({state:session.state,records:session.records,count:session.count()});
  settings.open('guide'); settings.update({showNoteNames:false,sheetMusicSize:'standard'}); settings.close();
  assert.equal(JSON.stringify({state:session.state,records:session.records,count:session.count()}), before);
  assert.ok(!Object.hasOwn(record,'showNoteNames'));
});
