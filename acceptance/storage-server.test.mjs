import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoachServer, loadLibrary } from '../server/src/http.ts';
import { normalizeChannels } from '../mobile/src/audio-normalization.ts';

const library = await loadLibrary();
const audio = normalizeChannels([new Float32Array(22050)], 22050);
const bytes = Buffer.from(audio.wav);
const metadata = { attemptId: 'storage-acceptance', passageId: 'P01', passageVersion: '1', attemptTempoBpm: 60,
  sourceSampleRate: 22050, sampleRate: 22050, channels: 1, encoding: 'pcm_s16le', durationSec: 1, captureSource: 'test' };
const analysis = { schemaVersion: '1', attemptId: metadata.attemptId, passageId: 'P01', passageVersion: '1',
  attemptTempoBpm: 60, status: 'ok', detectorVersion: 'acceptance', scoringVersion: 'acceptance',
  audioQuality: { clipped: false, hasDropouts: false, warnings: [] }, alignment: { offsetSec: 0, reliable: true },
  detectedNotes: [{ id: 'd1', midiPitch: 61, onsetSec: 0, durationSec: 1 }],
  findings: [{ id: 'f1', kind: 'wrong_note', referenceNoteId: 'P01-N01', detectedNoteId: 'd1' }],
  metrics: { matchedNotes: 7, expectedNotes: 8, medianAbsTimingErrorMs: 0 } };

async function harness(t, status = 'ok') {
  let now = 1_800_000_000_000, detectorCalls = 0, coachCalls = 0;
  const server = createCoachServer({ library, token: 'acceptance-only', now: () => now,
    fetchImpl: async (_url, init) => {
      detectorCalls++;
      assert.deepEqual(Buffer.from(await init.body.get('audio').arrayBuffer()), bytes);
      return new Response(JSON.stringify({ ...analysis, status }), { status: 200 });
    },
    chooser: async (_prompt, wav) => {
      coachCalls++; assert.deepEqual(Buffer.from(wav), bytes);
      return { findingId: 'f1', actionId: 'slow_key', visualKind: 'keyboard' };
    } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: {
    authorization: 'Bearer acceptance-only', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const upload = () => post('/v1/recordings', { metadata, wavBase64: bytes.toString('base64') });
  const getAudio = receipt => fetch(receipt.audioUrl, { headers: { authorization: 'Bearer acceptance-only' } });
  return { post, upload, getAudio, advance: ms => { now += ms; }, calls: () => [detectorCalls, coachCalls] };
}

test('fixed acceptance: duplicate upload does not renew expiry; expiry allows same-attempt recovery', async t => {
  const h = await harness(t);
  const first = await (await h.upload()).json();
  h.advance(120000);
  const second = await (await h.upload()).json();
  assert.equal(second.artifactId, first.artifactId);
  assert.equal(second.expiresAt, first.expiresAt);
  h.advance(480001);
  assert.equal((await h.getAudio(first)).status, 410);
  const restored = await (await h.upload()).json();
  assert.equal(restored.attemptId, first.attemptId);
  assert.notEqual(restored.artifactId, first.artifactId);
});

test('fixed acceptance: bytes survive analysis and are removed after both consumers plus grace', async t => {
  const h = await harness(t);
  const receipt = await (await h.upload()).json();
  const fields = { artifactId: receipt.artifactId, attemptId: metadata.attemptId, passageId: 'P01', passageVersion: '1' };
  const analyzed = await (await h.post('/v1/analyze', fields)).json();
  h.advance(61000);
  assert.equal((await h.getAudio(receipt)).status, 200, 'analysis alone must not delete WAV');
  const coached = await h.post('/v1/coach', { ...fields, analysis: analyzed });
  assert.equal(coached.status, 200);
  assert.equal((await h.post('/v1/coach', { ...fields, analysis: analyzed })).status, 200);
  assert.deepEqual(h.calls(), [1, 1], 'response retries must reuse cached computations');
  h.advance(60001);
  assert.equal((await h.getAudio(receipt)).status, 410);
});

test('fixed acceptance: terminal uncertain analysis needs no coach and expires after grace', async t => {
  const h = await harness(t, 'uncertain');
  const receipt = await (await h.upload()).json();
  assert.equal((await h.post('/v1/analyze', { artifactId: receipt.artifactId, ...metadata })).status, 200);
  h.advance(60001);
  assert.equal((await h.getAudio(receipt)).status, 410);
  assert.deepEqual(h.calls(), [1, 0]);
});

test('fixed acceptance: technical analysis result retains audio for explicit retry', async t => {
  const h = await harness(t, 'error');
  const receipt = await (await h.upload()).json();
  await h.post('/v1/analyze', { artifactId: receipt.artifactId, ...metadata });
  h.advance(60001);
  assert.equal((await h.getAudio(receipt)).status, 200);
  h.advance(540000);
  assert.equal((await h.getAudio(receipt)).status, 410);
});

test('fixed acceptance: audio requires server authorization', async t => {
  const h = await harness(t);
  const receipt = await (await h.upload()).json();
  assert.equal((await fetch(receipt.audioUrl)).status, 401);
  assert.equal((await h.getAudio(receipt)).headers.get('cache-control'), 'no-store');
});