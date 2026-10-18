import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RecordingMetadata } from './contracts.js';
import { ArtifactStore, HARD_TTL_MS, RETRY_GRACE_MS } from './recordings.js';

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
