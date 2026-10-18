import { passages } from './passages.ts';
import { HISTORY_CAP, type AttemptRecord, type SessionStore } from './session.ts';
import { normalizeBlob, bytesToBase64, type NormalizedAudio } from './audio-normalization.ts';
import type { PhonePersistence } from './storage.ts';

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
    if (this.recording || this.rejectRecording) this.interruptCapture('Recording failed.');
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
      this.clearCapture();
      const record = this.store.stop();
      if (!record || !attemptId || record.attemptId !== attemptId) return;
      if (blob.size === 0) {
        this.fail(record, 'capture', 'No audio was recorded.');
        return;
      }
      this.remember(record.attemptId, { blob });
      await this.process(record, generation);
    } catch (cause) {
      if (generation !== this.generation || this.disposed) return;
      this.clearCapture();
      this.store.interrupt();
      this.error = message(cause);
    } finally {
      if (generation === this.generation) {
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
      const response = await fetch(url, { method: 'POST', body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) throw new Error(`Service returned HTTP ${response.status}.`);
      try {
        return await response.json() as unknown;
      } catch {
        throw new InvalidResponseError('Service returned invalid JSON.');
      }
    } finally {
      clearTimeout(timeout);
      if (this.request === controller) this.request = null;
    }
  }

  private fail(record: AttemptRecord, stage: 'capture' | 'normalization' | 'upload' | 'analysis' | 'coaching', detail: string): void {
    this.error = detail;
    this.store.fail(record.attemptId, stage, detail);
    this.changed();
  }

  private async process(record: AttemptRecord, generation: number): Promise<void> {
    const passage = passages.find((item) => item.id === record.passageId && item.version === record.passageVersion);
    if (!passage) { this.fail(record, 'analysis', 'The selected passage is unavailable.'); return; }
    const saved = this.saved.get(record.attemptId);
    if (!saved) return;
    if (Date.now() - (saved.savedAt ?? 0) > RETRY_TTL_MS) {
      this.saved.delete(record.attemptId); this.scheduleMemoryExpiry();
      this.fail(record, 'normalization', 'Recording retry window expired after 10 minutes. Record a new attempt.');
      return;
    }
    if (!saved.normalized) {
      this.store.setProcessingStage(record.attemptId, 'normalization');
      this.requestStage = 'normalization';
      try {
        if (!saved.blob) throw new Error('Audio is unavailable for normalization.');
        saved.normalized = await normalizeBlob(saved.blob);
        saved.savedAt ??= Date.now();
      }
      catch (cause) { if (generation === this.generation) this.fail(record, 'normalization', message(cause)); return; }
    }
    if (generation !== this.generation || this.disposed) return;
    const normalized = saved.normalized;
    if (this.persistence && !this.persistence.hasAudio(record.attemptId)) {
      try {
        await this.persistence.saveAudio({ attemptId: record.attemptId, ...normalized, savedAt: saved.savedAt ?? Date.now() });
        saved.blob = undefined;
      } catch {
        this.store.warnStorage(this.persistence.warning ?? 'Recording could not be saved for retry. It remains available only in this open session.');
        if (this.persistence.warning?.includes('expired')) {
          this.fail(record, 'normalization', 'Recording retry window expired after 10 minutes. Record a new attempt.');
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
      try {
        this.requestStage = 'upload';
        const response = await this.post(this.endpoints.upload, {
          metadata: { attemptId: record.attemptId, passageId: record.passageId, passageVersion: record.passageVersion,
            attemptTempoBpm: passage.tempoBpm, sourceSampleRate: normalized.sourceSampleRate,
            sampleRate: normalized.sampleRate, channels: normalized.channels, encoding: normalized.encoding,
            durationSec: normalized.durationSec, captureSource: record.captureSource === 'test' ? 'test' : 'phone' },
          wavBase64: bytesToBase64(normalized.wav),
        });
        if (!artifactValid(response, record.attemptId)) throw new InvalidResponseError('Upload returned a mismatched or invalid artifact.');
        artifact = response;
        saved.artifact = artifact;
        uploaded = true;
      } catch (cause) {
        if (generation === this.generation) this.fail(record, 'upload', `Upload failed: ${message(cause)}`);
        return;
      }
    }
    if (generation !== this.generation || this.disposed) return;
    if (!record.analysis || uploaded) {
      this.store.setProcessingStage(record.attemptId, 'analysis');
      try {
        this.requestStage = 'analysis';
        const analysis = await this.post(this.endpoints.analysis, { artifactId: artifact.artifactId,
          attemptId: record.attemptId, passageId: record.passageId, passageVersion: record.passageVersion });
        if (generation !== this.generation || this.disposed) return;
        if (!this.store.applyAnalysis(record.attemptId, analysis, uploaded && record.analysis !== null))
          throw new InvalidResponseError('The analysis response was invalid.');
      } catch (cause) {
        if (/HTTP (404|410)/.test(message(cause))) saved.artifact = undefined;
        if (generation === this.generation) this.fail(record, 'analysis', `Analysis failed: ${message(cause)}`);
        return;
      }
    }
    if (record.analysis?.status !== 'ok') {
      if (record.processingStatus === 'result') await this.releaseAudio(record.attemptId);
      return;
    }
    this.store.setProcessingStage(record.attemptId, 'coaching');
    try {
      this.requestStage = 'coaching';
      const coaching = await this.post(this.endpoints.coaching, { artifactId: artifact.artifactId,
        passageId: record.passageId, passageVersion: record.passageVersion, analysis: record.analysis });
      if (generation !== this.generation || this.disposed) return;
      if (!this.store.applyCoaching(record.attemptId, coaching)) {
        this.fail(record, 'coaching', 'The coaching response was invalid.');
      } else {
        await this.releaseAudio(record.attemptId);
      }
    } catch (cause) {
      if (/HTTP (404|410)/.test(message(cause))) saved.artifact = undefined;
      if (generation === this.generation) this.fail(record, 'coaching', `Coaching failed: ${message(cause)}`);
    }
  }

  private async releaseAudio(attemptId: string): Promise<void> {
    this.saved.delete(attemptId);
    this.scheduleMemoryExpiry();
    if (!this.persistence?.hasAudio(attemptId)) { this.changed(); return; }
    try { await this.persistence.deleteAudio(attemptId); }
    catch { this.store.warnStorage('A completed recording could not be removed from local retry storage.'); }
    this.changed();
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
      this.remember(record.attemptId, { blob });
      await this.process(record, generation);
    } finally {
      if (generation === this.generation) { this.busy = false; this.activeAttemptId = null; this.changed(); }
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
      await this.process(record, generation);
    } finally {
      if (generation === this.generation) { this.busy = false; this.activeAttemptId = null; this.changed(); }
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
