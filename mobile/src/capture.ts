import { passages } from './passages.ts';
import type { AttemptRecord, SessionStore } from './session.ts';

export type CaptureEndpoints = { analysis: string; coaching: string };

const MAX_CAPTURE_MS = 30_000;
const RECORDER_STOP_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

class InvalidResponseError extends Error {}

function validEndpoint(value: string): boolean {
  if (!value || value.trim() !== value) return false;
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
  return validEndpoint(endpoints.analysis) && validEndpoint(endpoints.coaching);
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

function extension(mimeType: string): string {
  if (mimeType.startsWith('audio/webm')) return 'webm';
  if (mimeType.startsWith('audio/mp4')) return 'm4a';
  if (mimeType.startsWith('audio/ogg')) return 'ogg';
  return 'audio';
}

export class PhoneCapture {
  busy = false;
  recording = false;
  error: string | null = null;

  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private captureStartedAt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private request: AbortController | null = null;
  private requestStage: 'upload' | 'coaching' = 'upload';
  private generation = 0;
  private disposed = false;
  private activeAttemptId: string | null = null;
  private rejectRecording: ((error: Error) => void) | null = null;
  private readonly store: SessionStore;
  private readonly endpoints: CaptureEndpoints;
  private readonly onChange?: () => void;

  constructor(
    store: SessionStore,
    endpoints: CaptureEndpoints,
    onChange?: () => void,
  ) {
    this.store = store;
    this.endpoints = endpoints;
    this.onChange = onChange;
    if (typeof window !== 'undefined') window.addEventListener('pagehide', this.onPageHide);
  }

  private readonly onPageHide = (): void => { this.dispose(); };

  private changed(): void { this.onChange?.(); }

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
    this.error = null;
    if (!validateEndpoints(this.endpoints)) {
      this.error = 'Configure secure analysis and coaching endpoints before recording.';
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
      this.captureStartedAt = performance.now();
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
    const stream = this.stream;
    const attemptId = this.activeAttemptId;
    const settings = stream.getAudioTracks()[0]?.getSettings();
    const durationMs = Math.max(0, Math.round(performance.now() - this.captureStartedAt));
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
      await this.process(record, blob, recorder.mimeType, durationMs, settings, generation);
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

  private async post(url: string, body: BodyInit, headers?: HeadersInit): Promise<unknown> {
    const controller = new AbortController();
    this.request = controller;
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
      if (this.request === controller) this.request = null;
    }
  }

  private fail(record: AttemptRecord, stage: 'capture' | 'upload' | 'analysis' | 'coaching', detail: string): void {
    this.error = detail;
    this.store.fail(record.attemptId, stage, detail);
    this.changed();
  }

  private async process(
    record: AttemptRecord, blob: Blob, mimeType: string, durationMs: number,
    settings: MediaTrackSettings | undefined, generation: number,
  ): Promise<void> {
    const passage = passages.find((item) => item.id === record.passageId && item.version === record.passageVersion);
    if (!passage) { this.fail(record, 'analysis', 'The selected passage is unavailable.'); return; }
    const metadata = {
      attemptId: record.attemptId, passageId: record.passageId, passageVersion: record.passageVersion,
      attemptTempoBpm: passage.tempoBpm, captureSource: 'phone',
      sampleRateHz: settings?.sampleRate ?? null, channelCount: settings?.channelCount ?? null,
      encoding: mimeType, durationMs,
    };
    const form = new FormData();
    form.append('audio', blob, `attempt.${extension(mimeType)}`);
    form.append('metadata', JSON.stringify(metadata));
    let analysis: unknown;
    try {
      this.requestStage = 'upload';
      analysis = await this.post(this.endpoints.analysis, form);
    } catch (cause) {
      if (generation === this.generation) {
        this.fail(record, cause instanceof InvalidResponseError ? 'analysis' : 'upload',
          cause instanceof InvalidResponseError ? message(cause) : `Analysis upload failed: ${message(cause)}`);
      }
      return;
    }
    if (generation !== this.generation || this.disposed) return;
    if (!this.store.applyAnalysis(record.attemptId, analysis)) {
      this.fail(record, 'analysis', 'The analysis response was invalid.');
      return;
    }
    if (record.analysis?.status !== 'ok') return;
    try {
      this.requestStage = 'coaching';
      const coaching = await this.post(this.endpoints.coaching, JSON.stringify({
        schemaVersion: '1', attemptId: record.attemptId, passageId: record.passageId,
        passageVersion: record.passageVersion, passage, analysis: record.analysis,
      }), { 'Content-Type': 'application/json' });
      if (generation !== this.generation || this.disposed) return;
      if (!this.store.applyCoaching(record.attemptId, coaching)) {
        this.fail(record, 'coaching', 'The coaching response was invalid.');
      }
    } catch (cause) {
      if (generation === this.generation) this.fail(record, 'coaching', `Coaching failed: ${message(cause)}`);
    }
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
    this.disposed = true;
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.onPageHide);
  }
}
