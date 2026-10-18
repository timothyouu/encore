import type { MenuContainerProperty } from '@evenrealities/even_hub_sdk'
import { orderedFindings } from '../../mobile/src/feedback.ts'
import type { SessionState, SessionStore } from '../../mobile/src/session.ts'
import { resolveMistakeVisualization, type MistakeVisualization } from '../../mobile/src/visualization.ts'
import { resultView } from './feedback.ts'
import type { Glasses } from './glasses.ts'
import type { Input } from './input.ts'
import { renderKeyboard, visualLegend } from './keyboard.ts'
import { PASSAGES } from './passages.ts'
import { readyScreen, type ReadyScreen } from './screens/ready.ts'
import { analyzingScreen, errorScreen, guideScreen, reviewScreen } from './screens/results.ts'
import type { Screen } from './screens/screen.ts'
import { selectionScreen } from './screens/selection.ts'
import type { StaffTiles } from './staff.ts'
import { status } from './status.ts'

// What the phone session's capture controls do (startPhoneApp's start/stop/cancel).
export type SessionActions = { start(): Promise<void>; stop(): Promise<void>; cancel(): void }

type ControllerOptions = {
  glasses: Glasses
  store: SessionStore
  actions: SessionActions
  sheetMusic(): boolean
  // The OS menu for a screen, or undefined where it is not allowed.
  menu(screen: Screen): MenuContainerProperty | undefined
  onExit(): void
  renderTiles?: (passage: (typeof PASSAGES)[number]) => Promise<StaffTiles>
  // Canvas rendering by default; tests pass a stand-in.
  renderKeys?: (visual: MistakeVisualization) => Promise<Uint8Array | null>
}

// One glasses page per session state (CONTRACT.md state map). Ready and
// Recording share a key so recording swaps text in place instead of rebuilding.
function keyOf(state: SessionState): string {
  switch (state.screen) {
    case 'library':
    case 'history':
      return 'selection'
    case 'ready':
    case 'recording':
      return `ready:${state.passageId}`
    case 'sheet':
      return `${state.sheetOrigin}:${state.attemptId}:${state.findingIndex}`
    case 'review':
    case 'guide':
      return `${state.screen}:${state.attemptId}:${state.findingIndex}`
    default:
      return `${state.screen}:${state.attemptId}`
  }
}

// Mirrors the phone session (mobile SessionStore) on the glasses and turns
// glasses gestures into the same session calls the phone buttons make. The
// store is the only source of truth; this file owns every glasses side effect.
export function startController({ glasses, store, actions, sheetMusic, menu, onExit, renderTiles, renderKeys = renderKeyboard }: ControllerOptions) {
  let current: Screen | null = null
  let currentKey = ''
  // Set while a multi-step store change runs, so only its end state is drawn.
  let holding = false

  function show(screen: Screen) {
    current = screen
    status(`screen → ${screen.name}`)
    // Failures are already reported by the glasses queue.
    glasses.showPage({ ...screen.page(), menuObject: menu(screen) }).catch(() => {})
    screen.enter?.({ glasses, isActive: () => current === screen, redraw: () => show(screen) })
  }

  function batch(change: () => void) {
    holding = true
    try {
      change()
    } finally {
      holding = false
    }
    sync()
  }

  function playAgain() {
    store.showLibrary()
  }

  function screenFor(state: SessionState): Screen | null {
    const record = store.records.find(item => item.attemptId === state.attemptId)
    const passage = PASSAGES.find(item => item.id === (state.passageId ?? record?.passageId))
    switch (state.screen) {
      case 'library':
      case 'history':
        return selectionScreen({
          passages: PASSAGES,
          onOpen: chosen =>
            batch(() => {
              // From History or a result on the phone, start over at the Library.
              if (store.state.screen !== 'library') store.showLibrary()
              store.selectPassage(chosen.id)
            }),
          onExit,
        })
      case 'ready':
      case 'recording': {
        if (!passage) return null
        const screen: ReadyScreen = readyScreen({
          passage,
          sheetMusic,
          renderTiles,
          onStart: () => {
            // A start that settles without recording (mic failed, no
            // endpoints, glasses-only Demo refused) returns to Ready.
            void actions.start().finally(() => {
              if (current === screen && store.state.screen === 'ready') screen.setRecording(false)
            })
          },
          onStop: () => void actions.stop(),
          // Discard returns to Ready for the same passage (spec §4), not the Library.
          onDiscard: () =>
            batch(() => {
              const passageId = store.state.passageId
              actions.cancel()
              if (passageId && store.state.screen === 'library') store.selectPassage(passageId)
            }),
          onBack: () => store.showLibrary(),
        })
        if (state.screen === 'recording') screen.setRecording(true)
        return screen
      }
      case 'processing':
        return passage ? analyzingScreen({ title: passage.title, tag: (record?.captureSource ?? 'demo') === 'demo' ? 'Demo' : '' }) : null
      case 'review':
      case 'guide':
      case 'sheet': {
        if (!record || !passage) return null
        const view = resultView(record, passage, state.findingIndex)
        const onPlayAgain = playAgain
        const which = state.screen === 'sheet' ? state.sheetOrigin : state.screen
        // While the phone shows its sheet overlay the glasses keep showing the
        // origin screen; a paging gesture first closes the sheet so both
        // surfaces land on the same state.
        if (which === 'review') {
          return reviewScreen({
            view,
            onGuide: () =>
              batch(() => {
                store.closeSheet()
                store.showGuide()
              }),
            onPrev: () =>
              batch(() => {
                store.closeSheet()
                store.moveFinding(-1)
                store.showGuide()
              }),
            onPlayAgain,
          })
        }
        const finding = orderedFindings(record, passage)[view.index]
        const mistake = finding ? resolveMistakeVisualization(record, passage, finding) : null
        return guideScreen({
          view,
          onReview: () =>
            batch(() => {
              store.closeSheet()
              store.showReview()
            }),
          onNext: () =>
            batch(() => {
              store.closeSheet()
              store.moveFinding(1)
              store.showReview()
            }),
          onPlayAgain,
          visual: mistake ? { legend: visualLegend(mistake), render: () => renderKeys(mistake) } : undefined,
        })
      }
      case 'error':
        return errorScreen({
          title: passage?.title ?? 'Encore',
          message: record?.error?.message ?? 'Something went wrong.',
          onPlayAgain: playAgain,
        })
    }
  }

  function sync() {
    if (holding) return
    const state = store.state
    const key = keyOf(state)
    if (key === currentKey && current) {
      // Same page: only Ready ↔ Recording changes in place.
      if (key.startsWith('ready:')) (current as ReadyScreen).setRecording(state.screen === 'recording')
      return
    }
    const next = screenFor(state)
    if (!next) return
    currentKey = key
    show(next)
  }

  const unsubscribe = store.subscribe(sync)
  sync()

  return {
    onInput(input: Input) {
      current?.onInput(input)
    },
    get current() {
      return current
    },
    // Re-declare the current page, e.g. so the menu label flips.
    redraw() {
      if (current) show(current)
    },
    dispose() {
      unsubscribe()
    },
  }
}
