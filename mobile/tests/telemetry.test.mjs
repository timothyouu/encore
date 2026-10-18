import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PhoneCapture } from '../src/capture.ts';
import { SessionStore, fixtureAnalysis, fixtureCoaching } from '../src/session.ts';
import {
  beginTelemetrySpan, endTelemetrySpan, initializeSentry, measureTelemetry,
  recordTelemetryFailure, setTelemetrySink,
} from '../src/telemetry.ts';

const endpoints = {
  upload: 'https://upload.example/v1/recordings?synthetic_secret=URL_SENTINEL',
  analysis: 'https://analysis.example/v1/analyze',
  coaching: 'https://coaching.example/v1/coach',
};
function uploadReply(options) {
  const { metadata, wavBase64 } = JSON.parse(options.body);
  const sha256 = createHash('sha256').update(Buffer.from(wavBase64, 'base64')).digest('hex');
  return { ok: true, json: async () => ({ ...metadata, artifactId: 'artifact-1',
    audioUrl: '/v1/recordings/artifact-1', expiresAt: new Date(Date.now() + 60_000).toISOString(), sha256 }) };
}

function spySink() {
  const events = [];
  let nextId = 0;
  const sink = {
    start(name, parent, source) {
      const id = ++nextId;
      events.push({ kind: 'start', id, name, parent: parent?.id ?? null, source });
      return {
        id,
        child(childName) { return sink.start(childName, this, source); },
        end(outcome) { events.push({ kind: 'end', id, outcome }); },
      };
    },
    failure(stage, code, source, parent) {
      events.push({ kind: 'failure', stage, code, source, parent: parent?.id ?? null });
    },
  };
  setTelemetrySink(sink);
  return events;
}

function starts(events, name) {
  return events.filter((event) => event.kind === 'start' && event.name === name);
}

function failures(events, stage) {
  return events.filter((event) => event.kind === 'failure' && event.stage === stage);
}

function ending(events, start) {
  return events.filter((event) => event.kind === 'end' && event.id === start.id);
}

function storage(setItem = () => {}) {
  return { getItem() { return null; }, setItem };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function browser(fetchImplementation, getUserMedia) {
  const original = Object.fromEntries(
    ['navigator', 'MediaRecorder', 'AudioContext', 'fetch'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
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
        event.data = new Blob(['AUDIO_SENTINEL'], { type: this.mimeType });
        this.dispatchEvent(event);
        this.dispatchEvent(new Event('stop'));
      });
    }
  }
  class Decoder {
    async decodeAudioData() { return { numberOfChannels: 2, sampleRate: 48_000,
      getChannelData: () => Float32Array.from({ length: 4_800 }, (_, i) => 0.4 * Math.sin(2 * Math.PI * 440 * i / 48_000)) }; }
    async close() {}
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Decoder });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, value: { mediaDevices: { getUserMedia: getUserMedia ?? (() => Promise.resolve(stream)) } },
  });
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: Recorder });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchImplementation });
  return {
    track, stream, Recorder,
    restore() {
      for (const [name, descriptor] of Object.entries(original)) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

afterEach(() => {
  setTelemetrySink({ start: () => ({ child() { return this; }, end() {} }), failure() {} });
});

test('Sentry stays disabled when opt-in or DSN is absent', () => {
  assert.equal(initializeSentry({}), false);
  assert.equal(initializeSentry({ VITE_SENTRY_DSN: 'https://public@example.invalid/1' }), false);
  assert.equal(initializeSentry({ VITE_SENTRY_ENABLED: 'true' }), false);
  assert.doesNotThrow(() => endTelemetrySpan(beginTelemetrySpan('app.render'), 'ok'));
});

test('telemetry failures never change the observed application result', () => {
  setTelemetrySink({
    start() { throw new Error('telemetry start unavailable'); },
    failure() { throw new Error('telemetry send unavailable'); },
  });
  assert.equal(measureTelemetry('app.render', () => 42), 42);
  assert.doesNotThrow(() => recordTelemetryFailure('render', 'render_failed'));
  setTelemetrySink({
    start() { return { child() { throw new Error('child unavailable'); }, end() { throw new Error('end unavailable'); } }; },
    failure() {},
  });
  assert.doesNotThrow(() => endTelemetrySpan(beginTelemetrySpan('app.render'), 'error'));
  assert.throws(() => measureTelemetry('app.render', () => { throw new Error('application failure'); }), /application failure/);
});

test('phone capture still reaches a result when every telemetry start throws', async () => {
  setTelemetrySink({
    start() { throw new Error('telemetry unavailable'); },
    failure() { throw new Error('telemetry unavailable'); },
  });
  const session = new SessionStore(storage());
  const env = browser(async (url, options) => url === endpoints.upload ? uploadReply(options) : ({
    ok: true, json: async () => fixtureAnalysis(session.records[0], 'uncertain'),
  }));
  try {
    session.selectPassage('P01');
    const capture = new PhoneCapture(session, endpoints);
    await capture.start();
    await capture.stop();
    capture.dispose();
    assert.equal(session.records[0].processingStatus, 'result');
    assert.equal(session.count(), 1);
    assert.equal(env.track.stopped, true);
  } finally { env.restore(); }
});

test('successful phone capture records bounded spans and one terminal result', async () => {
  const events = spySink();
  const session = new SessionStore(storage());
  const env = browser(async (url, options) => url === endpoints.upload ? uploadReply(options) : ({
    ok: true,
    json: async () => url === endpoints.analysis
      ? fixtureAnalysis(session.records[0], 'mistakes')
      : fixtureCoaching(session.records[0]),
  }));
  try {
    session.selectPassage('P01');
    const capture = new PhoneCapture(session, endpoints);
    await capture.start();
    await capture.stop();
    capture.dispose();
    assert.equal(session.records[0].processingStatus, 'result');
    const root = starts(events, 'phone.stop_to_result');
    assert.equal(root.length, 1);
    assert.deepEqual(ending(events, root[0]).map((event) => event.outcome), ['ok']);
    for (const name of [
      'phone.recorder_stop', 'phone.normalization', 'phone.upload_request', 'phone.upload_validation',
      'phone.analysis_request', 'phone.analysis_validation',
      'phone.coaching_request', 'phone.coaching_validation',
    ]) {
      const spans = starts(events, name);
      assert.equal(spans.length, 1, name);
      assert.equal(spans[0].parent, root[0].id, name);
      assert.deepEqual(ending(events, spans[0]).map((event) => event.outcome), ['ok'], name);
    }
    assert.equal(events.some((event) => event.kind === 'failure'), false);
    assert.doesNotMatch(JSON.stringify(events), /AUDIO_SENTINEL|URL_SENTINEL|https:\/\//);
  } finally { env.restore(); }
});

test('expected microphone permission denial and cancellation emit no failure event', async () => {
  const events = spySink();
  const denial = browser(() => { throw new Error('unexpected fetch'); },
    () => Promise.reject(new DOMException('PERMISSION_SENTINEL', 'NotAllowedError')));
  try {
    const session = new SessionStore(storage());
    session.selectPassage('P01');
    const capture = new PhoneCapture(session, endpoints);
    await capture.start();
    capture.dispose();
    assert.equal(session.records.length, 0);
    assert.equal(events.some((event) => event.kind === 'failure'), false);
    assert.equal(starts(events, 'phone.stop_to_result').length, 0);
  } finally { denial.restore(); }

  const pending = deferred();
  const cancelEnv = browser(() => { throw new Error('unexpected fetch'); }, () => pending.promise);
  try {
    const session = new SessionStore(storage());
    session.selectPassage('P01');
    const capture = new PhoneCapture(session, endpoints);
    const started = capture.start();
    capture.cancel();
    pending.resolve(cancelEnv.stream);
    await started;
    capture.dispose();
    assert.equal(session.records.length, 0);
    assert.equal(events.some((event) => event.kind === 'failure'), false);
    assert.equal(starts(events, 'phone.stop_to_result').length, 0);
  } finally { cancelEnv.restore(); }
});

test('HTTP and invalid analysis failures use fixed codes without raw service data', async (t) => {
  for (const [caseName, response, expectedStage, expectedCode] of [
    ['HTTP failure', { ok: false, status: 503 }, 'upload', 'service_error'],
    ['invalid JSON', { ok: true, json: async () => { throw new SyntaxError('JSON_SENTINEL'); } }, 'analysis', 'invalid_json'],
    ['invalid analysis', { ok: true, json: async () => ({ raw: 'ANALYSIS_SENTINEL' }) }, 'analysis', 'invalid_response'],
  ]) {
    await t.test(caseName, async () => {
      const events = spySink();
      const env = browser(async (url, options) =>
        url === endpoints.upload && expectedStage !== 'upload' ? uploadReply(options) : response);
      try {
        const session = new SessionStore(storage());
        session.selectPassage('P01');
        const capture = new PhoneCapture(session, endpoints);
        await capture.start();
        await capture.stop();
        capture.dispose();
        assert.equal(session.records[0].processingStatus, 'error');
        assert.deepEqual(failures(events, expectedStage).map(({ code, source }) => [code, source]), [[expectedCode, 'phone']]);
        const root = starts(events, 'phone.stop_to_result');
        assert.equal(root.length, 1);
        assert.deepEqual(ending(events, root[0]).map((event) => event.outcome), ['error']);
        assert.doesNotMatch(JSON.stringify(events), /URL_SENTINEL|AUDIO_SENTINEL|JSON_SENTINEL|ANALYSIS_SENTINEL|https:\/\//);
      } finally { env.restore(); }
    });
  }
});

test('invalid coaching is distinguished from analysis and keeps the completed attempt', async () => {
  const events = spySink();
  const session = new SessionStore(storage());
  const env = browser(async (url, options) => url === endpoints.upload ? uploadReply(options) : ({
    ok: true,
    json: async () => url === endpoints.analysis ? fixtureAnalysis(session.records[0], 'mistakes') : { cue: 'COACHING_SENTINEL' },
  }));
  try {
    session.selectPassage('P01');
    const capture = new PhoneCapture(session, endpoints);
    await capture.start();
    await capture.stop();
    capture.dispose();
    assert.equal(session.count(), 1);
    assert.equal(session.records[0].analysis?.status, 'ok');
    assert.equal(session.records[0].error?.stage, 'coaching');
    assert.deepEqual(failures(events, 'coaching').map(({ code }) => code), ['invalid_response']);
    assert.doesNotMatch(JSON.stringify(events), /COACHING_SENTINEL|AUDIO_SENTINEL|URL_SENTINEL/);
  } finally { env.restore(); }
});

test('cancel during processing ends the trace once without a failure', async () => {
  const events = spySink();
  const pending = deferred();
  const env = browser((url, options) => {
    if (url === endpoints.upload) return Promise.resolve(uploadReply(options));
    options.signal.addEventListener('abort', () => pending.reject(new DOMException('Aborted', 'AbortError')), { once: true });
    return pending.promise;
  });
  try {
    const session = new SessionStore(storage());
    session.selectPassage('P01');
    const capture = new PhoneCapture(session, endpoints);
    await capture.start();
    const stopping = capture.stop();
    for (let i = 0; i < 10 && !starts(events, 'phone.analysis_request').length; i++) await new Promise((done) => setTimeout(done, 0));
    assert.equal(starts(events, 'phone.analysis_request').length, 1);
    capture.cancel();
    await stopping;
    capture.dispose();
    const root = starts(events, 'phone.stop_to_result');
    assert.equal(root.length, 1);
    assert.deepEqual(ending(events, root[0]).map((event) => event.outcome), ['cancelled']);
    const request = starts(events, 'phone.analysis_request')[0];
    assert.deepEqual(ending(events, request).map((event) => event.outcome), ['cancelled']);
    assert.ok(events.indexOf(ending(events, request)[0]) < events.indexOf(ending(events, root[0])[0]));
    assert.equal(events.some((event) => event.kind === 'failure'), false);
  } finally { env.restore(); }
});

test('dispose during processing closes the trace once and does not report an expected abort', async () => {
  const events = spySink();
  const pending = deferred();
  const env = browser((url, options) => {
    if (url === endpoints.upload) return Promise.resolve(uploadReply(options));
    options.signal.addEventListener('abort', () => pending.reject(new DOMException('Aborted', 'AbortError')), { once: true });
    return pending.promise;
  });
  try {
    const session = new SessionStore(storage());
    session.selectPassage('P01');
    const capture = new PhoneCapture(session, endpoints);
    await capture.start();
    const stopping = capture.stop();
    for (let i = 0; i < 10 && !starts(events, 'phone.analysis_request').length; i++) await new Promise((done) => setTimeout(done, 0));
    assert.equal(starts(events, 'phone.analysis_request').length, 1);
    capture.dispose();
    capture.dispose();
    await stopping;
    const root = starts(events, 'phone.stop_to_result');
    assert.equal(root.length, 1);
    assert.deepEqual(ending(events, root[0]).map((event) => event.outcome), ['cancelled']);
    const request = starts(events, 'phone.analysis_request')[0];
    assert.deepEqual(ending(events, request).map((event) => event.outcome), ['cancelled']);
    assert.ok(events.indexOf(ending(events, request)[0]) < events.indexOf(ending(events, root[0])[0]));
    assert.equal(events.some((event) => event.kind === 'failure'), false);
  } finally { env.restore(); }
});

test('late response from a canceled attempt cannot end a newer attempt span', async () => {
  const events = spySink();
  const requests = [];
  const env = browser((url, options) => {
    if (url === endpoints.upload) return Promise.resolve(uploadReply(options));
    const request = deferred();
    requests.push(request);
    return request.promise;
  });
  try {
    const session = new SessionStore(storage());
    session.selectPassage('P01');
    const capture = new PhoneCapture(session, endpoints);
    await capture.start();
    const oldStopping = capture.stop();
    for (let i = 0; i < 10 && requests.length < 1; i++) await new Promise((done) => setTimeout(done, 0));
    assert.equal(requests.length, 1);
    const oldRecord = session.records[0];
    capture.cancel();
    session.showLibrary();
    session.selectPassage('P02');
    await capture.start();
    const newStopping = capture.stop();
    for (let i = 0; i < 10 && requests.length < 2; i++) await new Promise((done) => setTimeout(done, 0));
    assert.equal(requests.length, 2);
    const newRequestSpan = starts(events, 'phone.analysis_request').at(-1);
    assert.equal(ending(events, newRequestSpan).length, 0);
    requests[0].resolve({ ok: true, json: async () => fixtureAnalysis(oldRecord, 'uncertain') });
    await oldStopping;
    assert.equal(ending(events, newRequestSpan).length, 0, 'stale response must not close new request');
    requests[1].resolve({ ok: true, json: async () => fixtureAnalysis(session.records[1], 'uncertain') });
    await newStopping;
    assert.deepEqual(ending(events, newRequestSpan).map((event) => event.outcome), ['ok']);
    capture.dispose();
  } finally { env.restore(); }
});

test('duplicate stop and terminal callbacks create one root span and one end', async () => {
  const events = spySink();
  const session = new SessionStore(storage());
  const env = browser(async (url, options) => url === endpoints.upload ? uploadReply(options) :
    ({ ok: true, json: async () => fixtureAnalysis(session.records[0], 'uncertain') }));
  try {
    session.selectPassage('P01');
    const capture = new PhoneCapture(session, endpoints);
    await capture.start();
    await Promise.all([capture.stop(), capture.stop()]);
    await capture.stop();
    capture.cancel();
    capture.dispose();
    const root = starts(events, 'phone.stop_to_result');
    assert.equal(root.length, 1);
    assert.deepEqual(ending(events, root[0]).map((event) => event.outcome), ['ok']);
    assert.equal(session.count(), 1);
  } finally { env.restore(); }
});

test('recorder stop rejection closes its child span before the root', async () => {
  const events = spySink();
  const env = browser(() => { throw new Error('unexpected fetch'); });
  env.Recorder.prototype.stop = function () { throw new Error('RECORDER_SENTINEL'); };
  try {
    const session = new SessionStore(storage());
    session.selectPassage('P01');
    const capture = new PhoneCapture(session, endpoints);
    await capture.start();
    await capture.stop();
    capture.dispose();
    const child = starts(events, 'phone.recorder_stop');
    const root = starts(events, 'phone.stop_to_result');
    assert.equal(child.length, 1);
    assert.equal(root.length, 1);
    assert.deepEqual(ending(events, child[0]).map((event) => event.outcome), ['error']);
    assert.deepEqual(ending(events, root[0]).map((event) => event.outcome), ['error']);
    assert.ok(events.indexOf(ending(events, child[0])[0]) < events.indexOf(ending(events, root[0])[0]));
    assert.deepEqual(failures(events, 'capture').map(({ code }) => code), ['recorder_stop_failed']);
    assert.doesNotMatch(JSON.stringify(events), /RECORDER_SENTINEL/);
  } finally { env.restore(); }
});

test('history save failure is reported with a fixed code and history reopen starts no process trace', () => {
  const events = spySink();
  const session = new SessionStore(storage(() => { throw new Error('HISTORY_SENTINEL'); }));
  session.selectPassage('P01');
  const record = session.start();
  session.stop();
  session.applyAnalysis(record.attemptId, fixtureAnalysis(record, 'uncertain'));
  assert.equal(session.count(), 1);
  assert.ok(failures(events, 'history').some((event) => event.code === 'storage_failed'));
  const traceCount = starts(events, 'phone.stop_to_result').length + starts(events, 'demo.stop_to_result').length;
  session.showHistory();
  session.openAttempt(record.attemptId);
  session.showHistory();
  assert.equal(starts(events, 'phone.stop_to_result').length + starts(events, 'demo.stop_to_result').length, traceCount);
  assert.doesNotMatch(JSON.stringify(events), /HISTORY_SENTINEL/);
});

test('artifact validation failure and retry produce separate traces for one saved attempt', async () => {
  const events = spySink();
  const session = new SessionStore(storage());
  let valid = false;
  const env = browser(async (url, options) => {
    if (url === endpoints.upload) {
      const reply = uploadReply(options);
      return { ok: true, json: async () => ({ ...await reply.json(), attemptId: valid
        ? session.records[0].attemptId : 'mismatched-attempt' }) };
    }
    return { ok: true, json: async () => fixtureAnalysis(session.records[0], 'uncertain') };
  });
  try {
    session.selectPassage('P01');
    const capture = new PhoneCapture(session, endpoints);
    await capture.start();
    await capture.stop();
    assert.equal(session.records[0].error?.stage, 'upload');
    valid = true;
    await capture.retry(session.records[0].attemptId);
    assert.equal(session.records.length, 1);
    assert.equal(session.records[0].processingStatus, 'result');
    const roots = starts(events, 'phone.stop_to_result');
    assert.equal(roots.length, 2);
    assert.deepEqual(roots.map(root => ending(events, root).map(end => end.outcome)), [['error'], ['ok']]);
    assert.equal(starts(events, 'phone.normalization').length, 1, 'retry reuses normalized audio');
    assert.deepEqual(starts(events, 'phone.upload_validation')
      .map(span => ending(events, span).map(end => end.outcome)), [['error'], ['ok']]);
    assert.deepEqual(failures(events, 'upload').map(event => event.code), ['invalid_response']);
    capture.dispose();
  } finally { env.restore(); }
});

test('failed temporary audio persistence is reported without blocking the result', async () => {
  const events = spySink();
  const session = new SessionStore(storage());
  const persistence = {
    warning: null,
    canReserveAudio: () => true,
    hasAudio: () => false,
    saveAudio: async () => { throw new Error('AUDIO_STORAGE_SENTINEL'); },
  };
  const env = browser(async (url, options) => url === endpoints.upload ? uploadReply(options) :
    ({ ok: true, json: async () => fixtureAnalysis(session.records[0], 'uncertain') }));
  try {
    session.selectPassage('P01');
    const capture = new PhoneCapture(session, endpoints, undefined, persistence);
    await capture.start();
    await capture.stop();
    assert.equal(session.records[0].processingStatus, 'result');
    assert.deepEqual(failures(events, 'storage').map(event => event.code), ['storage_failed']);
    const span = starts(events, 'phone.audio_persist')[0];
    assert.deepEqual(ending(events, span).map(end => end.outcome), ['error']);
    assert.doesNotMatch(JSON.stringify(events), /AUDIO_STORAGE_SENTINEL/);
    capture.dispose();
  } finally { env.restore(); }
});

test('late audio deletion failure cannot attach to a newer attempt trace', async () => {
  const events = spySink();
  const session = new SessionStore(storage());
  const oldDelete = deferred();
  const nextAnalysis = deferred();
  const persistence = {
    warning: null,
    canReserveAudio: () => true,
    hasAudio: id => id === session.records[0]?.attemptId,
    saveAudio: async () => {},
    deleteAudio: () => oldDelete.promise,
  };
  const env = browser(async (url, options) => {
    if (url === endpoints.upload) return uploadReply(options);
    if (url === endpoints.analysis && session.records.length === 2) return nextAnalysis.promise;
    return { ok: true, json: async () => fixtureAnalysis(session.records[0], 'uncertain') };
  });
  try {
    session.selectPassage('P01');
    const capture = new PhoneCapture(session, endpoints, undefined, persistence);
    await capture.start();
    const oldStopping = capture.stop();
    for (let i = 0; i < 20 && !persistence.hasAudio(session.records[0]?.attemptId); i++)
      await new Promise(resolve => setTimeout(resolve, 0));
    for (let i = 0; i < 20 && session.records[0]?.processingStatus !== 'result'; i++)
      await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(session.records[0].processingStatus, 'result');
    capture.cancel();
    session.showLibrary();
    session.selectPassage('P02');
    await capture.start();
    const newStopping = capture.stop();
    for (let i = 0; i < 20 && starts(events, 'phone.analysis_request').length < 2; i++)
      await new Promise(resolve => setTimeout(resolve, 0));
    const newRoot = starts(events, 'phone.stop_to_result')[1];
    assert.ok(newRoot);
    oldDelete.reject(new Error('DELETION_SENTINEL'));
    await oldStopping;
    assert.equal(ending(events, newRoot).length, 0);
    assert.equal(failures(events, 'storage').length, 0);
    assert.doesNotMatch(session.storageWarning ?? '', /removed/);
    nextAnalysis.resolve({ ok: true, json: async () => fixtureAnalysis(session.records[1], 'uncertain') });
    await newStopping;
    assert.deepEqual(ending(events, newRoot).map(end => end.outcome), ['ok']);
    assert.doesNotMatch(JSON.stringify(events), /DELETION_SENTINEL/);
    capture.dispose();
  } finally { env.restore(); }
});

test('asynchronous history persistence failure closes its span and reports a fixed code', async () => {
  const events = spySink();
  const session = new SessionStore(storage());
  const persistence = {
    warning: null,
    load: async () => null,
    save: async () => { throw new Error('HISTORY_ASYNC_SENTINEL'); },
  };
  await session.hydrate(persistence);
  session.selectPassage('P01');
  session.start();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(starts(events, 'app.history_persist').length > 0);
  assert.ok(starts(events, 'app.history_persist').every(span =>
    ending(events, span).some(end => end.outcome === 'error')));
  assert.ok(failures(events, 'history').some(event => event.code === 'storage_failed'));
  assert.doesNotMatch(JSON.stringify(events), /HISTORY_ASYNC_SENTINEL/);
});

test('telemetry span lifecycle is explicit and demo work is tagged simulated', () => {
  const events = spySink();
  const demo = beginTelemetrySpan('demo.stop_to_result', undefined, 'demo');
  endTelemetrySpan(demo, 'ok');
  assert.deepEqual(starts(events, 'demo.stop_to_result').map((event) => event.source), ['demo']);
  assert.deepEqual(ending(events, starts(events, 'demo.stop_to_result')[0]).map((event) => event.outcome), ['ok']);
});
