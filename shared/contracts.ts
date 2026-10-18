import type { VisualPlan } from './visual-contract.ts';

export type ReferenceNote = {
  id: string;
  midiPitch: number;
  onsetBeat: number;
  durationBeats: number;
  hand: 'right' | 'left';
  suggestedFinger?: 1 | 2 | 3 | 4 | 5;
};
export type Passage = {
  id: string;
  version: string;
  title: string;
  tempoBpm: number;
  beatsPerBar: number;
  bars?: { number: number; startBeat: number; endBeat: number }[];
  notes: ReferenceNote[];
};
export type DetectedNote = {
  id: string;
  midiPitch: number;
  onsetSec: number;
  durationSec: number;
  detectorScore?: number;
};
export type FindingLocation = { barNumber: number; beatInBar: number; passageBeat: number };
export type DisplaySegment = {
  id: string; startBar: number; endBar: number; startBeat: number; endBeat: number;
  referenceNoteIds: string[]; findingIds: string[];
};
export type Finding = {
  id: string;
  kind: 'wrong_note' | 'missing_note' | 'extra_note' | 'timing' | 'duration';
  referenceNoteId?: string;
  detectedNoteId?: string;
  timingDeltaMs?: number;
  durationDeltaMs?: number;
  location?: FindingLocation | null;
  segmentIds?: string[];
};
export type AnalysisResult = {
  schemaVersion: '1' | '2';
  attemptId: string;
  passageId: string;
  passageVersion: string;
  attemptTempoBpm: number;
  status: 'ok' | 'uncertain' | 'insufficient_audio' | 'error';
  detectorVersion: string;
  scoringVersion: string;
  audioQuality: { clipped: boolean; hasDropouts: boolean; warnings: string[] };
  alignment: { offsetSec: number | null; reliable: boolean };
  detectedNotes: DetectedNote[];
  findings: Finding[];
  displaySegments?: DisplaySegment[];
  metrics: { matchedNotes: number; expectedNotes: number; medianAbsTimingErrorMs: number | null };
};
export type CoachingResult = {
  schemaVersion: '1' | '2';
  attemptId: string;
  coachingSource: 'gemini' | 'fallback' | 'analysis_only';
  fallbackReason?: 'missing_key' | 'model_error' | 'invalid_response' | 'timeout';
  cue: string;
  evidenceFindingIds: string[];
  primarySegmentId?: string | null;
  visual: {
    kind: 'keyboard' | 'rhythm_strip' | 'none';
    referenceNoteIds: string[];
    poseIds: string[];
    mistakes: { findingId: string; referenceNoteId?: string; detectedNoteId?: string }[];
  };
  summary?: { where: string; what: string; next: string };
  visualPlan?: VisualPlan;
};
export type CoachRequest = {
  artifactId: string;
  passageId: string;
  passageVersion: string;
  analysis: AnalysisResult;
};
