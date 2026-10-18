import { ListContainerProperty, ListItemContainerProperty } from '@evenrealities/even_hub_sdk'
import { HEADER_Y, HINT_Y, MARGIN_X, SCREEN_W, splitRow, text } from '../layout'
import type { Passage } from '../passages'
import type { Screen } from './screen'

// Firmware list rows are a fixed 40px; four fit between the header and hint bar.
// Rows have 12px inner padding, so this lines item text up with the header at MARGIN_X.
const LIST_X = MARGIN_X - 12 - 4
const LIST_W = SCREEN_W - 2 * LIST_X
const LIST_Y = 48
const VISIBLE_ROWS = 4
const LIST_PADDING = 4

type SelectionOptions = {
  passages: Passage[]
  onOpen(passage: Passage): void
  onExit(): void
}

// 01 · Select passage. The native list owns scrolling and the selection box,
// so swipes never reach the app here; only a tap (listSelect) or double tap does.
export function selectionScreen({ passages, onOpen, onExit }: SelectionOptions): Screen {
  return {
    name: 'selection',

    page: () => ({
      textObject: [
        text({ id: 1, name: 'title', x: MARGIN_X, y: HEADER_Y, width: 400, content: 'Choose a passage' }),
        ...splitRow(3, 'hint', HINT_Y, 'tap  open', '2× tap  exit'),
      ],
      listObject: [
        new ListContainerProperty({
          xPosition: LIST_X,
          yPosition: LIST_Y,
          width: LIST_W,
          height: VISIBLE_ROWS * 40 + 2 * LIST_PADDING,
          borderWidth: 0,
          borderColor: 0,
          paddingLength: LIST_PADDING,
          containerID: 2,
          containerName: 'passages',
          isEventCapture: 1,
          itemContainer: new ListItemContainerProperty({
            itemCount: passages.length,
            // Full-width rows so the selection box spans the screen like the mockup.
            itemWidth: LIST_W - 2 * LIST_PADDING,
            isItemSelectBorderEn: 1,
            itemName: passages.map(passage => passage.title),
          }),
        }),
      ],
    }),

    onInput(input) {
      if (input.kind === 'listSelect') {
        const passage = passages[input.index]
        if (passage) onOpen(passage)
      } else if (input.kind === 'doubleTap') {
        onExit()
      }
    },
  }
}
