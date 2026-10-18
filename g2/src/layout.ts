import { TextContainerProperty } from '@evenrealities/even_hub_sdk'
import { getTextWidth } from '@evenrealities/pretext'

// Shared geometry from the Paper mockups (576×288 canvas, 27px firmware line height).
export const SCREEN_W = 576
export const LINE_H = 27
export const MARGIN_X = 24
export const HEADER_Y = 12
export const HINT_Y = 250
const TEXT_BOX_H = 32

type TextOptions = {
  id: number
  name: string
  x: number
  y: number
  width: number
  height?: number
  content: string
  capture?: boolean
  // Firmware brightness 0–4; omitted means full (4).
  brightness?: number
}

export function text({ id, name, x, y, width, height = TEXT_BOX_H, content, capture, brightness }: TextOptions) {
  return new TextContainerProperty({
    xPosition: x,
    yPosition: y,
    width,
    height,
    borderWidth: 0,
    borderColor: 0,
    paddingLength: 0,
    containerID: id,
    containerName: name,
    // Containers cannot be empty; a single space renders as nothing.
    content: content || ' ',
    isEventCapture: capture ? 1 : 0,
    ...(brightness === undefined ? {} : { textColor: brightness }),
  })
}

// The firmware only left-aligns, so right-aligned text is positioned by its
// measured width. In-place updates keep that width, so a box whose text will
// change can be sized for its eventual label with `sizeFor`.
export function rightText({ sizeFor, ...options }: Omit<TextOptions, 'x' | 'width'> & { sizeFor?: string }) {
  const width = Math.min(getTextWidth(sizeFor ?? options.content) + 4, SCREEN_W - 2 * MARGIN_X)
  return text({ ...options, x: SCREEN_W - MARGIN_X - width, width })
}

// Left and right labels on one row, e.g. a header or the gesture hint bar.
export function splitRow(firstId: number, prefix: string, y: number, left: string, right: string) {
  return [
    text({ id: firstId, name: `${prefix}L`, x: MARGIN_X, y, width: 300, content: left }),
    rightText({ id: firstId + 1, name: `${prefix}R`, y, content: right }),
  ]
}

// Gesture hints sit dimmed on the bottom row so content stays brightest.
// Only shown where the action isn't obvious; first hint left, second right.
export const HINT_BRIGHTNESS = 2

export function hintRow(firstId: number, hints: [string] | [string, string]) {
  const [left, right] = hints
  const row = [
    text({ id: firstId, name: 'hintL', x: MARGIN_X, y: HINT_Y, width: 260, content: left, brightness: HINT_BRIGHTNESS }),
  ]
  if (right) row.push(rightText({ id: firstId + 1, name: 'hintR', y: HINT_Y, content: right, brightness: HINT_BRIGHTNESS }))
  return row
}
