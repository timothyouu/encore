import test from 'node:test'
import assert from 'node:assert/strict'
import { PASSAGES } from '../src/passages.ts'
import { readyScreen } from '../src/screens/ready.ts'
import { analyzingScreen, errorScreen, guideScreen, reviewScreen } from '../src/screens/results.ts'
import { selectionScreen } from '../src/screens/selection.ts'
import { fakeGlasses, mount, settle, textByName } from './fakes.mjs'

const LITTLE_ECHO = PASSAGES.find(passage => passage.id === 'P02')
const tiles = async () => ({ left: new Uint8Array([1]), right: new Uint8Array([2]), hasClef: true })

// ── 01 · Select passage ────────────────────────────────────────────────

test('selection: a native list of all passages, five rows tall, no gesture hints', () => {
  const page = selectionScreen({ passages: PASSAGES, onOpen() {}, onExit() {} }).page()
  const [list] = page.listObject
  assert.deepEqual(list.itemContainer.itemName, PASSAGES.map(passage => passage.title))
  assert.equal(list.isEventCapture, 1)
  assert.equal(list.itemContainer.isItemSelectBorderEn, 1)
  assert.equal(list.height, 5 * 40 + 2 * list.paddingLength)
  assert.deepEqual(page.textObject.map(t => t.content), ['Choose a passage'])
})

test('selection: list click opens that passage; double tap asks to exit; plain taps do nothing', () => {
  const opened = []
  let exits = 0
  const screen = selectionScreen({ passages: PASSAGES, onOpen: p => opened.push(p.id), onExit: () => exits++ })
  screen.onInput({ kind: 'listSelect', index: 2 })
  screen.onInput({ kind: 'listSelect', index: 99 })
  screen.onInput({ kind: 'tap' })
  screen.onInput({ kind: 'doubleTap' })
  assert.deepEqual(opened, ['P03'])
  assert.equal(exits, 1)
})

// ── 02 · Ready / 03 · Recording ────────────────────────────────────────
// Ready is a view: taps ask the phone session to act, and the session's
// answer arrives through setRecording. The mic lives in g2capture.ts.

function ready({ sheetMusic = true, renderTiles = tiles } = {}) {
  const { glasses, bridge } = fakeGlasses()
  const calls = []
  const screen = readyScreen({
    passage: LITTLE_ECHO,
    sheetMusic: () => sheetMusic,
    onStart: () => calls.push('start'),
    onStop: () => calls.push('stop'),
    onDiscard: () => calls.push('discard'),
    onBack: () => calls.push('back'),
    renderTiles,
  })
  const ctx = mount(screen, glasses)
  return { screen, ctx, bridge, calls }
}

// Tap on the glasses, then the session confirms the take started.
async function recording(options) {
  const setup = ready(options)
  await settle()
  setup.screen.onInput({ kind: 'tap' })
  setup.screen.setRecording(true)
  await settle()
  return setup
}

test('ready: title, tempo, focus, staff images and only the record hint (dimmed)', async () => {
  const { screen, bridge } = ready()
  await settle()
  const shown = textByName(bridge)
  assert.equal(shown.titleL, 'Little Echo')
  assert.equal(shown.titleR, '60 bpm · RH')
  assert.equal(shown.focus, 'Focus: Play each repeat cleanly')
  assert.equal(shown.hintL, 'tap  ●')
  assert.equal(shown.hintR.trim(), '')
  assert.equal(shown.rec.trim(), '')
  const hint = bridge.callsTo('createStartUpPageContainer')[0].textObject.find(t => t.containerName === 'hintL')
  assert.equal(hint.textColor, 2)
  assert.deepEqual(bridge.callsTo('updateImageRawData').map(u => u.containerName), ['staffL', 'staffR'])
  assert.equal(screen.name, 'ready')
  assert.equal(screen.allowsMenu, true)
})

test('ready: tap asks to start once; double tap goes back', async () => {
  const { screen, calls } = ready()
  screen.onInput({ kind: 'tap' })
  screen.onInput({ kind: 'tap' }) // while starting
  screen.onInput({ kind: 'doubleTap' }) // while starting
  assert.deepEqual(calls, ['start'])
  const other = ready()
  other.screen.onInput({ kind: 'doubleTap' })
  assert.deepEqual(other.calls, ['back'])
})

test('recording (sheet music on): text swaps in place, staff stays, no rebuild or image send', async () => {
  const { screen, ctx, bridge } = ready({ sheetMusic: true })
  await settle()
  const imagesBefore = bridge.callsTo('updateImageRawData').length
  screen.onInput({ kind: 'tap' })
  screen.setRecording(true)
  await settle()

  assert.equal(ctx.redraws, 0)
  assert.equal(bridge.callsTo('rebuildPageContainer').length, 0)
  assert.equal(bridge.callsTo('updateImageRawData').length, imagesBefore)
  const shown = textByName(bridge)
  assert.equal(shown.titleL.trim(), '')
  assert.equal(shown.titleR.trim(), '')
  assert.equal(shown.focus.trim(), '')
  assert.equal(shown.rec, '■')
  assert.equal(shown.hintL, 'tap  ■')
  assert.equal(shown.hintR, '2×  discard')
  assert.equal(screen.name, 'recording')
  assert.equal(screen.allowsMenu, false)
})

test('recording (sheet music off): rebuilds to just ■ and the hints, with no images', async () => {
  const { ctx, bridge } = await recording({ sheetMusic: false })
  assert.equal(ctx.redraws, 1)
  const [page] = bridge.callsTo('rebuildPageContainer')
  assert.equal(page.imageObject?.length ?? 0, 0)
  assert.deepEqual(
    page.textObject.map(t => t.content.trim()).filter(Boolean),
    ['■', 'tap  ■', '2×  discard'],
  )
})

test('recording started on the phone switches the glasses view too', async () => {
  const { screen, bridge, calls } = ready({ sheetMusic: true })
  await settle()
  screen.setRecording(true)
  await settle()
  assert.equal(textByName(bridge).rec, '■')
  assert.equal(screen.name, 'recording')
  assert.deepEqual(calls, [])
})

test('recording: tap asks to stop exactly once', async () => {
  const { screen, calls } = await recording()
  screen.onInput({ kind: 'tap' })
  screen.onInput({ kind: 'tap' }) // a duplicate stop while stopping
  assert.deepEqual(calls, ['start', 'stop'])
})

test('recording: double tap asks to discard; Ready returns in place', async () => {
  const { screen, ctx, bridge, calls } = await recording({ sheetMusic: true })
  screen.onInput({ kind: 'doubleTap' })
  screen.setRecording(false)
  await settle()
  assert.deepEqual(calls, ['start', 'discard'])
  assert.equal(ctx.redraws, 0)
  const shown = textByName(bridge)
  assert.equal(shown.titleL, 'Little Echo')
  assert.equal(shown.hintL, 'tap  ●')
  assert.equal(shown.rec.trim(), '')
  assert.equal(screen.allowsMenu, true)
})

test('recording (sheet music off): back to Ready rebuilds and resends the staff', async () => {
  const { screen, ctx, bridge } = await recording({ sheetMusic: false })
  screen.onInput({ kind: 'doubleTap' })
  screen.setRecording(false)
  await settle()
  assert.equal(ctx.redraws, 2)
  assert.equal(bridge.callsTo('updateImageRawData').length, 4)
})

test('a start that never records returns to Ready', async () => {
  const { screen, bridge } = ready()
  await settle()
  screen.onInput({ kind: 'tap' })
  screen.setRecording(false) // e.g. the mic did not start
  await settle()
  assert.equal(screen.name, 'ready')
  assert.equal(textByName(bridge).hintL, 'tap  ●')
})

test('no staff image is sent once recording has started', async () => {
  let finishRender
  const slowTiles = () => new Promise(resolve => (finishRender = () => resolve({ left: new Uint8Array(1), right: new Uint8Array(1), hasClef: true })))
  const { screen, bridge } = ready({ renderTiles: slowTiles })
  screen.onInput({ kind: 'tap' }) // record before the staff is ready
  await settle()
  finishRender()
  await settle()
  assert.equal(bridge.callsTo('updateImageRawData').length, 0)
})

// ── 04 · Analyzing / 05 · Review / 06 · Guide / error ──────────────────

const VIEW = { title: 'Little Echo', tag: '', review: 'Beat 3 · Note mismatch\nExpected G4 · Heard G#4\nPlay G4 on beat 3.', guide: 'Play G4 on beat 3.', index: 1, findings: 3 }

async function shownBody(screen) {
  const { glasses, bridge } = fakeGlasses()
  mount(screen, glasses)
  await settle()
  return textByName(bridge)
}

test('analyzing: a short status with no input and no menu', async () => {
  const screen = analyzingScreen({ title: 'Little Echo', tag: 'Demo' })
  const shown = await shownBody(screen)
  assert.equal(shown.body, 'Analyzing…')
  assert.equal(shown.titleR, 'Demo')
  assert.equal(screen.allowsMenu, false)
  screen.onInput({ kind: 'tap' })
})

test('review: finding and cue, ▼ guide hint, swipe down to Guide, tap is Play again', async () => {
  const events = []
  const screen = reviewScreen({ view: VIEW, onGuide: () => events.push('guide'), onPrev: () => events.push('prev'), onPlayAgain: () => events.push('again') })
  const shown = await shownBody(screen)
  assert.equal(shown.body, VIEW.review)
  assert.equal(shown.hintR, '▼ guide')
  screen.onInput({ kind: 'swipeDown' })
  screen.onInput({ kind: 'swipeUp' })
  screen.onInput({ kind: 'tap' })
  screen.onInput({ kind: 'doubleTap' })
  assert.deepEqual(events, ['guide', 'prev', 'again', 'again'])
})

test('review of the first finding ignores swipe up', () => {
  const events = []
  const screen = reviewScreen({ view: { ...VIEW, index: 0 }, onGuide() {}, onPrev: () => events.push('prev'), onPlayAgain() {} })
  screen.onInput({ kind: 'swipeUp' })
  assert.deepEqual(events, [])
})

test('review without a correction offers no guide', async () => {
  const events = []
  const screen = reviewScreen({ view: { ...VIEW, guide: null }, onGuide: () => events.push('guide'), onPrev() {}, onPlayAgain: () => {} })
  assert.equal((await shownBody(screen)).hintR, undefined)
  screen.onInput({ kind: 'swipeDown' })
  assert.deepEqual(events, [])
})

test('guide: the correction; swipe up back to Review; swipe down to the next finding; tap is Play again', async () => {
  const events = []
  const screen = guideScreen({ view: VIEW, onReview: () => events.push('review'), onNext: () => events.push('next'), onPlayAgain: () => events.push('again') })
  assert.equal((await shownBody(screen)).body, VIEW.guide)
  screen.onInput({ kind: 'swipeUp' })
  screen.onInput({ kind: 'swipeDown' })
  screen.onInput({ kind: 'tap' })
  assert.deepEqual(events, ['review', 'next', 'again'])
})

test('guide of the last finding ignores swipe down', () => {
  const events = []
  const screen = guideScreen({ view: { ...VIEW, index: 2 }, onReview() {}, onNext: () => events.push('next'), onPlayAgain() {} })
  screen.onInput({ kind: 'swipeDown' })
  assert.deepEqual(events, [])
})

test('guide with a coaching visual shows the keyboard image and legend', async () => {
  const { glasses, bridge } = fakeGlasses()
  const screen = guideScreen({
    view: VIEW,
    onReview() {}, onNext() {}, onPlayAgain() {},
    visual: { legend: 'Expected E4 · Heard F4', render: async () => new Uint8Array([1, 2, 3]) },
  })
  mount(screen, glasses)
  await settle()
  const [page] = bridge.callsTo('createStartUpPageContainer')
  assert.equal(page.imageObject.length, 1)
  assert.equal(page.imageObject[0].containerName, 'keys')
  assert.deepEqual(bridge.callsTo('updateImageRawData').map(u => u.containerName), ['keys'])
  assert.equal(textByName(bridge).legend, 'Expected E4 · Heard F4')
})

test('guide without a visual stays text-only and sends no image', async () => {
  const { glasses, bridge } = fakeGlasses()
  mount(guideScreen({ view: VIEW, onReview() {}, onNext() {}, onPlayAgain() {} }), glasses)
  await settle()
  const [page] = bridge.callsTo('createStartUpPageContainer')
  assert.equal(page.imageObject?.length ?? 0, 0)
  assert.equal(bridge.callsTo('updateImageRawData').length, 0)
  assert.equal(textByName(bridge).legend, undefined)
})

test('a visual that renders nothing sends no image', async () => {
  const { glasses, bridge } = fakeGlasses()
  const screen = guideScreen({
    view: VIEW,
    onReview() {}, onNext() {}, onPlayAgain() {},
    visual: { legend: '', render: async () => null },
  })
  mount(screen, glasses)
  await settle()
  assert.equal(bridge.callsTo('updateImageRawData').length, 0)
})

test('error: a plain reason, never a musical claim; tap or double tap is Play again', async () => {
  const events = []
  const screen = errorScreen({ title: 'Little Echo', message: "Can't reach the server.", onPlayAgain: () => events.push('again') })
  assert.equal((await shownBody(screen)).body, "Couldn't finish this take.\nCan't reach the server.")
  screen.onInput({ kind: 'tap' })
  screen.onInput({ kind: 'doubleTap' })
  assert.deepEqual(events, ['again', 'again'])
})
