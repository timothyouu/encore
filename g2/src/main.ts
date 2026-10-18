import { status } from './status.ts'
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { startPhoneApp } from '../../mobile/src/app.ts'
import { startController } from './controller.ts'
import { G2Capture } from './g2capture.ts'
import { Glasses } from './glasses.ts'
import { filterInputs, toInput } from './input.ts'
import { Recorder } from './recorder.ts'
import { SHEET_MUSIC_MENU_ITEM, loadSettings, saveSettings, sheetMusicMenu } from './settings.ts'
import { serviceForOrigin } from './service.ts'

// One page for phone and glasses (glasses-integration/CONTRACT.md). The phone
// UI from mobile/ renders phone DOM only and owns the session; everything
// that touches the glasses (bridge, pages, gestures, mic) is in g2/.
async function main() {
  const root = document.getElementById('app')
  if (!root) throw new Error('phone UI root #app is missing')

  const service = serviceForOrigin(import.meta.env.VITE_ENCORE_API_ORIGIN)
  let sessionToken = ''
  const memory = new Map<string, string>()
  const fallbackStorage = { getItem: (key: string): string | null => memory.get(key) ?? null,
    setItem: (key: string, value: string): void => { memory.set(key, value) },
    removeItem: (key: string): void => { memory.delete(key) } }
  let storage: Storage | typeof fallbackStorage = fallbackStorage
  let indexedDB: IDBFactory | undefined
  try { storage = window.localStorage; status('WebView localStorage API exposed; persistence pending probe') }
  catch { status('WebView local storage unavailable; using session memory', 'error') }
  try { indexedDB = window.indexedDB; status(indexedDB ? 'WebView IndexedDB API exposed; persistence pending hydrate' : 'WebView IndexedDB API unavailable') }
  catch { status('WebView IndexedDB unavailable', 'error') }
  status(`build ${import.meta.env.VITE_ENCORE_BUILD_ID || 'development'} · WebView origin ${window.location.origin}`)
  status(service ? `service ${service.origin}` : 'service not packaged; Demo only until configured')
  let glasses: Glasses | null = null
  // The bridge being ready is not proof the glasses are connected (spec §9).
  const app = await startPhoneApp(root, {
    storage,
    indexedDB,
    sentry: {
      VITE_SENTRY_ENABLED: import.meta.env.VITE_SENTRY_ENABLED,
      VITE_SENTRY_DSN: import.meta.env.VITE_SENTRY_DSN,
      VITE_SENTRY_ENVIRONMENT: import.meta.env.VITE_SENTRY_ENVIRONMENT,
    },
    hostSource: { id: 'g2', create: context => new G2Capture(context, () => glasses) },
    service: service ? { ...service, getSessionToken: () => sessionToken, setSessionToken: token => { sessionToken = token } } : undefined,
    deviceStatus: () => (glasses ? 'Even bridge ready · glasses connection unverified' : null),
  })
  window.addEventListener('pagehide', () => { sessionToken = ''; app.dispose() }, { once: true })

  status('script loaded; waiting for Even bridge…')
  const slowBridge = setTimeout(() => status('still waiting for the Even bridge after 5s', 'error'), 5000)
  const bridged = new Glasses(await waitForEvenAppBridge())
  clearTimeout(slowBridge)
  status('bridge ready')

  // Read before the first page: every page declares the menu label from it.
  let settings = await loadSettings(bridged)
  glasses = bridged
  app.refresh()

  const controller = startController({
    glasses: bridged,
    store: app.store,
    actions: app,
    sheetMusic: () => settings.showSheetMusicWhilePlaying,
    menu: screen => (screen.allowsMenu === false ? undefined : sheetMusicMenu(settings)),
    onExit: () => bridged.requestExit(),
  })

  function toggleSheetMusic() {
    settings = { ...settings, showSheetMusicWhilePlaying: !settings.showSheetMusicWhilePlaying }
    saveSettings(bridged, settings)
    status(`sheet music while playing: ${settings.showSheetMusicWhilePlaying ? 'on' : 'off'}`)
    // Re-declare the page so the menu label flips (Hide ↔ Show).
    controller.redraw()
  }

  const handleInput = filterInputs(input => {
    if (input.kind === 'exit') {
      // A take in progress is kept as interrupted, never as completed.
      controller.dispose()
      app.dispose()
      unsubscribe()
      return
    }
    // Opening and closing the OS menu also fire foreground events; the page
    // is still on the glasses, so there is nothing to redraw.
    if (input.kind === 'foreground') return
    if (input.kind === 'menuItem') {
      if (input.itemID === SHEET_MUSIC_MENU_ITEM && controller.current?.allowsMenu !== false) toggleSheetMusic()
      return
    }
    controller.onInput(input)
  })

  const unsubscribe = bridged.bridge.onEvenHubEvent(event => {
    // Audio frames skip input handling; the active recorder (if any) keeps them.
    if (event.audioEvent?.audioPcm) return Recorder.feed(event.audioEvent.audioPcm)
    const input = toInput(event)
    if (input) handleInput(input)
  })
}

main().catch(error => status(`startup failed: ${String(error)}`, 'error'))
