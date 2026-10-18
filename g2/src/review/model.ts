import { getTextWidth } from '@evenrealities/pretext'
import type { CoachingResult, DisplaySegment, Passage } from '../../../shared/contracts.ts'
import type { VisualCard, VisualNote } from '../../../shared/visual-contract.ts'
import { validateVisualPlan } from '../../../shared/visual-plan.ts'

// What one mistake card shows on the glasses, derived from the coaching
// result's visual plan (spec §5). Text only; art is drawn from `card`.
export type CardView = {
  card: VisualCard | null
  header: string
  // "● Expected F4" / "× Detected E4": solid note = expected, × = what was heard.
  legend: [string, string]
  cue: string
  // Present only when validated saved evidence supplies an authored bar.
  segment?: DisplaySegment
  findingId?: string
  position?: string
}

// ASCII '#': the firmware font spaces '♯' wide enough to read as "F #4".
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function noteName(midi: number) {
  return `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`
}

// Beat numbers on screen count from 1, as a player counts.
const beatLabel = (beat: number) => `${Math.floor(beat) + 1}`

export function beatFraction(beats: number) {
  const quarters = Math.round(Math.abs(beats) * 4)
  const named: Record<number, string> = { 1: '¼', 2: '½', 3: '¾' }
  if (named[quarters]) return named[quarters]
  const value = quarters / 4
  return `${value} beat${value === 1 ? '' : 's'}`
}

const beats = (value: number) => `${value} beat${value === 1 ? '' : 's'}`

// Evidence IDs list every note in the card's context, not just the faulty
// one, so the mistake is found by pairing expected and detected notes one to
// one (same pitch, onset within ONSET_TOLERANCE beats, closest first). What is
// left over is the mistake: an unpaired expected note was missed or replaced;
// an unpaired detected note was extra or wrong.
const ONSET_TOLERANCE = 0.2

export function unmatched(card: VisualCard) {
  const pairs: [number, number, number][] = []
  card.expected.notes.forEach((e, i) =>
    card.detected.notes.forEach((d, j) => {
      const gap = Math.abs(e.onsetBeat - d.onsetBeat)
      if (e.midiPitch === d.midiPitch && gap <= ONSET_TOLERANCE) pairs.push([gap, i, j])
    }),
  )
  const usedE = new Set<number>()
  const usedD = new Set<number>()
  for (const [, i, j] of pairs.sort((a, b) => a[0] - b[0])) {
    if (usedE.has(i) || usedD.has(j)) continue
    usedE.add(i)
    usedD.add(j)
  }
  const byOnset = (a: VisualNote, b: VisualNote) => a.onsetBeat - b.onsetBeat
  return {
    expected: card.expected.notes.filter((_, i) => !usedE.has(i)).sort(byOnset),
    detected: card.detected.notes.filter((_, j) => !usedD.has(j)).sort(byOnset),
  }
}

// The notes a card is about: the unpaired ones, else its evidence notes.
export function flaggedNotes(card: VisualCard) {
  const left = unmatched(card)
  const pick = (notes: VisualNote[], ids: string[]) => notes.filter(note => ids.includes(note.id))
  // Analysis cards carry the one finding's exact note IDs. Context notes may
  // have onset jitter and must not steal the highlight or authored finger.
  if (card.evidence.source === 'analysis') {
    return {
      expected: pick(card.expected.notes, card.evidence.referenceNoteIds),
      detected: pick(card.detected.notes, card.evidence.detectedNoteIds),
    }
  }
  return {
    expected: left.expected.length || left.detected.length ? left.expected : pick(card.expected.notes, card.evidence.referenceNoteIds),
    detected: left.expected.length || left.detected.length ? left.detected : pick(card.detected.notes, card.evidence.detectedNoteIds),
  }
}

// The beat a card is about: its first flagged note, else the start of its focus.
function cardBeat(card: VisualCard) {
  const flagged = flaggedNotes(card)
  return (flagged.expected[0] ?? flagged.detected[0])?.onsetBeat ?? card.focus.startBeat
}

const KIND_LABEL: Record<string, string> = {
  'wrong_note': 'wrong note',
  'wrong_note:self_fix': 'caught it',
  'missing_note': 'missed note',
  'missing_note:swapped_order': 'order swapped',
  'extra_note': 'extra note',
  'extra_note:swapped_order': 'order swapped',
  'timing:early': 'early',
  'timing:late': 'late',
  'duration:short': 'too short',
  'duration:long': 'too long',
  'tempo_drift:rushing': 'rushing',
  'tempo_drift:slowing': 'slowing down',
  'uneven_rhythm': 'uneven rhythm',
  'unexpected_pause': 'pause',
  'rest_violation': 'played in a rest',
  'section_repeat_skip:repeated': 'repeated bar',
  'section_repeat_skip:skipped': 'skipped bar',
  'recurring_trouble:recurring': 'trouble spot',
  'recurring_trouble:resolved': 'cleaned up',
}

function kindLabel(card: VisualCard) {
  return KIND_LABEL[`${card.kind}:${card.variant}`] ?? KIND_LABEL[card.kind] ?? card.kind.replace(/_/g, ' ')
}

const UNCLEAR_DETECTED: Record<string, string> = {
  uncertain: 'unclear audio',
  noisy: 'mostly noise',
  quiet: 'very quiet',
  no_piano: 'no piano',
}

function legend(card: VisualCard): [string, string] {
  const flagged = flaggedNotes(card)
  const expected = flagged.expected[0] ?? card.expected.notes[0]
  const detected = flagged.detected[0]
  const m = card.metrics

  switch (card.kind) {
    case 'wrong_note':
    case 'missing_note':
    case 'extra_note':
      // A plain missing note has nothing detected, a plain extra nothing expected.
      return [
        `● Expected  ${expected && !(card.kind === 'extra_note' && card.variant === 'extra') ? noteName(expected.midiPitch) : '—'}`,
        `× Detected  ${detected && !(card.kind === 'missing_note' && card.variant === 'missing') ? noteName(detected.midiPitch) : '—'}`,
      ]
    case 'timing': {
      const delta = m.timingDeltaBeats ?? 0
      return [
        `● Expected  on ${beatLabel(expected?.onsetBeat ?? card.focus.startBeat)}`,
        `× Detected  ${beatFraction(delta)} ${delta < 0 ? 'early' : 'late'}`,
      ]
    }
    case 'duration':
      return [
        `□ Expected  ${beats(m.expectedDurationBeats ?? expected?.durationBeats ?? 1)}`,
        `■ Detected  ${beats(m.detectedDurationBeats ?? detected?.durationBeats ?? 1)}`,
      ]
    case 'unclear_audio':
      return ['Expected  clear piano', `Detected  ${UNCLEAR_DETECTED[card.variant] ?? 'unclear audio'}`]
    case 'tempo_drift':
      return ['● Expected  steady beat', `× Detected  ${Math.abs(m.driftPercent ?? 0)}% ${card.variant === 'rushing' ? 'faster' : 'slower'}`]
    case 'uneven_rhythm':
      return ['● Expected  even beats', '× Detected  uneven']
    case 'unexpected_pause':
      return ['● Expected  keep going', `× Detected  ${beats(m.gapBeats ?? 1)} gap`]
    case 'rest_violation':
      return ['● Expected  silence', `× Detected  ${detected ? noteName(detected.midiPitch) : 'a note'}`]
    case 'section_repeat_skip': {
      const [a, b] = card.segments ?? []
      const names = a && b ? `${title(a.label)}, ${title(b.label)}` : 'each bar once'
      return [`● Expected  ${names}`, `× Detected  ${card.variant === 'skipped' ? `${title(b?.label ?? 'a bar')} missing` : `${title(a?.label ?? 'a bar')} twice`}`]
    }
    case 'recurring_trouble':
      return [
        `Flagged  ${m.recurrenceCount ?? 0} of last ${m.recurrenceWindow ?? 0} takes`,
        card.variant === 'resolved' ? 'Latest take  clean' : `Latest take  beat ${beatLabel(cardBeat(card))}`,
      ]
  }
}

// "BAR A" → "Bar A"
const title = (label: string) => label.toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase())

// The cue column is 252px wide and three lines tall.
export const CUE_WIDTH = 252
const CUE_LINES = 3

function fits(text: string) {
  let lines = 1
  let line = ''
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (getTextWidth(next) <= CUE_WIDTH) line = next
    else {
      lines += 1
      line = word
    }
  }
  return lines <= CUE_LINES
}

function header(card: VisualCard) {
  if (card.kind === 'unclear_audio') return "Couldn't hear clearly"
  if (card.kind === 'section_repeat_skip' || card.kind === 'tempo_drift' || card.kind === 'uneven_rhythm') {
    return `Beats ${beatLabel(card.focus.startBeat)}–${Math.ceil(card.focus.endBeat)} · ${kindLabel(card)}`
  }
  return `Beat ${beatLabel(cardBeat(card))} · ${kindLabel(card)}`
}

// One view per card, in plan order (already sorted by priority). The card the
// coach chose gets Gemini's authored next step when it fits; the others keep
// their own cue. With no usable plan, the coach's text stands alone.
export function cardViews(coaching: CoachingResult): CardView[] {
  const plan = coaching.visualPlan && validateVisualPlan(coaching.visualPlan) ? coaching.visualPlan : null

  if (!plan || plan.cards.length === 0) {
    const summary = coaching.summary
    return [
      {
        card: null,
        header: summary?.where ?? 'Feedback',
        legend: [summary?.what ?? '', ''],
        cue: summary?.next && fits(summary.next) ? summary.next : coaching.cue,
      },
    ]
  }

  return viewsForCards(plan.cards, coaching)
}

export function viewsForCards(cards: VisualCard[], coaching: Pick<CoachingResult, 'evidenceFindingIds' | 'summary'>, passage?: Passage): CardView[] {
  const next = coaching.summary?.next
  return cards.map(card => {
    const coached = card.evidence.findingIds.some(id => coaching.evidenceFindingIds.includes(id))
    const authored = (card.kind === 'wrong_note' || card.kind === 'missing_note')
      ? passage?.notes.find(note => note.id === (card.evidence.source === 'analysis'
        ? card.evidence.referenceNoteIds[0] : flaggedNotes(card).expected[0]?.id))
      : undefined
    const baseCue = coached && next && fits(next) ? next : card.cue
    const finger = authored?.suggestedFinger ? `Finger ${authored.suggestedFinger} (score).` : ''
    const cue = finger && fits(`${baseCue} ${finger}`) ? `${baseCue} ${finger}`
      : finger && fits(`${card.cue} ${finger}`) ? `${card.cue} ${finger}` : baseCue
    return {
      card,
      header: header(card),
      legend: legend(card),
      cue,
    }
  })
}
