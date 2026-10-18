import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RecordingMetadata } from './contracts.js';
import { ArtifactStore, HARD_TTL_MS, RETRY_GRACE_MS, parseRecording } from './recordings.js';

const metadata: RecordingMetadata = {
  attemptId: 'a1', passageId: 'P01', passageVersion: '1', attemptTempoBpm: 60,
  sourceSampleRate: 22050, sampleRate: 22050, channels: 1,
  encoding: 'pcm_s16le', durationSec: 1, captureSource: 'test'
};

test('idle timer purges completed WAV after fixed grace without extending upload expiry', () => {
  let now = 1_000;
  const timers: { due: number; cancelled: boolean; run: () => void }[] = [];
  const store = new ArtifactStore(() => now, (run, delayMs) => {
    const timer = { due: now + delayMs, cancelled: false, run };
    timers.push(timer);
    return { cancel: () => { timer.cancelled = true; } };
  });
  const advance = (elapsed: number): void => {
    now += elapsed;
    for (;;) {
      const due = timers.find(timer => !timer.cancelled && timer.due <= now);
      if (!due) break;
      due.cancelled = true;
      due.run();
    }
  };
  const bytes = Buffer.from('same WAV identity');
  const first = store.put(metadata, bytes, 'http://127.0.0.1');
  advance(2_000);
  const duplicate = store.put(metadata, bytes, 'http://127.0.0.1');
  assert.equal(duplicate.artifactId, first.artifactId);
  assert.equal(duplicate.expiresAt, first.expiresAt);
  const artifact = store.get(first.artifactId);
  assert.ok(artifact);
  store.complete(artifact, 'skipped');
  advance(30_000);
  store.complete(artifact, 'completed');
  assert.equal(artifact.purgeAt, 3_000 + RETRY_GRACE_MS, 'late coach response cannot renew grace');
  advance(30_001);
  assert.equal(store.get(first.artifactId), undefined);
  assert.equal(store.put(metadata, bytes, 'http://127.0.0.1').artifactId === first.artifactId, false);
  store.dispose();
  assert.equal(timers.some(timer => !timer.cancelled), false);
});

test('hard upload expiry purges a pending consumer and releases its attempt ID', () => {
  let now = 5_000;
  const store = new ArtifactStore(() => now);
  const bytes = Buffer.from('pending WAV');
  const first = store.put(metadata, bytes, 'http://127.0.0.1');
  const artifact = store.get(first.artifactId);
  assert.ok(artifact);
  artifact.analysisPromise = new Promise<never>(() => {});
  now += HARD_TTL_MS;
  store.cleanup();
  assert.equal(store.get(first.artifactId), undefined);
  assert.notEqual(store.put(metadata, bytes, 'http://127.0.0.1').artifactId, first.artifactId);
  store.dispose();
});

test('uploads accept G2 as a capture source and reject unknown sources', () => {
  const samples = 22050;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0, 'ascii'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii'); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(22050, 24); wav.writeUInt32LE(44100, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii'); wav.writeUInt32LE(samples * 2, 40);
  const library = [{ id: 'P01', version: '1' }] as Parameters<typeof parseRecording>[1];
  const body = (captureSource: string) => ({ metadata: { ...metadata, captureSource }, wavBase64: wav.toString('base64') });
  assert.equal(parseRecording(body('g2'), library).metadata.captureSource, 'g2');
  assert.throws(() => parseRecording(body('glasses'), library), /captureSource invalid/);
});
