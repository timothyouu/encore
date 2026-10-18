import type { CoachingResult } from '../../shared/contracts.ts'
import type { VisualCard } from '../../shared/visual-contract.ts'
import examples from '../../shared/visual-examples.json' with { type: 'json' }
import { viewsForCards } from './review/model.ts'

// Dev-only gallery of every example card in shared/visual-examples.json, so
// the Review screen can be checked on the glasses before the pipeline is
// connected. Open the app with `?demo=review`. Shown with a DEMO label.
export function demoReview() {
  const cards = (examples.examples as { plan: { cards: VisualCard[] } }[]).map(example => example.plan.cards[0])
  const coaching: CoachingResult = {
    schemaVersion: '1',
    attemptId: 'demo',
    coachingSource: 'fallback',
    cue: cards[0].cue,
    evidenceFindingIds: [],
    visual: { kind: 'none', referenceNoteIds: [], poseIds: [], mistakes: [] },
  }
  return { coaching, views: viewsForCards(cards, coaching) }
}

export function demoRequested() {
  const env = import.meta.env as ImportMetaEnv | undefined
  return Boolean(env?.DEV) && typeof location !== 'undefined' && new URLSearchParams(location.search).get('demo') === 'review'
}
