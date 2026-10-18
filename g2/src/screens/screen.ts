import type { Glasses, Page } from '../glasses'
import type { Input } from '../input'

export type ScreenContext = {
  glasses: Glasses
  // False once the player has moved to another screen; check before late work.
  isActive(): boolean
}

// One glasses state from spec §4. The app renders `page()` on entry, then
// calls `enter` for follow-up work such as image sends, and forwards every
// normalized input to `onInput`.
export type Screen = {
  name: string
  page(): Page
  enter?(context: ScreenContext): void
  onInput(input: Input): void
  // Long press opens Settings unless this is false (Recording, Analyzing, Settings).
  allowsSettings?: boolean
}
