import { status } from './status'
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { Glasses } from './glasses'
import { filterInputs, toInput } from './input'
import { PASSAGES } from './passages'
import { readyScreen } from './screens/ready'
import type { Screen } from './screens/screen'
import { selectionScreen } from './screens/selection'
import { SHEET_MUSIC_MENU_ITEM, loadSettings, saveSettings, sheetMusicMenu } from './settings'

async function main() {
  status('script loaded; waiting for Even bridge…')
  const slowBridge = setTimeout(() => status('still waiting for the Even bridge after 5s', 'error'), 5000)
  const glasses = new Glasses(await waitForEvenAppBridge())
  clearTimeout(slowBridge)
  status('bridge ready')

  let current: Screen
  // Read before the first page: every page declares the menu label from it.
  let settings = await loadSettings(glasses)

  function show(screen: Screen) {
    current = screen
    status(`screen → ${screen.name}`)
    const menuObject = screen.allowsMenu === false ? undefined : sheetMusicMenu(settings)
    // Failures are already reported by the glasses queue.
    glasses.showPage({ ...screen.page(), menuObject }).catch(() => {})
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

  function toggleSheetMusic() {
    settings = { ...settings, showSheetMusicWhilePlaying: !settings.showSheetMusicWhilePlaying }
    saveSettings(glasses, settings)
    status(`sheet music while playing: ${settings.showSheetMusicWhilePlaying ? 'on' : 'off'}`)
    // Re-declare the page so the menu label flips (Hide ↔ Show).
    show(current)
  }

  const handleInput = filterInputs(input => {
    if (input.kind === 'exit') {
      unsubscribe()
      return
    }
    // Opening and closing the OS menu also fire foreground events; the page
    // is still on the glasses, so there is nothing to redraw.
    if (input.kind === 'foreground') return
    if (input.kind === 'menuItem') {
      if (input.itemID === SHEET_MUSIC_MENU_ITEM && current.allowsMenu !== false) toggleSheetMusic()
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
