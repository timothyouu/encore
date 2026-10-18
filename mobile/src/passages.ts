import { PASSAGES, type Passage as AuthoredPassage, type ReferenceNote } from '../../shared/passages.ts';

export type { ReferenceNote };

// Phone callers only require the original passage contract. G2 teaching copy is extra metadata.
export type Passage = Omit<AuthoredPassage, 'purpose' | 'focus'> & Partial<Pick<AuthoredPassage, 'purpose' | 'focus'>>;

export const passages: Passage[] = PASSAGES;

export function noteName(midi: number): string {
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) return 'Unknown';
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return names[midi % 12] + (Math.floor(midi / 12) - 1);
}

export function suggestedFingerLabel(reference?: ReferenceNote): string | null {
  const finger = reference?.suggestedFinger;
  return typeof finger === 'number' && Number.isInteger(finger) && finger >= 1 && finger <= 5
    ? `Suggested finger ${finger} · Authored for this passage`
    : null;
}
