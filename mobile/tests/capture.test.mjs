import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PhoneCapture, validateEndpoints, requestTimeoutMs } from '../src/capture.ts';
import { SessionStore, fixtureAnalysis, fixtureCoaching } from '../src/session.ts';
import { PhonePersistence } from '../src/storage.ts';

const endpoints = { upload: '/api/recordings', analysis: '/api/analyze', coaching: '/api/coach' };
let latestUploadMetadata;
let latestUploadDigest;
const artifact = attemptId => ({ ...latestUploadMetadata, artifactId: 'artifact-1', attemptId,
  audioUrl: '/v1/recordings/artifact-1/audio',
  expiresAt: new Date(Date.now() + 60_000).toISOString(), sha256: latestUploadDigest });
const store = () => new SessionStore({ getItem() { return null; }, setItem() {} });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function browser(fetchImplementation, getUserMedia) {
  const original = new Map(['navigator', 'MediaRecorder', 'AudioContext', 'fetch'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const track = new EventTarget(); track.stopped = false; track.stop = () => { track.stopped = true; };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  class Recorder extends EventTarget {
    static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
    constructor() { super(); this.mimeType = 'audio/webm;codecs=opus'; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; queueMicrotask(() => {
      const event = new Event('dataavailable'); event.data = new Blob(['encoded']); this.dispatchEvent(event);
      this.dispatchEvent(new Event('stop'));
    }); }
  }
  class Decoder {
    async decodeAudioData() { return { numberOfChannels: 2, sampleRate: 48_000,
      getChannelData: () => Float32Array.from({ length: 4_800 }, (_, i) => 0.4 * Math.sin(2 * Math.PI * 440 * i / 48_000)) }; }
    async close() {}
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: getUserMedia ?? (() => Promise.resolve(stream)) } } });
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: Recorder });
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Decoder });
  latestUploadMetadata = undefined;
  latestUploadDigest = undefined;
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url, options) => {
    if (options?.body) {
      const body = JSON.parse(options.body);
      if (body.metadata && body.wavBase64) {
        latestUploadMetadata = body.metadata;
        latestUploadDigest = createHash('sha256').update(Buffer.from(body.wavBase64, 'base64')).digest('hex');
      }
    }
    return fetchImplementation(url, options);
  } });
  return { track, stream, Recorder, restore() { for (const [name, descriptor] of original) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  } } };
}

test('endpoint validation allows local proxy and secure absolute URLs', () => {
  assert.equal(validateEndpoints(endpoints), true);
  assert.equal(validateEndpoints({ ...endpoints, upload: 'https://example.com/v1/recordings' }), true);
  assert.equal(validateEndpoints({ ...endpoints, upload: 'http://remote.example/v1/recordings' }), false);
  assert.equal(validateEndpoints({ ...endpoints, upload: '/v1/recordings' }), false);
});
test('analysis timeout permits the 65 second service budget', () => {
  assert.equal(requestTimeoutMs('analysis'), 70_000);
  assert.equal(requestTimeoutMs('upload'), 30_000);
  assert.equal(requestTimeoutMs('coaching'), 30_000);
});

test('stop saves once, uploads decoded WAV, and sends one artifact to analysis and coaching', async () => {
  const session = store(); const calls = [];
  const env = browser(async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body });
    const record = session.records[0];
    return { ok: true, json: async () => url === endpoints.upload ? artifact(record.attemptId) :
      url === endpoints.analysis ? fixtureAnalysis(record, 'mistakes') : fixtureCoaching(record) };
  });
  try {
    session.selectPassage('P01'); const capture = new PhoneCapture(session, endpoints);
    await capture.start(); await Promise.all([capture.stop(), capture.stop()]);
    assert.equal(session.count(), 1); assert.equal(session.records.length, 1);
    assert.equal(session.state.screen, 'review'); assert.equal(env.track.stopped, true);
    assert.deepEqual(calls.map(call => call.url), Object.values(endpoints));
    const { metadata, wavBase64 } = calls[0].body;
    const bytes = Buffer.from(wavBase64, 'base64'); const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(view.getUint32(24, true), 22_050);
    assert.equal(metadata.sourceSampleRate, 48_000); assert.equal(metadata.sampleRate, 22_050);
    assert.equal(metadata.encoding, 'pcm_s16le'); assert.equal(metadata.channels, 1);
    assert.equal(metadata.durationSec, 0.1); assert.equal(view.getUint32(40, true), 4_410);
    assert.equal(calls[1].body.artifactId, 'artifact-1'); assert.equal(calls[2].body.artifactId, 'artifact-1');
    assert.equal(calls[1].body.attemptId, session.records[0].attemptId);
    assert.equal(calls[2].body.analysis.attemptId, session.records[0].attemptId);
    capture.dispose();
  } finally { env.restore(); }
});

test('normalization failure keeps one completed attempt at the correct stage', async () => {
  const session = store(); let calls = 0;
  const env = browser(() => { calls += 1; throw new Error('unexpected'); });
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: class {
    async decodeAudioData() { throw new Error('bad bytes'); } async close() {}
  } });
  try {
    session.selectPassage('P01'); const capture = new PhoneCapture(session, endpoints);
    await capture.start(); await capture.stop();
    assert.equal(session.count(), 1); assert.equal(session.records[0].error.stage, 'normalization');
    assert.equal(calls, 0); capture.dispose();
  } finally { env.restore(); }
});

test('mismatched artifact fails upload and retry reuses same completed attempt', async () => {
  const session = store(); let bad = true; const calls = [];
  const env = browser(async (url, options) => {
    calls.push(url); const record = session.records[0];
    return { ok: true, json: async () => url === endpoints.upload ? { ...artifact(record.attemptId), attemptId: bad ? 'other' : record.attemptId } :
      url === endpoints.analysis ? fixtureAnalysis(record, 'uncertain') : {} };
  });
  try {
    session.selectPassage('P01'); const capture = new PhoneCapture(session, endpoints);
    await capture.start(); await capture.stop();
    assert.equal(session.records[0].error.stage, 'upload'); assert.equal(session.count(), 1);
    bad = false; await capture.retry(session.records[0].attemptId);
    assert.equal(session.records.length, 1); assert.equal(session.count(), 1);
    assert.equal(session.records[0].processingStatus, 'result');
    assert.deepEqual(calls, [endpoints.upload, endpoints.upload, endpoints.analysis]);
    capture.dispose();
  } finally { env.restore(); }
});

test('failed upload retries normalized WAV after reload using the original attempt', async () => {
  const state = new Map(); const audio = new Map();
  const backend = {
    async get(store, key) { return structuredClone((store === 'state' ? state : audio).get(key)); },
    async put(store, key, value) { (store === 'state' ? state : audio).set(key, structuredClone(value)); },
    async delete(store, key) { (store === 'state' ? state : audio).delete(key); },
    async values() { return structuredClone([...audio.values()]); },
  };
  const legacy = { getItem() { return null; }, setItem() {}, removeItem() {} };
  let session = new SessionStore(legacy); let failing = true; const calls = [];
  const env = browser(async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    if (url === endpoints.upload && failing) return { ok: false, status: 503 };
    const record = session.records[0];
    return { ok: true, json: async () => url === endpoints.upload ? artifact(record.attemptId) :
      url === endpoints.analysis ? fixtureAnalysis(record, 'uncertain') : {} };
  });
  try {
    let persistence = new PhonePersistence(backend, legacy);
    await session.hydrate(persistence); await persistence.hydrateAudio();
    session.selectPassage('P01'); const first = new PhoneCapture(session, endpoints, undefined, persistence);
    await first.start(); await first.stop();
    const attemptId = session.records[0].attemptId;
    assert.equal(session.records[0].error.stage, 'upload');
    assert.equal(audio.has(attemptId), true);
    await persistence.flush(); first.dispose();

    session = new SessionStore(legacy); persistence = new PhonePersistence(backend, legacy);
    await session.hydrate(persistence); await persistence.hydrateAudio();
    assert.equal(calls.length, 1, 'hydrating history must not contact the service');
    const second = new PhoneCapture(session, endpoints, undefined, persistence);
    assert.equal(second.canRetry(attemptId), true);
    failing = false; await second.retry(attemptId);
    assert.equal(session.records.length, 1);
    assert.equal(session.count(), 1);
    assert.equal(session.records[0].attemptId, attemptId);
    assert.equal(session.records[0].processingStatus, 'result');
    assert.deepEqual(calls.map(call => call.url), [endpoints.upload, endpoints.upload, endpoints.analysis]);
    assert.equal(calls[1].body.metadata.attemptId, attemptId);
    assert.equal(audio.has(attemptId), false, 'terminal uncertain result removes retry audio');
    second.dispose();
  } finally { env.restore(); }
});

test('session-only failed audio stops being retryable after ten minutes', async () => {
  const originalNow = Date.now; let now = 1000000; Date.now = () => now;
  const session = store(); let calls = 0;
  const env = browser(async () => { calls++; return { ok: false, status: 503 }; });
  try {
    session.selectPassage('P01'); const capture = new PhoneCapture(session, endpoints);
    await capture.start(); await capture.stop();
    const id = session.records[0].attemptId;
    assert.equal(capture.canRetry(id), true);
    now += 10 * 60 * 1000 + 1;
    assert.equal(capture.canRetry(id), false);
    await capture.retry(id);
    assert.equal(calls, 1);
    assert.match(session.storageWarning, /expired/);
    capture.dispose();
  } finally { env.restore(); Date.now = originalNow; }
});
test('correcting endpoints in the same tab retains failed attempt audio for retry', async () => {
  const session = store(); const requests = []; const corrected = '/api/corrected-recordings';
  const env = browser(async (url) => { requests.push(url); const record = session.records[0];
    if (url === endpoints.upload) return { ok: false, status: 503 };
    return { ok: true, json: async () => url === corrected ? artifact(record.attemptId) :
      url === endpoints.analysis ? fixtureAnalysis(record, 'uncertain') : {} }; });
  try {
    session.selectPassage('P01'); const capture = new PhoneCapture(session, endpoints);
    await capture.start(); await capture.stop();
    assert.equal(session.records[0].error.stage, 'upload');
    assert.equal(capture.canRetry(session.records[0].attemptId), true);
    assert.equal(capture.updateEndpoints({ ...endpoints, upload: corrected }), true);
    await capture.retry();
    assert.equal(session.records[0].processingStatus, 'result'); assert.equal(session.count(), 1);
    assert.deepEqual(requests, [endpoints.upload, corrected, endpoints.analysis]);
    capture.dispose();
  } finally { env.restore(); }
});
test('changing upload endpoint discards old receipt and reanalyzes the replacement artifact', async () => {
  const session = store(); const changedUpload = '/api/new-recordings'; const calls = [];
  const env = browser(async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body }); const record = session.records[0];
    if (url === endpoints.upload || url === changedUpload) return { ok: true, json: async () =>
      ({ ...artifact(record.attemptId), artifactId: url === changedUpload ? 'new-artifact' : 'old-artifact' }) };
    if (url === endpoints.analysis) return { ok: true, json: async () => fixtureAnalysis(record, 'mistakes') };
    return { ok: body.artifactId === 'new-artifact', status: 410, json: async () => fixtureCoaching(record) };
  });
  try {
    session.selectPassage('P01'); const capture = new PhoneCapture(session, endpoints);
    await capture.start(); await capture.stop();
    assert.equal(session.records[0].error.stage, 'coaching');
    assert.equal(capture.updateEndpoints({ ...endpoints, upload: changedUpload }), true);
    await capture.retry();
    assert.equal(session.records[0].processingStatus, 'result'); assert.equal(session.count(), 1);
    assert.deepEqual(calls.map(call => call.url), [endpoints.upload, endpoints.analysis, endpoints.coaching,
      changedUpload, endpoints.analysis, endpoints.coaching]);
    assert.equal(calls[4].body.artifactId, 'new-artifact');
    capture.dispose();
  } finally { env.restore(); }
});

test('coaching failure retries same attempt and preserves saved analysis', async () => {
  const session = store(); let bad = true; const calls = [];
  const env = browser(async (url) => { calls.push(url); const record = session.records[0]; return { ok: true, json: async () =>
    url === endpoints.upload ? artifact(record.attemptId) : url === endpoints.analysis ? fixtureAnalysis(record, 'mistakes') : bad ? {} : fixtureCoaching(record) }; });
  try {
    session.selectPassage('P01'); const capture = new PhoneCapture(session, endpoints);
    await capture.start(); await capture.stop();
    assert.equal(session.records[0].error.stage, 'coaching'); assert.equal(session.records[0].analysis.status, 'ok');
    bad = false; await capture.retry();
    assert.equal(session.records[0].processingStatus, 'result'); assert.equal(session.count(), 1);
    assert.deepEqual(calls, [endpoints.upload, endpoints.analysis, endpoints.coaching, endpoints.coaching]);
    capture.dispose();
  } finally { env.restore(); }
});

test('expired receipt retry analyzes a newly uploaded artifact before coaching', async () => {
  const session = store(); const calls = []; let uploadCount = 0;
  const analyzed = new Set();
  const env = browser(async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body }); const record = session.records[0];
    if (url === endpoints.upload) {
      uploadCount += 1;
      return { ok: true, json: async () => ({ ...artifact(record.attemptId), artifactId: `artifact-${uploadCount}` }) };
    }
    if (url === endpoints.analysis) {
      analyzed.add(body.artifactId);
      return { ok: true, json: async () => fixtureAnalysis(record, 'mistakes') };
    }
    return { ok: analyzed.has(body.artifactId) && uploadCount > 1,
      status: 409, json: async () => fixtureCoaching(record) };
  });
  try {
    session.selectPassage('P01'); const capture = new PhoneCapture(session, endpoints);
    await capture.start(); await capture.stop();
    assert.equal(session.records[0].error.stage, 'coaching');
    const id = session.records[0].attemptId;
    capture.saved.get(id).artifact.expiresAt = new Date(Date.now() - 1000).toISOString();
    await capture.retry(id);
    assert.equal(session.records[0].processingStatus, 'result'); assert.equal(session.count(), 1);
    assert.deepEqual(calls.map(call => call.url), [endpoints.upload, endpoints.analysis, endpoints.coaching,
      endpoints.upload, endpoints.analysis, endpoints.coaching]);
    assert.equal(calls[4].body.artifactId, 'artifact-2');
    assert.equal(calls[5].body.artifactId, 'artifact-2');
    capture.dispose();
  } finally { env.restore(); }
});

test('analysis error response retries analysis using saved artifact and completes', async () => {
  const session = store(); let bad = true; const calls = [];
  const env = browser(async (url) => { calls.push(url); const record = session.records[0]; return { ok: true, json: async () =>
    url === endpoints.upload ? artifact(record.attemptId) : url === endpoints.analysis ?
      fixtureAnalysis(record, bad ? 'error' : 'uncertain') : {} }; });
  try {
    session.selectPassage('P01'); const capture = new PhoneCapture(session, endpoints);
    await capture.start(); await capture.stop();
    assert.equal(session.records[0].error.stage, 'analysis'); assert.equal(session.records[0].analysis.status, 'error');
    bad = false; await capture.retry();
    assert.equal(session.records[0].processingStatus, 'result'); assert.equal(session.count(), 1);
    assert.deepEqual(calls, [endpoints.upload, endpoints.analysis, endpoints.analysis]);
    capture.dispose();
  } finally { env.restore(); }
});

test('cancel while permission is pending rejects late stream and creates no attempt', async () => {
  const pending = deferred(); const env = browser(() => { throw new Error('unexpected'); }, () => pending.promise);
  try { const session = store(); session.selectPassage('P01'); const capture = new PhoneCapture(session, endpoints);
    const started = capture.start(); capture.cancel(); pending.resolve(env.stream); await started;
    assert.equal(env.track.stopped, true); assert.equal(session.records.length, 0); capture.dispose();
  } finally { env.restore(); }
});

test('late upload response after cancellation cannot overwrite completed attempt', async () => {
  const pending = deferred(); const session = store(); const env = browser(async () => pending.promise);
  try { session.selectPassage('P01'); const capture = new PhoneCapture(session, endpoints);
    await capture.start(); const stopped = capture.stop();
    while (session.processingStage !== 'upload') await new Promise(resolve => setTimeout(resolve, 1));
    capture.cancel(); pending.resolve({ ok: true, json: async () => artifact(session.records[0].attemptId) }); await stopped;
    assert.equal(session.count(), 1); assert.equal(session.records[0].error.stage, 'upload');
    assert.equal(session.records[0].analysis, null); capture.dispose();
  } finally { env.restore(); }
});

test('a host-completed recording (G2) runs the same upload, analysis and coaching, labeled g2', async () => {
  const session = store(); const calls = [];
  const env = browser(async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body });
    const record = session.records[0];
    return { ok: true, json: async () => url === endpoints.upload ? artifact(record.attemptId) :
      url === endpoints.analysis ? fixtureAnalysis(record, 'mistakes') : fixtureCoaching(record) };
  });
  try {
    session.selectPassage('P01'); const capture = new PhoneCapture(session, endpoints);
    session.start('g2'); const record = session.stop();
    await Promise.all([capture.processRecording(record, new Blob(['wav'])), capture.processRecording(record, new Blob(['wav']))]);
    assert.equal(session.count(), 1); assert.equal(session.records.length, 1);
    assert.equal(session.state.screen, 'review');
    assert.deepEqual(calls.map(call => call.url), Object.values(endpoints));
    assert.equal(calls[0].body.metadata.captureSource, 'g2');
    assert.equal(calls[0].body.metadata.attemptId, record.attemptId);
    capture.dispose();
  } finally { env.restore(); }
});

test('a host recording that is empty or not completed is never uploaded', async () => {
  const session = store(); const calls = [];
  const env = browser(async (url) => { calls.push(url); return { ok: true, json: async () => ({}) }; });
  try {
    session.selectPassage('P01'); const capture = new PhoneCapture(session, endpoints);
    const recording = session.start('g2');
    await capture.processRecording(recording, new Blob(['wav']));
    const completed = session.stop();
    await capture.processRecording(completed, new Blob([]));
    assert.equal(calls.length, 0);
    assert.equal(session.records[0].error.stage, 'capture');
    assert.equal(session.count(), 1);
    capture.dispose();
  } finally { env.restore(); }
});

test('receipt SHA and metadata must match normalized upload before analysis', async () => {
  const session = store(); const calls = [];
  const env = browser(async (url) => { calls.push(url); const record = session.records[0];
    return { ok: true, json: async () => ({ ...artifact(record.attemptId), sha256: 'b'.repeat(64) }) }; });
  try {
    session.selectPassage('P01'); const capture = new PhoneCapture(session, endpoints);
    await capture.start(); await capture.stop();
    assert.deepEqual(calls, [endpoints.upload]);
    assert.equal(session.records[0].error.stage, 'upload');
    assert.match(session.records[0].error.message, /mismatched|invalid/i);
    capture.dispose();
  } finally { env.restore(); }
});

test('terminal upload 410 releases retry audio and asks for a new attempt', async () => {
  const session = store(); let calls = 0;
  const env = browser(async () => { calls++; return { ok: false, status: 410 }; });
  try {
    session.selectPassage('P01'); const capture = new PhoneCapture(session, endpoints);
    await capture.start(); await capture.stop();
    const id = session.records[0].attemptId;
    assert.equal(calls, 1);
    assert.equal(session.records[0].error.stage, 'upload');
    assert.match(session.records[0].error.message, /Record a new attempt/);
    assert.equal(capture.canRetry(id), false);
    await capture.retry(id);
    assert.equal(calls, 1);
    capture.dispose();
  } finally { env.restore(); }
});

test('session bearer is scoped to exact HTTPS service and revoked on endpoint origin change', async () => {
  const session = store(); const secure = { upload: 'https://approved.example/api/recordings',
    analysis: 'https://approved.example/api/analyze', coaching: 'https://approved.example/api/coach' };
  const calls = []; let failure = true;
  const env = browser(async (url, options) => {
    calls.push({ url, authorization: options.headers.Authorization, redirect: options.redirect });
    const record = session.records[0];
    if (failure) return { ok: false, status: 503 };
    return { ok: true, json: async () => url.endsWith('/recordings') ? artifact(record.attemptId) :
      url.endsWith('/analyze') ? fixtureAnalysis(record, 'uncertain') : {} };
  });
  try {
    session.selectPassage('P01');
    const capture = new PhoneCapture(session, secure, undefined, undefined,
      () => ({ token: 'session-only-token-123', origin: 'https://approved.example' }));
    await capture.start(); await capture.stop();
    assert.equal(calls[0].authorization, 'Bearer session-only-token-123');
    assert.equal(calls[0].redirect, 'error');
    const moved = { ...secure, upload: 'https://other.example/api/recordings',
      analysis: 'https://other.example/api/analyze', coaching: 'https://other.example/api/coach' };
    assert.equal(capture.updateEndpoints(moved), true);
    failure = false; await capture.retry();
    assert.equal(calls[1].authorization, undefined);
    assert.equal(calls[2].authorization, undefined);
    assert.equal(session.records[0].processingStatus, 'result');
    capture.dispose();
  } finally { env.restore(); }
});
test('receipt passage and sample-rate identity cannot be substituted', async () => {
  for (const change of [{ passageId: 'P02' }, { sourceSampleRate: 16000 }]) {
    const session = store(); const calls = [];
    const env = browser(async (url) => { calls.push(url); const record = session.records[0];
      return { ok: true, json: async () => ({ ...artifact(record.attemptId), ...change }) }; });
    try {
      session.selectPassage('P01'); const capture = new PhoneCapture(session, endpoints);
      await capture.start(); await capture.stop();
      assert.deepEqual(calls, [endpoints.upload]);
      assert.equal(session.records[0].error.stage, 'upload');
      capture.dispose();
    } finally { env.restore(); }
  }
});