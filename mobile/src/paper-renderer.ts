import type { VisualCard, VisualNote } from '../../shared/visual-contract.ts'
import { validateVisualCard } from '../../shared/visual-plan.ts'

export type PaperPhase = 'static' | 'detected' | 'correction' | 'resolved'
export interface PaperMountOptions { reducedMotion?: boolean }
export interface PaperVisualization {
  element: HTMLElement
  replay(): void
  destroy(): void
}

const GREEN = '#3CFA44'
const DIM = '#1E7D22'
const MUTED = '#1E9426'
const BLACK = '#000000'
const PHASES: PaperPhase[] = ['detected', 'correction', 'resolved', 'static']
const PHASE_MS = [460, 520, 480]
const MUSIC = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

function safe(value: unknown, max = 80): string {
  return String(value ?? '').slice(0, max).replace(/[&<>"']/g, char => {
    const escapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
    return escapes[char]
  })
}
function fitted(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, Math.max(1, max - 1)).trimEnd() + '…'
}
function cueText(x: number, y: number, value: string, expanded: boolean): string {
  const max = expanded ? 48 : 23
  const words = value.trim().split(/\s+/)
  const lines: string[] = ['']
  for (const word of words) {
    const line = lines.length - 1
    const next = lines[line] ? lines[line] + ' ' + word : word
    if (next.length <= max) lines[line] = next
    else if (lines.length < 2) lines.push(word)
    else { lines[line] = fitted(lines[line] + ' ' + word, max); break }
  }
  return lines.map((line, index) => txt(x, y + index * 23, fitted(line, max), 17, GREEN, 700, 'class="paper-cue"')).join('')
}
function clamp(value: number, low: number, high: number): number {
  return Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : low
}
function n(value: number): string { return String(Math.round(clamp(value, -1000, 1000) * 10) / 10) }
function rect(x: number, y: number, w: number, h: number, fill = 'none', stroke = 'none', extra = ''): string {
  return '<rect x="' + n(x) + '" y="' + n(y) + '" width="' + n(Math.max(0, w)) + '" height="' + n(Math.max(0, h)) + '" fill="' + fill + '" stroke="' + stroke + '" ' + extra + '/>'
}
function line(x1: number, y1: number, x2: number, y2: number, color = GREEN, width = 2, extra = ''): string {
  return '<line x1="' + n(x1) + '" y1="' + n(y1) + '" x2="' + n(x2) + '" y2="' + n(y2) + '" stroke="' + color + '" stroke-width="' + n(width) + '" ' + extra + '/>'
}
function circle(x: number, y: number, r: number, fill = BLACK, stroke = GREEN, width = 2): string {
  return '<circle cx="' + n(x) + '" cy="' + n(y) + '" r="' + n(r) + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + n(width) + '"/>'
}
function txt(x: number, y: number, value: unknown, size = 16, color = GREEN, weight = 500, extra = ''): string {
  return '<text x="' + n(x) + '" y="' + n(y) + '" fill="' + color + '" font-size="' + n(size) + '" font-weight="' + n(weight) + '" ' + extra + '>' + safe(value) + '</text>'
}
function path(d: string, color = GREEN, width = 2, extra = ''): string {
  return '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + n(width) + '" ' + extra + '/>'
}
function cross(x: number, y: number, size = 11): string {
  return line(x - size, y - size, x + size, y + size, GREEN, 2.5) + line(x + size, y - size, x - size, y + size, GREEN, 2.5)
}
function pitch(note?: VisualNote): string {
  if (!note) return '—'
  const midi = clamp(note.midiPitch, 0, 127)
  return MUSIC[Math.round(midi) % 12] + String(Math.floor(midi / 12) - 1)
}
function nameOnly(note?: VisualNote): string { return pitch(note).replace(/[0-9-]/g, '') }
function beat(value: number): string {
  const whole = Math.floor(value)
  const fraction = value - whole
  const suffix = fraction >= 0.375 && fraction < 0.625 ? '½' : fraction >= 0.125 && fraction < 0.375 ? '¼' : fraction >= 0.625 && fraction < 0.875 ? '¾' : ''
  return String(whole) + suffix
}
function humanBeat(value: number): string { return beat(value + 1) }
function deltaLabel(value: number): string {
  const amount = Math.abs(value)
  const rounded = Math.round(amount * 100) / 100
  const beats = Math.abs(rounded - 0.25) < 0.005 ? '¼' :
    Math.abs(rounded - 0.5) < 0.005 ? '½' :
    Math.abs(rounded - 0.75) < 0.005 ? '¾' : String(rounded)
  return beats + (rounded === 1 ? ' beat' : ' beats') + ' ' + (value < 0 ? 'early' : 'late')
}
function focusNote(card: VisualCard, which: 'expected' | 'detected'): VisualNote | undefined {
  const notes = card[which].notes
  const ids = which === 'expected' ? card.evidence.referenceNoteIds : card.evidence.detectedNoteIds
  return notes.find(note => ids.includes(note.id)) ?? notes.find(note => note.onsetBeat >= card.focus.startBeat - 0.25 && note.onsetBeat <= card.focus.endBeat + 0.25) ?? notes[0]
}
function label(card: VisualCard): string {
  const b = humanBeat(card.focus.startBeat)
  const kind = card.kind
  if (kind === 'unclear_audio') return 'Couldn’t hear clearly'
  if (kind === 'tempo_drift') return 'Phrase · ' + (card.variant === 'slowing' ? 'slowing down' : 'speeding up')
  if (kind === 'uneven_rhythm') return 'Phrase · uneven rhythm'
  if (kind === 'recurring_trouble') return 'Beats ' + humanBeat(card.focus.startBeat) + '–' + humanBeat(card.focus.endBeat) + ' · trouble spot'
  if (kind === 'section_repeat_skip') return 'Bar ' + b + ' · ' + (card.variant === 'skipped' ? 'skipped' : 'restarted')
  const noun: Record<string, string> = {
    wrong_note: 'wrong note', missing_note: 'missed note', extra_note: 'extra note',
    timing: card.variant === 'late' ? 'late' : 'early',
    duration: card.variant === 'long' ? 'too long' : 'too short',
    unexpected_pause: 'unexpected pause', rest_violation: 'sound in a rest',
  }
  return 'Beat ' + b + ' · ' + (noun[kind] ?? kind.replace(/_/g, ' '))
}
function frame(card: VisualCard, phase: PaperPhase, body: string, expanded = false): string {
  const active = phase !== 'static'
  const header = txt(24, 33, label(card), 20, GREEN, 500) + txt(552, 33, active ? 'replaying' : '1 / 1', 18, GREEN, 500, 'text-anchor="end"')
  const footer = txt(24, 268, active ? 'replaying' : 'tap  ↻ replay', 18, MUTED, 500) +
    txt(552, 268, active ? (phase === 'detected' ? '●○○' : phase === 'correction' ? '●●○' : '●●●') : '▼  next', 18, MUTED, 500, 'text-anchor="end"')
  const cueX = expanded ? 24 : 328
  const cueY = expanded ? 238 : 178
  const cue = phase === 'static' || phase === 'resolved' ? cueText(cueX, cueY, card.cue, expanded) : ''
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 288" width="576" height="288" role="img" aria-label="' +
    safe(label(card) + '. Expected ' + card.expected.label + '. Detected ' + card.detected.label + '. ' + card.cue, 260) +
    '" class="paper-screen"><rect width="576" height="288" fill="' + BLACK + '"/>' +
    header + body + cue + footer + '</svg>'
}
function side(expected: string, detected: string, phase: PaperPhase): string {
  const y = phase === 'resolved' || phase === 'static' ? 94 : 112
  return txt(328, y, '● Expected: ' + fitted(expected, 12), 16, GREEN, 600) +
    txt(328, y + 32, '○ Detected: ' + fitted(detected, 12), 16, GREEN, 600)
}
function staff(y = 91): string {
  let output = ''
  for (let i = 0; i < 5; i++) output += line(24, y - 28 + i * 14, 304, y - 28 + i * 14, DIM, 1.5)
  return output
}
function noteHead(x: number, y: number, filled: boolean, color = GREEN): string {
  return '<ellipse cx="' + n(x) + '" cy="' + n(y) + '" rx="9" ry="6" transform="rotate(-20 ' + n(x) + ' ' + n(y) + ')" fill="' +
    (filled ? color : BLACK) + '" stroke="' + color + '" stroke-width="2.5"/>' + line(x + 8, y, x + 8, y - 36, color, 2)
}
function pitchY(note?: VisualNote): number {
  const midi = clamp(note?.midiPitch ?? 65, 21, 108)
  const chromatic = Math.round(midi) % 12
  const step = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][chromatic]
  const diatonic = Math.floor(midi / 12) * 7 + step
  return clamp(105 - (diatonic - 35) * 7, 67, 145)
}
function staffNote(x: number, note: VisualNote, filled: boolean, color = GREEN): string {
  const y = pitchY(note)
  const accidental = [1, 3, 6, 8, 10].includes(note.midiPitch % 12) ?
    txt(x - 19, y + 5, '♯', 18, color, 700) : ''
  return accidental + noteHead(x, y, filled, color)
}
function coreWrong(card: VisualCard, phase: PaperPhase): string {
  const expected = focusNote(card, 'expected'), detected = focusNote(card, 'detected')
  const ePitch = pitch(expected), dPitch = pitch(detected)
  const eMidi = expected?.midiPitch ?? 65, dMidi = detected?.midiPitch ?? 64
  const startC = Math.floor(Math.min(eMidi, dMidi) / 12) * 12
  const octaves = clamp(Math.floor(Math.max(eMidi, dMidi) / 12) - Math.floor(startC / 12) + 1, 1, 2)
  const whiteW = 276 / (7 * octaves)
  const whiteOffsets = [0, 2, 4, 5, 7, 9, 11]
  const blackOffsets = [1, 3, 6, 8, 10]
  const whiteIndex = (midi: number): number => {
    const octave = clamp(Math.floor((midi - startC) / 12), 0, octaves - 1)
    const chromatic = ((midi - startC) % 12 + 12) % 12
    const i = whiteOffsets.indexOf(chromatic)
    if (i >= 0) return octave * 7 + i
    return octave * 7 + Math.max(0, whiteOffsets.findIndex(value => value > chromatic) - 1)
  }
  const keyX = (midi: number): number => {
    const chromatic = ((midi - startC) % 12 + 12) % 12
    const left = 22 + whiteIndex(midi) * whiteW
    return blackOffsets.includes(chromatic) ? left + whiteW : left + whiteW / 2
  }
  let keyboard = ''
  for (let octave = 0; octave < octaves; octave++) {
    for (let i = 0; i < 7; i++) {
      const midi = startC + octave * 12 + whiteOffsets[i]
      const x = 22 + (octave * 7 + i) * whiteW
      keyboard += rect(x, 78, whiteW, 105, midi === eMidi && phase !== 'detected' ? GREEN : 'none',
        midi === dMidi ? GREEN : DIM, midi === dMidi ? 'stroke-width="2" stroke-dasharray="5 4"' : 'stroke-width="1.5"')
    }
  }
  for (let octave = 0; octave < octaves; octave++) {
    for (const chromatic of blackOffsets) {
      const midi = startC + octave * 12 + chromatic
      const x = keyX(midi) - whiteW * 0.29
      keyboard += rect(x, 78, whiteW * 0.58, 63, midi === eMidi && phase !== 'detected' ? GREEN : DIM,
        midi === dMidi ? GREEN : DIM, midi === dMidi ? 'stroke-width="2" stroke-dasharray="5 4"' : '')
    }
  }
  const eX = keyX(eMidi), dX = keyX(dMidi)
  const keys = keyboard + circle(dX, 62, 6) + (phase === 'detected' ? '' : circle(eX, 62, 7, GREEN, GREEN)) +
    txt(dX, 205, dPitch, 14, GREEN, 700, 'text-anchor="middle"') +
    (phase === 'detected' ? '' : txt(eX, 222, ePitch, 14, GREEN, 700, 'text-anchor="middle"'))
  if (phase === 'detected' || phase === 'correction') {
    const eY = pitchY(expected), dY = pitchY(detected)
    return frame(card, phase, staff() + (detected ? staffNote(145, detected, false) : '') +
      (phase === 'correction' ? (expected ? staffNote(190, expected, true) : '') + path('M155 ' + n(dY) + ' Q172 ' + n(dY - 22) + ' 180 ' + n(eY), GREEN, 2) : '') +
      txt(150, 189, '○ DETECTED ' + dPitch, 16, GREEN, 700, 'text-anchor="middle"') +
      (phase === 'correction' ? txt(150, 65, '● EXPECTED ' + ePitch, 16, GREEN, 700, 'text-anchor="middle"') : ''))
  }
  return frame(card, phase, keys + side(ePitch, dPitch, phase))
}
function coreMissing(card: VisualCard, phase: PaperPhase): string {
  const e = focusNote(card, 'expected')
  const expected = pitch(e)
  const neighbors = card.expected.notes.filter(note => note.id !== e?.id)
  const left = neighbors.filter(note => note.onsetBeat < (e?.onsetBeat ?? card.focus.startBeat)).at(-1)
  const right = neighbors.find(note => note.onsetBeat > (e?.onsetBeat ?? card.focus.startBeat))
  let body = staff() + rect(130, 65, 50, 112, 'none', GREEN, 'rx="3" stroke-width="2" stroke-dasharray="5 4"')
  if (left) body += staffNote(64, left, true, MUTED) + txt(64, 207, pitch(left), 14, MUTED, 700, 'text-anchor="middle"')
  if (right) body += staffNote(259, right, true, MUTED) + txt(259, 207, pitch(right), 14, MUTED, 700, 'text-anchor="middle"')
  if (e && (phase === 'correction' || phase === 'resolved' || phase === 'static')) body += staffNote(155, e, true)
  if (phase === 'detected') body += txt(155, 125, 'silence', 15, GREEN, 600, 'text-anchor="middle"')
  if (phase === 'correction') body += txt(155, 58, 'DROP IN ' + expected, 14, GREEN, 700, 'text-anchor="middle"')
  if (phase === 'resolved' || phase === 'static') body += txt(155, 207, '[ ' + expected + ' ]', 14, GREEN, 700, 'text-anchor="middle"')
  return frame(card, phase, body + side(expected, '— silence', phase))
}
function coreExtra(card: VisualCard, phase: PaperPhase): string {
  const extra = focusNote(card, 'detected')
  const expected = card.expected.notes
  const left = expected.filter(note => note.onsetBeat <= (extra?.onsetBeat ?? card.focus.startBeat)).at(-1)
  const right = expected.find(note => note.onsetBeat > (extra?.onsetBeat ?? card.focus.startBeat))
  let body = staff(88) + (extra ? staffNote(160, extra, false, phase === 'resolved' ? MUTED : GREEN) : '') +
    line(35, 176, 280, 176, DIM, 2) + circle(160, 176, 6) +
    txt(160, 206, humanBeat(extra?.onsetBeat ?? card.focus.startBeat), 13, GREEN, 700, 'text-anchor="middle"')
  if (left) body += staffNote(64, left, true) + line(64, 165, 64, 188) +
    txt(64, 206, 'beat ' + humanBeat(left.onsetBeat), 13, MUTED, 700, 'text-anchor="middle"')
  if (right) body += staffNote(262, right, true) + line(262, 165, 262, 188) +
    txt(262, 206, 'beat ' + humanBeat(right.onsetBeat), 13, MUTED, 700, 'text-anchor="middle"')
  if (extra && phase !== 'detected') body += cross(160, pitchY(extra), 15)
  if (phase === 'correction') body += txt(160, 55, 'EXTRA', 15, GREEN, 700, 'text-anchor="middle"')
  const expectedNames = [left, right].filter((note): note is VisualNote => note !== undefined).map(nameOnly).join(' ')
  const detectedNames = [left, extra, right].filter((note): note is VisualNote => note !== undefined).map(nameOnly).join(' ')
  return frame(card, phase, body + side(expectedNames || '—', detectedNames || nameOnly(extra), phase))
}
function coreTiming(card: VisualCard, phase: PaperPhase): string {
  const delta = card.metrics.timingDeltaBeats ?? ((focusNote(card, 'detected')?.onsetBeat ?? 0) - (focusNote(card, 'expected')?.onsetBeat ?? 0))
  const offset = clamp(delta * 112, -75, 75)
  const detectedX = phase === 'correction' || phase === 'resolved' ? 150 : 150 + offset
  let body = line(38, 149, 286, 149, DIM, 2) + line(42, 139, 42, 159, DIM) +
    line(150, 112, 150, 173, GREEN, 4) + line(258, 139, 258, 159, DIM) +
    txt(42, 194, humanBeat(card.focus.startBeat - 1), 16, MUTED, 600, 'text-anchor="middle"') +
    txt(150, 194, humanBeat(card.focus.startBeat), 20, GREEN, 800, 'text-anchor="middle"') +
    txt(258, 194, humanBeat(card.focus.startBeat + 1), 16, MUTED, 600, 'text-anchor="middle"') +
    circle(detectedX, 149, 8)
  if (phase === 'static' || phase === 'detected') body += line(150, 99, 150 + offset, 99) +
    line(150, 92, 150, 106) + line(150 + offset, 92, 150 + offset, 106) +
    txt(150 + offset / 2, 86, deltaLabel(delta), 14, GREEN, 700, 'text-anchor="middle"')
  if (phase === 'correction' || phase === 'resolved') body += txt(150, 85, 'ON THE BEAT', 15, GREEN, 700, 'text-anchor="middle"')
  return frame(card, phase, body + side('on ' + humanBeat(card.focus.startBeat), deltaLabel(delta), phase))
}
function coreDuration(card: VisualCard, phase: PaperPhase): string {
  const expected = clamp(card.metrics.expectedDurationBeats ?? focusNote(card, 'expected')?.durationBeats ?? 1, 0.1, 8)
  const detected = clamp(card.metrics.detectedDurationBeats ?? focusNote(card, 'detected')?.durationBeats ?? 1, 0.1, 8)
  const scale = 224 / Math.max(expected, detected, 1)
  const ew = expected * scale, dw = detected * scale
  const tooLong = detected > expected
  let body = txt(24, 81, expected >= 1.75 ? '𝅗𝅥' : '♩', 26) +
    txt(55, 81, 'EXPECTED', 13, GREEN, 700) + rect(55, 88, ew, 24, 'none', GREEN, 'rx="3" stroke-width="2"') +
    txt(24, 149, '♩', 26) + txt(55, 145, 'DETECTED', 13, GREEN, 700) +
    rect(55, 153, phase === 'detected' ? Math.min(dw, 112) : dw, 24, GREEN, 'none', 'rx="3"') +
    txt(55 + ew / 2, 215, expected + (expected === 1 ? ' beat' : ' beats'), 14, MUTED, 700, 'text-anchor="middle"')
  if (phase !== 'detected') {
    const gapX = tooLong ? 55 + ew : 55 + dw
    const gapW = Math.abs(ew - dw)
    body += rect(gapX, 153, gapW, 24, 'none', GREEN, 'stroke-width="2" stroke-dasharray="5 4"') +
      txt(55 + (ew + dw) / 2, 130, (Math.round(Math.abs(expected - detected) * 10) / 10) + (tooLong ? ' beat long' : ' beat short'), 13, GREEN, 700, 'text-anchor="middle"')
  }
  if (phase === 'correction' || phase === 'resolved') body += rect(55, 88, ew, 24, GREEN, GREEN)
  return frame(card, phase, body + side(expected + (expected === 1 ? ' beat' : ' beats'), detected + (detected === 1 ? ' beat' : ' beats'), phase))
}
function coreUnclear(card: VisualCard, phase: PaperPhase): string {
  const variant = card.variant
  const what = variant === 'quiet' ? 'very quiet' : variant === 'no_piano' ? 'no piano heard' : variant === 'noisy' ? 'background noise' : 'unclear sound'
  let body = rect(35, 71, 255, 50, 'none', DIM, 'rx="4" stroke-width="2" stroke-dasharray="6 5"') +
    txt(163, 101, 'EXPECTED · clear piano', 15, GREEN, 700, 'text-anchor="middle"') +
    rect(35, 137, 255, 50, 'none', GREEN, 'rx="4" stroke-width="2"') +
    txt(163, 167, 'DETECTED · ' + what, 15, GREEN, 700, 'text-anchor="middle"')
  if (phase === 'correction') body += txt(163, 217, 'Try another take', 15, GREEN, 700, 'text-anchor="middle"')
  if (phase === 'resolved' || phase === 'static') body += txt(163, 217, 'No pitch cue', 15, MUTED, 600, 'text-anchor="middle"')
  return frame(card, phase, body + side('clear piano', what, phase))
}
function phrasePoints(notes: VisualNote[], start: number, end: number): number[] {
  return notes.slice(0, 8).map(note => 148 + clamp((note.onsetBeat - start) / Math.max(1, end - start), 0, 1) * 370)
}
function phraseBase(card: VisualCard, phase: PaperPhase, mode: 'drift' | 'uneven' | 'pause'): string {
  const expected = card.expected.notes.slice(0, 8), detected = card.detected.notes.slice(0, 8)
  const start = Math.min(card.focus.startBeat, expected[0]?.onsetBeat ?? card.focus.startBeat)
  const end = Math.max(card.focus.endBeat, expected.at(-1)?.onsetBeat ?? card.focus.endBeat, start + 1)
  const ex = phrasePoints(expected, start, end)
  const dx = phrasePoints(detected, start, end)
  let body = txt(24, 82, '● EXPECTED', 14, GREEN, 700) + txt(24, 157, '○ DETECTED', 14, GREEN, 700) +
    line(145, 101, 533, 101, DIM) + line(145, 178, 533, 178, DIM)
  expected.forEach((note, i) => {
    body += line(ex[i], 84, ex[i], 120, GREEN, 3) +
      txt(ex[i], 72, nameOnly(note), 14, GREEN, 700, 'text-anchor="middle"')
    if (mode === 'uneven' && i > 0) body += txt((ex[i - 1] + ex[i]) / 2, 126, '=', 15, GREEN, 700, 'text-anchor="middle"')
  })
  detected.forEach((note, i) => {
    if (phase !== 'detected' || i < Math.ceil(detected.length / 2)) {
      const x = phase === 'resolved' ? (ex[i] ?? dx[i]) : dx[i]
      body += circle(x, 178, 6) + txt(x, 209, nameOnly(note), 13, MUTED, 700, 'text-anchor="middle"')
      if (mode === 'drift' && phase !== 'detected' && ex[i] !== undefined)
        body += line(ex[i], 119, x, 169, MUTED, 1.5, 'stroke-dasharray="4 3"')
      if (mode === 'uneven' && i > 0 && phase !== 'detected')
        body += txt((dx[i - 1] + x) / 2, 216, i % 2 === 0 ? 'L' : 'S', 14, GREEN, 700, 'text-anchor="middle"')
    }
  })
  if (mode === 'pause') {
    const center = 148 + clamp((card.focus.startBeat - start) / (end - start), 0.05, 0.85) * 370
    body += rect(center, 148, 70, 57, 'none', GREEN, 'stroke-width="2" stroke-dasharray="5 4"') +
      txt(center + 35, 185, 'silence', 13, GREEN, 700, 'text-anchor="middle"') +
      txt(center + 35, 216, 'pause · ' + (card.metrics.gapBeats ?? 1) + ' beats', 13, GREEN, 700, 'text-anchor="middle"')
  } else if (mode === 'drift') body += txt(332, 216, card.variant === 'slowing' ? 'gaps grow → slowing down' : '← gaps shrink · speeding up', 14, GREEN, 700, 'text-anchor="middle"')
  return body
}
function rest(card: VisualCard, phase: PaperPhase): string {
  let body = staff() + rect(102, 60, 118, 145, 'none', GREEN, 'rx="4" stroke-width="2"') +
    txt(161, 116, '𝄽', 58, GREEN, 500, 'text-anchor="middle"') +
    txt(161, 145, 'REST', 14, GREEN, 700, 'text-anchor="middle"')
  if (phase !== 'detected') {
    body += rect(123, 160, 76, 24, 'none', GREEN, 'stroke-width="2" stroke-dasharray="4 3"') +
      cross(207, 171, 9)
  }
  return frame(card, phase, body + side('silence', 'sound', phase))
}
function sections(card: VisualCard, phase: PaperPhase): string {
  const segments = card.segments?.slice(0, 4) ?? []
  const labels = segments.length ? segments.map(s => s.label) : card.expected.notes.slice(0, 4).map(n => nameOnly(n))
  const order = card.detected.segmentIds ?? []
  let body = txt(24, 76, '● EXPECTED', 14, GREEN, 700) + txt(24, 168, '○ DETECTED', 14, GREEN, 700)
  labels.forEach((value, i) => {
    const x = 142 + i * 102
    body += rect(x, 55, 88, 35, GREEN, GREEN, 'rx="3"') +
      txt(x + 44, 79, value, 15, BLACK, 700, 'text-anchor="middle"')
    const skipped = card.variant === 'skipped' && !order.includes(segments[i]?.id ?? '')
    const repeated = card.variant !== 'skipped' && order.filter(id => id === segments[i]?.id).length > 1
    if (phase !== 'detected' || i < 2) {
      body += rect(x, 146, 88, 35, BLACK, skipped ? MUTED : GREEN, 'rx="3" stroke-width="2" ' + (skipped ? 'stroke-dasharray="5 4"' : '')) +
        txt(x + 44, 170, skipped ? 'skipped' : value + (repeated ? ' ×2' : ''), 14, GREEN, 700, 'text-anchor="middle"')
    }
    if (i < labels.length - 1) body += line(x + 90, 73, x + 101, 73) + line(x + 90, 164, x + 101, 164)
  })
  if (phase !== 'detected') {
    const d = card.variant === 'skipped' ? 'M230 136 Q339 94 447 136' : 'M333 136 Q333 106 184 106 Q150 106 150 136'
    body += path(d) + txt(300, 126, card.variant === 'skipped' ? 'jumped ahead' : 'restarted', 14, GREEN, 700, 'text-anchor="middle"')
  }
  return frame(card, phase, body, true)
}
function history(card: VisualCard, phase: PaperPhase): string {
  const rows = card.historyRows?.slice(-3) ?? []
  const start = Math.max(0, Math.floor(card.focus.startBeat) - 4)
  let body = txt(24, 76, '● EXPECTED clean', 14, GREEN, 700) +
    txt(552, 76, '○ DETECTED ' + (card.metrics.recurrenceCount ?? rows.length) + ' takes', 14, GREEN, 700, 'text-anchor="end"')
  rows.forEach((row, ri) => {
    if (phase === 'detected' && ri > 0) return
    if (phase === 'correction' && ri > 1) return
    const y = 92 + ri * 39
    body += txt(24, y + 18, row.label, 13, GREEN, 700)
    for (let col = 0; col < 8; col++) {
      const x = 137 + col * 50
      const flagged = row.flaggedBeats.includes(start + col)
      body += rect(x, y, 42, 23, flagged ? BLACK : DIM, flagged ? GREEN : DIM, 'rx="2" stroke-width="1.5"') +
        (flagged ? cross(x + 21, y + 11, 6) : '')
    }
  })
  const first = clamp(card.focus.startBeat - start, 0, 7), last = clamp(card.focus.endBeat - start, first, 7)
  if (phase === 'resolved' || phase === 'static') {
    body += rect(131 + first * 50, 86, (last - first + 1) * 50, 128, 'none', GREEN, 'rx="3" stroke-width="2"') +
      txt(131 + (first + last + 1) * 25, 214, 'BEATS ' + humanBeat(card.focus.startBeat) + '–' + humanBeat(card.focus.endBeat), 13, GREEN, 700, 'text-anchor="middle"')
  }
  return frame(card, phase, body, true)
}

export function renderPaperSvg(card: VisualCard, phase: PaperPhase = 'static'): string {
  if (!validateVisualCard(card)) throw new TypeError('Invalid Paper visual card')
  if (!PHASES.includes(phase)) throw new TypeError('Invalid Paper phase')
  switch (card.kind) {
    case 'wrong_note': return coreWrong(card, phase)
    case 'missing_note': return coreMissing(card, phase)
    case 'extra_note': return coreExtra(card, phase)
    case 'timing': return coreTiming(card, phase)
    case 'duration': return coreDuration(card, phase)
    case 'unclear_audio': return coreUnclear(card, phase)
    case 'tempo_drift': return frame(card, phase, phraseBase(card, phase, 'drift'), true)
    case 'uneven_rhythm': return frame(card, phase, phraseBase(card, phase, 'uneven'), true)
    case 'unexpected_pause': return frame(card, phase, phraseBase(card, phase, 'pause'), true)
    case 'rest_violation': return rest(card, phase)
    case 'section_repeat_skip': return sections(card, phase)
    case 'recurring_trouble': return history(card, phase)
  }
}

export function mountPaperVisualization(card: VisualCard, options: PaperMountOptions = {}): PaperVisualization {
  if (!validateVisualCard(card)) throw new TypeError('Invalid Paper visual card')
  const element = document.createElement('div')
  element.className = 'paper-visualization'
  element.setAttribute('data-paper-kind', card.kind)
  let destroyed = false
  let generation = 0
  let timers: ReturnType<typeof setTimeout>[] = []
  const reduced = (): boolean => options.reducedMotion === true || (options.reducedMotion !== false && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true)
  const paint = (phase: PaperPhase): void => { if (!destroyed) element.innerHTML = renderPaperSvg(card, phase) }
  const clear = (): void => { timers.forEach(clearTimeout); timers = []; generation++ }
  paint('static')
  return {
    element,
    replay(): void {
      clear()
      if (destroyed || reduced()) { paint('static'); return }
      const current = generation
      paint('detected')
      let elapsed = 0
      PHASE_MS.forEach((duration, index) => {
        elapsed += duration
        timers.push(setTimeout(() => {
          if (destroyed || current !== generation) return
          paint(PHASES[index + 1])
        }, elapsed))
      })
      timers.push(setTimeout(() => { if (!destroyed && current === generation) paint('static') }, elapsed + 550))
    },
    destroy(): void {
      clear()
      destroyed = true
      element.replaceChildren()
    },
  }
}
