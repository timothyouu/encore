import { status } from './status.ts'
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { demoRequested, demoReview } from './demo.ts'
import { Glasses } from './glasses.ts'
import { filterInputs, toInput } from './input.ts'
import { PASSAGES, type Passage } from './passages.ts'
import { mountUploadSettings } from './phone.ts'
import { Recorder, type Take } from './recorder.ts'
import { readyScreen } from './screens/ready.ts'
import { reviewScreen } from './screens/review.ts'
import { savingScreen } from './screens/saving.ts'
import type { Screen } from './screens/screen.ts'
import { selectionScreen } from './screens/selection.ts'
import { SHEET_MUSIC_MENU_ITEM, loadSettings, saveSettings, sheetMusicMenu } from './settings.ts'
import { loadUploadUrl, uploadTake } from './upload.ts'

async function main() {
  status('script loaded; waiting for Even bridge…')
  const slowBridge = setTimeout(() => status('still waiting for the Even bridge after 5s', 'error'), 5000)
  const glasses = new Glasses(await waitForEvenAppBridge())
  clearTimeout(slowBridge)
  status('bridge ready')

  let current: Screen
  // Read before the first page: every page declares the menu label from it.
  let settings = await loadSettings(glasses)
  let uploadUrl = await loadUploadUrl(glasses)
  mountUploadSettings(glasses, uploadUrl, url => (uploadUrl = url))

  function show(screen: Screen) {
    current = screen
    status(`screen → ${screen.name}`)
    const menuObject = screen.allowsMenu === false ? undefined : sheetMusicMenu(settings)
    // Failures are already reported by the glasses queue.
    glasses.showPage({ ...screen.page(), menuObject }).catch(() => {})
    screen.enter?.({ glasses, isActive: () => current === screen, redraw: () => show(screen) })
  }

  function showSelection() {
    show(
      selectionScreen({
        passages: PASSAGES,
        onOpen: showReady,
        onExit: () => glasses.requestExit(),
      }),
    )
  }

  function showReady(passage: Passage) {
    show(
      readyScreen({
        passage,
        sheetMusic: () => settings.showSheetMusicWhilePlaying,
        onTake: take => showSaving(passage, take),
        onBack: showSelection,
      }),
    )
  }

  // Until Analyzing (04) exists, a finished take is uploaded, then the player
  // continues to selection (spec §4); if it wasn't saved, back to Ready.
  function showSaving(passage: Passage, take: Take) {
    show(
      savingScreen({
        take,
        upload: () => uploadTake(uploadUrl, take),
        onSaved: showSelection,
        onFailed: () => showReady(passage),
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
      current.dispose?.()
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
    // Audio frames skip input handling; the active recorder (if any) keeps them.
    if (event.audioEvent?.audioPcm) return Recorder.feed(event.audioEvent.audioPcm)
    const input = toInput(event)
    if (input) handleInput(input)
  })

  if (demoRequested()) {
    status('demo: example review cards (shared/visual-examples.json)')
    show(reviewScreen({ ...demoReview(), demo: true, onPlayAgain: showSelection }))
  } else {
    showSelection()
  }
}

main().catch(error => status(`startup failed: ${String(error)}`, 'error'))
