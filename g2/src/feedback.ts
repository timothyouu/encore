import { resolveVisualPlan } from '../../mobile/src/paper-evidence.ts'
import type { AttemptRecord } from '../../mobile/src/session.ts'
import type { Passage } from './passages.ts'
import { viewsForCards, type CardView } from './review/model.ts'

export type ReviewData = { tag: string; views: CardView[] }

function sourceTag(record: AttemptRecord): string {
  const source = record.captureSource ?? 'demo'
  const label = source === 'demo' ? 'Demo' : source === 'test' ? 'Test WAV' : source === 'g2' ? 'G2' : 'Phone'
  return record.coaching && record.coaching.coachingSource !== 'gemini' ? `${label} · local cue` : label
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
  if (!record.coaching) {
    return { tag, views: [textView('Feedback unavailable', 'No validated coaching result', 'Return to the Library or retry this saved take on the phone.')] }
  }
  const plan = resolveVisualPlan(analysis, passage, record.coaching)
  const views = viewsForCards(plan.cards, record.coaching, passage)
  if (views.length) return { tag, views }
  return { tag, views: [textView('No supported mistakes', `${analysis.metrics.matchedNotes} of ${analysis.metrics.expectedNotes} notes matched`, record.coaching.cue)] }
}
