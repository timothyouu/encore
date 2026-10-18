import type { AnalysisResult, CoachingResult, DisplaySegment, Finding, Passage } from './contracts.ts';
import { analysisSegmentsValid } from './segments.ts';
import { buildVisualPlan } from './visual-plan.ts';
import { compareFindingImportance, topFindings } from './finding-priority.ts';

export type FeedbackEntry = { finding: Finding; segment: DisplaySegment | null };

/** Keep all phone findings; glasses can limit distinct mistakes before bar expansion. */
export function feedbackEntries(
  analysis: AnalysisResult, passage: Passage, coaching?: CoachingResult | null, limit: number = Infinity,
): FeedbackEntry[] {
  const beat = (finding: Finding): number => {
    const referenceBeat = passage.notes.find(note => note.id === finding.referenceNoteId)?.onsetBeat;
    const detected = analysis.detectedNotes.find(note => note.id === finding.detectedNoteId);
    return finding.location?.passageBeat ?? referenceBeat ??
      (detected && analysis.alignment.reliable && analysis.alignment.offsetSec !== null
        ? (detected.onsetSec - analysis.alignment.offsetSec) * analysis.attemptTempoBpm / 60 : Infinity);
  };
  const orderedFindings = topFindings(analysis, passage, limit);
  if (analysis.schemaVersion === '1') {
    const priority = buildVisualPlan(analysis, passage).cards.flatMap(card => card.evidence.findingIds);
    const rank = (finding: Finding): number => {
      const index = priority.indexOf(finding.id);
      return index < 0 ? Infinity : index;
    };
    return orderedFindings.sort((a, b) => rank(a) - rank(b) || compareFindingImportance(a, b) || beat(a) - beat(b))
      .map(finding => ({ finding, segment: null }));
  }
  if (!analysisSegmentsValid(analysis, passage)) return [];
  const segments = analysis.displaySegments ?? [];
  const priorityIds: string[] = [];
  const prioritize = (id: string): void => { if (!priorityIds.includes(id)) priorityIds.push(id); };
  const ordered: DisplaySegment[] = [];
  const append = (segment: DisplaySegment): void => {
    if (!ordered.some(item => item.id === segment.id)) ordered.push(segment);
  };
  if (coaching?.schemaVersion === '2' && coaching.attemptId === analysis.attemptId) {
    const primary = segments.find(segment => segment.id === coaching.primarySegmentId &&
      coaching.evidenceFindingIds.some(id => segment.findingIds.includes(id)));
    if (primary) {
      append(primary);
      for (const id of coaching.evidenceFindingIds) {
        if (analysis.findings.some(finding => finding.id === id)) prioritize(id);
      }
    }
  }
  for (const card of buildVisualPlan(analysis, passage).cards) {
    for (const id of card.evidence.findingIds) prioritize(id);
    for (const segment of segments) {
      if (card.evidence.findingIds.some(id => segment.findingIds.includes(id))) append(segment);
    }
  }
  for (const finding of orderedFindings) {
    prioritize(finding.id);
    for (const segment of segments) {
      if (finding.segmentIds?.includes(segment.id)) append(segment);
    }
  }
  const rankedFindings = [...orderedFindings].sort((a, b) => {
    const rank = (finding: Finding): number => {
      const index = priorityIds.indexOf(finding.id);
      return index < 0 ? Infinity : index;
    };
    return rank(a) - rank(b) || compareFindingImportance(a, b) || beat(a) - beat(b);
  });
  const entries: FeedbackEntry[] = rankedFindings.flatMap(finding => ordered
    .filter(segment => finding.segmentIds?.includes(segment.id)).map(segment => ({ finding, segment })));
  return [...entries, ...orderedFindings.filter(finding => finding.location === null)
    .map(finding => ({ finding, segment: null }))];
}
