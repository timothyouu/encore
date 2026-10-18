import type { Page } from '../glasses'
import type { Input } from '../input'

// One glasses state from spec §4. The app renders `page()` on entry and
// forwards every normalized input to `onInput`.
export type Screen = {
  name: string
  page(): Page
  onInput(input: Input): void
}
