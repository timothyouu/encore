import { HEADER_Y, HINT_Y, MARGIN_X, splitRow, text } from '../layout'
import type { Passage } from '../passages'
import type { Screen } from './screen'

type ReadyOptions = {
  passage: Passage
  onBack(): void
}

// 02 · Ready. Placeholder until the preview (staff + focus line) lands in the next PR;
// it exists so selection and back navigation can be tested on hardware now.
export function readyScreen({ passage, onBack }: ReadyOptions): Screen {
  return {
    name: 'ready',

    page: () => ({
      textObject: [
        ...splitRow(1, 'title', HEADER_Y, passage.title, `${passage.bpm} bpm · RH`),
        text({
          id: 3,
          name: 'body',
          x: MARGIN_X,
          y: 104,
          width: 528,
          height: 64,
          content: 'Preview coming in the next build.',
          capture: true,
        }),
        ...splitRow(4, 'hint', HINT_Y, '', '2× tap  back'),
      ],
    }),

    onInput(input) {
      if (input.kind === 'doubleTap') onBack()
    },
  }
}
