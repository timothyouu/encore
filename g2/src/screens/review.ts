import { ImageContainerProperty } from '@evenrealities/even_hub_sdk'
import type { CoachingResult } from '../../../shared/contracts.ts'
import type { VisualCard } from '../../../shared/visual-contract.ts'
import type { MistakeVisualization } from '../../../mobile/src/visualization.ts'
import { HEADER_Y, HINT_BRIGHTNESS, HINT_Y, MARGIN_X, padToWidth, rightText, text } from '../layout.ts'
import { ART_H, ART_W, MAX_REVEAL_STEPS, renderBarArt, renderCardArt, renderReplayFrame, replaySteps, type ReplayStep } from '../review/art.ts'
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
const PHASE = { id: 8, name: 'phase' }

const ART_Y = 44
const COLUMN_X = 300
const LEGEND_BRIGHTNESS = 3
const REPLAY_HINT = 'tap  replay'
// The bottom-right box holds the next hint or one progress dot per replay frame.
const DOTS_ROOM = '●'.repeat(2 * MAX_REVEAL_STEPS + 1)
const NEXT_HINT = padToWidth('▼  next', DOTS_ROOM)
// A frame that ends a replay phase stays up at least this long (a reveal
// step half as long), even on a fast link.
const FRAME_DWELL_MS = 2000

type ReviewOptions = {
  coaching?: CoachingResult
  // Ready-made cards (the dev demo gallery); otherwise built from `coaching`.
  views?: CardView[]
  tag?: string
  initialIndex?: number
  // Saved attempts traverse Review(i), Guide(i), Review(i+1) in the store.
  phase?: 'review' | 'guide'
  history?: boolean
  onNavigate?: (delta: number) => void
  // Double tap: back to passage selection (spec §4 "Play again").
  onPlayAgain(): void
  // Keep the shared phone finding selection aligned with a glasses card swipe.
  onCardChange?: (view: CardView, index: number) => void
  // Only validated saved finding evidence may supply a supplemental frame.
  keyboardContext?: (view: CardView) => MistakeVisualization | null
  // Fixture results must say so on screen (spec §9).
  demo?: boolean
  // Canvas rendering and real time by default; tests pass stand-ins.
  renderArt?: (card: VisualCard) => Promise<Uint8Array>
  renderFrame?: (card: VisualCard, step: ReplayStep, context?: MistakeVisualization | null) => Promise<Uint8Array>
  frameDwellMs?: number
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// 05 · Review. One mistake card per screen from the coaching result's visual
// plan: art on the left (keys, staff, beat ruler, duration bars or mic), the
// ●/× legend and cue on the right. Swipe down/up moves between cards; every
// card shares one layout, so changing card is text updates plus one image.
// Tap replays the card: its keyframes (what was played, revealed in order,
// then the fix) are sent one after another at Bluetooth pace, ending on the
// fix. Swiping away and back shows the comparison again. Swiping or leaving
// cancels a replay.
export function reviewScreen({
  coaching,
  views = coaching ? cardViews(coaching) : [{ card: null, header: 'Feedback unavailable', legend: ['No validated coaching result', ''], cue: 'Try again.' }],
  tag = '',
  initialIndex = 0,
  phase,
  history = false,
  onNavigate,
  onPlayAgain,
  onCardChange,
  keyboardContext,
  demo = false,
  renderArt,
  renderFrame = renderReplayFrame,
  frameDwellMs = FRAME_DWELL_MS,
}: ReviewOptions): Screen {
  let index = Math.max(0, Math.min(views.length - 1, initialIndex))
  let context: ScreenContext | null = null
  // Bumped whenever the card changes or a replay starts; stale work stops.
  let generation = 0
  let replaying = false
  // Keep the last picture delivered to the glasses across an OS-menu redraw.
  let displayed: { index: number; step: ReplayStep } | null = null
  const paired = Boolean(phase && views.some(view => view.findingId))

  const contextFor = (i: number) => keyboardContext?.(views[i]) ?? null
  const steps = (i: number) => {
    const card = views[i].card
    return card ? replaySteps(card, Boolean(contextFor(i)), Boolean(views[i].segment)) : []
  }
  const counter = (i: number) => {
    const count = views.length > 1 ? `${i + 1} / ${views.length}` : ''
    return `${tag || (demo ? 'DEMO' : '')} ${count}`.trim()
  }
  const nextHint = (i: number) => paired && phase === 'review' ? padToWidth('▼  guide', DOTS_ROOM) : (i < views.length - 1 ? NEXT_HINT : '')
  const replayHint = (i: number) => paired && phase === 'review' ? 'tap  guide' : (steps(i).length ? REPLAY_HINT : '')
  const phaseLabel = (view: CardView) => phase
    ? `${history ? 'Saved ' : ''}${phase === 'review' ? 'Review' : 'Guide'}${view.position ? ` · ${view.position}` : ''}` : ''
  const cue = (view: CardView) => phase === 'review' && view.findingId ? 'Compare the notes. Swipe down for guidance.' : view.cue
  const dots = (done: number, total: number) => padToWidth('●'.repeat(done) + '○'.repeat(total - done), DOTS_ROOM)

  function texts(view: CardView, i: number): [{ id: number; name: string }, string][] {
    return [
      [TITLE, view.header],
      [COUNTER, counter(i)],
      [EXPECTED, view.legend[0]],
      [DETECTED, view.legend[1]],
      [CUE, cue(view)],
      [NEXT, nextHint(i)],
      [REPLAY, replayHint(i)],
      [PHASE, phaseLabel(view)],
    ]
  }

  function sendStatic(i: number, still: () => boolean) {
    const card = views[i].card
    if (!card || !context) return Promise.resolve()
    const ctx = context
    const paint = renderArt ?? (views[i].segment ? (value: VisualCard) => renderBarArt(value, phase === 'guide') : renderCardArt)
    return paint(card)
      .then(png => ctx.glasses.updateImage(ART, png, still))
      .catch(error => status(`card art failed: ${String(error)}`, 'error'))
  }

  function sendDisplayed(i: number, still: () => boolean) {
    const shown = displayed
    const card = views[i].card
    if (!shown || shown.index !== i || !card || !context) return sendStatic(i, still)
    const ctx = context
    return renderFrame(card, shown.step, contextFor(i))
      .then(png => ctx.glasses.updateImage(ART, png, still))
      .catch(error => status(`replay art failed: ${String(error)}`, 'error'))
  }

  function show(i: number) {
    index = i
    replaying = false
    displayed = null
    const mine = ++generation
    const ctx = context
    if (!ctx) return
    onCardChange?.(views[i], i)
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
    const total = plan.length

    try {
      for (const [n, step] of plan.entries()) {
        if (!current()) return
        const delivered = await ctx.glasses.updateImage(ART, await renderFrame(card, step, contextFor(i)), current)
        if (!delivered || !current()) return
        displayed = { index: i, step }
        // Text lands instantly and images lag over BLE, so the caption follows the picture.
        await ctx.glasses.updateText(REPLAY, step.caption, current)
        await ctx.glasses.updateText(NEXT, dots(n + 1, total), current)
        const dwell = step.hold === 'end' ? frameDwellMs : frameDwellMs / 2
        if (current() && dwell > 0) await wait(dwell)
      }
      if (!current()) return
      // Stay on the fix and restore the hints.
      ctx.glasses.updateText(REPLAY, replayHint(i) || ' ', current)
      ctx.glasses.updateText(NEXT, nextHint(i) || ' ', current)
    } catch (error) {
      status(`replay failed: ${String(error)}`, 'error')
    } finally {
      if (generation === mine) replaying = false
    }
  }

  return {
    name: phase ?? 'review',

    page: () => {
      const first = views[index]
      return {
        textObject: [
          text({ ...TITLE, x: MARGIN_X, y: HEADER_Y, width: 380, content: first.header }),
          rightText({ ...COUNTER, y: HEADER_Y, content: counter(index), sizeFor: `${tag || 'DEMO'} ${views.length} / ${views.length}` }),
          text({ ...EXPECTED, x: COLUMN_X, y: 60, width: CUE_WIDTH, content: first.legend[0], brightness: LEGEND_BRIGHTNESS }),
          text({ ...DETECTED, x: COLUMN_X, y: 87, width: CUE_WIDTH, content: first.legend[1], brightness: LEGEND_BRIGHTNESS }),
          // Swipes reach the app through this capture container.
          text({ ...CUE, x: COLUMN_X, y: 124, width: CUE_WIDTH, height: 81, content: cue(first), capture: true }),
          text({ ...PHASE, x: MARGIN_X, y: 211, width: 528, content: phaseLabel(first), brightness: LEGEND_BRIGHTNESS }),
          // Bottom row: replay hint (then the frame caption) left, next hint (then progress dots) right.
          text({ ...REPLAY, x: MARGIN_X, y: HINT_Y, width: 260, content: replayHint(index), brightness: HINT_BRIGHTNESS }),
          rightText({ ...NEXT, y: HINT_Y, content: nextHint(index), sizeFor: DOTS_ROOM, brightness: HINT_BRIGHTNESS }),
        ],
        imageObject: first.card ? [
          new ImageContainerProperty({ xPosition: 0, yPosition: ART_Y, width: ART_W, height: ART_H, containerID: ART.id, containerName: ART.name }),
        ] : [],
      }
    },

    enter(ctx) {
      context = ctx
      replaying = false
      const mine = ++generation
      sendDisplayed(index, () => ctx.isActive() && generation === mine)
    },

    dispose() {
      generation++
      replaying = false
      context = null
    },

    onInput(input) {
      if (paired && onNavigate && input.kind === 'swipeDown') onNavigate(1)
      else if (paired && onNavigate && input.kind === 'swipeUp') onNavigate(-1)
      else if (paired && onNavigate && phase === 'review' && input.kind === 'tap') onNavigate(1)
      else if (input.kind === 'swipeDown' && index < views.length - 1) show(index + 1)
      else if (input.kind === 'swipeUp' && index > 0) show(index - 1)
      else if (input.kind === 'tap') replay(index)
      else if (input.kind === 'doubleTap') onPlayAgain()
    },
  }
}
