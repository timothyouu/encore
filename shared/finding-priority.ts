import type { AnalysisResult, Finding, Passage } from './contracts.ts';

export const MAX_FEEDBACK_FINDINGS = 10;
const PRIORITY: Record<Finding['kind'], number> = {
  missing_note: 0, extra_note: 1, wrong_note: 2, timing: 3, duration: 4,
};

/** Stable ties retain the caller's passage order. Mirrors analysis/scoring.py. */
export function compareFindingImportance(a: Finding, b: Finding): number {
  const magnitude = (finding: Finding): number =>
    Math.abs(finding.timingDeltaMs ?? finding.durationDeltaMs ?? 0);
  return PRIORITY[a.kind] - PRIORITY[b.kind] || magnitude(b) - magnitude(a);
}

export function topFindings(analysis: AnalysisResult, passage: Passage, limit: number = Infinity): Finding[] {
  const beat = (finding: Finding): number => {
    const reference = passage.notes.find(note => note.id === finding.referenceNoteId);
    const detected = analysis.detectedNotes.find(note => note.id === finding.detectedNoteId);
    return finding.location?.passageBeat ?? reference?.onsetBeat ??
      (detected && analysis.alignment.reliable && analysis.alignment.offsetSec !== null
        ? (detected.onsetSec - analysis.alignment.offsetSec) * analysis.attemptTempoBpm / 60 : Infinity);
  };
  return [...analysis.findings]
    .sort((a, b) => compareFindingImportance(a, b) || beat(a) - beat(b))
    .slice(0, limit);
}
