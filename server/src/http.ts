import { isQuotaError } from './quota.js';
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import type { AnalysisResult, CoachingResult, Passage } from './contracts.js';
import { coach, type ModelChooser } from './coaching.js';
import { ArtifactStore, AttemptConflictError, MAX_JSON_BYTES, PurgedAttemptError, StoreFullError, parseId, parseRecording, type Artifact } from './recordings.js';
import { InputError, parseCoachRequest, parsePassages } from './validation.js';
import { invokeBasicPitch } from './workflow.js';

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
type RateEntry = { startedAt: number; count: number };
export type RequestObservation = {
  method: string; path: string; origin?: string; attemptId?: string;
  stage?: 'upload' | 'analysis' | 'coaching' | 'audio'; status: number; durationMs: number;
};
function canonicalPath(path: string): string {
  return path.startsWith('/api/') ? '/v1/' + path.slice('/api/'.length) : path;
}
function observedStage(path: string): RequestObservation['stage'] {
  if (/^\/(?:api|v1)\/recordings\/[0-9a-f-]{36}\/audio$/.test(path)) return 'audio';
  if (path === '/api/recordings' || path === '/v1/recordings') return 'upload';
  if (path === '/api/analyze' || path === '/v1/analyze') return 'analysis';
  if (path === '/api/coach' || path === '/v1/coach') return 'coaching';
  return undefined;
}
export type CoachServerOptions = {
  library: Passage[];
  chooser: ModelChooser | null;
  analysisUrl?: string;
  fetchImpl?: typeof fetch;
  token?: string;
  allowedOrigin?: string;
  publicBaseUrl?: string;
  timeoutMs?: number;
  analysisTimeoutMs?: number;
  now?: () => number;
  observeRequest?: (event: RequestObservation) => void;
};
export async function loadLibrary(): Promise<Passage[]> {
  const path = fileURLToPath(new URL('../../shared/passages.json', import.meta.url));
  return parsePassages(JSON.parse(await readFile(path, 'utf8')) as unknown);
}
function headers(origin?: string): Record<string, string> {
  return { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}) };
}
function send(response: ServerResponse, status: number, value: unknown, origin?: string): void {
  response.writeHead(status, { ...headers(origin), 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}
function error(response: ServerResponse, status: number, code: string, origin?: string): void {
  send(response, status, { error: code }, origin);
}
function validToken(actual: string | undefined, expected: string): boolean {
  if (!actual?.startsWith('Bearer ')) return false;
  const provided = Buffer.from(actual.slice(7));
  const wanted = Buffer.from(expected);
  return provided.length === wanted.length && timingSafeEqual(provided, wanted);
}
async function readJson(request: IncomingMessage, maximum: number): Promise<unknown> {
  const length = Number(request.headers['content-length']);
  if (Number.isFinite(length) && length > maximum) throw new TooLargeError();
  let count = 0;
  const parts: Buffer[] = [];
  for await (const chunk of request) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    count += part.length;
    if (count > maximum) throw new TooLargeError();
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown; }
  catch { throw new InputError('invalid JSON'); }
}
class TooLargeError extends Error {}
class AnalysisError extends Error {}
async function boundedAnalysis<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new AnalysisError('analysis deadline exceeded'));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    controller.abort();
  }
}
function requestFields(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new InputError('request object required');
  return raw as Record<string, unknown>;
}
function artifactFor(store: ArtifactStore, raw: Record<string, unknown>): Artifact {
  const artifact = store.get(parseId(raw.artifactId, 'artifactId'));
  if (!artifact) throw new ExpiredArtifactError();
  if (raw.attemptId !== undefined && raw.attemptId !== artifact.metadata.attemptId) throw new AttemptConflictError();
  if (raw.passageId !== artifact.metadata.passageId || raw.passageVersion !== artifact.metadata.passageVersion) {
    throw new AttemptConflictError();
  }
  return artifact;
}
class ExpiredArtifactError extends Error {}
function analysisEndpoint(input: string): string {
  const url = new URL(input);
  if (url.protocol !== 'http:' || !isLoopbackHost(url.hostname) || url.pathname !== '/v1/analyze' || url.search || url.hash) {
    throw new Error('ENCORE_ANALYSIS_URL must be a fixed loopback /v1/analyze endpoint');
  }
  return url.toString();
}
export function createCoachServer(options: CoachServerOptions): Server {
  const clock = options.now ?? Date.now;
  const store = new ArtifactStore(clock);
  const rates = new Map<string, RateEntry>();
  const fetcher = options.fetchImpl ?? fetch;
  const target = analysisEndpoint(options.analysisUrl ?? 'http://127.0.0.1:8002/v1/analyze');
  const analysisTimeoutMs = Math.min(65_000, Math.max(1, options.analysisTimeoutMs ?? 65_000));
  const coachTimeoutMs = Math.min(60_000, Math.max(1, options.timeoutMs ?? 12_000));
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    const corsOrigin = origin && options.allowedOrigin === origin ? origin : undefined;
    const incomingPath = new URL(request.url ?? '/', 'http://localhost').pathname;
    const path = canonicalPath(incomingPath);
    const startedAt = performance.now();
    let observedAttemptId: string | undefined;
    response.once('finish', () => {
      try {
        options.observeRequest?.({ method: request.method ?? '', path: incomingPath, origin,
          attemptId: observedAttemptId, stage: observedStage(incomingPath),
          status: response.statusCode, durationMs: Math.round(performance.now() - startedAt) });
      } catch { /* diagnostic callback must not affect the HTTP response */ }
    });
    try {
      if (request.method === 'GET' && path === '/health') {
        send(response, 200, { ok: true, passageLibraryReady: options.library.length > 0,
          modelConfigured: options.chooser !== null }, corsOrigin);
        return;
      }
      const audioMatch = /^\/v1\/recordings\/([0-9a-f-]{36})\/audio$/.exec(path);
      if (!audioMatch && !['/v1/recordings', '/v1/analyze', '/v1/coach'].includes(path)) {
        error(response, 404, 'not_found', corsOrigin); return;
      }
      if (origin && origin !== options.allowedOrigin) { error(response, 403, 'origin_not_allowed'); return; }
      if (request.method === 'OPTIONS') {
        if (!corsOrigin) { error(response, 403, 'origin_not_allowed'); return; }
        response.writeHead(204, { ...headers(corsOrigin), 'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type, authorization', 'access-control-max-age': '600' });
        response.end(); return;
      }
      if (options.token && !validToken(request.headers.authorization, options.token)) {
        error(response, 401, 'unauthorized', corsOrigin); return;
      }
      if (audioMatch) {
        if (request.method !== 'GET') { error(response, 405, 'method_not_allowed', corsOrigin); return; }
        const artifact = store.get(audioMatch[1]);
        if (!artifact) { error(response, 410, 'artifact_expired', corsOrigin); return; }
        response.writeHead(200, { ...headers(corsOrigin), 'content-type': 'audio/wav', 'content-length': artifact.bytes.length });
        response.end(artifact.bytes); return;
      }
      if (request.method !== 'POST') { error(response, 405, 'method_not_allowed', corsOrigin); return; }
      if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        error(response, 415, 'json_required', corsOrigin); return;
      }
      const now = clock();
      const address = request.socket.remoteAddress ?? 'unknown';
      const rate = rates.get(address);
      if (!rate || now - rate.startedAt >= RATE_WINDOW_MS) rates.set(address, { startedAt: now, count: 1 });
      else if (++rate.count > RATE_LIMIT) { error(response, 429, 'rate_limited', corsOrigin); return; }
      for (const [ip, entry] of rates) if (now - entry.startedAt >= RATE_WINDOW_MS) rates.delete(ip);
      const raw = await readJson(request, path === '/v1/recordings' ? MAX_JSON_BYTES : 256_000);
      if (path === '/v1/recordings') {
        const { metadata, bytes } = parseRecording(raw, options.library);
        observedAttemptId = metadata.attemptId;
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 8788;
        const base = options.publicBaseUrl ?? 'http://127.0.0.1:' + String(port);
        send(response, 200, store.put(metadata, bytes, base), corsOrigin); return;
      }
      const fields = requestFields(raw);
      const artifact = artifactFor(store, fields);
      observedAttemptId = artifact.metadata.attemptId;
      if (path === '/v1/analyze') {
        if (artifact.analysis) { send(response, 200, artifact.analysis, corsOrigin); return; }
        if (!artifact.analysisPromise) {
          artifact.analysisPromise = boundedAnalysis(signal => invokeBasicPitch(artifact.id, async (): Promise<AnalysisResult> => {
            const form = new FormData();
            form.set('metadata', JSON.stringify(artifact.metadata));
            form.set('audio', new Blob([new Uint8Array(artifact.bytes)], { type: 'audio/wav' }), 'attempt.wav');
            const upstream = await fetcher(target, { method: 'POST', body: form, signal });
            if (!upstream.ok) throw new AnalysisError('analysis unavailable');
            const result = await upstream.json() as unknown;
            let parsed: ReturnType<typeof parseCoachRequest>;
            try {
              parsed = parseCoachRequest({ artifactId: artifact.id, passageId: artifact.metadata.passageId,
                passageVersion: artifact.metadata.passageVersion, analysis: result }, options.library);
            } catch { throw new AnalysisError('invalid analysis result'); }
            if (parsed.request.analysis.attemptId !== artifact.metadata.attemptId ||
                parsed.request.analysis.attemptTempoBpm !== artifact.metadata.attemptTempoBpm) throw new AnalysisError('analysis mismatch');
            return parsed.request.analysis;
          }), analysisTimeoutMs).then(result => {
            if (store.get(artifact.id) !== artifact) throw new ExpiredArtifactError();
            if (result.status !== 'error') {
              artifact.analysis = result;
              if (result.status !== 'ok') store.complete(artifact, 'skipped');
            }
            return result;
          }).catch(cause => {
            if (cause instanceof ExpiredArtifactError) throw cause;
            throw new AnalysisError('analysis unavailable');
          })
            .finally(() => { artifact.analysisPromise = undefined; });
        }
        send(response, 200, await artifact.analysisPromise, corsOrigin); return;
      }
      if (!artifact.analysis) { error(response, 409, 'analysis_required', corsOrigin); return; }
      const parsed = parseCoachRequest(raw, options.library);
      if (JSON.stringify(parsed.request.analysis) !== JSON.stringify(artifact.analysis)) {
        error(response, 409, 'analysis_mismatch', corsOrigin); return;
      }
      if (artifact.coaching) { send(response, 200, artifact.coaching, corsOrigin); return; }
      if (!artifact.coachingPromise) {
        artifact.coachingPromise = coach(parsed.request, parsed.passage, artifact.bytes, options.chooser, coachTimeoutMs)
          .then((result: CoachingResult) => {
            if (store.get(artifact.id) !== artifact) throw new ExpiredArtifactError();
            artifact.coaching = result;
            store.complete(artifact, 'completed');
            artifact.coachingPromise = undefined;
            return result;
          })
          .catch(cause => { artifact.coachingPromise = undefined; throw cause; });
      }
      send(response, 200, await artifact.coachingPromise, corsOrigin);
    } catch (cause) {
      if (response.headersSent) return;
      if (isQuotaError(cause)) error(response, 429, 'gemini_quota_stopped', corsOrigin);
      else if (cause instanceof AttemptConflictError) error(response, 409, 'attempt_conflict', corsOrigin);
      else if (cause instanceof ExpiredArtifactError || cause instanceof PurgedAttemptError) error(response, 410, 'artifact_expired', corsOrigin);
      else if (cause instanceof StoreFullError) error(response, 503, 'artifact_store_full', corsOrigin);
      else if (cause instanceof TooLargeError) error(response, 413, 'request_too_large', corsOrigin);
      else if (cause instanceof InputError) error(response, 400, 'invalid_request', corsOrigin);
      else if (cause instanceof AnalysisError || (cause instanceof Error && cause.name === 'TimeoutError')) {
        error(response, 502, 'analysis_unavailable', corsOrigin);
      } else error(response, 500, 'internal_error', corsOrigin);
    }
  });
  server.on('close', () => store.dispose());
  return server;
}
export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}
