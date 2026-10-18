import { feedbackEntries } from '../../shared/feedback.ts';
import type { DisplaySegment } from '../../shared/contracts.ts';
import { noteName, type Passage, type ReferenceNote } from './passages.ts';
import type { AttemptRecord, Finding } from './session.ts';

// Pure result wording and finding order, shared by every view of a result so
// the phone and any mirrored display describe the same finding the same way.

export function findingBeat(finding: Finding, passage: Passage, record: AttemptRecord): number {
  const reference = passage.notes.find((note) => note.id === finding.referenceNoteId);
  if (reference) return reference.onsetBeat;
  const detected = record.analysis?.detectedNotes.find((note) => note.id === finding.detectedNoteId);
  return detected ? (detected.onsetSec - (record.analysis?.alignment.offsetSec ?? 0)) * (record.analysis?.attemptTempoBpm ?? passage.tempoBpm) / 60 : Number.MAX_SAFE_INTEGER;
}

export function orderedFindings(record: AttemptRecord, passage: Passage): Finding[] {
  return record.analysis ? [...new Map(feedbackEntries(record.analysis, passage, record.coaching).map(entry => [entry.finding.id, entry.finding])).values()] : [];
}

export function referenceFor(finding: Finding | undefined, passage: Passage): ReferenceNote | undefined {
  return passage.notes.find((note) => note.id === finding?.referenceNoteId);
}

export function findingTitle(finding: Finding): string {
  return { wrong_note: 'Note mismatch', missing_note: 'Missing note', extra_note: 'Extra note', timing: 'Timing', duration: 'Hold duration' }[finding.kind];
}

export function detailFor(finding: Finding, passage: Passage, record: AttemptRecord): string {
  const reference = referenceFor(finding, passage);
  const detected = record.analysis?.detectedNotes.find((note) => note.id === finding.detectedNoteId);
  if (finding.kind === 'wrong_note') return `Expected ${reference ? noteName(reference.midiPitch) : 'a note'} · Heard ${detected ? noteName(detected.midiPitch) : 'another note'}`;
  if (finding.kind === 'missing_note') return `Expected ${reference ? noteName(reference.midiPitch) : 'a note'} · Not detected`;
  if (finding.kind === 'extra_note') return `Heard ${detected ? noteName(detected.midiPitch) : 'an extra note'} outside the reference`;
  if (finding.kind === 'duration') return `${reference ? noteName(reference.midiPitch) : 'Note'} · Hold duration differs from the reference`;
  const delta = finding.timingDeltaMs ?? 0;
  return `${reference ? noteName(reference.midiPitch) : 'Note'} · ${Math.abs(Math.round(delta))} ms ${delta >= 0 ? 'late' : 'early'}`;
}

export function correctionFor(finding: Finding, passage: Passage): string {
  const reference = referenceFor(finding, passage);
  if (!reference) return 'Listen for the next expected note, then try the passage again.';
  const beat = reference.onsetBeat + 1;
  if (finding.kind === 'timing') return `Place ${noteName(reference.midiPitch)} on beat ${beat}.`;
  if (finding.kind === 'duration') return `Hold ${noteName(reference.midiPitch)} for ${reference.durationBeats} beat${reference.durationBeats === 1 ? '' : 's'}.`;
  return `Play ${noteName(reference.midiPitch)} on beat ${beat}.`;
}

export function segmentLabel(segment: DisplaySegment | null): string {
  return segment ? segment.startBar === segment.endBar ? `Bar ${segment.startBar}` : `Bars ${segment.startBar}–${segment.endBar}` : 'Unlocated';
}

export function locationLabel(finding: Finding, segment: DisplaySegment | null, legacy: boolean): string {
  if (legacy) return 'Legacy result · Full passage';
  if (!segment) return 'Outside reference · No located bar';
  if (!finding.location || finding.location.barNumber < segment.startBar || finding.location.barNumber > segment.endBar) return `${segmentLabel(segment)} · Continued note`;
  return `${segmentLabel(segment)} · Beat ${Number(finding.location.beatInBar.toFixed(2))}`;
}
