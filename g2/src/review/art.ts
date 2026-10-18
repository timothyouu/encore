import type { VisualCard, VisualNote } from '../../../shared/visual-contract.ts'
import { SHARP_PITCH_CLASSES, canvas, stepOf, toPng } from '../staff.ts'
import { beatFraction, flaggedNotes, noteName } from './model.ts'

// Static art for one mistake card: a 288×144 greyscale image (the largest a
// G2 image container takes), drawn in the shared visual language of the Paper
// "Mistake animations" page: solid = expected, hollow/dashed = detected, a
// shaded band marks the beat in question, and shape carries meaning, not colour.
export const ART_W = 288
export const ART_H = 144

// The SDK's greyscale conversion lifts dark tones a lot (#3c3c3c shows at
// ~70%), so supporting greys are kept very dark to stay behind the ink.
const INK = '#ffffff'
const DIM = '#505050'
const LINE = '#262626'
// One step above off: #080808 rounds down to level 0 and disappears.
const BAND = '#141414'

// ── Keyboard (wrong note) ─────────────────────────────────────────────

export type Key = { step: number; black: boolean; x: number; y: number; w: number; h: number }

const KEYS_TOP = 40
const WHITE_H = 84
const BLACK_H = 56
// White-key steps (C=0 … B=6) that have a black key to their right.
const HAS_SHARP = new Set([0, 1, 3, 4, 5])

const naturalStep = (midi: number) => stepOf(midi) // sharps sit on the natural below
const mod7 = (n: number) => ((n % 7) + 7) % 7

// Enough white keys to show both pitches with two keys of context each side,
// at least one octave.
export function keyboardKeys(midis: number[]) {
  const steps = midis.map(naturalStep)
  let lo = Math.min(...steps) - 2
  let hi = Math.max(...steps) + 2
  while (hi - lo + 1 < 7) {
    lo -= 1
    if (hi - lo + 1 < 7) hi += 1
  }
  const count = hi - lo + 1
  const w = Math.min(36, (ART_W - 24) / count)
  const x0 = (ART_W - count * w) / 2
  const keys: Key[] = []
  for (let step = lo; step <= hi; step++) {
    keys.push({ step, black: false, x: x0 + (step - lo) * w, y: KEYS_TOP, w, h: WHITE_H })
  }
  for (let step = lo; step < hi; step++) {
    if (HAS_SHARP.has(mod7(step))) {
      keys.push({ step, black: true, x: x0 + (step - lo + 1) * w - w * 0.3, y: KEYS_TOP, w: w * 0.6, h: BLACK_H })
    }
  }
  return keys
}

export function keyFor(keys: Key[], midi: number) {
  const black = SHARP_PITCH_CLASSES.has(midi % 12)
  return keys.find(key => key.step === naturalStep(midi) && key.black === black)
}

function drawKeyboard(ctx: CanvasRenderingContext2D, expected: number, detected: number | null) {
  const keys = keyboardKeys(detected === null ? [expected] : [expected, detected])
  ctx.lineWidth = 1.5
  for (const key of keys.filter(k => !k.black)) {
    ctx.strokeStyle = LINE
    ctx.strokeRect(key.x, key.y, key.w, key.h)
  }
  ctx.fillStyle = LINE
  for (const key of keys.filter(k => k.black)) ctx.fillRect(key.x, key.y, key.w, key.h)

  // Lit key = play this one.
  const target = keyFor(keys, expected)!
  ctx.fillStyle = INK
  ctx.fillRect(target.x + 1, target.y + 1, target.w - 2, target.h - 2)
  keyLabel(ctx, target, noteName(expected), '#000000')

  if (detected !== null && detected !== expected) {
    // Dashed key = the one pressed by mistake.
    const pressed = keyFor(keys, detected)!
    ctx.strokeStyle = INK
    ctx.setLineDash([4, 3])
    ctx.lineWidth = 2
    ctx.strokeRect(pressed.x + 2, pressed.y + 2, pressed.w - 4, pressed.h - 4)
    ctx.setLineDash([])
    keyLabel(ctx, pressed, noteName(detected), INK)

    // ○ → ● above the keys: from what was played to what to play.
    const from = pressed.x + pressed.w / 2
    const to = target.x + target.w / 2
    ctx.strokeStyle = INK
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(from, 22, 6, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = INK
    ctx.beginPath()
    ctx.arc(to, 22, 6, 0, Math.PI * 2)
    ctx.fill()
    const dir = Math.sign(to - from)
    if (Math.abs(to - from) > 20) {
      ctx.beginPath()
      ctx.moveTo(from + dir * 10, 22)
      ctx.lineTo(to - dir * 10, 22)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(to - dir * 10, 22)
      ctx.lineTo(to - dir * 15, 18)
      ctx.lineTo(to - dir * 15, 26)
      ctx.closePath()
      ctx.fill()
    }
  }
}

// Black keys are too narrow for a label; theirs sits under the keyboard.
function keyLabel(ctx: CanvasRenderingContext2D, key: Key, name: string, onKey: string) {
  if (key.black) label(ctx, name, key.x + key.w / 2, KEYS_TOP + WHITE_H + 12, INK, 11)
  else label(ctx, name, key.x + key.w / 2, key.y + key.h - 10, onKey)
}

// ── Staff window (notes, phrase-level kinds) ──────────────────────────

const STAFF_BOTTOM = 92 // E4 line
const HALF_SPACE = 6
const NOTES_LEFT = 44
const NOTES_RIGHT = 262

export function staffY(midi: number) {
  return STAFF_BOTTOM - (stepOf(midi) - 2) * HALF_SPACE
}

export function windowX(card: VisualCard) {
  const { startBeat, endBeat } = card.focus
  const span = Math.max(1, endBeat - startBeat)
  return (beat: number) => NOTES_LEFT + ((beat - startBeat) / span) * (NOTES_RIGHT - NOTES_LEFT)
}

function notehead(ctx: CanvasRenderingContext2D, x: number, y: number, hollow: boolean, color = INK) {
  ctx.beginPath()
  ctx.ellipse(x, y + 0.75, 7, 5.2, -20 * (Math.PI / 180), 0, Math.PI * 2)
  if (hollow) {
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.stroke()
  } else {
    ctx.fillStyle = color
    ctx.fill()
  }
}

function ledgers(ctx: CanvasRenderingContext2D, x: number, midi: number) {
  const step = stepOf(midi)
  ctx.fillStyle = LINE
  for (let ledger = 0; ledger >= step; ledger -= 2) ctx.fillRect(x - 11, STAFF_BOTTOM - (ledger - 2) * HALF_SPACE, 22, 1.5)
  for (let ledger = 12; ledger <= step; ledger += 2) ctx.fillRect(x - 11, STAFF_BOTTOM - (ledger - 2) * HALF_SPACE, 22, 1.5)
}

function drawStaffWindow(ctx: CanvasRenderingContext2D, card: VisualCard) {
  const x = windowX(card)
  const flaggedSides = flaggedNotes(card)
  const refIds = new Set(flaggedSides.expected.map(note => note.id))
  const detIds = new Set(flaggedSides.detected.map(note => note.id))
  const flagged: VisualNote[] = [...flaggedSides.expected, ...flaggedSides.detected]

  // Focus band behind the beat(s) in question.
  ctx.fillStyle = BAND
  const bandBeats = flagged.length ? flagged.map(note => note.onsetBeat) : [card.focus.startBeat]
  const left = Math.min(...bandBeats.map(x)) - 16
  const right = Math.max(...bandBeats.map(x)) + 16
  ctx.fillRect(left, 20, right - left, 100)

  ctx.fillStyle = LINE
  for (let line = 0; line < 5; line++) ctx.fillRect(16, STAFF_BOTTOM - 48 + line * 12, ART_W - 32, 1.5)

  // Bar labels for section cards.
  for (const segment of card.segments ?? []) {
    const from = x(segment.startBeat) - 10
    const to = x(segment.endBeat) - 14
    ctx.fillStyle = DIM
    ctx.fillRect(from, 12, to - from, 1.5)
    label(ctx, segment.label, (from + to) / 2, 9, DIM, 10)
  }

  // Expected: solid notes, with names underneath; a missing one sits in a dashed slot.
  for (const note of card.expected.notes) {
    const nx = x(note.onsetBeat)
    const ny = staffY(note.midiPitch)
    const missing = card.kind === 'missing_note' && refIds.has(note.id)
    ledgers(ctx, nx, note.midiPitch)
    notehead(ctx, nx, ny, note.durationBeats >= 2)
    if (note.durationBeats < 4) {
      ctx.fillStyle = INK
      if (stepOf(note.midiPitch) < 6) ctx.fillRect(nx + 5.2, ny - 30, 2, 30)
      else ctx.fillRect(nx - 7.2, ny + 1, 2, 30)
    }
    if (missing) {
      ctx.strokeStyle = INK
      ctx.setLineDash([3, 3])
      ctx.lineWidth = 1.5
      ctx.strokeRect(nx - 13, 26, 26, 86)
      ctx.setLineDash([])
    }
    const name = noteName(note.midiPitch)
    label(ctx, missing ? `[${name}]` : name, nx, 134, missing ? INK : DIM, 11)
  }

  // Detected (only the unpaired notes): hollow.
  if (!(card.kind === 'missing_note' && card.variant === 'missing')) {
    for (const note of card.detected.notes.filter(n => detIds.has(n.id))) {
      const nx = x(note.onsetBeat)
      ledgers(ctx, nx, note.midiPitch)
      notehead(ctx, nx, staffY(note.midiPitch), true, INK)
    }
  }
}

// ── Beat ruler (timing) ───────────────────────────────────────────────

const RULER_Y = 92

export function rulerX(card: VisualCard) {
  const start = Math.floor(card.focus.startBeat)
  const end = Math.ceil(card.focus.endBeat)
  const span = Math.max(1, end - start)
  return { start, end, x: (beat: number) => 24 + ((beat - start) / span) * (ART_W - 48) }
}

function drawRuler(ctx: CanvasRenderingContext2D, card: VisualCard) {
  const { start, end, x } = rulerX(card)
  const flagged = flaggedNotes(card)
  const expected = flagged.expected[0] ?? card.expected.notes[0]
  const detected = flagged.detected[0] ?? card.detected.notes[0]

  ctx.fillStyle = LINE
  ctx.fillRect(x(start) - 8, RULER_Y, x(end) - x(start) + 16, 2)
  for (let beat = start; beat <= end; beat++) {
    ctx.fillRect(x(beat) - 1, RULER_Y - 6, 2, 14)
    label(ctx, `${beat + 1}`, x(beat), RULER_Y + 30, beat === expected?.onsetBeat ? INK : DIM, 13)
  }
  if (!expected) return

  // Tall solid tick = where the beat falls.
  const ex = x(expected.onsetBeat)
  ctx.fillStyle = INK
  ctx.fillRect(ex - 2, RULER_Y - 30, 4, 46)

  if (detected) {
    // Hollow circle = when the note was heard; bracket labels the gap.
    const dx = x(detected.onsetBeat)
    ctx.strokeStyle = INK
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(dx, RULER_Y + 1, 7, 0, Math.PI * 2)
    ctx.stroke()
    const delta = card.metrics.timingDeltaBeats ?? detected.onsetBeat - expected.onsetBeat
    const [a, b] = [Math.min(dx, ex), Math.max(dx, ex)]
    ctx.fillStyle = INK
    ctx.fillRect(a, RULER_Y - 44, b - a, 1.5)
    ctx.fillRect(a, RULER_Y - 48, 1.5, 9)
    ctx.fillRect(b, RULER_Y - 48, 1.5, 9)
    label(ctx, `${beatFraction(delta)} ${delta < 0 ? 'early' : 'late'}`, (a + b) / 2, RULER_Y - 52, INK, 12)
  }
}

// ── Duration bars ─────────────────────────────────────────────────────

export function durationBars(card: VisualCard) {
  const expected = card.metrics.expectedDurationBeats ?? card.expected.notes[0]?.durationBeats ?? 1
  const detected = card.metrics.detectedDurationBeats ?? card.detected.notes[0]?.durationBeats ?? 1
  const unit = 200 / Math.max(expected, detected, 2)
  return { expected, detected, unit, left: 56 }
}

function drawDuration(ctx: CanvasRenderingContext2D, card: VisualCard) {
  const { expected, detected, unit, left } = durationBars(card)
  label(ctx, 'EXPECTED', left, 30, DIM, 10, 'left')
  ctx.strokeStyle = INK
  ctx.lineWidth = 2
  ctx.strokeRect(left, 36, expected * unit, 18)

  label(ctx, 'DETECTED', left, 78, DIM, 10, 'left')
  ctx.fillStyle = INK
  ctx.fillRect(left, 84, detected * unit, 18)
  if (detected !== expected) {
    // The missing or extra part is dashed and labelled in words.
    const [a, b] = [left + Math.min(expected, detected) * unit, left + Math.max(expected, detected) * unit]
    ctx.setLineDash([4, 3])
    ctx.strokeRect(a, 84, b - a, 18)
    ctx.setLineDash([])
  }
  for (let beat = 0; beat < Math.max(expected, detected); beat++) {
    label(ctx, `${beat + 1}`, left + (beat + 0.5) * unit, 128, DIM, 12)
  }
}

// ── Microphone (unclear audio): no meters, since analysis reports no levels ──

function drawMic(ctx: CanvasRenderingContext2D) {
  const cx = ART_W / 2
  ctx.strokeStyle = INK
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.roundRect(cx - 16, 22, 32, 58, 16)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, 62, 30, 0.1 * Math.PI, 0.9 * Math.PI)
  ctx.stroke()
  ctx.fillStyle = INK
  ctx.fillRect(cx - 1.5, 92, 3, 22)
  ctx.fillRect(cx - 18, 113, 36, 3)
}

// ── Shared ────────────────────────────────────────────────────────────

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  size = 13,
  align: CanvasTextAlign = 'center',
) {
  ctx.fillStyle = color
  ctx.font = `600 ${size}px sans-serif`
  ctx.textAlign = align
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(text, x, y)
}

export type ArtKind = 'keyboard' | 'staff' | 'ruler' | 'duration' | 'mic'

// Which picture a card gets. Wrong notes show keys; timing shows the beat
// ruler; length shows bars; unclear audio shows the mic; the rest use the staff.
export function artKind(card: VisualCard): ArtKind {
  if (card.kind === 'wrong_note' && card.variant !== 'self_fix') return 'keyboard'
  if (card.kind === 'timing') return 'ruler'
  if (card.kind === 'duration') return 'duration'
  if (card.kind === 'unclear_audio') return 'mic'
  return 'staff'
}

export async function renderCardArt(card: VisualCard): Promise<Uint8Array> {
  const { element, ctx } = canvas(ART_W, ART_H)
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, ART_W, ART_H)

  switch (artKind(card)) {
    case 'keyboard': {
      const flagged = flaggedNotes(card)
      const expected = flagged.expected[0] ?? card.expected.notes[0]
      drawKeyboard(ctx, expected.midiPitch, flagged.detected[0]?.midiPitch ?? null)
      break
    }
    case 'ruler':
      drawRuler(ctx, card)
      break
    case 'duration':
      drawDuration(ctx, card)
      break
    case 'mic':
      drawMic(ctx)
      break
    case 'staff':
      drawStaffWindow(ctx, card)
      break
  }
  return toPng(element)
}
