import { ImageContainerProperty } from '@evenrealities/even_hub_sdk'
import type { ResultView } from '../feedback.ts'
import { HEADER_Y, HINT_BRIGHTNESS, HINT_Y, MARGIN_X, rightText, splitRow, text } from '../layout.ts'
import { status } from '../status.ts'
import type { Screen, ScreenContext } from './screen.ts'

const BODY = { id: 3, name: 'body' }
const BODY_Y = 56
const BODY_H = HINT_Y - BODY_Y - 8

const KEYS = { id: 10, name: 'keys' }
const KEYS_W = 288
const KEYS_H = 96
const KEYS_Y = 118
const LEGEND = { id: 4, name: 'legend' }
const LEGEND_Y = KEYS_Y + KEYS_H + 6

function header(title: string, tag: string) {
  return splitRow(1, 'title', HEADER_Y, title, tag)
}

function body(content: string, height = BODY_H) {
  // The body captures taps and swipes for the whole page.
  return text({ ...BODY, x: MARGIN_X, y: BODY_Y, width: 528, height, content, capture: true })
}

// The keyboard schematic for a finding's coaching visual (spec §4 Guide).
export type GuideVisual = {
  legend: string
  render(): Promise<Uint8Array | null>
}

// 04 · Analyzing. No input and no menu: settings never change mid-processing.
export function analyzingScreen({ title, tag }: { title: string; tag: string }): Screen {
  return {
    name: 'analyzing',
    allowsMenu: false,
    page: () => ({ textObject: [...header(title, tag), body('Analyzing…')] }),
    onInput() {},
  }
}

type ResultOptions = { view: ResultView; onGuide(): void; onPrev(): void; onPlayAgain(): void }

// 05 · Review: where, what happened, one cue. Swipe down opens Guide when
// there is a correction; swipe up is the previous feedback page (the earlier
// finding's Guide); tap or double tap is Play again (back to Selection).
export function reviewScreen({ view, onGuide, onPrev, onPlayAgain }: ResultOptions): Screen {
  const hints = view.guide ? [rightText({ id: 5, name: 'hintR', y: HINT_Y, content: '▼ guide', brightness: HINT_BRIGHTNESS })] : []
  return {
    name: 'review',
    page: () => ({ textObject: [...header(view.title, view.tag), body(view.review), ...hints] }),
    onInput(input) {
      if (input.kind === 'swipeDown' && view.guide) onGuide()
      else if (input.kind === 'swipeUp' && view.index > 0) onPrev()
      else if (input.kind === 'tap' || input.kind === 'doubleTap') onPlayAgain()
    },
  }
}

// 06 · Guide: the correction for the same finding, with a keyboard schematic
// when the coaching visual supplies one. Swipe up returns to Review; swipe
// down is the next feedback page (the next finding's Review).
export function guideScreen({ view, onReview, onNext, onPlayAgain, visual }: {
  view: ResultView
  onReview(): void
  onNext(): void
  onPlayAgain(): void
  visual?: GuideVisual
}): Screen {
  let context: ScreenContext | null = null
  return {
    name: 'guide',
    page: () => {
      const content = view.guide ?? view.review
      if (!visual) return { textObject: [...header(view.title, view.tag), body(content)] }
      return {
        textObject: [
          ...header(view.title, view.tag),
          body(content, KEYS_Y - BODY_Y - 4),
          text({ ...LEGEND, x: MARGIN_X, y: LEGEND_Y, width: 528, content: visual.legend, brightness: HINT_BRIGHTNESS }),
        ],
        imageObject: [
          new ImageContainerProperty({
            xPosition: (576 - KEYS_W) / 2,
            yPosition: KEYS_Y,
            width: KEYS_W,
            height: KEYS_H,
            containerID: KEYS.id,
            containerName: KEYS.name,
          }),
        ],
      }
    },
    enter(ctx) {
      context = ctx
      if (!visual) return
      Promise.resolve()
        .then(() => visual.render())
        .then(image => {
          if (image) ctx.glasses.updateImage(KEYS, image, () => context === ctx && ctx.isActive())
        })
        .catch(error => status(`keyboard render failed: ${String(error)}`, 'error'))
    },
    onInput(input) {
      if (input.kind === 'swipeUp') onReview()
      else if (input.kind === 'swipeDown' && view.index < view.findings - 1) onNext()
      else if (input.kind === 'tap' || input.kind === 'doubleTap') onPlayAgain()
    },
  }
}

// Recoverable error: a plain reason, never worded as a musical mistake.
export function errorScreen({ title, message, onPlayAgain }: { title: string; message: string; onPlayAgain(): void }): Screen {
  return {
    name: 'error',
    page: () => ({ textObject: [...header(title, ''), body(`Couldn't finish this take.\n${message}`)] }),
    onInput(input) {
      if (input.kind === 'tap' || input.kind === 'doubleTap') onPlayAgain()
    },
  }
}
