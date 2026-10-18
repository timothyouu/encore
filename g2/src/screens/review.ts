import { ImageContainerProperty } from '@evenrealities/even_hub_sdk'
import type { CoachingResult } from '../../../shared/contracts.ts'
import type { VisualCard } from '../../../shared/visual-contract.ts'
import { HEADER_Y, HINT_BRIGHTNESS, HINT_Y, MARGIN_X, rightText, text } from '../layout.ts'
import { ART_H, ART_W, renderCardArt } from '../review/art.ts'
import { CUE_WIDTH, cardViews, type CardView } from '../review/model.ts'
import { status } from '../status.ts'
import type { Screen, ScreenContext } from './screen.ts'

const ART = { id: 10, name: 'art' }
const TITLE = { id: 1, name: 'title' }
const COUNTER = { id: 2, name: 'counter' }
const EXPECTED = { id: 3, name: 'expected' }
const DETECTED = { id: 4, name: 'detected' }
const CUE = { id: 5, name: 'cue' }
const NEXT = { id: 6, name: 'next' }

const ART_Y = 44
const COLUMN_X = 300
const LEGEND_BRIGHTNESS = 3
const NEXT_HINT = '▼  next'

type ReviewOptions = {
  coaching: CoachingResult
  // Ready-made cards (the dev demo gallery); otherwise built from `coaching`.
  views?: CardView[]
  // Double tap: back to passage selection (spec §4 "Play again").
  onPlayAgain(): void
  // Fixture results must say so on screen (spec §9).
  demo?: boolean
  // Canvas rendering by default; tests pass a stand-in.
  renderArt?: (card: VisualCard) => Promise<Uint8Array>
}

// 05 · Review. One mistake card per screen from the coaching result's visual
// plan: art on the left (keys, staff, beat ruler, duration bars or mic), the
// ●/○ legend and cue on the right. Swipe down/up moves between cards; every
// card shares one layout, so changing card is text updates plus one image.
// Tap (replay) arrives with the replay keyframes.
export function reviewScreen({
  coaching,
  views = cardViews(coaching),
  onPlayAgain,
  demo = false,
  renderArt = renderCardArt,
}: ReviewOptions): Screen {
  let index = 0
  let context: ScreenContext | null = null

  const counter = (i: number) => {
    const count = views.length > 1 ? `${i + 1} / ${views.length}` : ''
    return demo ? `DEMO ${count}`.trim() : count
  }
  const nextHint = (i: number) => (i < views.length - 1 ? NEXT_HINT : '')

  function texts(view: CardView, i: number): [{ id: number; name: string }, string][] {
    return [
      [TITLE, view.header],
      [COUNTER, counter(i)],
      [EXPECTED, view.legend[0]],
      [DETECTED, view.legend[1]],
      [CUE, view.cue],
      [NEXT, nextHint(i)],
    ]
  }

  function sendArt(i: number) {
    const card = views[i].card
    if (!card || !context) return
    const ctx = context
    renderArt(card)
      .then(png => ctx.glasses.updateImage(ART, png, () => ctx.isActive() && index === i))
      .catch(error => status(`card art failed: ${String(error)}`, 'error'))
  }

  function show(i: number) {
    index = i
    const ctx = context
    if (!ctx) return
    // Fast swipes queue several cards; only the card still shown is sent.
    const current = () => ctx.isActive() && index === i
    for (const [container, content] of texts(views[i], i)) ctx.glasses.updateText(container, content || ' ', current)
    sendArt(i)
  }

  return {
    name: 'review',

    page: () => {
      const first = views[0]
      return {
        textObject: [
          text({ ...TITLE, x: MARGIN_X, y: HEADER_Y, width: 380, content: first.header }),
          rightText({ ...COUNTER, y: HEADER_Y, content: counter(0), sizeFor: `DEMO ${views.length} / ${views.length}` }),
          text({ ...EXPECTED, x: COLUMN_X, y: 60, width: CUE_WIDTH, content: first.legend[0], brightness: LEGEND_BRIGHTNESS }),
          text({ ...DETECTED, x: COLUMN_X, y: 87, width: CUE_WIDTH, content: first.legend[1], brightness: LEGEND_BRIGHTNESS }),
          // Swipes reach the app through this capture container.
          text({ ...CUE, x: COLUMN_X, y: 124, width: CUE_WIDTH, height: 84, content: first.cue, capture: true }),
          rightText({ ...NEXT, y: HINT_Y, content: nextHint(0), sizeFor: NEXT_HINT, brightness: HINT_BRIGHTNESS }),
        ],
        imageObject: [
          new ImageContainerProperty({ xPosition: 0, yPosition: ART_Y, width: ART_W, height: ART_H, containerID: ART.id, containerName: ART.name }),
        ],
      }
    },

    enter(ctx) {
      context = ctx
      sendArt(index)
    },

    onInput(input) {
      if (input.kind === 'swipeDown' && index < views.length - 1) show(index + 1)
      else if (input.kind === 'swipeUp' && index > 0) show(index - 1)
      else if (input.kind === 'doubleTap') onPlayAgain()
    },
  }
}
