import { analysisSegmentsValid, validBarMap } from '../../shared/segments.ts';
import type { AnalysisResult, CoachRequest, DetectedNote, Finding, Passage, ReferenceNote } from './contracts.js';

export class InputError extends Error {
  constructor(message: string) { super(message); this.name = 'InputError'; }
}
function fail(message: string): never { throw new InputError(message); }
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + ' must be an object');
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string, max = 120): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\u0000-\u001f]/.test(value)) fail(label + ' invalid');
  return value;
}
function id(value: unknown, label: string): string {
  const parsed = string(value, label, 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(parsed)) fail(label + ' invalid');
  return parsed;
}
function finite(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(label + ' invalid');
  return value;
}
function integer(value: unknown, label: string, min: number, max: number): number {
  const parsed = finite(value, label, min, max);
  if (!Number.isInteger(parsed)) fail(label + ' invalid');
  return parsed;
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(label + ' invalid');
  return value;
}
function array(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(label + ' invalid');
  return value;
}
function optionalId(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : id(value, label);
}
function nullableNumber(value: unknown, label: string, min: number, max: number): number | null {
  return value === null ? null : finite(value, label, min, max);
}
function unique(items: { id: string }[], label: string): void {
  if (new Set(items.map(item => item.id)).size !== items.length) fail(label + ' duplicate IDs');
}
export function parsePassages(value: unknown): Passage[] {
  const raw = Array.isArray(value) ? value : record(value, 'library').passages;
  const passages = array(raw, 'passages', 20).map((entry, index): Passage => {
    const p = record(entry, 'passage ' + index);
    const notes = array(p.notes, 'notes', 64).map((item, noteIndex): ReferenceNote => {
      const n = record(item, 'note ' + noteIndex);
      const hand = n.hand;
      if (hand !== 'right' && hand !== 'left') fail('note hand invalid');
      const finger = n.suggestedFinger;
      return {
        id: id(n.id, 'note ID'),
        midiPitch: integer(n.midiPitch, 'note pitch', 21, 108),
        onsetBeat: finite(n.onsetBeat, 'note onset', 0, 128),
        durationBeats: finite(n.durationBeats, 'note duration', 0.01, 64),
        hand,
        ...(finger === undefined ? {} : { suggestedFinger: integer(finger, 'finger', 1, 5) as 1 | 2 | 3 | 4 | 5 })
      };
    });
    if (notes.length === 0) fail('passage notes empty');
    unique(notes, 'reference notes');
    const passage: Passage = {
      id: id(p.id, 'passage ID'),
      version: id(p.version, 'passage version'),
      title: string(p.title, 'title', 80),
      tempoBpm: finite(p.tempoBpm, 'tempo', 20, 240),
      beatsPerBar: integer(p.beatsPerBar, 'beats per bar', 1, 12),
      notes,
      ...(p.bars === undefined ? {} : { bars: array(p.bars, 'bars', 128).map(item => {
        const bar = record(item, 'bar');
        return { number: integer(bar.number, 'bar number', -10000, 10000),
          startBeat: finite(bar.startBeat, 'bar start', 0, 256),
          endBeat: finite(bar.endBeat, 'bar end', 0, 256) };
      }) })
    };
    if (passage.bars !== undefined && !validBarMap(passage)) fail('invalid authored bar map');
    return passage;
  });
  if (passages.length === 0) fail('passage library empty');
  unique(passages, 'passages');
  return passages;
}
export function parseCoachRequest(value: unknown, library: Passage[]): { request: CoachRequest; passage: Passage } {
  const root = record(value, 'request');
  const passageId = id(root.passageId, 'passageId');
  const passageVersion = id(root.passageVersion, 'passageVersion');
  const passage = library.find(item => item.id === passageId && item.version === passageVersion);
  if (!passage) fail('unknown passage ID/version');
  const a = record(root.analysis, 'analysis');
  if (a.schemaVersion !== '1' && a.schemaVersion !== '2') fail('unsupported analysis schema');
  if (a.passageId !== passageId || a.passageVersion !== passageVersion) fail('analysis passage mismatch');
  const status = a.status;
  if (status !== 'ok' && status !== 'uncertain' && status !== 'insufficient_audio' && status !== 'error') fail('analysis status invalid');
  const quality = record(a.audioQuality, 'audioQuality');
  const alignment = record(a.alignment, 'alignment');
  const metrics = record(a.metrics, 'metrics');
  const detectedNotes = array(a.detectedNotes, 'detectedNotes', 500).map((item): DetectedNote => {
    const n = record(item, 'detected note');
    return {
      id: id(n.id, 'detected note ID'),
      midiPitch: integer(n.midiPitch, 'detected pitch', 21, 108),
      onsetSec: finite(n.onsetSec, 'detected onset', 0, 120),
      durationSec: finite(n.durationSec, 'detected duration', 0.001, 120),
      ...(n.detectorScore === undefined ? {} : { detectorScore: finite(n.detectorScore, 'detector score', 0, 1) })
    };
  });
  unique(detectedNotes, 'detected notes');
  const referenceIds = new Set(passage.notes.map(note => note.id));
  const detectedIds = new Set(detectedNotes.map(note => note.id));
  const findings = array(a.findings, 'findings', 500).map((item): Finding => {
    const f = record(item, 'finding');
    const kind = f.kind;
    if (kind !== 'wrong_note' && kind !== 'missing_note' && kind !== 'extra_note' && kind !== 'timing' && kind !== 'duration') fail('finding kind invalid');
    const referenceNoteId = optionalId(f.referenceNoteId, 'referenceNoteId');
    const detectedNoteId = optionalId(f.detectedNoteId, 'detectedNoteId');
    if (referenceNoteId && !referenceIds.has(referenceNoteId)) fail('finding references unknown note');
    if (detectedNoteId && !detectedIds.has(detectedNoteId)) fail('finding references unknown detection');
    if (kind !== 'extra_note' && !referenceNoteId) fail('finding lacks reference note');
    if (kind === 'extra_note' && !detectedNoteId) fail('extra note lacks detected note');
    if (kind === 'wrong_note' && !detectedNoteId) fail('wrong note lacks detected note');
    if (kind === 'timing' && f.timingDeltaMs === undefined) fail('timing finding lacks delta');
    if (kind === 'duration' && (f.durationDeltaMs === undefined || !detectedNoteId)) fail('duration finding lacks delta or detection');
    return {
      ...(a.schemaVersion === '2' ? {
        location: f.location as Finding['location'], segmentIds: f.segmentIds as string[]
      } : {}),
      id: id(f.id, 'finding ID'),
      kind,
      ...(referenceNoteId ? { referenceNoteId } : {}),
      ...(detectedNoteId ? { detectedNoteId } : {}),
      ...(f.timingDeltaMs === undefined ? {} : { timingDeltaMs: finite(f.timingDeltaMs, 'timing delta', -120000, 120000) }),
      ...(f.durationDeltaMs === undefined ? {} : { durationDeltaMs: finite(f.durationDeltaMs, 'duration delta', -120000, 120000) })
    };
  });
  unique(findings, 'findings');
  if (a.schemaVersion === '1' && (a.displaySegments !== undefined ||
      (a.findings as Record<string, unknown>[]).some(f => f.location !== undefined || f.segmentIds !== undefined))) {
    fail('legacy analysis contains segment fields');
  }
  const expectedNotes = integer(metrics.expectedNotes, 'expected notes', 0, 64);
  if (expectedNotes !== passage.notes.length) fail('expected note count mismatch');
  const matchedNotes = integer(metrics.matchedNotes, 'matched notes', 0, expectedNotes);
  const warnings = array(quality.warnings, 'warnings', 16).map(item => string(item, 'warning', 160));
  const analysis: AnalysisResult = {
    schemaVersion: a.schemaVersion,
    attemptId: id(a.attemptId, 'attemptId'),
    passageId,
    passageVersion,
    attemptTempoBpm: finite(a.attemptTempoBpm, 'attempt tempo', 20, 240),
    status,
    detectorVersion: string(a.detectorVersion, 'detectorVersion', 80),
    scoringVersion: string(a.scoringVersion, 'scoringVersion', 80),
    audioQuality: { clipped: boolean(quality.clipped, 'clipped'), hasDropouts: boolean(quality.hasDropouts, 'hasDropouts'), warnings },
    alignment: { offsetSec: nullableNumber(alignment.offsetSec, 'offsetSec', -120, 120), reliable: boolean(alignment.reliable, 'alignment reliable') },
    detectedNotes,
    findings,
    ...(a.schemaVersion === '2' ? { displaySegments: a.displaySegments as AnalysisResult['displaySegments'] } : {}),
    metrics: { matchedNotes, expectedNotes, medianAbsTimingErrorMs: nullableNumber(metrics.medianAbsTimingErrorMs, 'median timing error', 0, 120000) }
  };
  if (!analysisSegmentsValid(analysis, passage)) fail('invalid analysis segments');
  return { request: { artifactId: id(root.artifactId, 'artifactId'), passageId, passageVersion, analysis }, passage };
}
