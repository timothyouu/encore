import type { MenuContainerProperty } from '@evenrealities/even_hub_sdk'
import type { SessionState, SessionStore } from '../../mobile/src/session.ts'
import { resolveMistakeVisualization } from '../../mobile/src/visualization.ts'
import type { VisualCard } from '../../shared/visual-contract.ts'
import type { CoachingResult } from '../../shared/contracts.ts'
import { reviewData } from './feedback.ts'
import type { Glasses } from './glasses.ts'
import type { Input } from './input.ts'
import { PASSAGES } from './passages.ts'
import type { ReplayStep } from './review/art.ts'
import type { CardView } from './review/model.ts'
import { readyScreen, type ReadyScreen } from './screens/ready.ts'
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
  renderArt?: (card: VisualCard) => Promise<Uint8Array>
  renderFrame?: (card: VisualCard, step: ReplayStep) => Promise<Uint8Array>
  frameDwellMs?: number
  gallery?: { coaching: CoachingResult; views: CardView[] }
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
    case 'review':
    case 'guide':
    case 'sheet':
      return `${state.screen === 'sheet' ? state.sheetOrigin : state.screen}:${state.attemptId}:${state.findingIndex}:${state.historyOrigin}`
    default:
      return `${state.screen}:${state.attemptId}`
  }
}

function stageText(stage: SessionStore['processingStage'], demo: boolean): string {
  if (demo) return 'Demo · prepared result'
  return stage === 'normalization' ? 'Saving WAV' : stage === 'upload' ? 'Uploading recording'
    : stage === 'analysis' ? 'Analyzing notes' : stage === 'coaching' ? 'Preparing coaching' : ''
}

// Mirrors the phone session (mobile SessionStore) on the glasses and turns
// glasses gestures into the same session calls the phone buttons make. The
// store is the only source of truth; this file owns every glasses side effect.
export function startController({ glasses, store, actions, sheetMusic, menu, onExit, renderTiles, renderArt, renderFrame, frameDwellMs, gallery }: ControllerOptions) {
  let current: Screen | null = null
  let currentKey = ''
  let pageGeneration = 0
  let disposed = false
  let galleryActive = Boolean(gallery)
  // Set while a multi-step store change runs, so only its end state is drawn.
  let holding = false

  function show(screen: Screen) {
    current?.dispose?.()
    current = screen
    const generation = ++pageGeneration
    status(`screen → ${screen.name}`)
    // Failures are already reported by the glasses queue.
    glasses.showPage({ ...screen.page(), menuObject: menu(screen) }).catch(() => {})
    screen.enter?.({ glasses, isActive: () => current === screen && pageGeneration === generation && !disposed, redraw: () => show(screen) })
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
        if (state.screen === 'library' && galleryActive && gallery) {
          return reviewScreen({
            ...gallery,
            demo: true,
            onPlayAgain: () => {
              galleryActive = false
              currentKey = ''
              sync()
            },
            renderArt, renderFrame, frameDwellMs,
          })
        }
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
        return analyzingScreen(stageText(store.processingStage, record?.captureSource === 'demo'))
      case 'review':
      case 'guide':
      case 'sheet': {
        if (!record || !passage) return null
        const { views, tag } = reviewData(record, passage)
        const entries = store.entries()
        const entryIndices = views.map(view => entries.findIndex(entry =>
          entry.finding.id === view.findingId && (entry.segment?.id ?? null) === (view.segment?.id ?? null)))
        const initialIndex = Math.max(0, entryIndices.indexOf(state.findingIndex))
        const phase = state.screen === 'sheet' ? state.sheetOrigin : state.screen
        return reviewScreen({
          views,
          tag,
          initialIndex,
          phase,
          history: state.historyOrigin,
          onPlayAgain: playAgain,
          onNavigate: delta => {
            if (store.state.attemptId !== record.attemptId) return
            const position = initialIndex * 2 + (phase === 'guide' ? 1 : 0)
            const next = Math.max(0, Math.min(views.length * 2 - 1, position + delta))
            const entryIndex = entryIndices[Math.floor(next / 2)]
            if (next === position || entryIndex === undefined || entryIndex < 0) return
            batch(() => {
              store.closeSheet()
              store.selectEntry(entryIndex)
              if (next % 2) store.showGuide()
            })
          },
          keyboardContext: view => {
            const card = view.card
            if (!card || card.evidence.source !== 'analysis' || card.evidence.findingIds.length !== 1) return null
            if (!['missing_note', 'extra_note', 'timing', 'duration'].includes(card.kind)) return null
            const finding = record.analysis?.findings.find(item => item.id === card.evidence.findingIds[0])
            return finding && finding.kind === card.kind ? resolveMistakeVisualization(record, passage, finding) : null
          },
          renderArt,
          renderFrame,
          frameDwellMs,
        })
      }
      case 'error':
        return problemScreen({ reason: record?.error?.message ?? 'Something went wrong.', onPlayAgain: playAgain })
    }
  }

  function sync() {
    if (holding) return
    const state = store.state
    if (state.screen !== 'library') galleryActive = false
    const key = galleryActive ? 'gallery' : keyOf(state)
    if (key === currentKey && current) {
      // Same page: only Ready ↔ Recording changes in place.
      if (key.startsWith('ready:')) (current as ReadyScreen).setRecording(state.screen === 'recording')
      if (key.startsWith('processing:')) {
        const record = store.records.find(item => item.attemptId === state.attemptId)
        const analyzing = current as ReturnType<typeof analyzingScreen>
        analyzing.setStage(stageText(store.processingStage, record?.captureSource === 'demo'))
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
    dispose() {
      disposed = true
      pageGeneration++
      current?.dispose?.()
      current = null
      unsubscribe()
    },
  }
}
