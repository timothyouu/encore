import test from 'node:test';
import assert from 'node:assert/strict';
import { PhoneCapture, validateEndpoints } from '../src/capture.ts';
import { SessionStore, fixtureAnalysis, fixtureCoaching } from '../src/session.ts';

const endpoints = { analysis: 'https://analysis.example/v1/analyze', coaching: 'https://coach.example/v1/coach' };

function store() {
  return new SessionStore({ getItem() { return null; }, setItem() {} });
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function browser(getUserMedia, fetchImplementation) {
  const original = {
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
    mediaRecorder: Object.getOwnPropertyDescriptor(globalThis, 'MediaRecorder'),
    fetch: Object.getOwnPropertyDescriptor(globalThis, 'fetch'),
  };
  const track = new EventTarget();
  track.stopped = false;
  track.stop = () => { track.stopped = true; };
  track.getSettings = () => ({ sampleRate: 48000, channelCount: 1 });
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  class Recorder extends EventTarget {
    static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
    constructor() {
      super();
      this.mimeType = 'audio/webm;codecs=opus';
      this.state = 'inactive';
    }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        const event = new Event('dataavailable');
        event.data = new Blob(['recorded audio'], { type: this.mimeType });
        this.dispatchEvent(event);
        this.dispatchEvent(new Event('stop'));
      });
    }
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: getUserMedia ?? (() => Promise.resolve(stream)) } } });
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: Recorder });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchImplementation });
  return {
    track, stream, Recorder,
    restore() {
      for (const [key, descriptor] of Object.entries(original)) {
        const name = key === 'mediaRecorder' ? 'MediaRecorder' : key;
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

test('endpoint validation requires complete secure URLs without embedded credentials', () => {
  assert.equal(validateEndpoints(endpoints), true);
  assert.equal(validateEndpoints({ analysis: 'http://localhost:8000/v1/analyze', coaching: endpoints.coaching }), true);
  assert.equal(validateEndpoints({ analysis: 'http://127.0.0.1:8000/v1/analyze', coaching: endpoints.coaching }), true);
  for (const analysis of ['', '/v1/analyze', 'http://remote.example/v1/analyze', 'https://user:pass@analysis.example/v1/analyze', 'https://analysis.example/v1/analyze#fragment']) {
    assert.equal(validateEndpoints({ analysis, coaching: endpoints.coaching }), false);
  }
});

test('permission denial creates no attempt and does not call a service', async () => {
  let calls = 0;
  const env = browser(() => Promise.reject(new Error('Permission denied')), () => { calls += 1; });
  try {
    const session = store();
    session.selectPassage('P01');
    const capture = new PhoneCapture(session, endpoints);
    await capture.start();
    assert.equal(session.records.length, 0);
    assert.equal(session.state.screen, 'ready');
    assert.match(capture.error, /Permission denied/);
    assert.equal(calls, 0);
    capture.dispose();
  } finally { env.restore(); }
});

test('capture posts actual encoding and metadata, then validated analysis and coaching', async () => {
  const requests = [];
  const session = store();
  const env = browser(undefined, async (url, options) => {
    requests.push({ url, options });
    const record = session.records[0];
    return { ok: true, json: async () => url === endpoints.analysis ? fixtureAnalysis(record, 'mistakes') : fixtureCoaching(record) };
  });
  try {
    session.selectPassage('P01');
    const capture = new PhoneCapture(session, endpoints);
    await capture.start();
    assert.equal(capture.recording, true);
    assert.equal(session.records[0].captureSource, 'phone');
    await capture.stop();
    assert.equal(capture.busy, false);
    assert.equal(capture.recording, false);
    assert.equal(env.track.stopped, true);
    assert.equal(session.count(), 1);
    assert.equal(session.state.screen, 'review');
    assert.deepEqual(requests.map((request) => request.url), [endpoints.analysis, endpoints.coaching]);
    const metadata = JSON.parse(requests[0].options.body.get('metadata'));
    assert.equal(metadata.attemptId, session.records[0].attemptId);
    assert.equal(metadata.captureSource, 'phone');
    assert.equal(metadata.encoding, 'audio/webm;codecs=opus');
    assert.equal(metadata.sampleRateHz, 48000);
    assert.equal(metadata.channelCount, 1);
    assert.ok(metadata.durationMs >= 0 && metadata.durationMs <= 30_000);
    assert.equal(requests[0].options.body.get('audio').type, 'audio/webm;codecs=opus');
    assert.equal(requests[0].options.credentials, 'same-origin');
    const coachingBody = JSON.parse(requests[1].options.body);
    assert.equal(coachingBody.analysis.attemptId, session.records[0].attemptId);
    assert.equal(coachingBody.passage.id, 'P01');
    capture.dispose();
  } finally { env.restore(); }
});

test('cancel during permission request stops late stream without starting a record', async () => {
  const pending = deferred();
  const env = browser(() => pending.promise, () => { throw new Error('unexpected fetch'); });
  try {
    const session = store();
    session.selectPassage('P01');
    const capture = new PhoneCapture(session, endpoints);
    const started = capture.start();
    capture.cancel();
    pending.resolve(env.stream);
    await started;
    assert.equal(env.track.stopped, true);
    assert.equal(session.records.length, 0);
    assert.equal(capture.busy, false);
    capture.dispose();
  } finally { env.restore(); }
});

test('microphone disconnect interrupts and excludes the recording', async () => {
  const env = browser(undefined, () => { throw new Error('unexpected fetch'); });
  try {
    const session = store();
    session.selectPassage('P01');
    const capture = new PhoneCapture(session, endpoints);
    await capture.start();
    env.track.dispatchEvent(new Event('ended'));
    assert.equal(session.records[0].captureStatus, 'interrupted');
    assert.equal(session.count(), 0);
    assert.equal(capture.recording, false);
    assert.equal(env.track.stopped, true);
    capture.dispose();
  } finally { env.restore(); }
});

test('invalid coaching preserves completed recording and validated analysis', async () => {
  const session = store();
  const env = browser(undefined, async (url) => ({
    ok: true,
    json: async () => url === endpoints.analysis ? fixtureAnalysis(session.records[0], 'mistakes') : { cue: 'unvalidated' },
  }));
  try {
    session.selectPassage('P01');
    const capture = new PhoneCapture(session, endpoints);
    await capture.start();
    await capture.stop();
    assert.equal(session.count(), 1);
    assert.equal(session.records[0].analysis?.status, 'ok');
    assert.equal(session.records[0].processingStatus, 'error');
    assert.equal(session.records[0].error?.stage, 'coaching');
    capture.dispose();
  } finally { env.restore(); }
});

test('duplicate taps do not create another attempt or request', async () => {
  let calls = 0;
  const session = store();
  const env = browser(undefined, async (url) => {
    calls += 1;
    return { ok: true, json: async () => url === endpoints.analysis ? fixtureAnalysis(session.records[0], 'uncertain') : {} };
  });
  try {
    session.selectPassage('P01');
    const capture = new PhoneCapture(session, endpoints);
    await Promise.all([capture.start(), capture.start()]);
    assert.equal(session.records.length, 1);
    await Promise.all([capture.stop(), capture.stop()]);
    assert.equal(session.count(), 1);
    assert.equal(calls, 1);
    capture.dispose();
  } finally { env.restore(); }
});

test('invalid analysis JSON is classified as analysis failure', async () => {
  const session = store();
  const env = browser(undefined, async () => ({ ok: true, json: async () => { throw new SyntaxError('bad JSON'); } }));
  try {
    session.selectPassage('P01');
    const capture = new PhoneCapture(session, endpoints);
    await capture.start();
    await capture.stop();
    assert.equal(session.count(), 1);
    assert.equal(session.records[0].error?.stage, 'analysis');
    assert.equal(session.records[0].analysis, null);
    capture.dispose();
  } finally { env.restore(); }
});

test('cancel releases active mic and excludes capture from count', async () => {
  const session = store();
  const env = browser(undefined, () => { throw new Error('unexpected fetch'); });
  try {
    session.selectPassage('P01');
    const capture = new PhoneCapture(session, endpoints);
    await capture.start();
    capture.cancel();
    assert.equal(env.track.stopped, true);
    assert.equal(session.records[0].captureStatus, 'canceled');
    assert.equal(session.count(), 0);
    assert.equal(capture.recording, false);
    capture.dispose();
  } finally { env.restore(); }
});

test('permission resolving after navigation cannot record a newly selected passage', async () => {
  const pending = deferred();
  const env = browser(() => pending.promise, () => { throw new Error('unexpected fetch'); });
  try {
    const session = store();
    session.selectPassage('P01');
    const capture = new PhoneCapture(session, endpoints);
    const started = capture.start();
    session.showLibrary();
    session.selectPassage('P02');
    pending.resolve(env.stream);
    await started;
    assert.equal(env.track.stopped, true);
    assert.equal(session.records.length, 0);
    assert.equal(session.state.passageId, 'P02');
    capture.dispose();
  } finally { env.restore(); }
});

test('recorder error while stopping interrupts rather than hanging or uploading', async () => {
  const session = store();
  let calls = 0;
  const env = browser(undefined, () => { calls += 1; throw new Error('unexpected fetch'); });
  env.Recorder.prototype.stop = function () {
    this.state = 'inactive';
    queueMicrotask(() => this.dispatchEvent(new Event('error')));
  };
  try {
    session.selectPassage('P01');
    const capture = new PhoneCapture(session, endpoints);
    await capture.start();
    await capture.stop();
    assert.equal(session.records[0].captureStatus, 'interrupted');
    assert.equal(session.count(), 0);
    assert.equal(calls, 0);
    capture.dispose();
  } finally { env.restore(); }
});

test('page disposal marks an active recording interrupted', async () => {
  const session = store();
  const env = browser(undefined, () => { throw new Error('unexpected fetch'); });
  try {
    session.selectPassage('P01');
    const capture = new PhoneCapture(session, endpoints);
    await capture.start();
    capture.dispose();
    assert.equal(env.track.stopped, true);
    assert.equal(session.records[0].captureStatus, 'interrupted');
    assert.equal(session.count(), 0);
    assert.equal(capture.recording, false);
  } finally { env.restore(); }
});

test('late denied permission from a canceled request cannot interrupt a newer capture', async () => {
  let rejectFirst;
  const first = new Promise((_resolve, reject) => { rejectFirst = reject; });
  let requests = 0;
  const env = browser(() => ++requests === 1 ? first : Promise.resolve(env.stream));
  const session = store(); session.selectPassage('P01');
  const capture = new PhoneCapture(session, endpoints);
  try {
    const oldStart = capture.start();
    capture.cancel();
    await capture.start();
    assert.equal(capture.recording, true);
    rejectFirst(new Error('Old permission denied'));
    await oldStart;
    assert.equal(capture.recording, true);
    assert.equal(env.track.stopped, false);
    assert.equal(session.state.screen, 'recording');
    assert.equal(capture.error, null);
  } finally { capture.dispose(); env.restore(); }
});
