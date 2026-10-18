import { HINT_BRIGHTNESS, MARGIN_X, text } from '../layout.ts'
import type { Screen } from './screen.ts'

type ProblemOptions = {
  // Plain words, e.g. "Can't reach the server." Never phrased as a musical mistake.
  reason: string
  onPlayAgain(): void
}

// Recoverable error: the take couldn't be processed (network, server or
// analysis failure). Unclear audio is not an error; it arrives as a review
// card. Tap or double tap returns to passage selection.
export function problemScreen({ reason, onPlayAgain }: ProblemOptions): Screen {
  return {
    name: 'problem',

    page: () => ({
      textObject: [
        text({ id: 1, name: 'title', x: MARGIN_X, y: 92, width: 528, content: "Couldn't finish that take.", capture: true }),
        text({ id: 2, name: 'reason', x: MARGIN_X, y: 119, width: 528, height: 60, content: reason, brightness: HINT_BRIGHTNESS + 1 }),
      ],
    }),

    onInput(input) {
      if (input.kind === 'tap' || input.kind === 'doubleTap') onPlayAgain()
    },
  }
}
