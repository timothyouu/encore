import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioMeter, WAVEFORM_BARS, waveformLevels } from '../src/audio-meter.ts';

test('waveform follows input amplitude and silence stays flat', () => {
  assert.deepEqual(waveformLevels(new Float32Array(2_048)), Array(WAVEFORM_BARS).fill(0));
  const quiet = waveformLevels(new Float32Array(2_048).fill(0.02));
  const loud = waveformLevels(new Float32Array(2_048).fill(0.5));
  assert.equal(quiet.length, WAVEFORM_BARS);
  assert.ok(quiet.every(level => level > 0 && level < 0.1));
  assert.ok(loud.every((level, index) => level > quiet[index]));
  assert.deepEqual(waveformLevels(new Float32Array(2_048).fill(0.002)), Array(WAVEFORM_BARS).fill(0));
});

test('meter observes the provided stream without output, then releases graph on disposal', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const stream = { getTracks() { throw new Error('meter must not manage microphone tracks'); } };
  const observed = { source: null, outputConnections: 0, sourceDisconnects: 0, analyserDisconnects: 0, closes: 0, level: 0 };
  class FakeContext {
    state = 'running';
    createMediaStreamSource(value) {
      observed.source = value;
      return { connect: () => { observed.outputConnections++; }, disconnect: () => { observed.sourceDisconnects++; } };
    }
    createAnalyser() {
      return { fftSize: 0, smoothingTimeConstant: 1,
        getFloatTimeDomainData: samples => samples.fill(observed.level),
        disconnect: () => { observed.analyserDisconnects++; } };
    }
    close() { observed.closes++; this.state = 'closed'; return Promise.resolve(); }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeContext });
  try {
    const meter = AudioMeter.create(stream);
    assert.ok(meter);
    assert.equal(observed.source, stream);
    assert.equal(observed.outputConnections, 1);
    assert.equal(meter.sample().every(level => level === 0), true);
    observed.level = 0.25;
    assert.ok(meter.sample().every(level => level > 0));
    meter.dispose();
    meter.dispose();
    assert.equal(meter.sample(), null);
    assert.equal(observed.sourceDisconnects, 1);
    assert.equal(observed.analyserDisconnects, 1);
    assert.equal(observed.closes, 1);
  } finally {
    if (original) Object.defineProperty(globalThis, 'AudioContext', original);
    else delete globalThis.AudioContext;
  }
});

test('meter creation and cleanup failures do not block recording', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  let closed = 0;
  class BrokenContext {
    state = 'running';
    createMediaStreamSource() { return { connect: () => { throw new Error('bad graph'); }, disconnect: () => { throw new Error('bad disconnect'); } }; }
    createAnalyser() { return { fftSize: 0, smoothingTimeConstant: 0, disconnect: () => { throw new Error('bad disconnect'); } }; }
    close() { closed++; return Promise.resolve(); }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: BrokenContext });
  try {
    assert.equal(AudioMeter.create({}), null);
    assert.equal(closed, 1);
  } finally {
    if (original) Object.defineProperty(globalThis, 'AudioContext', original);
    else delete globalThis.AudioContext;
  }
});
import { PhoneCapture } from '../src/capture.ts';
import { SessionStore } from '../src/session.ts';

test('capture samples its own microphone stream and releases meter on stop, cancel, and dispose', async () => {
  const originals = new Map(['navigator', 'MediaRecorder', 'AudioContext'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const contexts = [];
  const streams = [];
  let level = 0;
  class FakeAudioContext {
    state = 'running';
    sourceDisconnected = false;
    analyserDisconnected = false;
    closed = false;
    constructor() { contexts.push(this); }
    createMediaStreamSource(stream) {
      this.stream = stream;
      return { connect: analyser => { this.connectedTo = analyser; },
        disconnect: () => { this.sourceDisconnected = true; } };
    }
    createAnalyser() {
      return { fftSize: 0, smoothingTimeConstant: 1,
        getFloatTimeDomainData: samples => samples.fill(level),
        disconnect: () => { this.analyserDisconnected = true; } };
    }
    close() { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
  }
  class FakeRecorder extends EventTarget {
    static isTypeSupported() { return true; }
    constructor() { super(); this.mimeType = 'audio/webm'; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; queueMicrotask(() => this.dispatchEvent(new Event('stop'))); }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeAudioContext });
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: FakeRecorder });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => {
    const track = new EventTarget();
    track.stopped = false;
    track.stop = () => { track.stopped = true; };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track], track };
    streams.push(stream);
    return stream;
  } } } });
  const makeCapture = () => {
    const store = new SessionStore({ getItem() { return null; }, setItem() {} });
    store.selectPassage('P01');
    return new PhoneCapture(store, { upload: '/api/recordings', analysis: '/api/analyze', coaching: '/api/coach' });
  };
  try {
    const stopped = makeCapture();
    await stopped.start();
    assert.equal(contexts[0].stream, streams[0]);
    assert.equal(contexts[0].connectedTo !== undefined, true);
    assert.equal(stopped.getWaveform().every(value => value === 0), true);
    level = 0.3;
    assert.ok(stopped.getWaveform().every(value => value > 0));
    await stopped.stop();
    assert.equal(stopped.getWaveform(), null);
    assert.equal(streams[0].track.stopped, true);
    assert.equal(contexts[0].sourceDisconnected, true);
    assert.equal(contexts[0].analyserDisconnected, true);
    assert.equal(contexts[0].closed, true);
    stopped.dispose();

    const canceled = makeCapture();
    await canceled.start();
    canceled.cancel();
    assert.equal(canceled.getWaveform(), null);
    assert.equal(streams[1].track.stopped, true);
    assert.equal(contexts[1].closed, true);
    canceled.dispose();

    const disposed = makeCapture();
    await disposed.start();
    disposed.dispose();
    assert.equal(disposed.getWaveform(), null);
    assert.equal(streams[2].track.stopped, true);
    assert.equal(contexts[2].closed, true);
  } finally {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});

test('disconnect errors during disposal still close the audio context', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  let closed = 0;
  class BrokenDisconnectContext {
    state = 'running';
    createMediaStreamSource() { return { connect() {}, disconnect() { throw new Error('source disconnected'); } }; }
    createAnalyser() { return { fftSize: 0, smoothingTimeConstant: 0,
      getFloatTimeDomainData: samples => samples.fill(0), disconnect() { throw new Error('analyser disconnected'); } }; }
    close() { closed++; return Promise.resolve(); }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: BrokenDisconnectContext });
  try {
    const meter = AudioMeter.create({});
    assert.ok(meter);
    assert.doesNotThrow(() => meter.dispose());
    assert.equal(closed, 1);
  } finally {
    if (original) Object.defineProperty(globalThis, 'AudioContext', original);
    else delete globalThis.AudioContext;
  }
});
