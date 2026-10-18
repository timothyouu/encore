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
}

export function text({ id, name, x, y, width, height = TEXT_BOX_H, content, capture }: TextOptions) {
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
  })
}

// The firmware only left-aligns, so right-aligned text is positioned by its measured width.
export function rightText(options: Omit<TextOptions, 'x' | 'width'>) {
  const width = Math.min(getTextWidth(options.content) + 4, SCREEN_W - 2 * MARGIN_X)
  return text({ ...options, x: SCREEN_W - MARGIN_X - width, width })
}

// Left and right labels on one row, e.g. a header or the gesture hint bar.
export function splitRow(firstId: number, prefix: string, y: number, left: string, right: string) {
  return [
    text({ id: firstId, name: `${prefix}L`, x: MARGIN_X, y, width: 300, content: left }),
    rightText({ id: firstId + 1, name: `${prefix}R`, y, content: right }),
  ]
}
