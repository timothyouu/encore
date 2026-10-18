import { passages } from './passages.ts';
import { AudioMeter } from './audio-meter.ts';
import { HISTORY_CAP, type AttemptRecord, type SessionStore } from './session.ts';
import { normalizeBlob, bytesToBase64, type NormalizedAudio } from './audio-normalization.ts';
import type { PhonePersistence } from './storage.ts';
import { beginTelemetrySpan, endTelemetrySpan, recordTelemetryFailure,
  type FailureCode, type TelemetryName, type TelemetryOutcome, type TelemetrySpan } from './telemetry.ts';

export type CaptureEndpoints = { upload: string; analysis: string; coaching: string };

const MAX_CAPTURE_MS = 30_000;
const RECORDER_STOP_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 30_000;
const ANALYSIS_TIMEOUT_MS = 70_000;
const RETRY_TTL_MS = 10 * 60 * 1000;
const RETRY_COUNT_CAP = 24;
const RETRY_BYTE_CAP = 32 * 1024 * 1024;
const MAX_NORMALIZED_WAV_BYTES = 44 + Math.ceil(MAX_CAPTURE_MS / 1000 * 22_050 * 2);
export function requestTimeoutMs(stage: 'normalization' | 'upload' | 'analysis' | 'coaching'): number {
  return stage === 'analysis' ? ANALYSIS_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
}
const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

class InvalidResponseError extends Error {}
class InvalidJsonError extends Error {}
class ServiceStatusError extends Error {}

function failureCode(cause: unknown): FailureCode {
  if (cause instanceof InvalidJsonError) return 'invalid_json';
  if (cause instanceof InvalidResponseError) return 'invalid_response';
  if (cause instanceof ServiceStatusError) return 'service_error';
  return 'request_failed';
}
type Artifact = { artifactId: string; audioUrl: string; expiresAt: string; sha256: string; attemptId: string };
export type SessionAuthorization = { token: string; origin: string };

async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Secure audio verification is unavailable.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function captureSource(record: AttemptRecord): 'phone' | 'test' | 'g2' {
  return record.captureSource === 'test' || record.captureSource === 'g2' ? record.captureSource : 'phone';
}

function scopedBearer(url: string, endpoints: CaptureEndpoints, authorization: SessionAuthorization | undefined): string | undefined {
  if (!authorization || !/^[A-Za-z0-9._~+\/=\-]{16,1024}$/.test(authorization.token)) return undefined;
  try {
    const origin = new URL(authorization.origin);
    if (origin.protocol !== 'https:' || origin.origin !== authorization.origin ||
        origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) return undefined;
    const routes = [
      [endpoints.upload, 'recordings'],
      [endpoints.analysis, 'analyze'],
      [endpoints.coaching, 'coach'],
    ] as const;
    for (const [endpoint, route] of routes) {
      const parsed = new URL(endpoint);
      if (parsed.origin !== origin.origin || !['/api/' + route, '/v1/' + route].includes(parsed.pathname) ||
          parsed.search || parsed.hash || parsed.username || parsed.password) return undefined;
    }
    if (!routes.some(([endpoint]) => endpoint === url)) return undefined;
    return authorization.token;
  } catch { return undefined; }
}

function validEndpoint(value: string): boolean {
  if (!value || value.trim() !== value) return false;
  if (value.startsWith('/api/')) return !value.includes('?') && !value.includes('#');
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function validateEndpoints(endpoints: CaptureEndpoints): boolean {
  return validEndpoint(endpoints.upload) && validEndpoint(endpoints.analysis) && validEndpoint(endpoints.coaching);
}

function recorderOptions(): MediaRecorderOptions | undefined {
  const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
  return mimeType ? { mimeType } : undefined;
}

function stopTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function message(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'The request failed.';
}

function artifactValid(value: unknown, record: AttemptRecord, normalized: NormalizedAudio,
  attemptTempoBpm: number, digest: string): value is Artifact {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return item.attemptId === record.attemptId &&
    item.passageId === record.passageId && item.passageVersion === record.passageVersion &&
    item.attemptTempoBpm === attemptTempoBpm && item.captureSource === captureSource(record) &&
    item.sourceSampleRate === normalized.sourceSampleRate && item.sampleRate === normalized.sampleRate &&
    item.channels === normalized.channels && item.encoding === normalized.encoding &&
    typeof item.durationSec === 'number' && Math.abs(item.durationSec - normalized.durationSec) < 0.0001 &&
    typeof item.artifactId === 'string' && item.artifactId.length > 0 &&
    typeof item.audioUrl === 'string' && item.audioUrl.length > 0 && typeof item.expiresAt === 'string' &&
    Date.parse(item.expiresAt) > Date.now() && item.sha256 === digest;
}

export class PhoneCapture {
  busy = false;
  recording = false;
  error: string | null = null;

  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private meter: AudioMeter | null = null;
  private chunks: Blob[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private request: AbortController | null = null;
  private requestStage: 'normalization' | 'upload' | 'analysis' | 'coaching' = 'normalization';
  private generation = 0;
  private disposed = false;
  private activeAttemptId: string | null = null;
  private rejectRecording: ((error: Error) => void) | null = null;
  private trace: TelemetrySpan | null = null;
  private stepTrace: TelemetrySpan | null = null;
  private saved = new Map<string, { blob?: Blob; normalized?: NormalizedAudio; digest?: string; artifact?: Artifact; savedAt?: number }>();
  private retryExpiryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly store: SessionStore;
  private endpoints: CaptureEndpoints;
  private readonly onChange?: () => void;
  private readonly persistence?: PhonePersistence;
  private readonly getSessionAuthorization?: () => SessionAuthorization | undefined;
  private sessionAuthorizationRevoked = false;

  constructor(
    store: SessionStore,
    endpoints: CaptureEndpoints,
    onChange?: () => void,
    persistence?: PhonePersistence,
    getSessionAuthorization?: () => SessionAuthorization | undefined,
  ) {
    this.store = store;
    this.endpoints = endpoints;
    this.onChange = onChange;
    this.persistence = persistence;
    this.getSessionAuthorization = getSessionAuthorization;
    if (typeof window !== 'undefined') window.addEventListener('pagehide', this.onPageHide);
  }

  private readonly onPageHide = (): void => { this.dispose(); };

  updateEndpoints(endpoints: CaptureEndpoints): boolean {
    if (this.disposed || this.busy || this.recording || !validateEndpoints(endpoints)) return false;
    if ([endpoints.upload, endpoints.analysis, endpoints.coaching].some((endpoint, index) => {
      const previous = [this.endpoints.upload, this.endpoints.analysis, this.endpoints.coaching][index];
      try { return new URL(endpoint).origin !== new URL(previous).origin; }
      catch { return endpoint !== previous; }
    })) this.sessionAuthorizationRevoked = true;
    if (endpoints.upload !== this.endpoints.upload) {
      for (const saved of this.saved.values()) saved.artifact = undefined;
    }
    this.endpoints = endpoints;
    this.error = null;
    this.changed();
    return true;
  }

  private changed(): void { this.onChange?.(); }

  getWaveform(): readonly number[] | null {
    return this.recording ? this.meter?.sample() ?? null : null;
  }

  private beginTrace(): void {
    this.endTrace('interrupted');
    this.trace = beginTelemetrySpan('phone.stop_to_result');
  }

  private startStep(name: TelemetryName): void {
    this.endStep('interrupted');
    this.stepTrace = beginTelemetrySpan(name, this.trace);
  }

  private endStep(outcome: TelemetryOutcome): void {
    endTelemetrySpan(this.stepTrace, outcome);
    this.stepTrace = null;
  }

  private endTrace(outcome: TelemetryOutcome): void {
    this.endStep(outcome);
    endTelemetrySpan(this.trace, outcome);
    this.trace = null;
  }

  private memoryBytes(): number {
    let bytes = 0;
    for (const item of this.saved.values()) bytes += item.normalized?.wav.byteLength ?? item.blob?.size ?? 0;
    return bytes;
  }

  private pruneMemory(): void {
    let removed = 0;
    for (const [id, item] of this.saved) {
      if (Date.now() - (item.savedAt ?? 0) <= RETRY_TTL_MS) continue;
      this.saved.delete(id); removed++;
    }
    if (removed) this.store.warnStorage(`${removed} recording${removed === 1 ? '' : 's'} expired after 10 minutes and can no longer be retried.`);
    this.scheduleMemoryExpiry();
  }

  private scheduleMemoryExpiry(): void {
    if (this.retryExpiryTimer) clearTimeout(this.retryExpiryTimer);
    const earliest = Math.min(...[...this.saved.values()].map(item => (item.savedAt ?? 0) + RETRY_TTL_MS));
    if (!Number.isFinite(earliest)) return;
    this.retryExpiryTimer = setTimeout(() => this.pruneMemory(), Math.max(1, earliest - Date.now() + 1));
    (this.retryExpiryTimer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  }

  private remember(attemptId: string, value: { blob?: Blob; normalized?: NormalizedAudio; digest?: string; artifact?: Artifact; savedAt?: number }): void {
    this.saved.set(attemptId, { ...value, savedAt: value.savedAt ?? Date.now() });
    this.scheduleMemoryExpiry();
  }

  private clearCapture(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.meter?.dispose();
    this.meter = null;
    this.stream?.getTracks().forEach((track) => track.removeEventListener('ended', this.onTrackEnded));
    stopTracks(this.stream);
    this.stream = null;
    this.recorder = null;
    this.recording = false;
    this.chunks = [];
    this.changed();
  }

  private interruptCapture(reason: string): void {
    if (!this.stream && this.store.state.screen !== 'recording') return;
    this.generation += 1;
    this.endTrace('interrupted');
    this.rejectRecording?.(new Error(reason));
    this.rejectRecording = null;
    try { if (this.recorder?.state === 'recording') this.recorder.stop(); } catch { /* already stopped */ }
    this.clearCapture();
    this.store.interrupt();
    this.activeAttemptId = null;
    this.error = reason;
    this.busy = false;
    this.changed();
  }

  private readonly onTrackEnded = (): void => {
    if (this.recording || this.rejectRecording) this.interruptCapture('Microphone disconnected.');
  };

  private readonly onRecorderError = (): void => {
    if (this.recording || this.rejectRecording) {
      recordTelemetryFailure('capture', 'capture_failed', 'phone', this.trace);
      this.interruptCapture('Recording failed.');
    }
  };

  async start(): Promise<void> {
    if (this.disposed || this.busy || this.recording || this.store.state.screen !== 'ready') return;
    this.pruneMemory();
    if (this.store.records.length >= HISTORY_CAP) {
      this.store.warnStorage('History is full at 1,000 attempts. Existing results are preserved; a new attempt cannot be recorded.');
      return;
    }
    if (this.saved.size >= RETRY_COUNT_CAP || this.memoryBytes() + MAX_NORMALIZED_WAV_BYTES > RETRY_BYTE_CAP ||
        (this.persistence && !this.persistence.canReserveAudio(MAX_NORMALIZED_WAV_BYTES))) {
      this.error = 'Recording retry storage is full (24 recordings or 32 MiB). Retry an earlier recording or wait for its 10 minute window to expire.';
      this.changed(); return;
    }
    this.error = null;
    if (!validateEndpoints(this.endpoints)) {
      this.error = 'Configure upload, analysis, and coaching endpoints before recording.';
      this.changed();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      this.error = 'Microphone recording is unavailable in this browser.';
      recordTelemetryFailure('capture', 'microphone_unavailable');
      this.changed();
      return;
    }
    this.busy = true;
    this.activeAttemptId = null;
    const generation = ++this.generation;
    const readyState = this.store.state;
    this.changed();
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== this.generation || this.disposed || this.store.state !== readyState) {
        stopTracks(stream);
        return;
      }
      const recorder = new MediaRecorder(stream, recorderOptions());
      // The browser's selected MIME type describes the bytes actually recorded.
      if (!recorder.mimeType) throw new Error('The browser did not report its audio encoding.');
      this.stream = stream;
      this.recorder = recorder;
      this.chunks = [];
      recorder.addEventListener('dataavailable', (event: BlobEvent) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      });
      recorder.addEventListener('error', this.onRecorderError);
      stream.getAudioTracks().forEach((track) => track.addEventListener('ended', this.onTrackEnded));
      const record = this.store.start('phone');
      if (!record) throw new Error('The passage is no longer ready to record.');
      record.captureSource = 'phone';
      this.activeAttemptId = record.attemptId;
      recorder.start();
      this.meter = AudioMeter.create(stream);
      this.recording = true;
      this.timer = setTimeout(() => { void this.stop(); }, MAX_CAPTURE_MS);
    } catch (cause) {
      stopTracks(stream);
      if (generation !== this.generation || this.disposed) return;
      this.clearCapture();
      if (this.activeAttemptId) this.store.interrupt();
      if (!(cause instanceof DOMException && (cause.name === 'NotAllowedError' || cause.name === 'AbortError')))
        recordTelemetryFailure('capture', 'capture_failed');
      this.error = message(cause);
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.changed();
      }
    }
  }

  async stop(): Promise<void> {
    if (this.disposed || this.busy || !this.recording || !this.recorder || !this.stream) return;
    this.busy = true;
    this.recording = false;
    this.beginTrace();
    this.startStep('phone.recorder_stop');
    let recorderPending = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    const generation = this.generation;
    const recorder = this.recorder;
    const attemptId = this.activeAttemptId;
    this.changed();
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        const cleanup = (): void => {
          clearTimeout(timeout);
          recorder.removeEventListener('stop', onStop);
          this.rejectRecording = null;
        };
        const rejectStop = (error: Error): void => { cleanup(); reject(error); };
        const onStop = (): void => {
          cleanup();
          resolve(new Blob(this.chunks, { type: recorder.mimeType }));
        };
        const timeout = setTimeout(() => rejectStop(new Error('Recorder did not finish stopping.')), RECORDER_STOP_TIMEOUT_MS);
        this.rejectRecording = rejectStop;
        recorder.addEventListener('stop', onStop, { once: true });
        try { recorder.stop(); } catch (cause) { rejectStop(cause instanceof Error ? cause : new Error('Could not stop recording.')); }
      });
      if (generation !== this.generation || this.disposed) return;
      recorderPending = false;
      this.endStep('ok');
      this.clearCapture();
      const record = this.store.stop();
      if (!record || !attemptId || record.attemptId !== attemptId) {
        this.endTrace('interrupted');
        return;
      }
      if (blob.size === 0) {
        this.fail(record, 'capture', 'No audio was recorded.', 'empty_audio');
        return;
      }
      this.remember(record.attemptId, { blob });
      await this.process(record, generation);
    } catch (cause) {
      if (generation !== this.generation || this.disposed) return;
      if (recorderPending) recordTelemetryFailure('capture', 'recorder_stop_failed', 'phone', this.trace);
      this.clearCapture();
      this.store.interrupt();
      this.error = message(cause);
      this.endTrace('error');
    } finally {
      if (generation === this.generation) {
        if (this.trace) {
          const record = this.store.records.find(item => item.attemptId === attemptId);
          this.endTrace(record?.processingStatus === 'result' ? 'ok' :
            record?.processingStatus === 'error' ? 'error' : 'interrupted');
        }
        this.busy = false;
        this.activeAttemptId = null;
        this.changed();
      }
    }
  }

  private async post(url: string, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    this.request = controller;
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs(this.requestStage));
    try {
      const authorization = this.sessionAuthorizationRevoked ? undefined : this.getSessionAuthorization?.();
      const token = scopedBearer(url, this.endpoints, authorization);
      const response = await fetch(url, { method: 'POST', body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        credentials: 'same-origin', redirect: token ? 'error' : 'follow', signal: controller.signal });
      if (!response.ok) throw new ServiceStatusError(`Service returned HTTP ${response.status}.`);
      try {
        return await response.json() as unknown;
      } catch {
        throw new InvalidJsonError('Service returned invalid JSON.');
      }
    } finally {
      clearTimeout(timeout);
      if (this.request === controller) this.request = null;
    }
  }

  private fail(record: AttemptRecord, stage: 'capture' | 'normalization' | 'upload' | 'analysis' | 'coaching', detail: string, code: FailureCode): void {
    this.error = detail;
    recordTelemetryFailure(stage, code, 'phone', this.trace);
    try { this.store.fail(record.attemptId, stage, detail); }
    finally { this.endTrace('error'); }
    this.changed();
  }

  private async process(record: AttemptRecord, generation: number): Promise<void> {
    const passage = passages.find(item => item.id === record.passageId && item.version === record.passageVersion);
    if (!passage) { this.fail(record, 'analysis', 'The selected passage is unavailable.', 'passage_unavailable'); return; }
    const saved = this.saved.get(record.attemptId);
    if (!saved) {
      this.fail(record, 'normalization', 'Saved audio is unavailable.', 'normalization_failed');
      return;
    }
    if (Date.now() - (saved.savedAt ?? 0) > RETRY_TTL_MS) {
      this.saved.delete(record.attemptId); this.scheduleMemoryExpiry();
      this.fail(record, 'normalization', 'Recording retry window expired after 10 minutes. Record a new attempt.', 'normalization_failed');
      return;
    }
    if (!saved.normalized) {
      this.store.setProcessingStage(record.attemptId, 'normalization');
      this.requestStage = 'normalization';
      this.startStep('phone.normalization');
      try {
        if (!saved.blob) throw new Error('Audio is unavailable for normalization.');
        saved.normalized = await normalizeBlob(saved.blob);
        if (generation !== this.generation || this.disposed) return;
        saved.savedAt ??= Date.now();
        this.endStep('ok');
      } catch (cause) {
        if (generation !== this.generation || this.disposed) return;
        this.endStep('error');
        this.fail(record, 'normalization', message(cause), 'normalization_failed');
        return;
      }
    }
    if (generation !== this.generation || this.disposed) return;
    const normalized = saved.normalized;
    if (this.persistence && !this.persistence.hasAudio(record.attemptId)) {
      this.startStep('phone.audio_persist');
      try {
        await this.persistence.saveAudio({ attemptId: record.attemptId, ...normalized, savedAt: saved.savedAt ?? Date.now() });
        if (generation !== this.generation || this.disposed) return;
        saved.blob = undefined;
        this.endStep('ok');
      } catch {
        if (generation !== this.generation || this.disposed) return;
        this.endStep('error');
        recordTelemetryFailure('storage', 'storage_failed', 'phone', this.trace);
        this.store.warnStorage(this.persistence.warning ?? 'Recording could not be saved for retry. It remains available only in this open session.');
        if (this.persistence.warning?.includes('expired')) {
          this.fail(record, 'normalization', 'Recording retry window expired after 10 minutes. Record a new attempt.', 'normalization_failed');
          return;
        }
      }
    }
    if (this.persistence?.hasAudio(record.attemptId)) {
      this.saved.delete(record.attemptId);
      this.scheduleMemoryExpiry();
    }
    if (generation !== this.generation || this.disposed) return;
    let artifact = saved.artifact;
    let uploaded = false;
    if (!artifact || Date.parse(artifact.expiresAt) <= Date.now() + 1_000) {
      this.store.setProcessingStage(record.attemptId, 'upload');
      this.requestStage = 'upload';
      this.startStep('phone.upload_request');
      try {
        saved.digest ??= await sha256(normalized.wav);
        const response = await this.post(this.endpoints.upload, {
          metadata: { attemptId: record.attemptId, passageId: record.passageId, passageVersion: record.passageVersion,
            attemptTempoBpm: passage.tempoBpm, sourceSampleRate: normalized.sourceSampleRate,
            sampleRate: normalized.sampleRate, channels: normalized.channels, encoding: normalized.encoding,
            durationSec: normalized.durationSec, captureSource: captureSource(record) },
          wavBase64: bytesToBase64(normalized.wav),
        });
        if (generation !== this.generation || this.disposed) return;
        this.endStep('ok');
        this.startStep('phone.upload_validation');
        if (!artifactValid(response, record, normalized, passage.tempoBpm, saved.digest)) throw new InvalidResponseError('Upload returned a mismatched or invalid artifact.');
        artifact = response;
        saved.artifact = artifact;
        uploaded = true;
        this.endStep('ok');
      } catch (cause) {
        if (generation !== this.generation || this.disposed) return;
        this.endStep('error');
        if (cause instanceof ServiceStatusError && /HTTP 410\b/.test(cause.message)) {
          this.fail(record, 'upload', 'This attempt is no longer available on the server. Record a new attempt.', 'service_error');
          await this.releaseAudio(record.attemptId);
          return;
        }
        this.fail(record, 'upload', `Upload failed: ${message(cause)}`, failureCode(cause));
        return;
      }
    }
    if (generation !== this.generation || this.disposed) return;
    if (!record.analysis || uploaded) {
      this.store.setProcessingStage(record.attemptId, 'analysis');
      this.requestStage = 'analysis';
      this.startStep('phone.analysis_request');
      try {
        const analysis = await this.post(this.endpoints.analysis, { artifactId: artifact.artifactId,
          attemptId: record.attemptId, passageId: record.passageId, passageVersion: record.passageVersion });
        if (generation !== this.generation || this.disposed) return;
        this.endStep('ok');
        this.startStep('phone.analysis_validation');
        if (!this.store.applyAnalysis(record.attemptId, analysis, uploaded && record.analysis !== null))
          throw new InvalidResponseError('The analysis response was invalid.');
        this.endStep(record.analysis?.status === 'error' ? 'error' : 'ok');
      } catch (cause) {
        if (generation !== this.generation || this.disposed) return;
        this.endStep('error');
        if (cause instanceof ServiceStatusError && /HTTP (404|410)/.test(cause.message)) saved.artifact = undefined;
        this.fail(record, 'analysis', cause instanceof ServiceStatusError && /HTTP 410\b/.test(cause.message)
          ? 'Audio artifact expired. Retry the saved recording while it is available.'
          : `Analysis failed: ${message(cause)}`, failureCode(cause));
        return;
      }
    }
    if (record.analysis?.status !== 'ok') {
      if (record.analysis?.status === 'error') {
        recordTelemetryFailure('analysis', 'service_error', 'phone', this.trace);
        this.endTrace('error');
      } else if (record.processingStatus === 'result') {
        await this.releaseAudio(record.attemptId);
      }
      return;
    }
    this.store.setProcessingStage(record.attemptId, 'coaching');
    this.requestStage = 'coaching';
    this.startStep('phone.coaching_request');
    try {
      const coaching = await this.post(this.endpoints.coaching, { artifactId: artifact.artifactId,
        passageId: record.passageId, passageVersion: record.passageVersion, analysis: record.analysis });
      if (generation !== this.generation || this.disposed) return;
      this.endStep('ok');
      this.startStep('phone.coaching_validation');
      if (!this.store.applyCoaching(record.attemptId, coaching))
        throw new InvalidResponseError('The coaching response was invalid.');
      this.endStep('ok');
      await this.releaseAudio(record.attemptId);
    } catch (cause) {
      if (generation !== this.generation || this.disposed) return;
      this.endStep('error');
      if (cause instanceof ServiceStatusError && /HTTP (404|410)/.test(cause.message)) saved.artifact = undefined;
      this.fail(record, 'coaching', cause instanceof ServiceStatusError && /HTTP 410\b/.test(cause.message)
        ? 'Audio artifact expired. Retry the saved recording while it is available.'
        : `Coaching failed: ${message(cause)}`, failureCode(cause));
    }
  }

  private async releaseAudio(attemptId: string): Promise<void> {
    const generation = this.generation;
    const trace = this.trace;
    this.saved.delete(attemptId);
    this.scheduleMemoryExpiry();
    if (!this.persistence?.hasAudio(attemptId)) { this.changed(); return; }
    try { await this.persistence.deleteAudio(attemptId); }
    catch {
      if (generation !== this.generation || this.disposed) return;
      recordTelemetryFailure('storage', 'storage_failed', 'phone', trace);
      this.store.warnStorage('A completed recording could not be removed from local retry storage.');
    }
    if (generation === this.generation && !this.disposed) this.changed();
  }

  async processWavBlob(blob: Blob): Promise<void> {
    if (this.disposed || this.busy || this.recording || this.store.state.screen !== 'ready') return;
    this.pruneMemory();
    if (this.store.records.length >= HISTORY_CAP) {
      this.store.warnStorage('History is full at 1,000 attempts. Existing results are preserved; a new attempt cannot be recorded.');
      return;
    }
    if (this.saved.size >= RETRY_COUNT_CAP || this.memoryBytes() + blob.size > RETRY_BYTE_CAP ||
        (this.persistence && !this.persistence.canReserveAudio(MAX_NORMALIZED_WAV_BYTES))) {
      this.error = 'Recording retry storage is full (24 recordings or 32 MiB). Retry an earlier recording or wait for its 10 minute window to expire.';
      this.changed(); return;
    }
    if (!validateEndpoints(this.endpoints)) { this.error = 'Configure upload, analysis, and coaching endpoints first.'; this.changed(); return; }
    this.busy = true;
    const generation = ++this.generation;
    try {
      const record = this.store.start('test');
      if (!record) return;
      this.activeAttemptId = record.attemptId;
      this.store.stop();
      this.beginTrace();
      this.remember(record.attemptId, { blob });
      await this.process(record, generation);
    } finally {
      if (generation === this.generation) {
        const record = this.store.records.find(item => item.attemptId === this.activeAttemptId);
        this.endTrace(record?.processingStatus === 'result' ? 'ok' :
          record?.processingStatus === 'error' ? 'error' : 'interrupted');
        this.busy = false; this.activeAttemptId = null; this.changed();
      }
    }
  }

  /**
   * Processes an attempt that another capture source already completed (e.g. a
   * hosting page's G2 microphone): the same normalization, upload, retry window
   * and history as a phone recording. The caller owns the device; this only
   * handles the audio bytes.
   */
  async processRecording(record: AttemptRecord, blob: Blob): Promise<void> {
    if (this.disposed || this.busy || this.recording) return;
    if (record.captureStatus !== 'completed' || record.processingStatus !== 'processing') return;
    this.pruneMemory();
    if (blob.size === 0) { this.fail(record, 'capture', 'No audio was recorded.', 'empty_audio'); return; }
    if (this.saved.size >= RETRY_COUNT_CAP || this.memoryBytes() + blob.size > RETRY_BYTE_CAP ||
        (this.persistence && !this.persistence.canReserveAudio(MAX_NORMALIZED_WAV_BYTES))) {
      this.fail(record, 'normalization', 'Recording retry storage is full (24 recordings or 32 MiB). Retry an earlier recording or wait for its 10 minute window to expire.', 'storage_failed');
      return;
    }
    if (!validateEndpoints(this.endpoints)) {
      this.fail(record, 'upload', 'Configure upload, analysis, and coaching endpoints first.', 'request_failed');
      return;
    }
    this.busy = true;
    const generation = ++this.generation;
    this.activeAttemptId = record.attemptId;
    this.changed();
    try {
      this.beginTrace();
      this.remember(record.attemptId, { blob });
      await this.process(record, generation);
    } finally {
      if (generation === this.generation) {
        const status = this.store.records.find(item => item.attemptId === record.attemptId)?.processingStatus;
        this.endTrace(status === 'result' ? 'ok' : status === 'error' ? 'error' : 'interrupted');
        this.busy = false; this.activeAttemptId = null; this.changed();
      }
    }
  }

  async retry(attemptId = this.store.state.attemptId ?? ''): Promise<void> {
    if (this.disposed || this.busy || this.recording) return;
    this.pruneMemory();
    const record = this.store.records.find(item => item.attemptId === attemptId);
    if (!record || (!this.saved.has(attemptId) && !this.persistence?.hasAudio(attemptId))) {
      this.error = 'Audio for this attempt is no longer available. Record a new attempt.';
      this.changed(); return;
    }
    this.busy = true;
    const generation = ++this.generation;
    this.changed();
    try {
      if (!this.saved.has(attemptId) && this.persistence) {
        try {
          const durable = await this.persistence.getAudio(attemptId);
          if (durable) this.remember(attemptId, { normalized: durable, savedAt: durable.savedAt });
        } catch { this.store.warnStorage('Saved recording could not be read for retry.'); }
        if (!this.saved.has(attemptId)) {
          this.error = 'Audio for this attempt is no longer available. Record a new attempt.';
          return;
        }
      }
      if (generation !== this.generation || this.disposed || !this.store.beginRetry(attemptId)) return;
      this.error = null; this.activeAttemptId = attemptId;
      this.beginTrace();
      await this.process(record, generation);
    } finally {
      if (generation === this.generation) {
        this.endTrace(record.processingStatus === 'result' ? 'ok' :
          record.processingStatus === 'error' ? 'error' : 'interrupted');
        this.busy = false; this.activeAttemptId = null; this.changed();
      }
    }
  }
  canRetry(attemptId: string): boolean {
    const record = this.store.records.find(item => item.attemptId === attemptId);
    const memory = this.saved.get(attemptId);
    return !this.disposed && !this.busy && !!record && record.captureStatus === 'completed' &&
      record.processingStatus === 'error' && record.error?.stage !== 'capture' &&
      ((!!memory && Date.now() - (memory.savedAt ?? 0) <= RETRY_TTL_MS) || this.persistence?.hasAudio(attemptId) === true);
  }

  cancel(): void {
    if (!this.busy && !this.recording) return;
    this.generation += 1;
    this.endTrace('cancelled');
    this.request?.abort();
    this.request = null;
    this.rejectRecording?.(new Error('Recording canceled.'));
    this.rejectRecording = null;
    try { if (this.recorder?.state === 'recording') this.recorder.stop(); } catch { /* already stopped */ }
    this.clearCapture();
    if (this.store.state.screen === 'recording') this.store.cancel();
    else if (this.activeAttemptId) this.store.fail(this.activeAttemptId, this.requestStage, 'Processing canceled.');
    this.activeAttemptId = null;
    this.busy = false;
    this.changed();
  }

  dispose(): void {
    if (this.disposed) return;
    if (this.store.state.screen === 'recording') this.interruptCapture('Recording was interrupted when the page closed.');
    else this.cancel();
    this.saved.clear();
    if (this.retryExpiryTimer) clearTimeout(this.retryExpiryTimer);
    this.disposed = true;
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.onPageHide);
  }
}
