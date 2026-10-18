import { ImageContainerProperty } from '@evenrealities/even_hub_sdk'
import { DIAGRAM_H, DIAGRAM_TILE_W, renderFeedbackTiles } from '../feedback-visual.ts'
import type { ResultView } from '../feedback.ts'
import { status } from '../status.ts'
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

// 06 · Guide: the selected, evidence-bound correction and its deterministic
// keyboard or rhythm diagram. Two 288px tiles fit the G2 image limit.
export function guideScreen({ view, onReview, onPlayAgain, renderTiles = renderFeedbackTiles }:
  { view: ResultView; onReview(): void; onPlayAgain(): void; renderTiles?: typeof renderFeedbackTiles }): Screen {
  let rendered: ReturnType<typeof renderFeedbackTiles> | null = null
  const diagram = view.diagram
  return {
    name: 'guide',
    page: () => diagram ? { textObject: [
      ...header(view.title, view.tag),
      text({ ...BODY, x: MARGIN_X, y: BODY_Y, width: 528, height: 60, content: view.guide ?? view.review, capture: true }),
      rightText({ id: 5, name: 'hintR', y: HINT_Y, content: '▲ review', brightness: HINT_BRIGHTNESS }),
    ], imageObject: [
      new ImageContainerProperty({ xPosition: 0, yPosition: 120, width: DIAGRAM_TILE_W,
        height: DIAGRAM_H, containerID: 10, containerName: 'diagramL' }),
      new ImageContainerProperty({ xPosition: DIAGRAM_TILE_W, yPosition: 120, width: DIAGRAM_TILE_W,
        height: DIAGRAM_H, containerID: 11, containerName: 'diagramR' }),
    ] } : { textObject: [...header(view.title, view.tag), body(view.guide ?? view.review)] },
    enter(ctx) {
      if (!diagram) return
      rendered ??= renderTiles(diagram)
      void rendered.then(tiles => {
        if (!ctx.isActive()) return
        void ctx.glasses.updateImage({ id: 10, name: 'diagramL' }, tiles.left, ctx.isActive)
        void ctx.glasses.updateImage({ id: 11, name: 'diagramR' }, tiles.right, ctx.isActive)
      }).catch(error => status(`feedback diagram failed: ${String(error)}`, 'error'))
    },
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
