import { TextContainerProperty } from '@evenrealities/even_hub_sdk'
import { getTextWidth } from '@evenrealities/pretext'
import { HEADER_Y, HINT_Y, MARGIN_X, rightText, splitRow, text } from '../layout'
import type { DisplaySettings } from '../settings'
import type { Screen, ScreenContext } from './screen'

// One boxed row, sized like a firmware list row: 2px border + 8px padding
// around a single 27px line.
const ROW = { x: 10, y: 54, width: 556, height: 47, border: 2, padding: 8 }
const VALUE = { id: 3, name: 'value' }

type SettingsOptions = {
  settings: DisplaySettings
  onChange(next: DisplaySettings): void
  onClose(): void
}

// The value updates in place, so its container keeps its first width. Size it
// for "Off" and left-pad "On" with spaces so both end at the right margin.
function valueLabel(settings: DisplaySettings) {
  if (!settings.showSheetMusicWhilePlaying) return 'Off'
  let label = 'On'
  while (getTextWidth(` ${label}`) <= getTextWidth('Off')) label = ` ${label}`
  return label
}

function valueText(settings: DisplaySettings) {
  const value = rightText({ ...VALUE, y: ROW.y + ROW.border + ROW.padding, content: 'Off' })
  value.content = valueLabel(settings)
  return value
}

// 09 · Settings. Opened with a long press; v1 holds a single toggle. Tap flips
// it in place (no rebuild), double tap returns to the screen it came from.
export function settingsScreen({ settings, onChange, onClose }: SettingsOptions): Screen {
  let current = settings
  let context: ScreenContext | null = null

  return {
    name: 'settings',
    allowsSettings: false,

    page: () => ({
      textObject: [
        text({ id: 1, name: 'title', x: MARGIN_X, y: HEADER_Y, width: 300, content: 'Settings' }),
        new TextContainerProperty({
          xPosition: ROW.x,
          yPosition: ROW.y,
          width: ROW.width,
          height: ROW.height,
          borderWidth: ROW.border,
          borderColor: 15,
          borderRadius: 6,
          paddingLength: ROW.padding,
          containerID: 2,
          containerName: 'row',
          content: 'Sheet music while playing',
          isEventCapture: 1,
        }),
        // Declared after the row so it draws on top, right-aligned inside the box.
        valueText(current),
        ...splitRow(4, 'hint', HINT_Y, 'tap  toggle', '2× tap  close'),
      ],
    }),

    enter(ctx) {
      context = ctx
    },

    onInput(input) {
      if (input.kind === 'tap') {
        current = { ...current, showSheetMusicWhilePlaying: !current.showSheetMusicWhilePlaying }
        onChange(current)
        context?.glasses.updateText(VALUE, valueLabel(current))
      } else if (input.kind === 'doubleTap') {
        onClose()
      }
    },
  }
}
