import { ImageContainerProperty } from '@evenrealities/even_hub_sdk'
import type { Page } from '../glasses.ts'
import { HEADER_Y, HINT_BRIGHTNESS, HINT_Y, MARGIN_X, rightText, splitRow, text } from '../layout.ts'
import type { Passage } from '../passages.ts'
import { STAFF_H, TILE_W, renderStaffTiles, type StaffTiles } from '../staff.ts'
import { status } from '../status.ts'
import type { Screen, ScreenContext } from './screen.ts'

const STAFF_Y = 46
const FOCUS_Y = 168
const STAFF_LEFT = { id: 10, name: 'staffL' }
const STAFF_RIGHT = { id: 11, name: 'staffR' }
const TITLE_L = { id: 1, name: 'titleL' }
const TITLE_R = { id: 2, name: 'titleR' }
const FOCUS = { id: 3, name: 'focus' }
const HINT_L = { id: 4, name: 'hintL' }
const HINT_R = { id: 5, name: 'hintR' }
const REC = { id: 6, name: 'rec' }

const RECORD_HINT = 'tap  ●'
const STOP_HINT = 'tap  ■'
const DISCARD_HINT = '2×  discard'

// 'starting' and 'stopping' wait for the phone session to confirm, so taps
// in between never start a second take or stop one instantly.
type Phase = 'ready' | 'starting' | 'recording' | 'stopping'

type ReadyOptions = {
  passage: Passage
  sheetMusic(): boolean
  // Taps ask the phone session to act; it answers through setRecording.
  onStart(): void
  onStop(): void
  onDiscard(): void
  onBack(): void
  // Canvas rendering by default; tests pass a stand-in.
  renderTiles?: (passage: Passage) => Promise<StaffTiles>
}

export type ReadyScreen = Screen & {
  // The session's capture state, whether started here or on the phone.
  setRecording(recording: boolean): void
}

function staffTile(container: { id: number; name: string }, x: number) {
  return new ImageContainerProperty({
    xPosition: x,
    yPosition: STAFF_Y,
    width: TILE_W,
    height: STAFF_H,
    containerID: container.id,
    containerName: container.name,
  })
}

// 02 · Ready and 03 · Recording share one screen because, with sheet music on,
// Recording is the Ready page with its text swapped in place: the staff images
// stay on the glasses and nothing is sent over BLE once capture starts
// (spec §4). With sheet music off, Recording rebuilds to a page with just ■.
// The microphone itself belongs to the capture source (g2capture.ts).
export function readyScreen({
  passage,
  sheetMusic,
  onStart,
  onStop,
  onDiscard,
  onBack,
  renderTiles = renderStaffTiles,
}: ReadyOptions): ReadyScreen {
  let phase: Phase = 'ready'
  // True when the recording view is drawn over the Ready page.
  let inPlace = false
  let context: ScreenContext | null = null

  const readyPage = (): Page => ({
    textObject: [
      ...splitRow(TITLE_L.id, 'title', HEADER_Y, passage.title, `${passage.tempoBpm} bpm · RH`),
      // Taps go to whichever container captures events; any one will do.
      text({ ...FOCUS, x: MARGIN_X, y: FOCUS_Y, width: 528, content: `Focus: ${passage.focus}`, capture: true }),
      // Recording only: ■ and the discard hint, kept blank until capture starts.
      rightText({ ...REC, y: HEADER_Y, content: ' ', sizeFor: '■' }),
      // Only the record hint: recording must never start by surprise. Back is a system convention.
      text({ ...HINT_L, x: MARGIN_X, y: HINT_Y, width: 260, content: RECORD_HINT, brightness: HINT_BRIGHTNESS }),
      rightText({ ...HINT_R, y: HINT_Y, content: ' ', sizeFor: DISCARD_HINT, brightness: HINT_BRIGHTNESS }),
    ],
    imageObject: [staffTile(STAFF_LEFT, 0), staffTile(STAFF_RIGHT, TILE_W)],
  })

  const recordingOnlyPage = (): Page => ({
    textObject: [
      text({ ...FOCUS, x: 0, y: 0, width: 576, height: 288, content: ' ', capture: true }),
      rightText({ ...REC, y: HEADER_Y, content: '■' }),
      text({ ...HINT_L, x: MARGIN_X, y: HINT_Y, width: 260, content: STOP_HINT, brightness: HINT_BRIGHTNESS }),
      rightText({ ...HINT_R, y: HINT_Y, content: DISCARD_HINT, brightness: HINT_BRIGHTNESS }),
    ],
  })

  function swapText(texts: [{ id: number; name: string }, string][]) {
    for (const [container, content] of texts) context?.glasses.updateText(container, content || ' ')
  }

  function showRecordingView() {
    // Not drawn yet: page() already reflects the phase.
    if (!context) return
    inPlace = sheetMusic()
    if (!inPlace) return context?.redraw()
    swapText([
      [TITLE_L, ''],
      [TITLE_R, ''],
      [FOCUS, ''],
      [REC, '■'],
      [HINT_L, STOP_HINT],
      [HINT_R, DISCARD_HINT],
    ])
  }

  function showReadyView() {
    if (!inPlace) return context?.redraw()
    swapText([
      [TITLE_L, passage.title],
      [TITLE_R, `${passage.tempoBpm} bpm · RH`],
      [FOCUS, `Focus: ${passage.focus}`],
      [REC, ''],
      [HINT_L, RECORD_HINT],
      [HINT_R, ''],
    ])
  }

  return {
    get name() {
      return phase === 'ready' ? 'ready' : 'recording'
    },

    get allowsMenu() {
      return phase === 'ready'
    },

    page: () => (phase === 'ready' ? readyPage() : recordingOnlyPage()),

    enter(ctx) {
      context = ctx
      if (phase !== 'ready') return
      renderTiles(passage)
        .then(tiles => {
          if (!tiles.hasClef) status('treble clef font failed to load; staff drawn without it', 'error')
          // Never start an image send once recording has begun.
          const wanted = () => ctx.isActive() && phase === 'ready'
          ctx.glasses.updateImage(STAFF_LEFT, tiles.left, wanted)
          ctx.glasses.updateImage(STAFF_RIGHT, tiles.right, wanted)
        })
        .catch(error => status(`staff render failed: ${String(error)}`, 'error'))
    },

    setRecording(recording) {
      if (recording) {
        // Started on the phone: switch the view now. Started here: already shown.
        const shown = phase === 'starting'
        phase = 'recording'
        if (!shown) showRecordingView()
      } else if (phase !== 'ready') {
        // Mic failed, take discarded, or canceled on the phone.
        phase = 'ready'
        showReadyView()
      }
    },

    onInput(input) {
      if (phase === 'ready') {
        if (input.kind === 'tap') {
          phase = 'starting'
          showRecordingView()
          onStart()
        } else if (input.kind === 'doubleTap') onBack()
      } else if (phase === 'recording') {
        if (input.kind === 'tap') {
          phase = 'stopping'
          onStop()
        } else if (input.kind === 'doubleTap') {
          phase = 'stopping'
          onDiscard()
        }
      }
      // 'starting' / 'stopping': ignore input until the session has settled.
    },
  }
}
