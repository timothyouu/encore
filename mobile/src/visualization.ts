import { noteName, type Passage, type ReferenceNote } from './passages.ts';
import type { AnalysisResult, AttemptRecord, DetectedNote, Finding } from './session.ts';

export type KeyEvent = { midiPitch: number; label: string };
export type DurationComparison = {
  expectedBeats: number;
  playedBeats: number;
  expectedSeconds: number;
  playedSeconds: number;
  referenceValue: string;
};
export type MistakeVisualization = {
  findingId: string;
  kind: Finding['kind'];
  expected?: KeyEvent;
  played?: KeyEvent;
  duration?: DurationComparison;
  suggestedFinger?: ReferenceNote['suggestedFinger'];
};

function keyEvent(pitch: number): KeyEvent | undefined {
  if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) return undefined;
  return { midiPitch: pitch, label: noteName(pitch) };
}

function referenceValue(beats: number): string {
  if (beats === 1) return 'Quarter note';
  if (beats === 2) return 'Half note';
  return `${beats} beats`;
}

function validatedEvidence(record: AttemptRecord, passage: Passage, finding: Finding): { analysis: AnalysisResult; reference?: ReferenceNote; detected?: DetectedNote } | null {
  const analysis = record.analysis;
  const savedFinding = analysis?.findings.find(item => item.id === finding.id);
  if (record.passageId !== passage.id || record.passageVersion !== passage.version ||
      !analysis || analysis.status !== 'ok' || !analysis.alignment.reliable ||
      analysis.audioQuality.clipped || analysis.audioQuality.hasDropouts ||
      analysis.attemptId !== record.attemptId || analysis.passageId !== passage.id ||
      analysis.passageVersion !== passage.version || !savedFinding ||
      savedFinding.kind !== finding.kind || savedFinding.referenceNoteId !== finding.referenceNoteId ||
      savedFinding.detectedNoteId !== finding.detectedNoteId ||
      savedFinding.durationDeltaMs !== finding.durationDeltaMs) return null;
  const reference = passage.notes.find(item => item.id === finding.referenceNoteId);
  const detected = analysis.detectedNotes.find(item => item.id === finding.detectedNoteId);
  if (finding.referenceNoteId && !reference || finding.detectedNoteId && !detected) return null;
  return { analysis, reference, detected };
}

// The review carousel shows every supported analysis finding, even if the coach prioritizes another one.
export function resolveDurationEvidence(record: AttemptRecord, passage: Passage, finding: Finding): DurationComparison | null {
  if (finding.kind !== 'duration') return null;
  const evidence = validatedEvidence(record, passage, finding);
  const reference = evidence?.reference;
  const detected = evidence?.detected;
  const tempo = evidence?.analysis.attemptTempoBpm;
  const claimedDelta = finding.durationDeltaMs;
  if (!reference || !detected || typeof tempo !== 'number' || !Number.isFinite(tempo) || tempo <= 0 ||
      typeof claimedDelta !== 'number' || !Number.isFinite(claimedDelta) ||
      !Number.isFinite(reference.durationBeats) || reference.durationBeats <= 0 ||
      !Number.isFinite(detected.durationSec) || detected.durationSec <= 0) return null;
  const expectedSeconds = reference.durationBeats * 60 / tempo;
  const measuredDeltaMs = (detected.durationSec - expectedSeconds) * 1000;
  if (Math.abs(measuredDeltaMs - claimedDelta) > 5) return null;
  return {
    expectedBeats: reference.durationBeats,
    playedBeats: detected.durationSec * tempo / 60,
    expectedSeconds,
    playedSeconds: detected.durationSec,
    referenceValue: referenceValue(reference.durationBeats),
  };
}

// Resolve visual data from saved evidence; coach output only selects a validated finding.
export function resolveMistakeVisualization(record: AttemptRecord, passage: Passage, finding: Finding): MistakeVisualization | null {
  const evidence = validatedEvidence(record, passage, finding);
  const coaching = record.coaching;
  if (!evidence || !coaching || coaching.attemptId !== record.attemptId ||
      !coaching.evidenceFindingIds.includes(finding.id)) return null;
  const visual = coaching.visual;
  const selected = visual.mistakes?.find(item => item.findingId === finding.id);
  if (!selected || selected.referenceNoteId !== finding.referenceNoteId ||
      selected.detectedNoteId !== finding.detectedNoteId) return null;
  const { reference, detected } = evidence;
  if (finding.kind === 'wrong_note' && (!reference || !detected || reference.midiPitch === detected.midiPitch)) return null;
  if (finding.kind === 'missing_note' && (!reference || detected)) return null;
  if (finding.kind === 'extra_note' && (!detected || reference)) return null;
  if ((finding.kind === 'timing' || finding.kind === 'duration') && (!reference || !detected)) return null;
  const expected = reference && keyEvent(reference.midiPitch);
  const played = detected && keyEvent(detected.midiPitch);
  if (reference && !expected || detected && !played) return null;
  const result: MistakeVisualization = { findingId: finding.id, kind: finding.kind, ...(expected && { expected }), ...(played && { played }), ...(reference?.suggestedFinger && { suggestedFinger: reference.suggestedFinger }) };
  if (finding.kind === 'duration') {
    const duration = resolveDurationEvidence(record, passage, finding);
    if (!duration) return null;
    result.duration = duration;
  }
  return result;
}

export function keyboardRange(visual: MistakeVisualization): number[] {
  const pitches = [visual.expected?.midiPitch, visual.played?.midiPitch].filter((pitch): pitch is number => pitch !== undefined);
  if (!pitches.length) return [];
  const firstOctave = Math.floor(Math.min(...pitches) / 12) - 1;
  const lastOctave = Math.floor(Math.max(...pitches) / 12) - 1;
  const values: number[] = [];
  for (let octave = firstOctave; octave <= lastOctave; octave += 1) {
    for (const interval of [0, 2, 4, 5, 7, 9, 11]) {
      const pitch = (octave + 1) * 12 + interval;
      if (pitch >= 0 && pitch <= 127) values.push(pitch);
    }
  }
  return values;
}
