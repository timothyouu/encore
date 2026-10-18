import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { GenerateContentParameters, GoogleGenAI, Content } from '@google/genai';
import { coach, createGeminiChooser, validateChoice } from './coaching.js';
import { createCoachServer, loadLibrary } from './http.js';
import type { AnalysisResult, Passage, RecordingMetadata } from './contracts.js';
import { InputError, parseCoachRequest } from './validation.js';

const library: Passage[] = await loadLibrary();
const metadata: RecordingMetadata = {
  attemptId: 'attempt-1', passageId: 'P01', passageVersion: '1', attemptTempoBpm: 60,
  sourceSampleRate: 48000, sampleRate: 22050, channels: 1,
  encoding: 'pcm_s16le', durationSec: 1, captureSource: 'test'
};
function wav(): Buffer {
  const bytes = Buffer.alloc(44 + 44100);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(22050, 24); bytes.writeUInt32LE(44100, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(44100, 40);
  return bytes;
}
function analysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    schemaVersion: '1', attemptId: 'attempt-1', passageId: 'P01', passageVersion: '1',
    attemptTempoBpm: 60, status: 'ok', detectorVersion: 'test', scoringVersion: 'test',
    audioQuality: { clipped: false, hasDropouts: false, warnings: [] },
    alignment: { offsetSec: 0, reliable: true },
    detectedNotes: [{ id: 'd1', midiPitch: 61, onsetSec: 0, durationSec: 1 }],
    findings: [{ id: 'f1', kind: 'wrong_note', referenceNoteId: 'P01-N01', detectedNoteId: 'd1' }],
    metrics: { matchedNotes: 7, expectedNotes: 8, medianAbsTimingErrorMs: 0 }, ...overrides
  };
}
async function serve(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return 'http://127.0.0.1:' + String((server.address() as AddressInfo).port);
}
async function close(server: Server): Promise<void> {
  await new Promise<void>(resolve => server.close(() => resolve()));
}
async function post(base: string, path: string, body: unknown, token = true): Promise<Response> {
  return fetch(base + path, { method: 'POST', headers: {
    'content-type': 'application/json', ...(token ? { authorization: 'Bearer test-token' } : {})
  }, body: JSON.stringify(body) });
}
test('validated findings retain exact reference and duration evidence', async () => {
  const raw = { artifactId: 'artifact-1', passageId: 'P01', passageVersion: '1', analysis: analysis() };
  assert.throws(() => parseCoachRequest({ ...raw, analysis: analysis({ findings: [{ id: 'f1', kind: 'missing_note', referenceNoteId: 'P99-N01' }] }) }, library), InputError);
  const parsed = parseCoachRequest(raw, library);
  const result = await coach(parsed.request, parsed.passage, wav(), async () => ({ findingId: 'f1', actionId: 'slow_key', visualKind: 'keyboard' }));
  assert.deepEqual(result.visual.mistakes, [{ findingId: 'f1', referenceNoteId: 'P01-N01', detectedNoteId: 'd1' }]);
  assert.equal(result.visual.referenceNoteIds[0], 'P01-N01');
  assert.match(result.cue, /Expected C4, heard C#4/);
  const duration = parseCoachRequest({ ...raw, analysis: analysis({ findings: [{ id: 'f2', kind: 'duration', referenceNoteId: 'P01-N01', detectedNoteId: 'd1', durationDeltaMs: -300 }] }) }, library);
  const held = await coach(duration.request, duration.passage, wav(), async () => ({ findingId: 'f2', actionId: 'hold_length', visualKind: 'rhythm_strip' }));
  assert.match(held.cue, /300 ms too short/);
  assert.equal(validateChoice({ findingId: 'invented', actionId: 'slow_key', visualKind: 'keyboard' }, analysis()), null);
  assert.equal(validateChoice({ findingId: 'f1', actionId: 'claim_fingering', visualKind: 'keyboard' }, analysis()), null);
  assert.equal(validateChoice({ findingId: 'f1', actionId: 'slow_key', visualKind: 'rhythm_strip' }, analysis()), null);
  const noVisual = await coach(parsed.request, parsed.passage, wav(), async () => ({ findingId: 'f1', actionId: 'slow_key', visualKind: 'none' }));
  assert.deepEqual(noVisual.visual.mistakes, []);
  assert.deepEqual(noVisual.visual.referenceNoteIds, []);
});
test('uncertain audio suppresses model and visual mistakes', async () => {
  const parsed = parseCoachRequest({ artifactId: 'x', passageId: 'P01', passageVersion: '1', analysis: analysis({ status: 'uncertain' }) }, library);
  const result = await coach(parsed.request, parsed.passage, wav(), async () => { throw new Error('unexpected'); });
  assert.deepEqual(result.visual.mistakes, []);
  assert.equal(result.coachingSource, 'analysis_only');
  const clipped = parseCoachRequest({ artifactId: 'x', passageId: 'P01', passageVersion: '1',
    analysis: analysis({ audioQuality: { clipped: true, hasDropouts: false, warnings: [] } }) }, library);
  const retry = await coach(clipped.request, clipped.passage, wav(), async () => { throw new Error('unexpected'); });
  assert.equal(retry.visual.kind, 'none');
  assert.deepEqual(retry.evidenceFindingIds, []);
});
test('upload stores actual WAV; analysis and coach each receive identical bytes; retries coalesce', async () => {
  const bytes = wav();
  let upstreamCalls = 0;
  let chooserCalls = 0;
  const fetchImpl = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    upstreamCalls++;
    assert.ok(init?.body instanceof FormData);
    const audio = init.body.get('audio');
    assert.ok(audio instanceof Blob);
    assert.deepEqual(Buffer.from(await audio.arrayBuffer()), bytes);
    assert.deepEqual(JSON.parse(String(init.body.get('metadata'))), metadata);
    return new Response(JSON.stringify(analysis()), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const chooser = async (_prompt: string, given: Uint8Array): Promise<unknown> => {
    chooserCalls++;
    assert.deepEqual(Buffer.from(given), bytes);
    return { findingId: 'f1', actionId: 'slow_key', visualKind: 'keyboard' };
  };
  const server = createCoachServer({ library, chooser, fetchImpl: fetchImpl as typeof fetch, token: 'test-token' });
  const base = await serve(server);
  try {
    assert.equal((await post(base, '/v1/recordings', {}, false)).status, 401);
    const upload = { metadata, wavBase64: bytes.toString('base64') };
    const first = await (await post(base, '/v1/recordings', upload)).json() as { artifactId: string; audioUrl: string; sha256: string };
    const second = await (await post(base, '/v1/recordings', upload)).json() as { artifactId: string };
    assert.equal(second.artifactId, first.artifactId);
    assert.equal((await post(base, '/v1/recordings', { ...upload, metadata: { ...metadata, attemptTempoBpm: 70 } })).status, 409);
    const audioResponse = await fetch(first.audioUrl, { headers: { authorization: 'Bearer test-token' } });
    assert.deepEqual(Buffer.from(await audioResponse.arrayBuffer()), bytes);
    const ref = { artifactId: first.artifactId, attemptId: metadata.attemptId, passageId: 'P01', passageVersion: '1' };
    const results = await Promise.all([post(base, '/v1/analyze', ref), post(base, '/v1/analyze', ref)]);
    assert.equal(upstreamCalls, 1);
    const measured = await results[0].json() as AnalysisResult;
    assert.equal(results[1].status, 200);
    const coachBody = { artifactId: first.artifactId, passageId: 'P01', passageVersion: '1', analysis: measured };
    const coaching = await Promise.all([post(base, '/v1/coach', coachBody), post(base, '/v1/coach', coachBody)]);
    assert.equal(chooserCalls, 1);
    assert.equal(coaching[0].status, 200);
    assert.equal(coaching[1].status, 200);
    assert.equal((await post(base, '/v1/coach', { ...coachBody, analysis: analysis({ attemptTempoBpm: 70 }) })).status, 409);
  } finally { await close(server); }
});
test('rejects malformed WAV and expires artifact with manual clock', async () => {
  let now = 1_000;
  const server = createCoachServer({ library, chooser: null, now: () => now });
  const base = await serve(server);
  try {
    const bytes = wav();
    const wrongHeader = Buffer.from(bytes); wrongHeader.writeUInt32LE(48000, 24);
    assert.equal((await post(base, '/v1/recordings', { metadata, wavBase64: wrongHeader.toString('base64') })).status, 400);
    const first = await (await post(base, '/v1/recordings', { metadata, wavBase64: bytes.toString('base64') })).json() as { artifactId: string };
    now += 10 * 60 * 1000;
    assert.equal((await post(base, '/v1/analyze', { artifactId: first.artifactId, attemptId: 'attempt-1', passageId: 'P01', passageVersion: '1' })).status, 410);
  } finally { await close(server); }
});
test('Strands GoogleModel streaming request contains inline WAV bytes', async () => {
  let captured: GenerateContentParameters | undefined;
  const fake = { models: { generateContentStream: async (params: GenerateContentParameters): Promise<never> => {
    captured = params;
    throw new Error('test stop before network');
  } } } as unknown as GoogleGenAI;
  const chooser = createGeminiChooser('test-only', 'gemini-2.5-flash', fake);
  const bytes = wav();
  await assert.rejects(() => chooser('Select one evidence-backed finding.', bytes, new AbortController().signal));
  assert.ok(captured);
  const contents = captured.contents as Content[];
  const parts = contents[contents.length - 1].parts ?? [];
  const inline = parts.find(part => part.inlineData?.mimeType === 'audio/wav')?.inlineData;
  assert.ok(inline?.data);
  assert.deepEqual(Buffer.from(inline.data, 'base64'), bytes);
});
test('Strands GoogleModel accepts a streamed Gemini choice with attached WAV', async () => {
  const bytes = wav();
  let captured: GenerateContentParameters | undefined;
  const fake = { models: { generateContentStream: async (params: GenerateContentParameters) => {
    captured = params;
    return (async function* () {
      yield { candidates: [{ content: { parts: [{ text: JSON.stringify({
        findingId: 'f1', actionId: 'slow_key', visualKind: 'keyboard'
      }) }] }, finishReason: 'STOP' }] };
    })();
  } } } as unknown as GoogleGenAI;
  const chooser = createGeminiChooser('test-only', 'gemini-2.5-flash', fake);
  const choice = await chooser('Select one supported finding.', bytes, new AbortController().signal);
  assert.deepEqual(choice, { findingId: 'f1', actionId: 'slow_key', visualKind: 'keyboard' });
  assert.ok(captured);
  const contents = captured.contents as Content[];
  const parts = contents[contents.length - 1].parts ?? [];
  const inline = parts.find(part => part.inlineData?.mimeType === 'audio/wav')?.inlineData;
  assert.ok(inline?.data);
  assert.deepEqual(Buffer.from(inline.data, 'base64'), bytes);
});
test('origin, auth, and input gates remain active', async () => {
  const server = createCoachServer({ library, chooser: null, token: 'test-token', allowedOrigin: 'http://localhost:5176' });
  const base = await serve(server);
  try {
    const health = await fetch(base + '/health');
    assert.deepEqual(await health.json(), { ok: true, passageLibraryReady: true, modelConfigured: false });
    const denied = await fetch(base + '/v1/recordings', { method: 'POST', headers: {
      origin: 'http://evil.test', authorization: 'Bearer test-token', 'content-type': 'application/json'
    }, body: '{}' });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
    const preflight = await fetch(base + '/v1/recordings', { method: 'OPTIONS', headers: { origin: 'http://localhost:5176' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:5176');
    assert.equal((await post(base, '/v1/recordings', { metadata, wavBase64: wav().toString('base64') }, false)).status, 401);
    const invalid = await fetch(base + '/v1/recordings', { method: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'text/plain' }, body: 'x' });
    assert.equal(invalid.status, 415);
  } finally { await close(server); }
});
test('model error, invalid selection, and timeout produce bounded fallback', async () => {
  const parsed = parseCoachRequest({ artifactId: 'x', passageId: 'P01', passageVersion: '1', analysis: analysis() }, library);
  const invalid = await coach(parsed.request, parsed.passage, wav(), async () => ({ findingId: 'missing', actionId: 'x', visualKind: 'none' }));
  assert.equal(invalid.fallbackReason, 'invalid_response');
  const failure = await coach(parsed.request, parsed.passage, wav(), async () => { throw new Error('provider error'); });
  assert.equal(failure.fallbackReason, 'model_error');
  const timed = await coach(parsed.request, parsed.passage, wav(), async () => new Promise<never>(() => {}), 5);
  assert.equal(timed.fallbackReason, 'timeout');
  assert.deepEqual(timed.evidenceFindingIds, ['f1']);
});
test('Basic Pitch error result can be retried on the same artifact', async () => {
  let calls = 0;
  const fetchImpl = async (): Promise<Response> => {
    calls++;
    const result = calls === 1 ? analysis({ status: 'error' }) : analysis();
    return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const server = createCoachServer({ library, chooser: null, fetchImpl: fetchImpl as typeof fetch });
  const base = await serve(server);
  try {
    const upload = await (await post(base, '/v1/recordings', { metadata, wavBase64: wav().toString('base64') })).json() as { artifactId: string };
    const ref = { artifactId: upload.artifactId, attemptId: 'attempt-1', passageId: 'P01', passageVersion: '1' };
    const first = await (await post(base, '/v1/analyze', ref)).json() as AnalysisResult;
    const second = await (await post(base, '/v1/analyze', ref)).json() as AnalysisResult;
    assert.equal(first.status, 'error');
    assert.equal(second.status, 'ok');
    assert.equal(calls, 2);
  } finally { await close(server); }
});

test('quota stops provider calls without SDK retry or coaching fallback', async () => {
  let calls = 0;
  const fake = { models: { generateContentStream: async (): Promise<never> => {
    calls++;
    throw Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 });
  } } } as unknown as GoogleGenAI;
  const chooser = createGeminiChooser('test-only', 'gemini-2.5-flash', fake);
  const parsed = parseCoachRequest({ artifactId: 'x', passageId: 'P01', passageVersion: '1', analysis: analysis() }, library);
  await assert.rejects(() => coach(parsed.request, parsed.passage, wav(), chooser), /quota/);
  await assert.rejects(() => coach(parsed.request, parsed.passage, wav(), chooser), /quota/);
  assert.equal(calls, 1, 'quota circuit must stop future attempts');
});

test('HTTP reports quota stop instead of a successful fallback', async () => {
  const server = createCoachServer({ library, chooser: async () => { throw { status: 429 }; },
    fetchImpl: (async () => new Response(JSON.stringify(analysis()), { status: 200 })) as typeof fetch });
  const base = await serve(server);
  try {
    const receipt = await (await post(base, '/v1/recordings', { metadata, wavBase64: wav().toString('base64') })).json() as { artifactId: string };
    const measured = await (await post(base, '/v1/analyze', { artifactId: receipt.artifactId, attemptId: metadata.attemptId, passageId: 'P01', passageVersion: '1' })).json();
    const response = await post(base, '/v1/coach', { artifactId: receipt.artifactId, passageId: 'P01', passageVersion: '1', analysis: measured });
    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { error: 'gemini_quota_stopped' });
  } finally { await close(server); }
});