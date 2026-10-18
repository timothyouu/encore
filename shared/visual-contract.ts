import type { AnalysisResult, Passage } from './contracts.ts';

export type VisualKind =
  | 'wrong_note' | 'missing_note' | 'extra_note' | 'timing' | 'duration' | 'unclear_audio'
  | 'tempo_drift' | 'uneven_rhythm' | 'unexpected_pause' | 'rest_violation'
  | 'section_repeat_skip' | 'recurring_trouble';

export type VisualNote = { id: string; midiPitch: number; onsetBeat: number; durationBeats: number };
export type VisualSegment = { id: string; label: string; startBeat: number; endBeat: number };
export type VisualHistoryRow = { attemptId: string; label: string; flaggedBeats: number[] };
export type VisualSequence = { label: string; notes: VisualNote[]; segmentIds?: string[] };
export type VisualMetrics = {
  timingDeltaBeats?: number;
  expectedDurationBeats?: number;
  detectedDurationBeats?: number;
  driftPercent?: number;
  gapBeats?: number;
  recurrenceCount?: number;
  recurrenceWindow?: number;
};
export interface VisualCard {
  id: string;
  kind: VisualKind;
  variant: string;
  priority: 1 | 2 | 3 | 4 | 5;
  focus: { startBeat: number; endBeat: number };
  expected: VisualSequence;
  detected: VisualSequence;
  metrics: VisualMetrics;
  cue: string;
  evidence: {
    source: 'analysis' | 'fixture';
    measurement: 'note_alignment' | 'audio_quality' | 'phrase_pattern' | 'history';
    findingIds: string[];
    referenceNoteIds: string[];
    detectedNoteIds: string[];
  };
  segments?: VisualSegment[];
  historyRows?: VisualHistoryRow[];
}
export interface VisualPlan {
  schemaVersion: '1';
  attemptId: string;
  passageId: string;
  passageVersion: string;
  source: 'analysis' | 'fixture';
  cards: VisualCard[];
}
export type VisualPlanBuilder = (analysis: AnalysisResult, passage: Passage, selectedFindingId?: string) => VisualPlan;
