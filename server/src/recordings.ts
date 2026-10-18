import { createHash, randomUUID } from 'node:crypto';
import type { Passage, RecordingMetadata, RecordingReceipt } from './contracts.js';
import { InputError } from './validation.js';

export const MAX_WAV_BYTES = 1_350_000;
export const MAX_JSON_BYTES = 1_850_000;
const TTL_MS = 10 * 60 * 1000;
const MAX_ARTIFACTS = 24;

export type Artifact = {
  metadata: RecordingMetadata;
  bytes: Buffer;
  digest: string;
  id: string;
  expiresAt: number;
  analysis?: unknown;
  analysisPromise?: Promise<unknown>;
  coaching?: unknown;
  coachingPromise?: Promise<unknown>;
};
function obj(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('object required');
  return value as Record<string, unknown>;
}
export function parseId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 80 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new InputError(label + ' invalid');
  }
  return value;
}
function numeric(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new InputError(label + ' invalid');
  return value;
}
export function parseRecording(value: unknown, library: Passage[]): { metadata: RecordingMetadata; bytes: Buffer } {
  const root = obj(value);
  const raw = obj(root.metadata);
  const passageId = parseId(raw.passageId, 'passageId');
  const passageVersion = parseId(raw.passageVersion, 'passageVersion');
  if (!library.some(p => p.id === passageId && p.version === passageVersion)) throw new InputError('unknown passage');
  const sampleRate = numeric(raw.sampleRate, 'sampleRate', 22050, 22050);
  const channels = numeric(raw.channels, 'channels', 1, 1);
  if (raw.encoding !== 'pcm_s16le') throw new InputError('encoding invalid');
  if (raw.captureSource !== 'phone' && raw.captureSource !== 'test') throw new InputError('captureSource invalid');
  const metadata: RecordingMetadata = {
    attemptId: parseId(raw.attemptId, 'attemptId'), passageId, passageVersion,
    attemptTempoBpm: numeric(raw.attemptTempoBpm, 'attemptTempoBpm', 30, 240),
    sourceSampleRate: numeric(raw.sourceSampleRate, 'sourceSampleRate', 8000, 192000),
    sampleRate: sampleRate as 22050, channels: channels as 1,
    encoding: 'pcm_s16le', durationSec: numeric(raw.durationSec, 'durationSec', 1, 30),
    captureSource: raw.captureSource
  };
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(metadata.attemptId) ||
      !/^[A-Za-z0-9_-]{1,32}$/.test(passageId) ||
      !/^[A-Za-z0-9_.-]{1,32}$/.test(passageVersion) ||
      !Number.isInteger(metadata.sourceSampleRate)) throw new InputError('analysis metadata invalid');
  if (typeof root.wavBase64 !== 'string' || root.wavBase64.length > Math.ceil(MAX_WAV_BYTES / 3) * 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(root.wavBase64) || root.wavBase64.length % 4 !== 0) {
    throw new InputError('WAV base64 invalid');
  }
  const bytes = Buffer.from(root.wavBase64, 'base64');
  if (bytes.length > MAX_WAV_BYTES || bytes.length < 46 || bytes.toString('base64') !== root.wavBase64) {
    throw new InputError('WAV bytes invalid');
  }
  validateWav(bytes, metadata.durationSec);
  return { metadata, bytes };
}
export function validateWav(bytes: Buffer, declaredDuration: number): void {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' ||
      bytes.readUInt32LE(4) !== bytes.length - 8) throw new InputError('WAV header invalid');
  let offset = 12;
  let format = false;
  let samples = -1;
  while (offset + 8 <= bytes.length) {
    const kind = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (size > bytes.length - start) throw new InputError('WAV chunk invalid');
    if (kind === 'fmt ') {
      if (size < 16 || bytes.readUInt16LE(start) !== 1 || bytes.readUInt16LE(start + 2) !== 1 ||
          bytes.readUInt32LE(start + 4) !== 22050 || bytes.readUInt32LE(start + 8) !== 44100 ||
          bytes.readUInt16LE(start + 12) !== 2 || bytes.readUInt16LE(start + 14) !== 16) {
        throw new InputError('WAV format invalid');
      }
      format = true;
    }
    if (kind === 'data') {
      if (size < 2 || size % 2 !== 0 || samples >= 0) throw new InputError('WAV data invalid');
      samples = size / 2;
    }
    offset = start + size + (size & 1);
  }
  if (!format || samples < 0 || Math.abs(samples / 22050 - declaredDuration) > 0.05) {
    throw new InputError('WAV duration invalid');
  }
}
export class ArtifactStore {
  private byId = new Map<string, Artifact>();
  private byAttempt = new Map<string, string>();
  constructor(private clock: () => number = Date.now) {}
  cleanup(): void {
    const now = this.clock();
    for (const [id, artifact] of this.byId) {
      if (artifact.expiresAt <= now && !artifact.analysisPromise && !artifact.coachingPromise) {
        this.byId.delete(id);
        this.byAttempt.delete(artifact.metadata.attemptId);
      }
    }
  }
  put(metadata: RecordingMetadata, bytes: Buffer, audioBase: string): RecordingReceipt {
    this.cleanup();
    const digest = createHash('sha256').update(bytes).digest('hex');
    const existingId = this.byAttempt.get(metadata.attemptId);
    let artifact = existingId ? this.byId.get(existingId) : undefined;
    if (artifact) {
      if (artifact.digest !== digest || JSON.stringify(artifact.metadata) !== JSON.stringify(metadata)) {
        throw new AttemptConflictError();
      }
    } else {
      if (this.byId.size >= MAX_ARTIFACTS) throw new StoreFullError();
      artifact = { id: randomUUID(), metadata, bytes: Buffer.from(bytes), digest, expiresAt: this.clock() + TTL_MS };
      this.byId.set(artifact.id, artifact);
      this.byAttempt.set(metadata.attemptId, artifact.id);
    }
    return {
      ...metadata, artifactId: artifact.id, audioUrl: audioBase + '/v1/recordings/' + artifact.id + '/audio',
      expiresAt: new Date(artifact.expiresAt).toISOString(), sha256: artifact.digest, mimeType: 'audio/wav'
    };
  }
  get(id: string): Artifact | undefined {
    this.cleanup();
    return this.byId.get(id);
  }
}
export class AttemptConflictError extends Error {}
export class StoreFullError extends Error {}
