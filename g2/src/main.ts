import { status } from './status'
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { Glasses } from './glasses'
import { filterInputs, toInput } from './input'
import { PASSAGES } from './passages'
import { readyScreen } from './screens/ready'
import type { Screen } from './screens/screen'
import { selectionScreen } from './screens/selection'
import { settingsScreen } from './screens/settings'
import { loadSettings, saveSettings } from './settings'

async function main() {
  status('script loaded; waiting for Even bridge…')
  const slowBridge = setTimeout(() => status('still waiting for the Even bridge after 5s', 'error'), 5000)
  const glasses = new Glasses(await waitForEvenAppBridge())
  clearTimeout(slowBridge)
  status('bridge ready')

  let current: Screen
  // Loaded behind the first page so startup isn't held up by a storage read.
  let settings = loadSettings(glasses)

  function show(screen: Screen) {
    current = screen
    status(`screen → ${screen.name}`)
    // Failures are already reported by the glasses queue.
    glasses.showPage(screen.page()).catch(() => {})
    screen.enter?.({ glasses, isActive: () => current === screen })
  }

  function showSelection() {
    show(
      selectionScreen({
        passages: PASSAGES,
        onOpen: passage =>
          show(
            readyScreen({
              passage,
              // Recording (03) is the next screen to build.
              onRecord: () => status('record: not built yet (next PR)'),
              onBack: showSelection,
            }),
          ),
        onExit: () => glasses.requestExit(),
      }),
    )
  }

  // Settings returns to the exact screen object it was opened from.
  async function openSettings(from: Screen) {
    show(
      settingsScreen({
        settings: await settings,
        onChange: next => {
          settings = Promise.resolve(next)
          saveSettings(glasses, next)
          status(`sheet music while playing: ${next.showSheetMusicWhilePlaying ? 'on' : 'off'}`)
        },
        onClose: () => show(from),
      }),
    )
  }

  const handleInput = filterInputs(input => {
    if (input.kind === 'exit') {
      unsubscribe()
      return
    }
    // Returning from the background: redraw whatever screen we were on.
    if (input.kind === 'foreground') {
      show(current)
      return
    }
    if (input.kind === 'longPress') {
      if (current.allowsSettings !== false) openSettings(current)
      return
    }
    current.onInput(input)
  })

  const unsubscribe = glasses.bridge.onEvenHubEvent(event => {
    const input = toInput(event)
    if (input) handleInput(input)
  })

  showSelection()
}

main().catch(error => status(`startup failed: ${String(error)}`, 'error'))
