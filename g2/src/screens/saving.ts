import { MARGIN_X, text } from '../layout.ts'
import type { Take } from '../recorder.ts'
import type { UploadResult } from '../upload.ts'
import type { Screen } from './screen.ts'

const MESSAGE = { id: 1, name: 'message' }

type SavingOptions = {
  take: Take
  upload(): Promise<UploadResult>
  // Saved: continue to passage selection, as after any result.
  onSaved(): void
  // Not saved: return to where the player was (Ready for the same passage).
  onFailed(): void
}

// Interim stand-in for 04 · Analyzing until analysis exists: uploads the take
// and says whether it was saved. Upload problems are worded as such, never as
// musical feedback (spec §8). Afterwards, tap continues to selection if the
// take was saved, or back to Ready (tap or double tap) if it wasn't.
export function savingScreen({ take, upload, onSaved, onFailed }: SavingOptions): Screen {
  let result: UploadResult | null = null

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
      upload().then(outcome => {
        result = outcome
        if (!isActive()) return
        glasses.updateText(
          MESSAGE,
          outcome.ok
            ? `Take saved · ${take.durationSec.toFixed(1)}s`
            : `Couldn't save the take.\n${outcome.reason}`,
        )
      })
    },

    onInput(input) {
      if (!result) return
      if (result.ok && input.kind === 'tap') onSaved()
      else if (!result.ok && (input.kind === 'tap' || input.kind === 'doubleTap')) onFailed()
    },
  }
}
