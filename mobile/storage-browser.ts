import { IndexedDbBackend, PhonePersistence } from './src/storage.ts';
import { SessionStore, fixtureAnalysis, fixtureCoaching } from './src/session.ts';
import { DisplaySettingsStore } from './src/settings.ts';
import { PhoneCapture } from './src/capture.ts';
import { normalizeChannels } from './src/audio-normalization.ts';

const output = document.querySelector<HTMLPreElement>('#output')!;
const button = document.querySelector<HTMLButtonElement>('#run')!;
const check = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const empty = { getItem: (_key: string): string | null => null, setItem: (_key: string, _value: string): void => {} };
const wav = normalizeChannels([new Float32Array(22050)], 22050);
button.onclick = async (): Promise<void> => {
  button.disabled = true; output.textContent = 'Running…\n';
  let passed = 0;
  const run = async (name: string, operation: () => Promise<void>): Promise<void> => {
    await operation(); passed++; output.textContent += `PASS ${name}\n`;
  };
  const database = `encore-storage-acceptance-${crypto.randomUUID()}`;
  const factory = { open: (_name: string, version: number) => indexedDB.open(database, version) } as IDBFactory;
  let now = Date.now();
  const legacyData = new Map<string, string>();
  const legacy = { getItem: (key: string) => legacyData.get(key) ?? null,
    setItem: (key: string, value: string): void => { legacyData.set(key, value); },
    removeItem: (key: string): void => { legacyData.delete(key); } };
  const backend = await IndexedDbBackend.open(factory);
  const p = new PhonePersistence(backend, legacy, () => now);
  const endpoints = { upload: '/api/recordings', analysis: '/api/analyze', coaching: '/api/coach' };
  const originalFetch = window.fetch;
  try {
    await run('real IndexedDB migration, serialized writes and reload', async () => {
      legacyData.set('example', 'legacy');
      check(await p.load('example') === 'legacy', 'migration lost source');
      await Promise.all([p.save('example', 'older'), p.save('example', 'newer')]);
      const fresh = new PhonePersistence(await IndexedDbBackend.open(factory), legacy, () => now);
      check(await fresh.load('example') === 'newer', 'late write overwrote latest snapshot');
    });
    await run('settings survive a fresh adapter', async () => {
      const settings = new DisplaySettingsStore(empty); await settings.hydrate(p);
      settings.update({ showNoteNames: false, sheetMusicSize: 'standard' }); await p.flush();
      const settings2 = new DisplaySettingsStore(empty);
      await settings2.hydrate(new PhonePersistence(await IndexedDbBackend.open(factory), legacy));
      check(settings2.value.showNoteNames === false && settings2.value.sheetMusicSize === 'standard', 'settings lost');
    });
    await run('WAV bytes survive IndexedDB structured clone', async () => {
      await p.hydrateAudio(); await p.saveAudio({ ...wav, attemptId: 'clip', savedAt: now });
      const fresh = new PhonePersistence(await IndexedDbBackend.open(factory), legacy, () => now); await fresh.hydrateAudio();
      const saved = await fresh.getAudio('clip');
      check(saved?.wav instanceof Uint8Array && saved.wav.length === wav.wav.length, 'WAV clone failed');
      check(saved?.wav.every((byte, i) => byte === wav.wav[i]), 'WAV bytes changed');
    });
    await run('audio retry cannot extend original expiry', async () => {
      now += 300000;
      await p.saveAudio({ ...wav, attemptId: 'clip', savedAt: now });
      now += 300001;
      check(await p.getAudio('clip') === null, 'retry renewed TTL');
      check(await backend.get('audio', 'clip') === undefined, 'expiry did not delete bytes');
    });
    await run('failed upload survives controller recreation; retry keeps one count and deletes audio on success', async () => {
      const session = new SessionStore(empty); await session.hydrate(p); session.selectPassage('P01');
      window.fetch = async () => { throw new Error('Injected offline'); };
      const first = new PhoneCapture(session, endpoints, undefined, p);
      await first.processWavBlob(new Blob([wav.wav], { type: 'audio/wav' })); await p.flush();
      const id = session.records[0].attemptId;
      check(session.records[0].processingStatus === 'error', 'offline not preserved');
      first.dispose();
      const fresh = new PhonePersistence(await IndexedDbBackend.open(factory), legacy); await fresh.hydrateAudio();
      const recovered = new SessionStore(empty); await recovered.hydrate(fresh);
      check(recovered.records.length === 1 && recovered.records[0].attemptId === id, 'reload changed attempt');
      const requests: string[] = [];
      window.fetch = async (input, init) => {
        const url = String(input); requests.push(url); const body = JSON.parse(String(init?.body));
        const record = recovered.records[0];
        const value = url === endpoints.upload ? { attemptId: id, artifactId: 'fixture-artifact', audioUrl: '/fixture.wav',
          sha256: 'a'.repeat(64), expiresAt: new Date(Date.now() + 60000).toISOString() } :
          url === endpoints.analysis ? fixtureAnalysis(record, 'mistakes') : fixtureCoaching(record);
        if (url === endpoints.upload) check(body.metadata.attemptId === id, 'upload changed attempt');
        return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
      };
      const second = new PhoneCapture(recovered, endpoints, undefined, fresh);
      check(second.canRetry(id), 'recovered audio cannot retry'); await second.retry(id); await fresh.flush();
      check(recovered.records.length === 1 && recovered.records[0].processingStatus === 'result', 'retry failed/count changed');
      check(!fresh.hasAudio(id) && await fresh.getAudio(id) === null, 'success retained raw audio');
      const before = requests.length;
      recovered.showHistory(); recovered.openAttempt(id);
      check(requests.length === before, 'History issued network calls');
      second.dispose();
      const final = new SessionStore(empty); await final.hydrate(fresh);
      check(final.records[0].coaching !== null, 'results lost after raw deletion');
    });
    await run('capacity rejects new audio without silently evicting pending recordings', async () => {
      // Reload the adapter after the preceding test removed a row through another adapter.
      await p.hydrateAudio();
      for (let i = 0; i < 24; i++) await p.saveAudio({ ...wav, attemptId: `cap-${i}`, savedAt: now });
      let rejected = false;
      try { await p.saveAudio({ ...wav, attemptId: 'cap-overflow', savedAt: now }); } catch { rejected = true; }
      check(rejected, 'capacity limit was ignored');
      check(await p.getAudio('cap-0') !== null, 'old unexpired pending audio was silently evicted');
      for (let i = 0; i < 24; i++) await p.deleteAudio(`cap-${i}`);
    });
    await run('corrupt audio rows are removed by their IndexedDB key', async () => {
      await backend.put('audio', 'corrupt-without-attempt-id', null);
      const restored = new PhonePersistence(await IndexedDbBackend.open(factory), legacy);
      await restored.hydrateAudio();
      check(await backend.get('audio', 'corrupt-without-attempt-id') === undefined, 'corrupt audio escaped cleanup');
    });
    await run('session-memory retries expire even without IndexedDB', async () => {
      const realNow = Date.now;
      let clock = realNow();
      Date.now = () => clock;
      const session = new SessionStore(empty); session.selectPassage('P01');
      let calls = 0;
      window.fetch = async () => { calls++; throw new Error('Injected offline'); };
      const capture = new PhoneCapture(session, endpoints);
      try {
        await capture.processWavBlob(new Blob([wav.wav], { type: 'audio/wav' }));
        const id = session.records[0].attemptId;
        check(capture.canRetry(id), 'fresh failed audio should be retryable');
        clock += 600001;
        check(!capture.canRetry(id), 'expired memory audio is still retryable');
        const before = calls;
        await capture.retry(id);
        check(calls === before, 'expired audio was uploaded again');
      } finally { Date.now = realNow; capture.dispose(); }
    });
    output.textContent += `COMPLETE ${passed} passed, 0 failed\n`;
  } catch (error) { output.textContent += `FAIL ${error instanceof Error ? error.stack : String(error)}\n`; }
  finally { window.fetch = originalFetch; button.disabled = false; }
};