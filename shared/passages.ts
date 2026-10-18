// Approved seed library (spec §7), shared by phone and G2 so findings and
// teaching guidance reference the same authored notes. Right hand, no
// pedal. Beats are quarter notes; onsets are counted from the first beat (0).

type Finger = 1 | 2 | 3 | 4 | 5

export type ReferenceNote = {
  id: string
  midiPitch: number
  onsetBeat: number
  durationBeats: number
  hand: 'right' | 'left'
  // Authored teaching suggestion, never an observation of the player.
  suggestedFinger?: Finger
}

export type Passage = {
  id: string
  version: string
  title: string
  tempoBpm: number
  beatsPerBar: number
  purpose: string
  focus: string
  notes: ReferenceNote[]
}

type Seed = {
  midiPitches: number[]
  fingers: Finger[]
  onsets?: number[]
  durations?: number[]
}

function notes(passageId: string, { midiPitches, fingers, onsets, durations }: Seed): ReferenceNote[] {
  return midiPitches.map((midiPitch, i) => ({
    // Stable note IDs are part of saved mobile results and G2 references.
    id: `${passageId}-N${String(i + 1).padStart(2, '0')}`,
    midiPitch,
    onsetBeat: onsets?.[i] ?? i,
    durationBeats: durations?.[i] ?? 1,
    hand: 'right',
    suggestedFinger: fingers[i],
  }))
}

// Fingerings use the C five-finger position (C1 D2 E3 F4 G5) unless noted.
export const PASSAGES: Passage[] = [
  {
    id: 'P01',
    version: '1',
    title: 'First Steps',
    tempoBpm: 60,
    beatsPerBar: 4,
    purpose: 'Adjacent-note accuracy',
    focus: 'Step cleanly to each next key',
    notes: notes('P01', { midiPitches: [60, 62, 64, 65, 67, 65, 64, 60], fingers: [1, 2, 3, 4, 5, 4, 3, 1] }),
  },
  {
    id: 'P02',
    version: '1',
    title: 'Little Echo',
    tempoBpm: 60,
    beatsPerBar: 4,
    purpose: 'Repeated onsets',
    focus: 'Play each repeat cleanly',
    notes: notes('P02', { midiPitches: [64, 64, 67, 67, 65, 65, 62, 62], fingers: [3, 3, 5, 5, 4, 4, 2, 2] }),
  },
  {
    id: 'P03',
    version: '1',
    title: 'Open Windows',
    tempoBpm: 60,
    beatsPerBar: 4,
    purpose: 'Skipped-key selection',
    focus: 'Land each skip on the right key',
    // Bar 2 shifts to the D position (D1 E2 F3 G4 A5) to reach A.
    notes: notes('P03', { midiPitches: [60, 64, 67, 64, 62, 65, 69, 65], fingers: [1, 3, 5, 3, 1, 3, 5, 3] }),
  },
  {
    id: 'P04',
    version: '1',
    title: 'Hold the Moment',
    tempoBpm: 60,
    beatsPerBar: 4,
    purpose: 'Durations',
    focus: 'Hold the long notes full length',
    notes: notes('P04', {
      midiPitches: [60, 64, 67, 65, 64, 62],
      fingers: [1, 3, 5, 4, 3, 2],
      onsets: [0, 2, 3, 4, 6, 7],
      durations: [2, 1, 1, 2, 1, 1],
    }),
  },
  {
    id: 'P05',
    version: '1',
    title: 'Room to Breathe',
    tempoBpm: 60,
    beatsPerBar: 4,
    purpose: 'Rests',
    focus: 'Let the rests stay silent',
    notes: notes('P05', {
      midiPitches: [60, 64, 67, 65, 64, 60],
      fingers: [1, 3, 5, 4, 3, 1],
      onsets: [0, 2, 3, 4, 5, 7],
    }),
  },
  {
    id: 'P06',
    version: '1',
    title: 'Small Climb',
    tempoBpm: 72,
    beatsPerBar: 4,
    purpose: 'Steady timing at a faster tempo',
    focus: 'Keep a steady beat at 72',
    // G and A extend the C position: G4, A5.
    notes: notes('P06', { midiPitches: [60, 62, 64, 67, 69, 67, 64, 62], fingers: [1, 2, 3, 4, 5, 4, 3, 2] }),
  },
]
