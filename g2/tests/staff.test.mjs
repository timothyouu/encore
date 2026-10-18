import test from 'node:test'
import assert from 'node:assert/strict'
import { PASSAGES } from '../src/passages.ts'
import { STAFF_W, staffLayout } from '../src/staff.ts'

const byId = id => PASSAGES.find(passage => passage.id === id)
const BOTTOM_LINE_Y = 80 // E4
const STEP = 6 // half a staff space

function passage(notes, beatsPerBar = 4) {
  return {
    id: 'T',
    version: '1',
    title: 'Test',
    tempoBpm: 60,
    beatsPerBar,
    purpose: '',
    focus: '',
    notes: notes.map(([midiPitch, onsetBeat, durationBeats = 1], i) => ({
      id: `T-N${i}`,
      midiPitch,
      onsetBeat,
      durationBeats,
      hand: 'right',
    })),
  }
}

test('every seed passage fits one screen: two 4/4 bars inside the staff', () => {
  for (const seed of PASSAGES) {
    const layout = staffLayout(seed)
    assert.equal(layout.bars, 2, seed.id)
    assert.equal(layout.totalBeats, 8, seed.id)
    for (const note of layout.notes) assert.ok(note.x > 90 && note.x < STAFF_W - 30, `${seed.id} ${note.id}`)
  }
})

test('notes sit on the right line or space (Little Echo: E E G G F F D D)', () => {
  const ys = staffLayout(byId('P02')).notes.map(note => note.y)
  const E = BOTTOM_LINE_Y, F = E - STEP, G = E - 2 * STEP, D = E + STEP
  assert.deepEqual(ys, [E, E, G, G, F, F, D, D])
})

test('notes advance left to right in onset order, one beat apart within a bar', () => {
  const xs = staffLayout(byId('P02')).notes.map(note => note.x)
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1])
  assert.equal(xs[1] - xs[0], xs[2] - xs[1])
})

test('middle C gets a ledger line below the staff; D4 does not', () => {
  const [c4] = staffLayout(byId('P01')).notes
  assert.deepEqual(c4.ledgerYs, [BOTTOM_LINE_Y + 2 * STEP])
  const d4 = staffLayout(byId('P02')).notes[6]
  assert.deepEqual(d4.ledgerYs, [])
})

test('half notes are hollow (Hold the Moment: 2,1,1,2,1,1 beats)', () => {
  const hollow = staffLayout(byId('P04')).notes.map(note => note.hollow)
  assert.deepEqual(hollow, [true, false, false, true, false, false])
})

test('silent beats get quarter rests (Room to Breathe: beats 1 and 6)', () => {
  const restXs = staffLayout(byId('P05')).restXs
  const beatXs = staffLayout(byId('P01')).notes.map(note => note.x) // one note per beat 0–7
  assert.deepEqual(restXs, [beatXs[1], beatXs[6]])
})

test('a passage with no silent beats has no rests', () => {
  for (const id of ['P01', 'P02', 'P03', 'P04', 'P06']) assert.deepEqual(staffLayout(byId(id)).restXs, [], id)
})

test('stems point up below the middle line, down from B4, and whole notes have none', () => {
  const layout = staffLayout(passage([[67, 0], [71, 1], [74, 2], [64, 4, 4]]))
  assert.deepEqual(
    layout.notes.map(note => note.stem),
    ['up', 'down', 'down', 'none'],
  )
})

test('sharps are marked and sit on the natural below', () => {
  const [cSharp, c] = staffLayout(passage([[61, 0], [60, 1]])).notes
  assert.equal(cSharp.sharp, true)
  assert.equal(c.sharp, false)
  assert.equal(cSharp.y, c.y)
})

test('notes above the staff get ledger lines from A5', () => {
  const [a5] = staffLayout(passage([[81, 0]])).notes
  assert.equal(a5.ledgerYs.length, 1)
})
