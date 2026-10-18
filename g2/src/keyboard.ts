import { keyboardRange, type MistakeVisualization } from '../../mobile/src/visualization.ts'

// Compact supplemental keyboard frame for a validated Review finding.
export const KEYS_W = 288
export const KEYS_H = 96

const LINE = '#7a7a7a'
const INK = '#ffffff'

const MARKER_Y = 9
const MARKER_R = 5
const KEY_TOP = 18
const KEY_H = 56
const KEY_H_WITH_BARS = 34
const BAR_W = KEYS_W - 96

export type KeyRect = { pitch: number; x: number; y: number; w: number; h: number }
export type KeyMarker = { x: number; role: 'expected' | 'played' }

export type KeysLayout = {
  whites: KeyRect[]
  blacks: KeyRect[]
  // Positions of the expected and heard marks; drawing uses solid/× to match Review.
  markers: KeyMarker[]
  // Note names under the marked keys.
  labels: { x: number; text: string }[]
  // Expected vs measured hold duration for duration findings.
  bars: { filled: boolean; frac: number; label: string; y: number }[]
}

// Geometry separate from drawing so it can be checked without a canvas.
export function keyboardLayout(visual: MistakeVisualization): KeysLayout | null {
  const pitches = keyboardRange(visual)
  if (!pitches.length) return null
  const hasBars = Boolean(visual.duration)
  const keyH = hasBars ? KEY_H_WITH_BARS : KEY_H
  const keyW = KEYS_W / pitches.length
  const whites: KeyRect[] = pitches.map((pitch, index) => ({
    pitch, x: index * keyW, y: KEY_TOP, w: keyW, h: keyH,
  }))
  const blacks: KeyRect[] = []
  for (let index = 0; index < whites.length - 1; index += 1) {
    const next = whites[index + 1].pitch
    if (next - whites[index].pitch !== 2) continue
    blacks.push({ pitch: whites[index].pitch + 1, x: (index + 1) * keyW - keyW * 0.29, y: KEY_TOP, w: keyW * 0.58, h: keyH * 0.6 })
  }
  const keys = [...whites, ...blacks]
  const keyOf = (pitch: number) => keys.find(key => key.pitch === pitch)
  const markers: KeyMarker[] = []
  const labels: { x: number; text: string }[] = []
  const labeled = new Set<number>()
  for (const { event, role } of [
    { event: visual.expected, role: 'expected' as const },
    { event: visual.played, role: 'played' as const },
  ]) {
    const key = event && keyOf(event.midiPitch)
    if (!event || !key) continue
    markers.push({ x: key.x + key.w / 2, role })
    if (!labeled.has(event.midiPitch)) {
      labeled.add(event.midiPitch)
      labels.push({ x: key.x + key.w / 2, text: event.label })
    }
  }
  const bars: KeysLayout['bars'] = []
  if (visual.duration) {
    const max = Math.max(visual.duration.expectedBeats, visual.duration.playedBeats)
    bars.push(
      { filled: false, frac: visual.duration.expectedBeats / max, label: `${visual.duration.expectedBeats}`, y: KEY_TOP + KEY_H_WITH_BARS + 18 },
      { filled: true, frac: visual.duration.playedBeats / max, label: visual.duration.playedBeats.toFixed(1), y: KEY_TOP + KEY_H_WITH_BARS + 32 },
    )
  }
  return { whites, blacks, markers, labels, bars }
}

// The text container under the image says what the marks mean.
export function visualLegend(visual: MistakeVisualization): string {
  const parts: string[] = []
  if (visual.expected) parts.push(`Expected ${visual.expected.label}`)
  if (visual.played) parts.push(`Heard ${visual.played.label}`)
  if (visual.duration) parts.push(`hold ${visual.duration.expectedBeats} vs ${visual.duration.playedBeats.toFixed(1)} beats`)
  return parts.join(' · ')
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

// Draw into either a compact image or the Review replay's 288×144 art frame.
// A solid mark is the written key; × is what the microphone heard.
export function drawKeyboardSchematic(ctx: CanvasRenderingContext2D, visual: MistakeVisualization, offsetY = 0): boolean {
  const layout = keyboardLayout(visual)
  if (!layout) return false
  ctx.save()
  ctx.translate(0, offsetY)
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, KEYS_W, KEYS_H)

  const expectedPitch = visual.expected?.midiPitch
  const playedPitch = visual.played?.midiPitch
  for (const key of layout.whites) {
    if (key.pitch === expectedPitch) {
      ctx.fillStyle = INK
      ctx.fillRect(key.x + 0.75, key.y, key.w - 1.5, key.h)
    } else {
      ctx.strokeStyle = LINE
      ctx.lineWidth = 1.5
      ctx.strokeRect(key.x + 0.75, key.y, key.w - 1.5, key.h)
    }
  }
  for (const key of layout.blacks) {
    ctx.fillStyle = key.pitch === expectedPitch ? INK : LINE
    ctx.fillRect(key.x, key.y, key.w, key.h)
  }

  for (const marker of layout.markers) {
    const x = marker.x + (expectedPitch === playedPitch ? (marker.role === 'played' ? 7 : -7) : 0)
    if (marker.role === 'expected') {
      ctx.beginPath()
      ctx.arc(x, MARKER_Y, MARKER_R, 0, Math.PI * 2)
      ctx.fillStyle = INK
      ctx.fill()
    } else {
      ctx.strokeStyle = INK
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x - MARKER_R, MARKER_Y - MARKER_R)
      ctx.lineTo(x + MARKER_R, MARKER_Y + MARKER_R)
      ctx.moveTo(x + MARKER_R, MARKER_Y - MARKER_R)
      ctx.lineTo(x - MARKER_R, MARKER_Y + MARKER_R)
      ctx.stroke()
    }
  }
  if (playedPitch !== undefined && playedPitch !== expectedPitch) {
    const played = [...layout.whites, ...layout.blacks].find(key => key.pitch === playedPitch)
    if (played) {
      ctx.strokeStyle = INK
      ctx.lineWidth = 2
      ctx.setLineDash([4, 3])
      ctx.strokeRect(played.x + 2, played.y + 2, played.w - 4, played.h - 4)
      ctx.setLineDash([])
    }
  }

  ctx.fillStyle = INK
  ctx.font = '600 11px sans-serif'
  ctx.textAlign = 'center'
  const labelY = KEY_TOP + (layout.bars.length ? KEY_H_WITH_BARS : KEY_H) + 13
  for (const label of layout.labels) ctx.fillText(label.text, label.x, labelY)

  for (const bar of layout.bars) {
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(bar.label, BAR_W + 10, bar.y + 9)
    if (bar.filled) {
      ctx.fillStyle = INK
      ctx.fillRect(0, bar.y, bar.frac * BAR_W, 9)
    } else {
      ctx.strokeStyle = INK
      ctx.lineWidth = 1.5
      ctx.strokeRect(0.75, bar.y + 0.75, bar.frac * BAR_W - 1.5, 8)
    }
  }
  ctx.restore()
  return true
}

export async function renderKeyboard(visual: MistakeVisualization): Promise<Uint8Array | null> {
  if (!keyboardLayout(visual)) return null
  const { element, ctx } = canvas(KEYS_W, KEYS_H)
  drawKeyboardSchematic(ctx, visual)
  return toPng(element)
}
