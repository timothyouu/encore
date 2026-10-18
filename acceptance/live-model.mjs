/** Opt-in real HTTP acceptance. Requires running services and one generated P01 wrong-note WAV. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { SessionStore } from '../mobile/src/session.ts';
import { passages } from '../mobile/src/passages.ts';
import { groundedVisualPlan } from '../mobile/src/paper-evidence.ts';

if (process.argv[2] !== '--live' || !process.argv[3]) {
  throw new Error('Explicit opt-in required: node --experimental-strip-types acceptance/live-model.mjs --live .run/model-e2e-wrong.wav');
}
const base = 'http://127.0.0.1:8788';
const health = await (await fetch(base + '/health')).json();
assert.equal(health.modelConfigured, true, 'Live acceptance requires configured Gemini');
const bytes = await readFile(process.argv[3]);
assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
assert.equal(bytes.readUInt32LE(24), 22050);
assert.equal(bytes.readUInt16LE(22), 1);
assert.equal(bytes.readUInt16LE(34), 16);
let saved = null;
const storage = { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
const store = new SessionStore(storage);
store.selectPassage('P01');
store.start('test');
const record = store.stop();
const passage = passages.find(item => item.id === record.passageId);
const identity = { attemptId: record.attemptId, passageId: record.passageId, passageVersion: record.passageVersion };
async function post(path, payload) {
  const response = await fetch(base + '/v1/' + path, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(90_000),
  });
  assert.equal(response.status, 200, `${path} failed with HTTP ${response.status}; no automatic retry`);
  return response.json();
}
const started = performance.now();
const receipt = await post('recordings', { metadata: {
  ...identity, attemptTempoBpm: passage.tempoBpm, sourceSampleRate: 22050,
  sampleRate: 22050, channels: 1, encoding: 'pcm_s16le',
  durationSec: bytes.readUInt32LE(40) / 44100, captureSource: 'test',
}, wavBase64: bytes.toString('base64') });
const analysis = await post('analyze', { ...identity, artifactId: receipt.artifactId });
assert.equal(store.applyAnalysis(record.attemptId, analysis), true, 'Phone must accept measured analysis');
assert.equal(analysis.status, 'ok');
assert.match(analysis.detectorVersion, /basic-pitch/);
const wrong = analysis.findings.find(f => f.kind === 'wrong_note' && f.referenceNoteId === 'P01-N03');
assert.ok(wrong, 'Controlled E4-to-F4 error must be detected');
const coaching = await post('coach', { artifactId: receipt.artifactId,
  passageId: record.passageId, passageVersion: record.passageVersion, analysis });
assert.equal(coaching.coachingSource, 'gemini', 'Fallback is not live model success');
assert.equal(store.applyCoaching(record.attemptId, coaching), true, 'Phone must accept real model-derived JSON');
assert.equal(coaching.evidenceFindingIds[0], wrong.id);
assert.equal(groundedVisualPlan(coaching.visualPlan, analysis, passage, wrong.id), true);
assert.equal(store.state.screen, 'review');
store.showGuide();
assert.equal(store.state.screen, 'guide');
const restored = new SessionStore(storage);
restored.showHistory();
restored.openAttempt(record.attemptId);
assert.equal(restored.state.screen, 'review');
assert.deepEqual(restored.current().coaching, coaching, 'History must preserve validated visuals');
const report = { passed: true, input: 'Generated harmonic tones with E4 changed to F4; not live piano',
  attemptId: record.attemptId, detector: analysis.detectorVersion, coachingSource: coaching.coachingSource,
  selectedFinding: wrong, cue: coaching.cue, visualKind: coaching.visual.kind,
  phoneAccepted: true, historyReplay: true, elapsedSec: Number(((performance.now() - started) / 1000).toFixed(2)) };
await mkdir(new URL('../.run/', import.meta.url), { recursive: true });
await writeFile(new URL('../.run/live-model-report.json', import.meta.url), JSON.stringify(report, null, 2));
await writeFile(new URL('../.run/live-model-response.json', import.meta.url), JSON.stringify({ analysis, coaching }, null, 2));
console.log(JSON.stringify(report, null, 2));
