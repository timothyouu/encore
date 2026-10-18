import type { MenuContainerProperty } from '@evenrealities/even_hub_sdk'
import type { SessionState, SessionStore } from '../../mobile/src/session.ts'
import type { Glasses } from './glasses.ts'
import type { Input } from './input.ts'
import { PASSAGES } from './passages.ts'
import { readyScreen, type ReadyScreen } from './screens/ready.ts'
import type { CoachingResult } from '../../shared/contracts.ts'
import { analyzingScreen } from './screens/analyzing.ts'
import { problemScreen } from './screens/problem.ts'
import { reviewScreen } from './screens/review.ts'
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
}

// One glasses page per session state (CONTRACT.md state map). Ready and
// Recording share a key so recording swaps text in place instead of rebuilding.
// G2 has no Guide state (spec §4): the phone's review, guide and sheet views of
// one attempt are all one Review page, which pages its own cards.
function keyOf(state: SessionState): string {
  switch (state.screen) {
    case 'library':
    case 'history':
      return 'selection'
    case 'ready':
    case 'recording':
      return `ready:${state.passageId}`
    case 'review':
    case 'guide':
    case 'sheet':
      return `review:${state.attemptId}`
    default:
      return `${state.screen}:${state.attemptId}`
  }
}

type Stage = SessionStore['processingStage']

// The same words the phone uses for each processing stage.
function stageText(stage: Stage, demo: boolean): string {
  if (demo) return 'Demo · prepared result'
  return stage === 'normalization' ? 'Saving WAV' : stage === 'upload' ? 'Uploading recording'
    : stage === 'analysis' ? 'Analyzing notes' : stage === 'coaching' ? 'Preparing coaching' : ''
}

// Unclear audio is a result without coaching; Review shows it as one card
// rather than as an error (trust before detail, spec §2).
function unclearCoaching(attemptId: string): CoachingResult {
  return {
    schemaVersion: '1', attemptId, coachingSource: 'analysis_only',
    cue: 'Try again from passage selection.', evidenceFindingIds: [],
    visual: { kind: 'none', referenceNoteIds: [], poseIds: [], mistakes: [] },
    summary: { where: 'Audio unclear', what: "I couldn't hear that clearly.", next: 'Try again from passage selection.' },
  }
}

// Mirrors the phone session (mobile SessionStore) on the glasses and turns
// glasses gestures into the same session calls the phone buttons make. The
// store is the only source of truth; this file owns every glasses side effect.
export function startController({ glasses, store, actions, sheetMusic, menu, onExit, renderTiles }: ControllerOptions) {
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
        return analyzingScreen(stageText(store.processingStage, (record?.captureSource ?? 'demo') === 'demo'))
      case 'review':
      case 'guide':
      case 'sheet': {
        if (!record) return null
        // Tap is replay on Review; double tap is Play again.
        return reviewScreen({
          coaching: record.coaching ?? unclearCoaching(record.attemptId),
          demo: (record.captureSource ?? 'demo') === 'demo',
          onPlayAgain: playAgain,
        })
      }
      case 'error':
        return problemScreen({
          reason: record?.error?.message ?? 'Something went wrong.',
          onPlayAgain: playAgain,
        })
    }
  }

  function sync() {
    if (holding) return
    const state = store.state
    const key = keyOf(state)
    if (key === currentKey && current) {
      // Same page: Ready ↔ Recording and the Analyzing stage change in place.
      if (key.startsWith('ready:')) (current as ReadyScreen).setRecording(state.screen === 'recording')
      else if (key.startsWith('processing:')) {
        const record = store.records.find(item => item.attemptId === state.attemptId)
        ;(current as ReturnType<typeof analyzingScreen>).setStage(stageText(store.processingStage, (record?.captureSource ?? 'demo') === 'demo'))
      }
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
    // Show a screen outside the session (the dev demo gallery) until the
    // session next changes or resync() is called.
    preview(screen: Screen) {
      currentKey = 'preview'
      show(screen)
    },
    resync() {
      currentKey = ''
      sync()
    },
    dispose() {
      unsubscribe()
    },
  }
}
