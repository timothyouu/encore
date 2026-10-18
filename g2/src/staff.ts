import type { Passage } from './passages.ts'

// Renders a passage as a one-line treble staff, matching the Paper mockup
// (576×112), and splits it into two 288×112 PNG tiles: the widest image a
// single G2 image container accepts is 288px.
export const STAFF_W = 576
export const STAFF_H = 112
export const TILE_W = STAFF_W / 2

// Greyscale levels; the glasses map brightness to 16 shades of green.
const LINE = '#7a7a7a'
const INK = '#ffffff'

const STAFF_LEFT = 24
const STAFF_RIGHT = 554
const BOTTOM_LINE_Y = 80 // E4
const STEP_PX = 6 // one diatonic step = half a staff space
const MUSIC_LEFT = 92 // after clef and time signature
const FIRST_BEAT_INSET = 30
const BAR_END_GAP = 22

const CLEF_FONT = 'Encore Clef'
let clefFont: Promise<boolean> | null = null

// The phone WebView may lack a music font, so a one-glyph Noto Music
// subset (OFL, public/fonts) is bundled for the treble clef.
function loadClefFont(): Promise<boolean> {
  clefFont ??= new FontFace(CLEF_FONT, `url(${new URL('fonts/noto-music-clef.woff2', document.baseURI).href})`)
    .load()
    .then(face => {
      document.fonts.add(face)
      return true
    })
    .catch(() => false)
  return clefFont
}

// Diatonic step relative to C4 (= 0); sharps sit on the natural below.
const PITCH_CLASS_STEP = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]
const SHARP_PITCH_CLASSES = new Set([1, 3, 6, 8, 10])

function stepOf(midi: number) {
  const octave = Math.floor(midi / 12) - 1
  return (octave - 4) * 7 + PITCH_CLASS_STEP[midi % 12]
}

function yOfStep(step: number) {
  // E4 (step 2) sits on the bottom line.
  return BOTTOM_LINE_Y - (step - 2) * STEP_PX
}

type Geometry = {
  totalBeats: number
  barWidth: number
  beatSpacing: number
  beatsPerBar: number
}

function geometry(passage: Passage): Geometry {
  const lastBeat = Math.max(...passage.notes.map(note => note.onsetBeat + note.durationBeats))
  const bars = Math.max(1, Math.ceil(lastBeat / passage.beatsPerBar))
  const barWidth = (STAFF_RIGHT - 2 - MUSIC_LEFT) / bars
  return {
    totalBeats: bars * passage.beatsPerBar,
    barWidth,
    beatSpacing: (barWidth - BAR_END_GAP) / passage.beatsPerBar,
    beatsPerBar: passage.beatsPerBar,
  }
}

function xOfBeat(beat: number, g: Geometry) {
  const bar = Math.floor(beat / g.beatsPerBar)
  return MUSIC_LEFT + bar * g.barWidth + FIRST_BEAT_INSET + (beat - bar * g.beatsPerBar) * g.beatSpacing
}

function drawStaffFrame(ctx: CanvasRenderingContext2D, g: Geometry, hasClef: boolean) {
  ctx.fillStyle = LINE
  for (let line = 0; line < 5; line++) {
    ctx.fillRect(STAFF_LEFT, BOTTOM_LINE_Y - 48 + line * 12, STAFF_RIGHT - STAFF_LEFT, 1.5)
  }
  const bars = g.totalBeats / g.beatsPerBar
  for (let bar = 1; bar < bars; bar++) {
    ctx.fillRect(MUSIC_LEFT + bar * g.barWidth - 1, BOTTOM_LINE_Y - 48, 2, 49.5)
  }
  // Final double bar: thin then thick.
  ctx.fillRect(STAFF_RIGHT - 9, BOTTOM_LINE_Y - 48, 2, 49.5)
  ctx.fillRect(STAFF_RIGHT - 4, BOTTOM_LINE_Y - 48, 4, 49.5)

  ctx.fillStyle = INK
  if (hasClef) drawClef(ctx)
  ctx.font = '800 26px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(String(g.beatsPerBar), 80, 54)
  ctx.fillText('4', 80, 78)
}

// The clef spans from just above the top line to below the bottom line.
// Glyph metrics vary between font builds, so fit the measured ink box
// instead of trusting a nominal font size.
const CLEF = { glyph: '\u{1D11E}', left: 26, top: BOTTOM_LINE_Y - 48 - 18, bottom: BOTTOM_LINE_Y + 26 }

function drawClef(ctx: CanvasRenderingContext2D) {
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `100px "${CLEF_FONT}"`
  const probe = ctx.measureText(CLEF.glyph)
  const inkHeight = probe.actualBoundingBoxAscent + probe.actualBoundingBoxDescent
  if (!inkHeight) return

  const size = (100 * (CLEF.bottom - CLEF.top)) / inkHeight
  ctx.font = `${size}px "${CLEF_FONT}"`
  const fitted = ctx.measureText(CLEF.glyph)
  ctx.fillText(CLEF.glyph, CLEF.left + fitted.actualBoundingBoxLeft, CLEF.top + fitted.actualBoundingBoxAscent)
}

export type NoteLayout = {
  id: string
  x: number
  y: number
  // Diatonic step from C4 (0); E4 (2) is the bottom line.
  step: number
  ledgerYs: number[]
  // Half notes and longer are hollow.
  hollow: boolean
  // Whole notes have no stem; stems point down from the middle line up.
  stem: 'up' | 'down' | 'none'
  sharp: boolean
}

export type StaffLayout = {
  bars: number
  totalBeats: number
  notes: NoteLayout[]
  // A quarter rest on every beat no note sounds on.
  restXs: number[]
}

// Where everything goes, separate from drawing so it can be checked without a canvas.
export function staffLayout(passage: Passage): StaffLayout {
  const g = geometry(passage)
  const notes = passage.notes.map((note): NoteLayout => {
    const step = stepOf(note.midiPitch)
    const ledgerYs: number[] = []
    // Ledger lines below (C4 and lower) or above (A5 and higher) the staff.
    for (let ledger = 0; ledger >= step; ledger -= 2) ledgerYs.push(yOfStep(ledger))
    for (let ledger = 12; ledger <= step; ledger += 2) ledgerYs.push(yOfStep(ledger))
    return {
      id: note.id,
      x: xOfBeat(note.onsetBeat, g),
      y: yOfStep(step),
      step,
      ledgerYs,
      hollow: note.durationBeats >= 2,
      stem: note.durationBeats >= 4 ? 'none' : step < 6 ? 'up' : 'down',
      sharp: SHARP_PITCH_CLASSES.has(note.midiPitch % 12),
    }
  })

  const restXs: number[] = []
  for (let beat = 0; beat < g.totalBeats; beat++) {
    const sounding = passage.notes.some(note => beat >= note.onsetBeat && beat < note.onsetBeat + note.durationBeats)
    if (!sounding) restXs.push(xOfBeat(beat, g))
  }

  return { bars: g.totalBeats / g.beatsPerBar, totalBeats: g.totalBeats, notes, restXs }
}

function drawNote(ctx: CanvasRenderingContext2D, note: NoteLayout) {
  const { x, y } = note
  ctx.fillStyle = LINE
  for (const ledgerY of note.ledgerYs) ctx.fillRect(x - 12, ledgerY, 24, 1.5)

  ctx.fillStyle = INK
  ctx.strokeStyle = INK
  ctx.beginPath()
  ctx.ellipse(x, y + 0.75, 7, 5.2, -20 * (Math.PI / 180), 0, Math.PI * 2)
  if (note.hollow) {
    ctx.lineWidth = 2
    ctx.stroke()
  } else {
    ctx.fill()
  }

  if (note.stem === 'up') ctx.fillRect(x + 5.2, y - 35, 2, 35)
  else if (note.stem === 'down') ctx.fillRect(x - 7.2, y + 1, 2, 35)

  if (note.sharp) {
    ctx.font = '600 18px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('#', x - 16, y + 6)
  }
}

function drawQuarterRest(ctx: CanvasRenderingContext2D, x: number) {
  ctx.strokeStyle = INK
  ctx.lineWidth = 3
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(x - 2, 42)
  ctx.lineTo(x + 4, 50)
  ctx.lineTo(x - 3, 58)
  ctx.lineTo(x + 4, 66)
  ctx.quadraticCurveTo(x - 6, 64, x - 1, 74)
  ctx.stroke()
}

function drawPassage(ctx: CanvasRenderingContext2D, layout: StaffLayout) {
  for (const note of layout.notes) drawNote(ctx, note)
  for (const x of layout.restXs) drawQuarterRest(ctx, x)
}

function canvas(width: number, height: number) {
  const element = document.createElement('canvas')
  element.width = width
  element.height = height
  const ctx = element.getContext('2d')
  if (!ctx) throw new Error('2d canvas context unavailable')
  return { element, ctx }
}

function toPng(element: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    element.toBlob(blob => {
      if (!blob) return reject(new Error('canvas toBlob failed'))
      blob.arrayBuffer().then(buffer => resolve(new Uint8Array(buffer)), reject)
    }, 'image/png')
  })
}

export type StaffTiles = { left: Uint8Array; right: Uint8Array; hasClef: boolean }

const cache = new Map<string, Promise<StaffTiles>>()

export function renderStaffTiles(passage: Passage): Promise<StaffTiles> {
  const key = `${passage.id}@${passage.version}`
  let tiles = cache.get(key)
  if (!tiles) {
    tiles = render(passage)
    cache.set(key, tiles)
    tiles.catch(() => cache.delete(key))
  }
  return tiles
}

async function render(passage: Passage): Promise<StaffTiles> {
  const hasClef = await loadClefFont()
  const g = geometry(passage)

  const full = canvas(STAFF_W, STAFF_H)
  // Black is "off" on the glasses, i.e. transparent to the wearer.
  full.ctx.fillStyle = '#000000'
  full.ctx.fillRect(0, 0, STAFF_W, STAFF_H)
  drawStaffFrame(full.ctx, g, hasClef)
  drawPassage(full.ctx, staffLayout(passage))

  const tile = async (offsetX: number) => {
    const part = canvas(TILE_W, STAFF_H)
    part.ctx.drawImage(full.element, offsetX, 0, TILE_W, STAFF_H, 0, 0, TILE_W, STAFF_H)
    return toPng(part.element)
  }
  return { left: await tile(0), right: await tile(TILE_W), hasClef }
}
