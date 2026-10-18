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
  notes: ReferenceNote[];
};

type Seed = { id: string; title: string; pitches: number[]; bpm: number; onsets?: number[]; durations?: number[] };

const seeds: Seed[] = [
  { id: 'P01', title: 'First Steps', pitches: [60, 62, 64, 65, 67, 65, 64, 60], bpm: 60 },
  { id: 'P02', title: 'Little Echo', pitches: [64, 64, 67, 67, 65, 65, 62, 62], bpm: 60 },
  { id: 'P03', title: 'Open Windows', pitches: [60, 64, 67, 64, 62, 65, 69, 65], bpm: 60 },
  { id: 'P04', title: 'Hold the Moment', pitches: [60, 64, 67, 65, 64, 62], bpm: 60, durations: [2, 1, 1, 2, 1, 1], onsets: [0, 2, 3, 4, 6, 7] },
  { id: 'P05', title: 'Room to Breathe', pitches: [60, 64, 67, 65, 64, 60], bpm: 60, onsets: [0, 2, 3, 4, 5, 7] },
  { id: 'P06', title: 'Small Climb', pitches: [60, 62, 64, 67, 69, 67, 64, 62], bpm: 72 },
];

export const passages: Passage[] = seeds.map((seed) => ({
  id: seed.id,
  version: '1',
  title: seed.title,
  tempoBpm: seed.bpm,
  beatsPerBar: 4,
  notes: seed.pitches.map((midiPitch, index) => ({
    id: seed.id + '-N' + String(index + 1).padStart(2, '0'),
    midiPitch,
    onsetBeat: seed.onsets?.[index] ?? index,
    durationBeats: seed.durations?.[index] ?? 1,
    hand: 'right' as const,
    suggestedFinger: ((index % 5) + 1) as 1 | 2 | 3 | 4 | 5,
  })),
}));

export function noteName(midi: number): string {
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) return 'Unknown';
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return names[midi % 12] + (Math.floor(midi / 12) - 1);
}
