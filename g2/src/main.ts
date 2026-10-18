import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { Glasses } from './glasses'
import { debounced, toInput } from './input'
import { PASSAGES } from './passages'
import { readyScreen } from './screens/ready'
import type { Screen } from './screens/screen'
import { selectionScreen } from './screens/selection'

const glasses = new Glasses(await waitForEvenAppBridge())

let current: Screen

function show(screen: Screen) {
  current = screen
  console.log('[encore] screen →', screen.name)
  // Failures are already logged by the glasses queue.
  glasses.showPage(screen.page()).catch(() => {})
}

function showSelection() {
  show(
    selectionScreen({
      passages: PASSAGES,
      onOpen: passage => show(readyScreen({ passage, onBack: showSelection })),
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
