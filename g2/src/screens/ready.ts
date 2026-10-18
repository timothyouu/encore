import { ImageContainerProperty } from '@evenrealities/even_hub_sdk'
import { HEADER_Y, HINT_Y, MARGIN_X, splitRow, text } from '../layout'
import type { Passage } from '../passages'
import { STAFF_H, TILE_W, renderStaffTiles } from '../staff'
import { status } from '../status'
import type { Screen } from './screen'

const STAFF_Y = 46
const FOCUS_Y = 168
const STAFF_LEFT = { id: 10, name: 'staffL' }
const STAFF_RIGHT = { id: 11, name: 'staffR' }

type ReadyOptions = {
  passage: Passage
  onRecord(): void
  onBack(): void
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

// 02 · Ready. Title and tempo, the passage on a staff, one focus line, and the
// record prompt. Text draws immediately; the two staff tiles follow over BLE.
export function readyScreen({ passage, onRecord, onBack }: ReadyOptions): Screen {
  return {
    name: 'ready',

    page: () => ({
      textObject: [
        ...splitRow(1, 'title', HEADER_Y, passage.title, `${passage.tempoBpm} bpm · RH`),
        // Taps go to whichever container captures events; any one will do.
        text({ id: 3, name: 'focus', x: MARGIN_X, y: FOCUS_Y, width: 528, content: `Focus: ${passage.focus}`, capture: true }),
        ...splitRow(4, 'hint', HINT_Y, 'tap  ● record', '2× tap  back'),
      ],
      imageObject: [staffTile(STAFF_LEFT, 0), staffTile(STAFF_RIGHT, TILE_W)],
    }),

    enter({ glasses, isActive }) {
      renderStaffTiles(passage)
        .then(tiles => {
          if (!tiles.hasClef) status('treble clef font failed to load; staff drawn without it', 'error')
          glasses.updateImage(STAFF_LEFT, tiles.left, isActive)
          glasses.updateImage(STAFF_RIGHT, tiles.right, isActive)
        })
        .catch(error => status(`staff render failed: ${String(error)}`, 'error'))
    },

    onInput(input) {
      if (input.kind === 'tap') onRecord()
      else if (input.kind === 'doubleTap') onBack()
    },
  }
}
