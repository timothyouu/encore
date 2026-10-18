import { buildVisualPlan, validateVisualPlan } from '../../shared/visual-plan.ts';
import type { VisualPlan } from '../../shared/visual-contract.ts';
import type { AnalysisResult, CoachingResult } from '../../shared/contracts.ts';
import type { Passage } from './passages.ts';

/** Stored plans must be identical to deterministic evidence resolution, not just valid JSON. */
export function groundedVisualPlan(value: unknown, analysis: AnalysisResult, passage: Passage, selectedFindingId?: string): value is VisualPlan {
  if (!validateVisualPlan(value) || value.source !== 'analysis') return false;
  return JSON.stringify(value) === JSON.stringify(buildVisualPlan(analysis, passage, selectedFindingId));
}

export function resolveVisualPlan(analysis: AnalysisResult, passage: Passage, coaching?: CoachingResult | null | null): VisualPlan {
  const selected = coaching?.evidenceFindingIds[0];
  const generated = buildVisualPlan(analysis, passage, selected);
  if (coaching?.visualPlan && groundedVisualPlan(coaching.visualPlan, analysis, passage, selected)) return coaching.visualPlan;
  return generated;
}
export function visibleFindings(analysis: AnalysisResult, passage: Passage, coaching?: CoachingResult | null): AnalysisResult['findings'] {
  return resolveVisualPlan(analysis, passage, coaching).cards.flatMap(card =>
    card.evidence.findingIds.flatMap(id => {
      const finding = analysis.findings.find(candidate => candidate.id === id);
      return finding ? [finding] : [];
    }));
}