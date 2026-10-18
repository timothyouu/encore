import { status } from './status'
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { Glasses } from './glasses'
import { debounced, toInput } from './input'
import { PASSAGES } from './passages'
import { readyScreen } from './screens/ready'
import type { Screen } from './screens/screen'
import { selectionScreen } from './screens/selection'

async function main() {
  status('script loaded; waiting for Even bridge…')
  const slowBridge = setTimeout(() => status('still waiting for the Even bridge after 5s', 'error'), 5000)
  const glasses = new Glasses(await waitForEvenAppBridge())
  clearTimeout(slowBridge)
  status('bridge ready')

  let current: Screen

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

  const handleInput = debounced(input => {
    if (input.kind === 'exit') {
      unsubscribe()
      return
    }
    // Returning from the background: redraw whatever screen we were on.
    if (input.kind === 'foreground') {
      show(current)
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
