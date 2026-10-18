import test from 'node:test';
import assert from 'node:assert/strict';
import { PhonePersistence } from '../src/storage.ts';
import { SessionStore } from '../src/session.ts';
import { DisplaySettingsStore, DISPLAY_SETTINGS_KEY } from '../src/settings.ts';

const HISTORY_KEY = 'encore.attempts.v1';

function backend() {
  const state = new Map(); const audio = new Map();
  let failPut = false;
  const calls = [];
  return {
    state, audio, calls,
    setFailPut(value) { failPut = value; },
    async get(store, key) { return structuredClone((store === 'state' ? state : audio).get(key)); },
    async put(store, key, value) {
      if (failPut) throw new Error('quota');
      calls.push([store, key]);
      (store === 'state' ? state : audio).set(key, structuredClone(value));
    },
    async delete(store, key) { (store === 'state' ? state : audio).delete(key); },
    async values() { return structuredClone([...audio.values()]); },
  };
}
function legacy(entries = []) {
  const map = new Map(entries);
  return { map, getItem(key) { return map.get(key) ?? null; }, setItem(key, value) { map.set(key, value); }, removeItem(key) { map.delete(key); } };
}
function audio(attemptId, savedAt, size = 100) {
  return { attemptId, savedAt, wav: new Uint8Array(size), sampleRate: 22050,
    sourceSampleRate: 48000, channels: 1, encoding: 'pcm_s16le', durationSec: 0.1 };
}

test('history and settings migrate only after durable save; old copies are not restored', async () => {
  const history = JSON.stringify({ version: 1, records: [] });
  const settings = JSON.stringify({ schemaVersion: '1', showSheetMusicWhilePlaying: false });
  const old = legacy([[HISTORY_KEY, history], [DISPLAY_SETTINGS_KEY, settings]]);
  const db = backend(); const persistence = new PhonePersistence(db, old);
  const session = new SessionStore(old); const display = new DisplaySettingsStore(old);
  await session.hydrate(persistence); await display.hydrate(persistence);
  assert.equal(old.map.has(HISTORY_KEY), false);
  assert.equal(old.map.has(DISPLAY_SETTINGS_KEY), false);
  assert.equal(display.value.showSheetMusicWhilePlaying, false);
  old.setItem(HISTORY_KEY, JSON.stringify({ version: 1, records: [{ attemptId: 'stale' }] }));
  const restored = new SessionStore(old); await restored.hydrate(new PhonePersistence(db, old));
  assert.deepEqual(restored.records, []);
  assert.equal(db.state.get(HISTORY_KEY).migrated, true);
});

test('failed migration retains legacy data and can be retried', async () => {
  const history = JSON.stringify({ version: 1, records: [] });
  const old = legacy([[HISTORY_KEY, history]]); const db = backend(); db.setFailPut(true);
  const session = new SessionStore(old);
  await session.hydrate(new PhonePersistence(db, old));
  assert.equal(old.getItem(HISTORY_KEY), history);
  assert.match(session.storageWarning, /unavailable/);
  db.setFailPut(false);
  await session.hydrate(new PhonePersistence(db, old));
  assert.equal(old.getItem(HISTORY_KEY), null);
});

test('migration marker suppresses a stale legacy copy when the database is unavailable', () => {
  const raw = JSON.stringify({ version: 1, records: [{ attemptId: 'stale' }] });
  const old = legacy([[HISTORY_KEY, raw], [`${HISTORY_KEY}.migrated`, '1'],
    [DISPLAY_SETTINGS_KEY, JSON.stringify({ schemaVersion: '1', showSheetMusicWhilePlaying: false })],
    [`${DISPLAY_SETTINGS_KEY}.migrated`, '1']]);
  const session = new SessionStore(old); const settings = new DisplaySettingsStore(old);
  assert.deepEqual(session.records, []);
  assert.equal(settings.value.showSheetMusicWhilePlaying, true);
});

test('state writes serialize and the latest session and settings values survive reload', async () => {
  const db = backend(); const old = legacy(); const persistence = new PhonePersistence(db, old);
  const session = new SessionStore(old); const settings = new DisplaySettingsStore(old);
  await session.hydrate(persistence); await settings.hydrate(persistence);
  session.selectPassage('P01'); session.start(); session.stop();
  settings.update({ showNoteNames: false }); settings.update({ showNoteNames: true, sheetMusicSize: 'standard' });
  await persistence.flush();
  const fresh = new PhonePersistence(db, old);
  const restored = new SessionStore(old); const restoredSettings = new DisplaySettingsStore(old);
  await restored.hydrate(fresh); await restoredSettings.hydrate(fresh);
  assert.equal(restored.records.length, 1);
  assert.equal(restored.count(), 1);
  assert.equal(restoredSettings.value.sheetMusicSize, 'standard');
  assert.equal(restoredSettings.value.showNoteNames, true);
});

test('failed durable write keeps the session usable and shows a warning', async () => {
  const db = backend(); const persistence = new PhonePersistence(db); const session = new SessionStore();
  await session.hydrate(persistence);
  db.setFailPut(true);
  session.selectPassage('P01'); session.start();
  await persistence.flush();
  assert.equal(session.records.length, 1);
  assert.match(session.storageWarning, /could not be saved/);
});

test('audio survives reload for ten minutes, expires physically, and cannot renew its window', async () => {
  let now = 1000000; const db = backend();
  const first = new PhonePersistence(db, undefined, () => now);
  await first.hydrateAudio(); await first.saveAudio(audio('one', now));
  const next = new PhonePersistence(db, undefined, () => now);
  await next.hydrateAudio();
  assert.equal(next.hasAudio('one'), true);
  assert.equal((await next.getAudio('one')).savedAt, now);
  now += 10 * 60 * 1000 + 1;
  await next.pruneExpired();
  assert.equal(db.audio.has('one'), false);
  assert.equal(next.hasAudio('one'), false);
  await assert.rejects(next.saveAudio(audio('one', 1000000)), /expired/);
});

test('audio capacity refuses a new row without evicting pending retries', async () => {
  const db = backend(); const persistence = new PhonePersistence(db, undefined, () => 1000);
  await persistence.hydrateAudio();
  for (let index = 0; index < 24; index++) await persistence.saveAudio(audio(String(index), 1000));
  await assert.rejects(persistence.saveAudio(audio('overflow', 1000)), /full/);
  assert.equal(db.audio.size, 24);
  assert.equal(persistence.hasAudio('0'), true);
  assert.match(persistence.warning, /24 recordings/);
});

test('history cap preserves all 1000 saved attempts and refuses attempt 1001', () => {
  const old = legacy(); const seed = new SessionStore(old);
  seed.selectPassage('P01'); const first = seed.start(); seed.stop(); seed.fail(first.attemptId, 'upload', 'offline');
  const records = Array.from({ length: 1000 }, (_, index) => ({ ...first, attemptId: `attempt-${index}` }));
  old.setItem(HISTORY_KEY, JSON.stringify({ version: 1, records }));
  const session = new SessionStore(old);
  assert.equal(session.records.length, 1000);
  session.selectPassage('P01');
  assert.equal(session.start(), null);
  assert.equal(session.records.length, 1000);
  assert.match(session.storageWarning, /History is full/);
  assert.equal(new SessionStore(old).records.length, 1000);
});
