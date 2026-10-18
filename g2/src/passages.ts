// Approved seed library (spec §7). Right hand, no pedal, one note per entry.
// Beats are quarter notes; onsets are counted from the first beat (0).

export type PassageNote = {
  id: string
  midi: number
  onsetBeat: number
  durationBeats: number
}

export type Passage = {
  id: string
  version: string
  title: string
  bpm: number
  beatsPerBar: number
  purpose: string
  focus: string
  notes: PassageNote[]
}

function notes(
  passageId: string,
  midi: number[],
  onsets: number[] = midi.map((_, i) => i),
  durations: number[] = midi.map(() => 1),
): PassageNote[] {
  return midi.map((pitch, i) => ({
    id: `${passageId}-n${i + 1}`,
    midi: pitch,
    onsetBeat: onsets[i],
    durationBeats: durations[i],
  }))
}

export const PASSAGES: Passage[] = [
  {
    id: 'P01',
    version: '1',
    title: 'First Steps',
    bpm: 60,
    beatsPerBar: 4,
    purpose: 'Adjacent-note accuracy',
    focus: 'Step cleanly to each next key',
    notes: notes('P01', [60, 62, 64, 65, 67, 65, 64, 60]),
  },
  {
    id: 'P02',
    version: '1',
    title: 'Little Echo',
    bpm: 60,
    beatsPerBar: 4,
    purpose: 'Repeated onsets',
    focus: 'Play each repeat cleanly',
    notes: notes('P02', [64, 64, 67, 67, 65, 65, 62, 62]),
  },
  {
    id: 'P03',
    version: '1',
    title: 'Open Windows',
    bpm: 60,
    beatsPerBar: 4,
    purpose: 'Skipped-key selection',
    focus: 'Land each skip on the right key',
    notes: notes('P03', [60, 64, 67, 64, 62, 65, 69, 65]),
  },
  {
    id: 'P04',
    version: '1',
    title: 'Hold the Moment',
    bpm: 60,
    beatsPerBar: 4,
    purpose: 'Durations',
    focus: 'Hold the long notes full length',
    notes: notes('P04', [60, 64, 67, 65, 64, 62], [0, 2, 3, 4, 6, 7], [2, 1, 1, 2, 1, 1]),
  },
  {
    id: 'P05',
    version: '1',
    title: 'Room to Breathe',
    bpm: 60,
    beatsPerBar: 4,
    purpose: 'Rests',
    focus: 'Let the rests stay silent',
    notes: notes('P05', [60, 64, 67, 65, 64, 60], [0, 2, 3, 4, 5, 7]),
  },
  {
    id: 'P06',
    version: '1',
    title: 'Small Climb',
    bpm: 72,
    beatsPerBar: 4,
    purpose: 'Steady timing at a faster tempo',
    focus: 'Keep a steady beat at 72',
    notes: notes('P06', [60, 62, 64, 67, 69, 67, 64, 62]),
  },
]
