/** Offline synthetic G2-format capture through the actual /api HTTP service and Basic Pitch. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { normalizeChannels } from '../mobile/src/audio-normalization.ts';

const base = process.argv[2] ?? 'http://127.0.0.1:8800';
const configuredOrigin = JSON.parse(readFileSync(new URL('../g2/service-origin.json', import.meta.url), 'utf8')).origin;
const target = new URL(base);
assert.ok(target.origin === base && (base === configuredOrigin ||
  (target.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))),
  'Use the configured HTTPS service or an isolated loopback backend');
const health = await fetch(base + '/health', { redirect: 'error' });
assert.equal(health.status, 200, 'backend health');
assert.equal((await health.json()).modelConfigured, false, 'fixture runner requires offline coaching');
const tokenPath = process.argv[3] ?? process.env.ENCORE_DEVICE_TOKEN_FILE ?? new URL('../.run/device-session-token', import.meta.url);
const token = readFileSync(tokenPath, 'utf8').trim();
const clientOrigin = process.env.ENCORE_DEVICE_ORIGIN ?? 'http://localhost:5196';
assert.ok(token.length >= 32, 'local session token must be available');
const passage = JSON.parse(readFileSync(new URL('../shared/passages.json', import.meta.url), 'utf8'))[0];
const sampleRate = 16000;
const source = new Float32Array(sampleRate * 10);
for (const note of passage.notes) {
  const start = Math.round((0.7 + note.onsetBeat * 60 / passage.tempoBpm) * sampleRate);
  const length = Math.round(note.durationBeats * 60 / passage.tempoBpm * 0.75 * sampleRate);
  const frequency = 440 * 2 ** ((note.midiPitch - 69) / 12);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const envelope = Math.min(1, t / 0.02) * Math.exp(-2.2 * t);
    source[start + i] += 0.22 * (Math.sin(2 * Math.PI * frequency * t) +
      0.3 * Math.sin(4 * Math.PI * frequency * t)) * envelope;
  }
}
const normalized = normalizeChannels([source], sampleRate);
const wav = Buffer.from(normalized.wav);
assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
assert.equal(wav.readUInt32LE(24), 22050);
assert.equal(wav.readUInt32LE(40), 22050 * 10 * 2);
assert.equal(normalized.sourceSampleRate, 16000);
const attemptId = randomUUID();
const identity = { attemptId, passageId: passage.id, passageVersion: passage.version };
const metadata = { ...identity, attemptTempoBpm: passage.tempoBpm,
  sourceSampleRate: normalized.sourceSampleRate, sampleRate: normalized.sampleRate,
  channels: normalized.channels, encoding: normalized.encoding,
  durationSec: normalized.durationSec, captureSource: 'g2' };
async function post(route, body) {
  const started = performance.now();
  const response = await fetch(base + '/api/' + route, { method: 'POST', redirect: 'error',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, origin: clientOrigin },
    body: JSON.stringify(body) });
  const payload = await response.json();
  assert.equal(response.status, 200, route + ' HTTP ' + response.status + ' ' + JSON.stringify(payload));
  return { payload, elapsedMs: Math.round(performance.now() - started) };
}
const uploadBody = { metadata, wavBase64: wav.toString('base64') };
const upload = await post('recordings', uploadBody);
assert.equal(upload.payload.sha256, createHash('sha256').update(wav).digest('hex'));
assert.equal(upload.payload.captureSource, 'g2');
const repeat = await post('recordings', uploadBody);
assert.equal(repeat.payload.artifactId, upload.payload.artifactId);
const analysis = await post('analyze', { ...identity, artifactId: upload.payload.artifactId });
assert.equal(analysis.payload.attemptId, attemptId);
assert.equal(analysis.payload.status, 'ok');
assert.equal(analysis.payload.metrics.matchedNotes, passage.notes.length);
const coach = await post('coach', { artifactId: upload.payload.artifactId,
  passageId: passage.id, passageVersion: passage.version, analysis: analysis.payload });
assert.equal(coach.payload.attemptId, attemptId);
assert.ok(['fallback', 'analysis_only'].includes(coach.payload.coachingSource));
assert.ok(Array.isArray(coach.payload.visual.mistakes));
console.log(JSON.stringify({ status: 'PASS', input: 'synthetic 16 kHz G2-like PCM; no hardware capture',
  base, attemptId, wavBytes: wav.length, sha256: upload.payload.sha256,
  matchedNotes: analysis.payload.metrics.matchedNotes, coachingSource: coach.payload.coachingSource,
  duplicateArtifact: true, timingMs: { upload: upload.elapsedMs, duplicate: repeat.elapsedMs,
    analysis: analysis.elapsedMs, coaching: coach.elapsedMs } }));
