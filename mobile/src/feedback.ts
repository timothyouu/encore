import { noteName, type Passage, type ReferenceNote } from './passages.ts';
import type { AttemptRecord, Finding } from './session.ts';

// Pure result wording and finding order, shared by every view of a result so
// the phone and any mirrored display describe the same finding the same way.

export function findingBeat(finding: Finding, passage: Passage, record: AttemptRecord): number {
  const reference = passage.notes.find((note) => note.id === finding.referenceNoteId);
  if (reference) return reference.onsetBeat;
  const detected = record.analysis?.detectedNotes.find((note) => note.id === finding.detectedNoteId);
  return detected ? detected.onsetSec * (record.analysis?.attemptTempoBpm ?? passage.tempoBpm) / 60 : Number.MAX_SAFE_INTEGER;
}

export function orderedFindings(record: AttemptRecord, passage: Passage): Finding[] {
  return [...(record.analysis?.findings ?? [])].sort((a, b) => findingBeat(a, passage, record) - findingBeat(b, passage, record));
}

export function referenceFor(finding: Finding | undefined, passage: Passage): ReferenceNote | undefined {
  return passage.notes.find((note) => note.id === finding?.referenceNoteId);
}

export function findingTitle(finding: Finding): string {
  return { wrong_note: 'Note mismatch', missing_note: 'Missing note', extra_note: 'Extra note', timing: 'Timing' }[finding.kind];
}

export function detailFor(finding: Finding, passage: Passage, record: AttemptRecord): string {
  const reference = referenceFor(finding, passage);
  const detected = record.analysis?.detectedNotes.find((note) => note.id === finding.detectedNoteId);
  if (finding.kind === 'wrong_note') return `Expected ${reference ? noteName(reference.midiPitch) : 'a note'} · Heard ${detected ? noteName(detected.midiPitch) : 'another note'}`;
  if (finding.kind === 'missing_note') return `Expected ${reference ? noteName(reference.midiPitch) : 'a note'} · Not detected`;
  if (finding.kind === 'extra_note') return `Heard ${detected ? noteName(detected.midiPitch) : 'an extra note'} outside the reference`;
  const delta = finding.timingDeltaMs ?? 0;
  return `${reference ? noteName(reference.midiPitch) : 'Note'} · ${Math.abs(Math.round(delta))} ms ${delta >= 0 ? 'late' : 'early'}`;
}

export function correctionFor(finding: Finding, passage: Passage): string {
  const reference = referenceFor(finding, passage);
  if (!reference) return 'Listen for the next expected note, then try the passage again.';
  const beat = reference.onsetBeat + 1;
  if (finding.kind === 'timing') return `Place ${noteName(reference.midiPitch)} on beat ${beat}.`;
  return `Play ${noteName(reference.midiPitch)} on beat ${beat}.`;
}
