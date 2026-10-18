import test from 'node:test'
import assert from 'node:assert/strict'
import { KEYS_H, keyboardLayout, visualLegend } from '../src/keyboard.ts'

// Layout is canvas-free: marks and key geometry can be checked without hardware.
const wrongNote = {
  findingId: 'f1',
  kind: 'wrong_note',
  expected: { midiPitch: 64, label: 'E4' },
  played: { midiPitch: 66, label: 'F#4' },
}

test('keyboard layout: white keys span the octaves of the marked pitches', () => {
  const layout = keyboardLayout(wrongNote)
  assert.ok(layout.whites.length >= 7)
  assert.deepEqual(layout.whites.map(key => key.pitch % 12).filter(pc => [1, 3, 6, 8, 10].includes(pc)), [])
  for (let i = 1; i < layout.whites.length; i += 1) {
    assert.ok(layout.whites[i].pitch - layout.whites[i - 1].pitch <= 2)
    assert.ok(layout.whites[i].x > layout.whites[i - 1].x)
  }
})

test('keyboard layout: black keys sit on the boundaries that have them', () => {
  const layout = keyboardLayout(wrongNote)
  for (const black of layout.blacks) assert.ok([1, 3, 6, 8, 10].includes(black.pitch % 12))
  assert.ok(layout.blacks.every(black => black.w < layout.whites[0].w))
  // No black key hangs off the right edge of the board.
  assert.ok(layout.blacks.every(black => black.x + black.w <= 288))
})

test('a wrong note marks expected with an open circle and heard with a filled one, both labeled', () => {
  const layout = keyboardLayout(wrongNote)
  assert.equal(layout.markers.length, 2)
  assert.equal(layout.markers.find(marker => !marker.filled).x, layout.whites.find(key => key.pitch === 64).x + layout.whites[0].w / 2)
  // F#4 is a black key: the marker centers on the black key, not a white one.
  const black = layout.blacks.find(key => key.pitch === 66)
  assert.equal(layout.markers.find(marker => marker.filled).x, black.x + black.w / 2)
  assert.deepEqual(layout.labels.map(label => label.text).sort(), ['E4', 'F#4'])
  assert.equal(layout.bars.length, 0)
})

test('a missing note marks only the expected key', () => {
  const layout = keyboardLayout({ findingId: 'f2', kind: 'missing_note', expected: { midiPitch: 65, label: 'F4' } })
  assert.equal(layout.markers.length, 1)
  assert.equal(layout.markers[0].filled, false)
  assert.deepEqual(layout.labels.map(label => label.text), ['F4'])
})

test('an extra note marks only the heard key', () => {
  const layout = keyboardLayout({ findingId: 'f3', kind: 'extra_note', played: { midiPitch: 67, label: 'G4' } })
  assert.equal(layout.markers.length, 1)
  assert.equal(layout.markers[0].filled, true)
})

test('a duration finding keeps keys shorter and adds expected vs measured bars', () => {
  const layout = keyboardLayout({
    findingId: 'f4', kind: 'duration',
    expected: { midiPitch: 64, label: 'E4' }, played: { midiPitch: 64, label: 'E4' },
    duration: { expectedBeats: 2, playedBeats: 1.3, expectedSeconds: 2, playedSeconds: 1.3, referenceValue: 'Half note' },
  })
  assert.ok(layout.whites[0].h < keyboardLayout(wrongNote).whites[0].h)
  assert.equal(layout.bars.length, 2)
  assert.equal(layout.bars[0].filled, false)
  assert.equal(layout.bars[0].frac, 1)
  assert.equal(layout.bars[1].filled, true)
  assert.equal(layout.bars[1].frac, 1.3 / 2)
  // Bars stay inside the image and clear of the key labels above them.
  assert.ok(layout.bars.every(bar => bar.y + 9 <= KEYS_H))
  assert.ok(layout.bars.every(bar => bar.y >= layout.whites[0].y + layout.whites[0].h + 16))
  // Same key expected and heard: both markers land on it.
  assert.equal(layout.markers.length, 2)
  assert.equal(layout.markers[0].x, layout.markers[1].x)
})

test('no marked pitch means no board', () => {
  assert.equal(keyboardLayout({ findingId: 'f5', kind: 'timing' }), null)
})

test('legend names the marked keys, and the hold comparison for durations', () => {
  assert.equal(visualLegend(wrongNote), 'Expected E4 · Heard F#4')
  assert.equal(visualLegend({ findingId: 'f2', kind: 'missing_note', expected: { midiPitch: 65, label: 'F4' } }), 'Expected F4')
  assert.equal(
    visualLegend({ findingId: 'f4', kind: 'duration', expected: { midiPitch: 64, label: 'E4' }, duration: { expectedBeats: 2, playedBeats: 1.3 } }),
    'Expected E4 · hold 2 vs 1.3 beats',
  )
})
