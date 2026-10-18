import { resolveVisualPlan } from '../../mobile/src/paper-evidence.ts'
import type { AttemptRecord } from '../../mobile/src/session.ts'
import type { Passage } from './passages.ts'
import { feedbackEntries } from '../../shared/feedback.ts'
import { buildVisualPlan } from '../../shared/visual-plan.ts'
import type { VisualNote } from '../../shared/visual-contract.ts'
import { viewsForCards, type CardView } from './review/model.ts'

export type ReviewData = { tag: string; views: CardView[] }

function sourceTag(record: AttemptRecord): string {
  const source = record.captureSource ?? 'demo'
  const label = source === 'demo' ? 'Demo' : source === 'test' ? 'Test WAV' : source === 'g2' ? 'G2' : 'Phone'
  return !record.coaching || record.coaching.coachingSource !== 'gemini' ? `${label} · local cue` : label
}

function textView(header: string, detail: string, cue: string): CardView {
  return { card: null, header, legend: [detail, ''], cue }
}

// A Review is derived from the saved attempt and its exact deterministic
// evidence plan. The coach's attached plan is never trusted on shape alone.
export function reviewData(record: AttemptRecord, passage: Passage): ReviewData {
  const tag = sourceTag(record)
  const analysis = record.analysis
  if (!analysis) {
    return { tag, views: [textView('Feedback unavailable', 'No validated coaching result', 'Return to the Library or retry this saved take on the phone.')] }
  }
  if (analysis.status !== 'ok') {
    const plan = resolveVisualPlan(analysis, passage)
    const views = viewsForCards(plan.cards, { evidenceFindingIds: [] })
    return { tag, views: views.length ? views : [textView("Couldn't hear clearly", 'Audio was uncertain', 'Try another recording.')] }
  }
  // The overview plan deliberately caps its top cards. Navigation must still
  // include every finding/bar pair, using deterministic evidence for each.
  const views = feedbackEntries(analysis, passage, record.coaching).map(({ finding, segment }) => {
    if (analysis.schemaVersion === '2' && !segment) return {
      ...textView('Position unavailable', finding.kind.replace(/_/g, ' '), 'No reliable bar position. Review this event on the phone.'),
      findingId: finding.id,
    }
    const card = buildVisualPlan({ ...analysis, findings: [finding] }, passage).cards[0]
    if (!card) return { ...textView('Saved finding', finding.kind.replace(/_/g, ' '), 'Review this saved evidence on the phone.'), findingId: finding.id }
    const view = viewsForCards([card], record.coaching ?? { evidenceFindingIds: [] }, passage)[0]
    if (!segment) return { ...view, findingId: finding.id }
    const overlaps = (note: { onsetBeat: number; durationBeats: number }) =>
      note.onsetBeat < segment.endBeat && note.onsetBeat + note.durationBeats > segment.startBeat
    const clip = (note: VisualNote): VisualNote => {
      const onsetBeat = Math.max(segment.startBeat, note.onsetBeat)
      return { ...note, onsetBeat, durationBeats: Math.min(segment.endBeat, note.onsetBeat + note.durationBeats) - onsetBeat }
    }
    const detected = analysis.detectedNotes.map(note => ({
      id: note.id, midiPitch: note.midiPitch,
      onsetBeat: (note.onsetSec - (analysis.alignment.offsetSec ?? 0)) * analysis.attemptTempoBpm / 60,
      durationBeats: note.durationSec * analysis.attemptTempoBpm / 60,
    }))
    return {
      ...view,
      header: `Bar ${segment.startBar} · ${view.header.replace(/^Beat \d+ · /, '')}`,
      findingId: finding.id,
      segment,
      position: finding.location?.barNumber === segment.startBar
        ? `Bar ${segment.startBar} · beat ${finding.location.beatInBar}`
        : `Bar ${segment.startBar} · continued`,
      card: {
        ...card,
        focus: { startBeat: segment.startBeat, endBeat: segment.endBeat },
        expected: { ...card.expected, notes: passage.notes.filter(overlaps).map(note => clip({
          id: note.id, midiPitch: note.midiPitch, onsetBeat: note.onsetBeat, durationBeats: note.durationBeats,
        })) },
        detected: { ...card.detected, notes: detected.filter(overlaps).map(clip) },
      },
    }
  })
  if (views.length) return { tag, views }
  return { tag, views: [textView('No supported mistakes', `${analysis.metrics.matchedNotes} of ${analysis.metrics.expectedNotes} notes matched`, record.coaching?.cue ?? 'Keep practicing the phrase.')] }
}
