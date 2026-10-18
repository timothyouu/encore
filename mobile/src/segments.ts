import type { VisualCard, VisualNote } from '../../shared/visual-contract.ts';
import { validateVisualCard } from '../../shared/visual-plan.ts';
import type { DisplaySegment } from '../../shared/contracts.ts';
import type { Passage, ReferenceNote } from './passages.ts';

export type NotationWindow = { startBeat: number; endBeat: number; notes: ReferenceNote[] };

/** Clip sustained reference events at the selected bar edges, keeping their stable IDs. */
export function notationWindow(passage: Passage, segment?: DisplaySegment | null): NotationWindow {
  const startBeat = segment?.startBeat ?? 0;
  const endBeat = segment?.endBeat ?? Math.max(8, ...passage.notes.map(note => note.onsetBeat + note.durationBeats));
  const notes = passage.notes.filter(note => note.onsetBeat < endBeat && note.onsetBeat + note.durationBeats > startBeat)
    .map(note => ({ ...note, onsetBeat: Math.max(note.onsetBeat, startBeat),
      durationBeats: Math.min(note.onsetBeat + note.durationBeats, endBeat) - Math.max(note.onsetBeat, startBeat) }));
  return { startBeat, endBeat, notes };
}

/** A bar view contains only intervals that intersect that bar. No event is relocated. */
export function clipVisualCard(card: VisualCard, segment: DisplaySegment): VisualCard | null {
  const clip = (notes: VisualNote[]): VisualNote[] => notes
    .filter(note => note.onsetBeat < segment.endBeat && note.onsetBeat + note.durationBeats > segment.startBeat)
    .map(note => ({ ...note, onsetBeat: Math.max(note.onsetBeat, segment.startBeat),
      durationBeats: Math.min(note.onsetBeat + note.durationBeats, segment.endBeat) - Math.max(note.onsetBeat, segment.startBeat) }));
  const result: VisualCard = { ...card, focus: { startBeat: segment.startBeat, endBeat: segment.endBeat },
    expected: { ...card.expected, notes: clip(card.expected.notes) },
    detected: { ...card.detected, notes: clip(card.detected.notes) } };
  if (result.kind === 'duration') {
    const expected = result.expected.notes.find(note => result.evidence.referenceNoteIds.includes(note.id));
    const detected = result.detected.notes.find(note => result.evidence.detectedNoteIds.includes(note.id));
    if (expected && detected) result.metrics = { expectedDurationBeats: expected.durationBeats, detectedDurationBeats: detected.durationBeats };
  }
  // An event wholly beyond this bar cannot be animated here as if it occurred inside it.
  return validateVisualCard(result) ? result : null;
}
