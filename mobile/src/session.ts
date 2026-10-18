import { analysisSegmentsValid, calculateDisplaySegments } from '../../shared/segments.ts';
import { feedbackEntries, type FeedbackEntry } from '../../shared/feedback.ts';
import { groundedVisualPlan } from './paper-evidence.ts';
import { passages, type Passage } from './passages.ts';
import type { AnalysisResult, CoachingResult, DetectedNote, Finding } from '../../shared/contracts.ts';
import type { PhonePersistence } from './storage.ts';
import { beginTelemetrySpan, endTelemetrySpan, measureTelemetry, recordTelemetryFailure } from './telemetry.ts';
export type { AnalysisResult, CoachingResult, DetectedNote, Finding, DisplaySegment, FindingLocation } from '../../shared/contracts.ts';

export type AttemptRecord = {
  attemptId: string; passageId: string; passageVersion: string; startedAt: string; completedAt: string | null;
  captureStatus: 'recording' | 'completed' | 'canceled' | 'interrupted';
  processingStatus: 'not_started' | 'processing' | 'result' | 'error';
  analysis: AnalysisResult | null; coaching: CoachingResult | null;
  error: { stage: 'capture' | 'normalization' | 'upload' | 'analysis' | 'coaching'; message: string } | null;
  captureSource?: 'demo' | 'phone' | 'test' | 'g2';
};

type Screen = 'library' | 'ready' | 'recording' | 'processing' | 'review' | 'guide' | 'sheet' | 'history' | 'error';
export type SessionState = {
  screen: Screen; passageId: string | null; attemptId: string | null; findingIndex: number;
  historyOrigin: boolean; sheetOrigin: 'review' | 'guide';
};
type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };
const STORAGE_KEY = 'encore.attempts.v1';
export const SESSION_STORAGE_KEY = STORAGE_KEY;
export const HISTORY_CAP = 1000;

function createAttemptId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === 'function') cryptoApi.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const POSE_IDS = new Set(['finger-1', 'finger-2', 'finger-3', 'finger-4', 'finger-5', 'neutral']);
const KINDS = new Set(['wrong_note', 'missing_note', 'extra_note', 'timing', 'duration']);
const STATUSES = new Set(['ok', 'uncertain', 'insufficient_audio', 'error']);
const STAGES = new Set(['capture', 'normalization', 'upload', 'analysis', 'coaching']);

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function string(value: unknown, max = 200): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}
function finite(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
function integer(value: unknown, min: number, max: number): value is number {
  return finite(value, min, max) && Number.isInteger(value);
}
function strings(value: unknown, maxItems = 100, maxLength = 200): value is string[] {
  return Array.isArray(value) && value.length <= maxItems && value.every((item: unknown) => string(item, maxLength));
}
function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
}
function iso(value: unknown): value is string {
  return string(value, 40) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function passageFor(record: AttemptRecord): Passage | undefined {
  return passages.find((passage) => passage.id === record.passageId && passage.version === record.passageVersion);
}
function analysisValid(value: unknown, record: AttemptRecord): value is AnalysisResult {
  const passage = passageFor(record);
  if (!passage || !object(value)) return false;
  if (!['1', '2'].includes(String(value.schemaVersion)) || value.attemptId !== record.attemptId ||
      value.passageId !== record.passageId || value.passageVersion !== record.passageVersion ||
      !finite(value.attemptTempoBpm, 20, 300) || !STATUSES.has(String(value.status)) ||
      !string(value.detectorVersion, 80) || !string(value.scoringVersion, 80) ||
      !object(value.audioQuality) || typeof value.audioQuality.clipped !== 'boolean' ||
      typeof value.audioQuality.hasDropouts !== 'boolean' || !strings(value.audioQuality.warnings, 20, 240) ||
      !object(value.alignment) || typeof value.alignment.reliable !== 'boolean' ||
      !(value.alignment.offsetSec === null || finite(value.alignment.offsetSec, -120, 120)) ||
      !Array.isArray(value.detectedNotes) || value.detectedNotes.length > 500 ||
      !Array.isArray(value.findings) || value.findings.length > 500 || !object(value.metrics)) return false;
  const notes = value.detectedNotes;
  if (!notes.every((note: unknown) => object(note) && string(note.id, 80) && integer(note.midiPitch, 0, 127) &&
      finite(note.onsetSec, 0, 600) && finite(note.durationSec, 0.001, 600) &&
      (note.detectorScore === undefined || finite(note.detectorScore, 0, 1)))) return false;
  const detectedIds = notes.map((note: DetectedNote) => note.id);
  if (!unique(detectedIds)) return false;
  const referenceIds = new Set(passage.notes.map((note) => note.id));
  const detectedSet = new Set(detectedIds);
  const findings = value.findings;
  if (!findings.every((finding: unknown) => object(finding) && string(finding.id, 80) &&
      KINDS.has(String(finding.kind)) &&
      (finding.referenceNoteId === undefined || (string(finding.referenceNoteId, 80) && referenceIds.has(finding.referenceNoteId))) &&
      (finding.detectedNoteId === undefined || (string(finding.detectedNoteId, 80) && detectedSet.has(finding.detectedNoteId))) &&
      (finding.timingDeltaMs === undefined || finite(finding.timingDeltaMs, -600000, 600000)) &&
      (finding.durationDeltaMs === undefined || finite(finding.durationDeltaMs, -600000, 600000)) &&
      (finding.kind !== 'timing' || (finding.referenceNoteId !== undefined && finding.timingDeltaMs !== undefined)) &&
      (finding.kind !== 'duration' || (finding.referenceNoteId !== undefined && finding.detectedNoteId !== undefined && finding.durationDeltaMs !== undefined)) &&
      (finding.kind !== 'wrong_note' || (finding.referenceNoteId !== undefined && finding.detectedNoteId !== undefined)) &&
      (finding.kind !== 'missing_note' || finding.referenceNoteId !== undefined) &&
      (finding.kind !== 'extra_note' || finding.detectedNoteId !== undefined))) return false;
  if (!unique(findings.map((finding: Finding) => finding.id))) return false;
  if (!analysisSegmentsValid(value as AnalysisResult, passage)) return false;
  if (value.status === 'ok' && (value.audioQuality.clipped || value.audioQuality.hasDropouts ||
      !value.alignment.reliable || value.alignment.offsetSec === null)) return false;
  if (value.status !== 'ok' && findings.length > 0) return false;
  const metrics = value.metrics;
  return integer(metrics.expectedNotes, 0, passage.notes.length) &&
    metrics.expectedNotes === passage.notes.length &&
    integer(metrics.matchedNotes, 0, passage.notes.length) &&
    (metrics.medianAbsTimingErrorMs === null || finite(metrics.medianAbsTimingErrorMs, 0, 600000));
}
function coachingValid(value: unknown, record: AttemptRecord): value is CoachingResult {
  const passage = passageFor(record);
  if (!passage || !record.analysis || record.analysis.status !== 'ok' || !object(value) || !object(value.visual)) return false;
  const findingIds = new Set(record.analysis.findings.map((finding) => finding.id));
  const findingMap = new Map(record.analysis.findings.map((finding) => [finding.id, finding]));
  const referenceIds = new Set(passage.notes.map((note) => note.id));
  const visual = value.visual;
  const segment = record.analysis.displaySegments?.find(candidate => candidate.id === value.primarySegmentId);
  const segmentValid = value.schemaVersion === '1' ? value.primarySegmentId === undefined :
    Array.isArray(record.analysis.displaySegments) && Array.isArray(value.evidenceFindingIds) &&
    (value.primarySegmentId === null
      ? value.evidenceFindingIds.every(id => {
        const finding = findingMap.get(id);
        return !!finding && finding.segmentIds?.length === 0;
      })
      : !!segment && value.evidenceFindingIds.some(id => segment.findingIds.includes(id)));
  return value.schemaVersion === record.analysis.schemaVersion && segmentValid && value.attemptId === record.attemptId &&
    ['gemini', 'fallback', 'analysis_only'].includes(String(value.coachingSource)) &&
    (value.fallbackReason === undefined || ['missing_key', 'model_error', 'invalid_response', 'timeout'].includes(String(value.fallbackReason))) &&
    string(value.cue, 120) && !/[<>]/.test(value.cue) &&
    (value.visualPlan === undefined || groundedVisualPlan(value.visualPlan, record.analysis, passage,
      Array.isArray(value.evidenceFindingIds) ? value.evidenceFindingIds[0] as string | undefined : undefined)) &&
    strings(value.evidenceFindingIds, 10, 80) && unique(value.evidenceFindingIds) &&
    value.evidenceFindingIds.every((id: string) => findingIds.has(id)) &&
    (findingIds.size === 0 || value.evidenceFindingIds.length > 0) &&
    (visual.kind === 'keyboard' || visual.kind === 'rhythm_strip' || visual.kind === 'none') &&
    strings(visual.referenceNoteIds, 20, 80) && unique(visual.referenceNoteIds) &&
    visual.referenceNoteIds.every((id: string) => referenceIds.has(id)) &&
    strings(visual.poseIds, 20, 40) && visual.poseIds.every((id: string) => POSE_IDS.has(id)) &&
    Array.isArray(visual.mistakes) && visual.mistakes.length <= 20 &&
    visual.mistakes.every((mistake: unknown) => {
      if (!object(mistake) || !string(mistake.findingId, 80)) return false;
      const finding = findingMap.get(mistake.findingId);
      return !!finding && mistake.referenceNoteId === finding.referenceNoteId &&
        mistake.detectedNoteId === finding.detectedNoteId &&
        (mistake.referenceNoteId === undefined || (string(mistake.referenceNoteId, 80) &&
          (visual.referenceNoteIds as string[]).includes(mistake.referenceNoteId)));
    }) &&
    unique(visual.mistakes.map((mistake: { findingId: string }) => mistake.findingId)) &&
    visual.mistakes.every((mistake: { findingId: string }) => (value.evidenceFindingIds as string[]).includes(mistake.findingId)) &&
    (visual.kind !== 'none' || (visual.referenceNoteIds.length === 0 && visual.poseIds.length === 0 && visual.mistakes.length === 0));
}
function recordValid(value: unknown): value is AttemptRecord {
  if (!object(value) || !string(value.attemptId, 100) || !string(value.passageId, 40) ||
      !string(value.passageVersion, 40) || !iso(value.startedAt) ||
      !(value.completedAt === null || iso(value.completedAt)) ||
      !['recording', 'completed', 'canceled', 'interrupted'].includes(String(value.captureStatus)) ||
      !['not_started', 'processing', 'result', 'error'].includes(String(value.processingStatus)) ||
      !(value.captureSource === undefined || ['demo', 'phone', 'test', 'g2'].includes(String(value.captureSource)))) return false;
  const record = value as AttemptRecord;
  if (!passageFor(record) || (record.captureStatus === 'completed') !== (record.completedAt !== null)) return false;
  if (record.error !== null && (!object(record.error) || !STAGES.has(String(record.error.stage)) ||
      !string(record.error.message, 240))) return false;
  if (record.analysis !== null && !analysisValid(record.analysis, record)) return false;
  if (record.coaching !== null && !coachingValid(record.coaching, record)) return false;
  return true;
}

function parseRecords(raw: string): AttemptRecord[] {
  const saved: unknown = JSON.parse(raw);
  if (!object(saved) || saved.version !== 1 || !Array.isArray(saved.records) ||
      saved.records.length > 1000 || !saved.records.every(recordValid) ||
      !unique(saved.records.map((record: AttemptRecord) => record.attemptId))) {
    throw new Error('Invalid saved session data');
  }
  return saved.records;
}

export class SessionStore {
  processingStage: 'normalization' | 'upload' | 'analysis' | 'coaching' | null = null;
  state: SessionState = {
    screen: 'library', passageId: null, attemptId: null, findingIndex: 0,
    historyOrigin: false, sheetOrigin: 'review',
  };
  records: AttemptRecord[] = [];
  storageWarning: string | null = null;
  private storage: Storage | undefined;
  private persistence: PhonePersistence | undefined;
  private listeners = new Set<() => void>();

  constructor(storage?: Storage) {
    try {
      this.storage = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
      const raw = this.storage?.getItem(`${STORAGE_KEY}.migrated`) === '1' ? null : this.storage?.getItem(STORAGE_KEY);
      if (raw) this.restore(raw);
    } catch {
      this.records = [];
      this.storageWarning = 'Saved history could not be loaded.';
    }
  }

  async hydrate(persistence: PhonePersistence): Promise<void> {
    try {
      const raw = await persistence.load(STORAGE_KEY, value => {
        try { parseRecords(value); return true; } catch { return false; }
      });
      this.persistence = persistence;
      this.records = [];
      if (raw) this.restore(raw);
      this.storageWarning = persistence.warning;
    } catch {
      this.storageWarning = 'Local history storage is unavailable. Changes may last only for this session.';
    }
    this.emit();
  }

  private restore(raw: string): void {
    this.records = parseRecords(raw);
    let changed = false;
    for (const record of this.records) {
      if (record.captureStatus === 'recording') {
        record.captureStatus = 'interrupted';
        record.processingStatus = 'error';
        record.error = { stage: 'capture', message: 'Recording was interrupted when the app closed.' };
        changed = true;
      } else if (record.captureStatus === 'completed' &&
          (record.processingStatus === 'processing' || record.processingStatus === 'not_started')) {
        record.processingStatus = 'error';
        record.error = { stage: record.analysis ? 'coaching' : 'upload', message: 'Processing was interrupted. Retry this attempt while its audio is available.' };
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  warnStorage(message: string): void { this.storageWarning = message; this.emit(); }
  private emit(): void { for (const listener of this.listeners) listener(); }
  private persist(): void {
    const snapshot = JSON.stringify({ version: 1, records: this.records });
    if (this.persistence) {
      const span = beginTelemetrySpan('app.history_persist', undefined, 'app');
      void this.persistence.save(STORAGE_KEY, snapshot).then(() => {
        endTelemetrySpan(span, 'ok');
        if (this.storageWarning?.startsWith('History could not be saved')) {
          this.storageWarning = null; this.emit();
        }
      }, () => {
        endTelemetrySpan(span, 'error');
        recordTelemetryFailure('history', 'storage_failed', 'app');
        this.storageWarning = 'History could not be saved on this device. Changes may last only for this session.';
        this.emit();
      });
      return;
    }
    try {
      measureTelemetry('app.history_persist', () => this.storage?.setItem(STORAGE_KEY, snapshot));
    } catch {
      recordTelemetryFailure('history', 'storage_failed', 'app');
      this.storageWarning = 'History could not be saved on this device.';
    }
  }
  private save(): void { this.persist(); this.emit(); }
  private current(): AttemptRecord | undefined {
    return this.records.find((record) => record.attemptId === this.state.attemptId);
  }
  entries(): FeedbackEntry[] {
    const record = this.current();
    const passage = record && passageFor(record);
    return record?.analysis && passage ? feedbackEntries(record.analysis, passage, record.coaching) : [];
  }
  selectedEntry(): FeedbackEntry | undefined { return this.entries()[this.state.findingIndex]; }
  selectEntry(index: number): void {
    if (!['review', 'guide'].includes(this.state.screen) || !Number.isInteger(index) ||
        index < 0 || index >= this.entries().length) return;
    this.state = { ...this.state, screen: 'review', findingIndex: index };
    this.emit();
  }
  // Review and Guide form a pair for each finding/bar; both directions keep that identity.
  moveFeedback(delta: number): void {
    if (!Number.isInteger(delta) || !['review', 'guide'].includes(this.state.screen)) return;
    const count = this.entries().length;
    if (!count) return;
    const position = this.state.findingIndex * 2 + (this.state.screen === 'guide' ? 1 : 0);
    const next = Math.max(0, Math.min(count * 2 - 1, position + delta));
    if (position === next) return;
    this.state = { ...this.state, findingIndex: Math.floor(next / 2), screen: next % 2 ? 'guide' : 'review' };
    this.emit();
  }
  showSavedAnalysis(): void {
    if (this.state.screen !== 'error' || this.current()?.analysis?.status !== 'ok') return;
    this.state = { ...this.state, screen: 'review', findingIndex: 0 };
    this.emit();
  }
  selectPassage(id: string): void {
    if (this.state.screen !== 'library' || !passages.some((passage) => passage.id === id)) return;
    this.state = { ...this.state, screen: 'ready', passageId: id, attemptId: null, findingIndex: 0, historyOrigin: false };
    this.emit();
  }
  // 'g2' only labels the record; the store never talks to a device.
  start(source: 'demo' | 'phone' | 'test' | 'g2' = 'demo'): AttemptRecord | null {
    if (this.state.screen !== 'ready' || !['demo', 'phone', 'test', 'g2'].includes(source)) return null;
    if (this.records.length >= HISTORY_CAP) {
      this.warnStorage('History is full at 1,000 attempts. Existing results are preserved; a new attempt cannot be recorded.');
      return null;
    }
    const passage = passages.find((item) => item.id === this.state.passageId);
    if (!passage) return null;
    const record: AttemptRecord = {
      attemptId: createAttemptId(), passageId: passage.id, passageVersion: passage.version,
      startedAt: new Date().toISOString(), completedAt: null, captureStatus: 'recording',
      processingStatus: 'not_started', analysis: null, coaching: null, error: null, captureSource: source,
    };
    this.records.push(record);
    this.state = { ...this.state, screen: 'recording', attemptId: record.attemptId };
    this.save();
    return record;
  }
  stop(): AttemptRecord | null {
    if (this.state.screen !== 'recording') return null;
    const record = this.current();
    if (!record || record.captureStatus !== 'recording') return null;
    record.captureStatus = 'completed';
    record.completedAt = new Date().toISOString();
    this.persist();
    record.processingStatus = 'processing';
    this.processingStage = 'normalization';
    this.state = { ...this.state, screen: 'processing' };
    this.save();
    return record;
  }
  cancel(): void {
    if (this.state.screen !== 'recording') return;
    const record = this.current();
    if (!record || record.captureStatus !== 'recording') return;
    record.captureStatus = 'canceled';
    this.state = { ...this.state, screen: 'library', passageId: null, attemptId: null };
    this.save();
  }
  interrupt(): void {
    if (this.state.screen !== 'recording') return;
    const record = this.current();
    if (!record || record.captureStatus !== 'recording') return;
    record.captureStatus = 'interrupted';
    record.processingStatus = 'error';
    record.error = { stage: 'capture', message: 'Recording was interrupted.' };
    this.state = { ...this.state, screen: 'error' };
    this.save();
  }
  showLibrary(): void {
    if (this.state.screen === 'recording') return;
    this.state = { ...this.state, screen: 'library', passageId: null, attemptId: null,
      findingIndex: 0, historyOrigin: false };
    this.processingStage = null;
    this.emit();
  }
  showHistory(): void {
    if (!['library', 'review', 'guide', 'sheet', 'error', 'processing', 'history'].includes(this.state.screen)) return;
    this.state = { ...this.state, screen: 'history', passageId: null, attemptId: null,
      findingIndex: 0, historyOrigin: true };
    this.emit();
  }
  openAttempt(id: string): void {
    if (this.state.screen !== 'history') return;
    const record = this.records.find((item) => item.attemptId === id);
    if (!record) return;
    const screen: Screen = record.processingStatus === 'result' ? 'review' :
      record.processingStatus === 'processing' ? 'processing' : 'error';
    this.state = { ...this.state, screen, passageId: record.passageId, attemptId: id,
      findingIndex: 0, historyOrigin: true };
    this.emit();
  }
  showGuide(): void {
    if (this.state.screen !== 'review' || !this.selectedEntry()) return;
    this.state = { ...this.state, screen: 'guide' };
    this.emit();
  }
  showReview(): void {
    if (this.state.screen !== 'guide') return;
    this.state = { ...this.state, screen: 'review' };
    this.emit();
  }
  showSheet(): void {
    if (this.state.screen !== 'review' && this.state.screen !== 'guide') return;
    this.state = { ...this.state, sheetOrigin: this.state.screen, screen: 'sheet' };
    this.emit();
  }
  closeSheet(): void {
    if (this.state.screen !== 'sheet') return;
    this.state = { ...this.state, screen: this.state.sheetOrigin };
    this.emit();
  }
  moveFinding(delta: number): void {
    if (!Number.isInteger(delta) || !['review', 'guide', 'sheet'].includes(this.state.screen)) return;
    const length = this.entries().length;
    const next = Math.max(0, Math.min(Math.max(0, length - 1), this.state.findingIndex + delta));
    if (next === this.state.findingIndex) return;
    this.state = { ...this.state, findingIndex: next };
    this.emit();
  }
  applyAnalysis(attemptId: string, input: unknown, replaceExisting = false): boolean {
    const record = this.records.find((item) => item.attemptId === attemptId);
    if (!record || record.captureStatus !== 'completed' || record.processingStatus !== 'processing' ||
        (record.analysis !== null && !replaceExisting) || !analysisValid(input, record)) return false;
    try { record.analysis = structuredClone(input); } catch { return false; }
    if (input.status === 'ok') {
      // Coaching remains pending. The deterministic analysis is already saved.
    } else if (input.status === 'error') {
      record.processingStatus = 'error';
      record.error = { stage: 'analysis', message: 'Analysis could not complete.' };
    } else {
      record.processingStatus = 'result';
      this.processingStage = null;
    }
    if (this.state.attemptId === attemptId && this.state.screen === 'processing' &&
        record.processingStatus !== 'processing') {
      this.state = { ...this.state, screen: record.processingStatus === 'result' ? 'review' : 'error' };
    }
    this.save();
    return true;
  }
  applyCoaching(attemptId: string, input: unknown): boolean {
    const record = this.records.find((item) => item.attemptId === attemptId);
    if (!record || record.captureStatus !== 'completed' || record.processingStatus !== 'processing' ||
        record.coaching !== null || !coachingValid(input, record)) return false;
    try { record.coaching = structuredClone(input); } catch { return false; }
    record.processingStatus = 'result';
    this.processingStage = null;
    record.error = null;
    if (this.state.attemptId === attemptId && this.state.screen === 'processing') {
      this.state = { ...this.state, screen: 'review' };
    }
    this.save();
    return true;
  }
  fail(attemptId: string, stage: 'capture' | 'normalization' | 'upload' | 'analysis' | 'coaching', message: string): void {
    const record = this.records.find((item) => item.attemptId === attemptId);
    if (!record || record.captureStatus !== 'completed' || record.processingStatus !== 'processing' ||
        !STAGES.has(stage)) return;
    record.processingStatus = 'error';
    this.processingStage = null;
    record.error = { stage, message: string(message, 240) ? message : 'Processing failed.' };
    if (this.state.attemptId === attemptId && this.state.screen === 'processing') {
      this.state = { ...this.state, screen: 'error' };
    }
    this.save();
  }
  setProcessingStage(attemptId: string, stage: 'normalization' | 'upload' | 'analysis' | 'coaching'): void {
    const record = this.records.find((item) => item.attemptId === attemptId);
    if (!record || record.processingStatus !== 'processing') return;
    this.processingStage = stage;
    this.emit();
  }
  beginRetry(attemptId: string): boolean {
    const record = this.records.find((item) => item.attemptId === attemptId);
    if (!record || record.captureStatus !== 'completed' || record.processingStatus !== 'error' ||
        !record.error || record.error.stage === 'capture') return false;
    if (record.analysis?.status === 'error') record.analysis = null;
    record.processingStatus = 'processing';
    record.error = null;
    this.processingStage = record.analysis?.status === 'ok' ? 'coaching' : 'normalization';
    if (this.state.attemptId === attemptId && this.state.screen === 'error') this.state = { ...this.state, screen: 'processing' };
    this.save();
    return true;
  }
  count(passageId?: string): number {
    return this.records.filter((record) => record.captureStatus === 'completed' &&
      (passageId === undefined || record.passageId === passageId)).length;
  }
}

export function fixtureAnalysis(record: AttemptRecord, scenario: 'mistakes' | 'clean' | 'uncertain' | 'error', schemaVersion: '1' | '2' = '1'): AnalysisResult {
  const passage = passageFor(record);
  if (!passage) throw new Error('Unknown passage');
  const detectedNotes: DetectedNote[] = passage.notes.map((note, index) => ({
    id: 'detected-' + String(index + 1), midiPitch: note.midiPitch + (scenario === 'mistakes' && index === 2 ? 1 : 0),
    onsetSec: note.onsetBeat * 60 / passage.tempoBpm + (scenario === 'mistakes' && index === 4 ? 0.25 : 0),
    durationSec: note.durationBeats * 60 / passage.tempoBpm,
    detectorScore: 0.9,
  })).filter((_note, index) => scenario !== 'mistakes' || index !== 5);
  const findings: Finding[] = scenario === 'mistakes' ? [
    { id: 'finding-1', kind: 'wrong_note', referenceNoteId: passage.notes[2].id, detectedNoteId: 'detected-3' },
    { id: 'finding-2', kind: 'timing', referenceNoteId: passage.notes[4].id, detectedNoteId: 'detected-5', timingDeltaMs: 250 },
    { id: 'finding-3', kind: 'missing_note', referenceNoteId: passage.notes[5].id },
  ] : [];
  const mapped = schemaVersion === '2' && scenario === 'mistakes'
    ? calculateDisplaySegments(passage, findings, detectedNotes, passage.tempoBpm, { offsetSec: 0, reliable: true })
    : { findings, displaySegments: [] };
  return {
    schemaVersion, ...(schemaVersion === '2' ? { displaySegments: mapped.displaySegments } : {}), attemptId: record.attemptId, passageId: record.passageId,
    passageVersion: record.passageVersion, attemptTempoBpm: passage.tempoBpm,
    status: scenario === 'uncertain' ? 'uncertain' : scenario === 'error' ? 'error' : 'ok',
    detectorVersion: 'demo-fixture-1', scoringVersion: 'demo-fixture-1',
    audioQuality: { clipped: false, hasDropouts: false, warnings: scenario === 'uncertain' ? ['Demo: unclear audio'] : [] },
    alignment: { offsetSec: scenario === 'uncertain' ? null : 0, reliable: scenario !== 'uncertain' },
    detectedNotes: scenario === 'error' ? [] : detectedNotes, findings: scenario === 'error' ? [] : mapped.findings,
    metrics: { matchedNotes: scenario === 'error' ? 0 : scenario === 'mistakes' ? passage.notes.length - 2 : passage.notes.length,
      expectedNotes: passage.notes.length, medianAbsTimingErrorMs: scenario === 'uncertain' || scenario === 'error' ? null : 0 },
  };
}
export function fixtureCoaching(record: AttemptRecord): CoachingResult {
  const passage = passageFor(record);
  if (!passage) throw new Error('Unknown passage');
  const finding = record.analysis?.findings[0];
  return {
    schemaVersion: record.analysis?.schemaVersion ?? '1',
    ...(record.analysis?.schemaVersion === '2' ? { primarySegmentId: record.analysis.displaySegments?.find(segment => segment.findingIds.includes(finding?.id ?? ''))?.id ?? null } : {}),
    attemptId: record.attemptId,
    coachingSource: 'fallback', fallbackReason: 'missing_key',
    cue: finding ? 'Try the highlighted key, then play the phrase again.' : 'That phrase matches the reference. Keep practicing.',
    evidenceFindingIds: finding ? [finding.id] : [],
    visual: finding ? { kind: 'keyboard', referenceNoteIds: finding.referenceNoteId ? [finding.referenceNoteId] : [],
      poseIds: ['finger-3'], mistakes: [{ findingId: finding.id, referenceNoteId: finding.referenceNoteId, detectedNoteId: finding.detectedNoteId }] } :
      { kind: 'none', referenceNoteIds: [], poseIds: [], mistakes: [] },
  };
}
