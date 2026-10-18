import type { Glasses, Page } from '../glasses'
import type { Input } from '../input'

export type ScreenContext = {
  glasses: Glasses
  // False once the player has moved to another screen; check before late work.
  isActive(): boolean
  // Rebuild this screen's page (with the app's menu) when its layout changes.
  redraw(): void
}

// One glasses state from spec §4. The app renders `page()` on entry, then
// calls `enter` for follow-up work such as image sends, and forwards every
// normalized input to `onInput`.
export type Screen = {
  name: string
  page(): Page
  enter?(context: ScreenContext): void
  onInput(input: Input): void
  // The OS menu offers the sheet-music toggle unless this is false
  // (Recording, Analyzing): settings never change mid-capture. Read on each
  // render and on each menu click, so a screen may compute it from its state.
  readonly allowsMenu?: boolean
  // Called when the app is closing or the glasses disconnect mid-screen.
  dispose?(): void
}
