import type { VisualCard } from '../../shared/visual-contract.ts'

export const DIAGRAM_W = 576
export const DIAGRAM_H = 96
export const DIAGRAM_TILE_W = 288
export type DiagramTiles = { left: Uint8Array; right: Uint8Array }

type NoteMark = { midiPitch: number; onsetBeat: number; durationBeats: number }
export type Diagram = { kind: 'keyboard' | 'rhythm'; expected?: NoteMark; detected?: NoteMark;
  timingDeltaBeats?: number; expectedDurationBeats?: number; detectedDurationBeats?: number }

// A card is built from the validated analysis; neither row estimates unobserved playing.
export function diagramForCard(card: VisualCard): Diagram {
  const expected = card.expected.notes.find(note => card.evidence.referenceNoteIds.includes(note.id))
  const detected = card.detected.notes.find(note => card.evidence.detectedNoteIds.includes(note.id))
  return card.kind === 'timing' || card.kind === 'duration'
    ? { kind: 'rhythm', expected, detected, ...card.metrics }
    : { kind: 'keyboard', expected, detected }
}

function canvas(width: number, height: number): { element: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const element = document.createElement('canvas')
  element.width = width
  element.height = height
  const ctx = element.getContext('2d')
  if (!ctx) throw new Error('2d canvas context unavailable')
  return { element, ctx }
}
function png(element: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => element.toBlob(blob => {
    if (!blob) { reject(new Error('canvas PNG unavailable')); return }
    blob.arrayBuffer().then(buffer => resolve(new Uint8Array(buffer)), reject)
  }, 'image/png'))
}
function keyboard(ctx: CanvasRenderingContext2D, diagram: Diagram): void {
  const white = [0, 2, 4, 5, 7, 9, 11]
  const black = [[1, 0], [3, 1], [6, 3], [8, 4], [10, 5]] as const
  const start = 50; const width = 68; const top = 20; const height = 63
  ctx.fillStyle = '#ffffff'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center'
  ctx.fillText('E expected   P played', DIAGRAM_W / 2, 12)
  ctx.strokeStyle = '#777777'; ctx.lineWidth = 2
  for (let i = 0; i < white.length; i++) {
    const x = start + i * width
    ctx.strokeRect(x, top, width, height)
    ctx.fillStyle = '#aaaaaa'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center'
    ctx.fillText(['C', 'D', 'E', 'F', 'G', 'A', 'B'][i], x + width / 2, top + height - 7)
  }
  for (const [pitchClass, left] of black) {
    const x = start + (left + 1) * width - 17
    ctx.fillStyle = '#555555'; ctx.fillRect(x, top, 34, 38)
    ctx.fillStyle = '#ffffff'; ctx.font = '12px sans-serif'
    ctx.fillText(['', 'C#', '', 'D#', '', '', 'F#', '', 'G#', '', 'A#'][pitchClass], x + 17, top + 25)
  }
  function marker(note: NoteMark | undefined, label: 'E' | 'P', y: number): void {
    if (!note) return
    const pc = note.midiPitch % 12
    const whiteIndex = white.indexOf(pc)
    const x = whiteIndex >= 0 ? start + (whiteIndex + .5) * width :
      start + ((black.find(pair => pair[0] === pc)?.[1] ?? 0) + 1) * width
    ctx.fillStyle = label === 'E' ? '#ffffff' : '#aaaaaa'
    ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#000000'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'
    ctx.fillText(label, x, y + 4)
  }
  marker(diagram.expected, 'E', 50)
  marker(diagram.detected, 'P', 69)
}
function rhythm(ctx: CanvasRenderingContext2D, diagram: Diagram): void {
  const expected = diagram.expected; const detected = diagram.detected
  if (!expected && !detected) return
  const origin = Math.floor(Math.min(expected?.onsetBeat ?? Infinity, detected?.onsetBeat ?? Infinity))
  const end = Math.max((expected?.onsetBeat ?? origin) + (diagram.expectedDurationBeats ?? expected?.durationBeats ?? 1),
    (detected?.onsetBeat ?? origin) + (diagram.detectedDurationBeats ?? detected?.durationBeats ?? 1))
  const beats = Math.max(2, Math.ceil(end - origin) + 1)
  const x0 = 100; const step = Math.min(55, 440 / beats)
  ctx.font = '14px sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#aaaaaa'
  ctx.fillText('WRITTEN', 4, 38); ctx.fillText('PLAYED', 4, 76)
  ctx.strokeStyle = '#666666'; ctx.lineWidth = 1
  for (let i = 0; i <= beats; i++) {
    const x = x0 + i * step
    ctx.beginPath(); ctx.moveTo(x, 12); ctx.lineTo(x, 86); ctx.stroke()
    if (i < beats && i % Math.max(1, Math.ceil(beats / 8)) === 0) ctx.fillText(String(origin + i + 1), x + 4, 13)
  }
  function bar(note: NoteMark | undefined, duration: number | undefined, y: number, color: string): void {
    if (!note) return
    ctx.fillStyle = color
    const left = Math.max(x0, Math.min(x0 + beats * step - 4, x0 + (note.onsetBeat - origin) * step))
    ctx.fillRect(left, y, Math.max(4, Math.min((duration ?? note.durationBeats) * step, x0 + beats * step - left)), 18)
  }
  bar(expected, diagram.expectedDurationBeats, 23, '#ffffff')
  bar(detected, diagram.detectedDurationBeats, 61, '#aaaaaa')
}

export async function renderFeedbackTiles(diagram: Diagram): Promise<DiagramTiles> {
  const full = canvas(DIAGRAM_W, DIAGRAM_H)
  full.ctx.fillStyle = '#000000'; full.ctx.fillRect(0, 0, DIAGRAM_W, DIAGRAM_H)
  if (diagram.kind === 'rhythm') rhythm(full.ctx, diagram)
  else keyboard(full.ctx, diagram)
  const tile = async (offsetX: number): Promise<Uint8Array> => {
    const part = canvas(DIAGRAM_TILE_W, DIAGRAM_H)
    part.ctx.drawImage(full.element, offsetX, 0, DIAGRAM_TILE_W, DIAGRAM_H, 0, 0, DIAGRAM_TILE_W, DIAGRAM_H)
    return png(part.element)
  }
  return { left: await tile(0), right: await tile(DIAGRAM_TILE_W) }
}
