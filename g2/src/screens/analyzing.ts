import { HINT_BRIGHTNESS, MARGIN_X, text } from '../layout.ts'
import type { Screen, ScreenContext } from './screen.ts'

const STAGE = { id: 2, name: 'stage' }

// 04 · Analyzing. Short processing status while the take is uploaded,
// analysed and coached; no input and no menu (settings never change while a
// take is processed). The host may report the current stage in words.
export function analyzingScreen(initialStage = '') {
  let context: ScreenContext | null = null
  let stage = initialStage

  const screen: Screen & { setStage(next: string): void } = {
    name: 'analyzing',
    allowsMenu: false,

    page: () => ({
      textObject: [
        text({ id: 1, name: 'status', x: MARGIN_X, y: 104, width: 528, content: 'Listening back…', capture: true }),
        text({ ...STAGE, x: MARGIN_X, y: 131, width: 528, content: stage, brightness: HINT_BRIGHTNESS }),
      ],
    }),

    enter(ctx) {
      context = ctx
    },

    onInput() {},

    setStage(next) {
      stage = next
      context?.glasses.updateText(STAGE, next || ' ')
    },
  }
  return screen
}
