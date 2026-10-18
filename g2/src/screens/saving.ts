import { MARGIN_X, text } from '../layout'
import type { Take } from '../recorder'
import type { UploadResult } from '../upload'
import type { Screen } from './screen'

const MESSAGE = { id: 1, name: 'message' }

type SavingOptions = {
  take: Take
  upload(): Promise<UploadResult>
  onDone(): void
}

// Interim stand-in for 04 · Analyzing until analysis exists: uploads the take
// and says whether it was saved. Upload problems are worded as such, never as
// musical feedback (spec §8). Tap afterwards returns to passage selection.
export function savingScreen({ take, upload, onDone }: SavingOptions): Screen {
  let done = false

  return {
    name: 'saving',
    // Like Analyzing: no settings changes while a take is being processed.
    allowsMenu: false,

    page: () => ({
      textObject: [
        text({ ...MESSAGE, x: MARGIN_X, y: 104, width: 528, height: 64, content: 'Saving take…', capture: true }),
      ],
    }),

    enter({ glasses, isActive }) {
      upload().then(result => {
        done = true
        if (!isActive()) return
        glasses.updateText(
          MESSAGE,
          result.ok
            ? `Take saved · ${take.durationSec.toFixed(1)}s`
            : `Couldn't save the take.\n${result.reason}`,
        )
      })
    },

    onInput(input) {
      if (done && input.kind === 'tap') onDone()
    },
  }
}
