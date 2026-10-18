import { passages } from './passages.ts';
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

function artifactValid(value: unknown, attemptId: string): value is Artifact {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return item.attemptId === attemptId && typeof item.artifactId === 'string' && item.artifactId.length > 0 &&
    typeof item.audioUrl === 'string' && item.audioUrl.length > 0 && typeof item.expiresAt === 'string' &&
    Date.parse(item.expiresAt) > Date.now() && typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(item.sha256);
}

export type SubmissionStage = 'upload' | 'coaching';
export type RecordedAudio = { blob: Blob; filename: string; metadata: Record<string, unknown> };
/** Lets the capture source cancel requests and ignore responses for an abandoned attempt. */
export type SubmissionContext = {
  isCurrent(): boolean;
  track(request: AbortController, stage: SubmissionStage): void;
  untrack(request: AbortController): void;
  fail(record: AttemptRecord, stage: 'capture' | 'upload' | 'analysis' | 'coaching', detail: string): void;
};

async function post(url: string, body: BodyInit, context: SubmissionContext, stage: SubmissionStage, headers?: HeadersInit): Promise<unknown> {
  const controller = new AbortController();
  context.track(controller, stage);
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'POST', body, headers, credentials: 'same-origin', signal: controller.signal });
    if (!response.ok) throw new Error(`Service returned HTTP ${response.status}.`);
    try {
      return await response.json() as unknown;
    } catch {
      throw new InvalidResponseError('Service returned invalid JSON.');
    }
  } finally {
    clearTimeout(timeout);
    context.untrack(controller);
  }
}

/** Sends one completed recording to analysis, then coaching, and applies validated results to the store. */
export async function submitAttempt(
  store: SessionStore, endpoints: CaptureEndpoints, record: AttemptRecord, audio: RecordedAudio, context: SubmissionContext,
): Promise<void> {
  const passage = passages.find((item) => item.id === record.passageId && item.version === record.passageVersion);
  if (!passage) { context.fail(record, 'analysis', 'The selected passage is unavailable.'); return; }
  const metadata = {
    attemptId: record.attemptId, passageId: record.passageId, passageVersion: record.passageVersion,
    attemptTempoBpm: passage.tempoBpm, captureSource: record.captureSource ?? 'demo',
    ...audio.metadata,
  };
  const form = new FormData();
  form.append('audio', audio.blob, audio.filename);
  form.append('metadata', JSON.stringify(metadata));
  let analysis: unknown;
  try {
    analysis = await post(endpoints.analysis, form, context, 'upload');
  } catch (cause) {
    if (context.isCurrent()) {
      context.fail(record, cause instanceof InvalidResponseError ? 'analysis' : 'upload',
        cause instanceof InvalidResponseError ? message(cause) : `Analysis upload failed: ${message(cause)}`);
    }
    return;
  }
  if (!context.isCurrent()) return;
  if (!store.applyAnalysis(record.attemptId, analysis)) {
    context.fail(record, 'analysis', 'The analysis response was invalid.');
    return;
  }
  if (record.analysis?.status !== 'ok') return;
  try {
    const coaching = await post(endpoints.coaching, JSON.stringify({
      schemaVersion: '1', attemptId: record.attemptId, passageId: record.passageId,
      passageVersion: record.passageVersion, passage, analysis: record.analysis,
    }), context, 'coaching', { 'Content-Type': 'application/json' });
    if (!context.isCurrent()) return;
    if (!store.applyCoaching(record.attemptId, coaching)) {
      context.fail(record, 'coaching', 'The coaching response was invalid.');
    }
  } catch (cause) {
    if (context.isCurrent()) context.fail(record, 'coaching', `Coaching failed: ${message(cause)}`);
  }
}

export class PhoneCapture {
  busy = false;
  recording = false;
  error: string | null = null;

  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
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
  private saved = new Map<string, { blob?: Blob; normalized?: NormalizedAudio; artifact?: Artifact; savedAt?: number }>();
  private retryExpiryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly store: SessionStore;
  private endpoints: CaptureEndpoints;
  private readonly onChange?: () => void;
  private readonly persistence?: PhonePersistence;

  constructor(
    store: SessionStore,
    endpoints: CaptureEndpoints,
    onChange?: () => void,
    persistence?: PhonePersistence,
  ) {
    this.store = store;
    this.endpoints = endpoints;
    this.onChange = onChange;
    this.persistence = persistence;
    if (typeof window !== 'undefined') window.addEventListener('pagehide', this.onPageHide);
  }

  private readonly onPageHide = (): void => { this.dispose(); };

  updateEndpoints(endpoints: CaptureEndpoints): boolean {
    if (this.disposed || this.busy || this.recording || !validateEndpoints(endpoints)) return false;
    if (endpoints.upload !== this.endpoints.upload) {
      for (const saved of this.saved.values()) saved.artifact = undefined;
    }
    this.endpoints = endpoints;
    this.error = null;
    this.changed();
    return true;
  }

  private changed(): void { this.onChange?.(); }

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

  private remember(attemptId: string, value: { blob?: Blob; normalized?: NormalizedAudio; artifact?: Artifact; savedAt?: number }): void {
    this.saved.set(attemptId, { ...value, savedAt: value.savedAt ?? Date.now() });
    this.scheduleMemoryExpiry();
  }

  private clearCapture(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
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

  private fail(record: AttemptRecord, stage: 'capture' | 'upload' | 'analysis' | 'coaching', detail: string): void {
    this.error = detail;
    recordTelemetryFailure(stage, code, 'phone', this.trace);
    try { this.store.fail(record.attemptId, stage, detail); }
    finally { this.endTrace('error'); }
    this.changed();
  }

  private async process(
    record: AttemptRecord, blob: Blob, mimeType: string, durationMs: number,
    settings: MediaTrackSettings | undefined, generation: number,
  ): Promise<void> {
    await submitAttempt(this.store, this.endpoints, record, {
      blob, filename: `attempt.${extension(mimeType)}`,
      metadata: { sampleRateHz: settings?.sampleRate ?? null, channelCount: settings?.channelCount ?? null, encoding: mimeType, durationMs },
    }, {
      isCurrent: () => generation === this.generation && !this.disposed,
      track: (request, stage) => { this.request = request; this.requestStage = stage; },
      untrack: (request) => { if (this.request === request) this.request = null; },
      fail: (failed, stage, detail) => this.fail(failed, stage, detail),
    });
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
