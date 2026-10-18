import type { ResultView } from '../feedback.ts'
import { HEADER_Y, HINT_BRIGHTNESS, HINT_Y, MARGIN_X, rightText, splitRow, text } from '../layout.ts'
import type { Screen } from './screen.ts'

const BODY = { id: 3, name: 'body' }
const BODY_Y = 56
const BODY_H = HINT_Y - BODY_Y - 8

function header(title: string, tag: string) {
  return splitRow(1, 'title', HEADER_Y, title, tag)
}

function body(content: string) {
  // The body captures taps and swipes for the whole page.
  return text({ ...BODY, x: MARGIN_X, y: BODY_Y, width: 528, height: BODY_H, content, capture: true })
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

type ResultOptions = { view: ResultView; onGuide(): void; onPlayAgain(): void }

// 05 · Review: where, what happened, one cue. Swipe down opens Guide when
// there is a correction; tap or double tap is Play again (back to Selection).
export function reviewScreen({ view, onGuide, onPlayAgain }: ResultOptions): Screen {
  const hints = view.guide ? [rightText({ id: 5, name: 'hintR', y: HINT_Y, content: '▼ guide', brightness: HINT_BRIGHTNESS })] : []
  return {
    name: 'review',
    page: () => ({ textObject: [...header(view.title, view.tag), body(view.review), ...hints] }),
    onInput(input) {
      if (input.kind === 'swipeDown' && view.guide) onGuide()
      else if (input.kind === 'tap' || input.kind === 'doubleTap') onPlayAgain()
    },
  }
}

// 06 · Guide: the correction for the same finding. Swipe up returns to Review.
export function guideScreen({ view, onReview, onPlayAgain }: { view: ResultView; onReview(): void; onPlayAgain(): void }): Screen {
  return {
    name: 'guide',
    page: () => ({ textObject: [...header(view.title, view.tag), body(view.guide ?? view.review)] }),
    onInput(input) {
      if (input.kind === 'swipeUp') onReview()
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
