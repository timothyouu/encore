import { ImageContainerProperty } from '@evenrealities/even_hub_sdk'
import type { CoachingResult } from '../../../shared/contracts.ts'
import type { VisualCard } from '../../../shared/visual-contract.ts'
import { HEADER_Y, HINT_BRIGHTNESS, HINT_Y, MARGIN_X, padToWidth, rightText, text } from '../layout.ts'
import { ART_H, ART_W, renderCardArt, renderReplayFrame, replaySteps, type ReplayStep } from '../review/art.ts'
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
const REPLAY = { id: 7, name: 'replay' }

const ART_Y = 44
const COLUMN_X = 300
const LEGEND_BRIGHTNESS = 3
const NEXT_HINT = '▼  next'
const REPLAY_HINT = 'tap  replay'
// Each replay frame stays up at least this long, even on a fast link.
const FRAME_DWELL_MS = 2000

type ReviewOptions = {
  coaching: CoachingResult
  // Ready-made cards (the dev demo gallery); otherwise built from `coaching`.
  views?: CardView[]
  // Double tap: back to passage selection (spec §4 "Play again").
  onPlayAgain(): void
  // Fixture results must say so on screen (spec §9).
  demo?: boolean
  // Canvas rendering and real time by default; tests pass stand-ins.
  renderArt?: (card: VisualCard) => Promise<Uint8Array>
  renderFrame?: (card: VisualCard, step: ReplayStep) => Promise<Uint8Array>
  frameDwellMs?: number
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// 05 · Review. One mistake card per screen from the coaching result's visual
// plan: art on the left (keys, staff, beat ruler, duration bars or mic), the
// ●/× legend and cue on the right. Swipe down/up moves between cards; every
// card shares one layout, so changing card is text updates plus one image.
// Tap replays the card: its keyframes (what was played, then the fix) are
// sent one after another at Bluetooth pace, then it settles on the static
// picture. Swiping or leaving cancels a replay.
export function reviewScreen({
  coaching,
  views = cardViews(coaching),
  onPlayAgain,
  demo = false,
  renderArt = renderCardArt,
  renderFrame = renderReplayFrame,
  frameDwellMs = FRAME_DWELL_MS,
}: ReviewOptions): Screen {
  let index = 0
  let context: ScreenContext | null = null
  // Bumped whenever the card changes or a replay starts; stale work stops.
  let generation = 0
  let replaying = false

  const steps = (i: number) => {
    const card = views[i].card
    return card ? replaySteps(card) : []
  }
  const counter = (i: number) => {
    const count = views.length > 1 ? `${i + 1} / ${views.length}` : ''
    return demo ? `DEMO ${count}`.trim() : count
  }
  const nextHint = (i: number) => (i < views.length - 1 ? NEXT_HINT : '')
  const replayHint = (i: number) => (steps(i).length ? REPLAY_HINT : '')
  const dots = (done: number, total: number) => padToWidth('●'.repeat(done) + '○'.repeat(total - done), NEXT_HINT)

  function texts(view: CardView, i: number): [{ id: number; name: string }, string][] {
    return [
      [TITLE, view.header],
      [COUNTER, counter(i)],
      [EXPECTED, view.legend[0]],
      [DETECTED, view.legend[1]],
      [CUE, view.cue],
      [NEXT, nextHint(i)],
      [REPLAY, replayHint(i)],
    ]
  }

  function sendStatic(i: number, still: () => boolean) {
    const card = views[i].card
    if (!card || !context) return Promise.resolve()
    const ctx = context
    return renderArt(card)
      .then(png => ctx.glasses.updateImage(ART, png, still))
      .catch(error => status(`card art failed: ${String(error)}`, 'error'))
  }

  function show(i: number) {
    index = i
    replaying = false
    const mine = ++generation
    const ctx = context
    if (!ctx) return
    // Fast swipes queue several cards; only the card still shown is sent.
    const current = () => ctx.isActive() && generation === mine
    for (const [container, content] of texts(views[i], i)) ctx.glasses.updateText(container, content || ' ', current)
    sendStatic(i, current)
  }

  async function replay(i: number) {
    const card = views[i].card
    const plan = steps(i)
    const ctx = context
    if (!card || !plan.length || !ctx || replaying) return
    replaying = true
    const mine = ++generation
    const current = () => ctx.isActive() && generation === mine
    const total = plan.length + 1

    try {
      for (const [n, step] of plan.entries()) {
        if (!current()) return
        const started = Date.now()
        ctx.glasses.updateText(REPLAY, step.caption, current)
        ctx.glasses.updateText(NEXT, dots(n + 1, total), current)
        await ctx.glasses.updateImage(ART, await renderFrame(card, step), current)
        const remaining = frameDwellMs - (Date.now() - started)
        if (remaining > 0) await wait(remaining)
      }
      if (!current()) return
      // Settle on the static card and restore the hints.
      ctx.glasses.updateText(NEXT, dots(total, total), current)
      await sendStatic(i, current)
      ctx.glasses.updateText(REPLAY, replayHint(i) || ' ', current)
      ctx.glasses.updateText(NEXT, nextHint(i) || ' ', current)
    } catch (error) {
      status(`replay failed: ${String(error)}`, 'error')
    } finally {
      if (generation === mine) replaying = false
    }
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
          // Bottom row: replay hint (then the frame caption) left, next hint (then progress dots) right.
          text({ ...REPLAY, x: MARGIN_X, y: HINT_Y, width: 260, content: replayHint(0), brightness: HINT_BRIGHTNESS }),
          rightText({ ...NEXT, y: HINT_Y, content: nextHint(0), sizeFor: NEXT_HINT, brightness: HINT_BRIGHTNESS }),
        ],
        imageObject: [
          new ImageContainerProperty({ xPosition: 0, yPosition: ART_Y, width: ART_W, height: ART_H, containerID: ART.id, containerName: ART.name }),
        ],
      }
    },

    enter(ctx) {
      context = ctx
      const mine = generation
      sendStatic(index, () => ctx.isActive() && generation === mine)
    },

    onInput(input) {
      if (input.kind === 'swipeDown' && index < views.length - 1) show(index + 1)
      else if (input.kind === 'swipeUp' && index > 0) show(index - 1)
      else if (input.kind === 'tap') replay(index)
      else if (input.kind === 'doubleTap') onPlayAgain()
    },
  }
}
