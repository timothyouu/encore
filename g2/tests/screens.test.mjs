import test from 'node:test'
import assert from 'node:assert/strict'
import { PASSAGES } from '../src/passages.ts'
import { readyScreen } from '../src/screens/ready.ts'
import { savingScreen } from '../src/screens/saving.ts'
import { selectionScreen } from '../src/screens/selection.ts'
import { fakeGlasses, mount, settle, textByName } from './fakes.mjs'

const LITTLE_ECHO = PASSAGES.find(passage => passage.id === 'P02')
const tiles = async () => ({ left: new Uint8Array([1]), right: new Uint8Array([2]), hasClef: true })
const micStates = bridge => bridge.callsTo('audioControl').map(call => call.isOpen)

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

function ready({ sheetMusic = true, renderTiles = tiles, micOk = true } = {}) {
  const { glasses, bridge } = fakeGlasses({ micOk })
  const takes = []
  let backs = 0
  const screen = readyScreen({
    passage: LITTLE_ECHO,
    sheetMusic: () => sheetMusic,
    onTake: take => takes.push(take),
    onBack: () => backs++,
    renderTiles,
  })
  const ctx = mount(screen, glasses)
  return { screen, ctx, bridge, takes, backs: () => backs }
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

test('ready: double tap goes back without touching the mic', async () => {
  const { screen, bridge, backs } = ready()
  screen.onInput({ kind: 'doubleTap' })
  await settle()
  assert.equal(backs(), 1)
  assert.deepEqual(micStates(bridge), [])
})

test('recording (sheet music on): text swaps in place, staff stays, no rebuild or image send', async () => {
  const { screen, ctx, bridge } = ready({ sheetMusic: true })
  await settle()
  const imagesBefore = bridge.callsTo('updateImageRawData').length
  screen.onInput({ kind: 'tap' })
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
  assert.deepEqual(micStates(bridge), [true])
  assert.equal(screen.name, 'recording')
  assert.equal(screen.allowsMenu, false)
})

test('recording (sheet music off): rebuilds to just ■ and the hints, with no images', async () => {
  const { screen, ctx, bridge } = ready({ sheetMusic: false })
  await settle()
  screen.onInput({ kind: 'tap' })
  await settle()
  assert.equal(ctx.redraws, 1)
  const [page] = bridge.callsTo('rebuildPageContainer')
  assert.equal(page.imageObject?.length ?? 0, 0)
  assert.deepEqual(
    page.textObject.map(t => t.content.trim()).filter(Boolean),
    ['■', 'tap  ■', '2×  discard'],
  )
})

test('recording: tap stops and hands over exactly one take for this passage', async () => {
  const { screen, bridge, takes } = ready()
  screen.onInput({ kind: 'tap' })
  await settle()
  screen.onInput({ kind: 'tap' })
  screen.onInput({ kind: 'tap' }) // a duplicate stop while stopping
  await settle()
  assert.equal(takes.length, 1)
  assert.equal(takes[0].passageId, 'P02')
  assert.deepEqual(micStates(bridge), [true, false])
})

test('recording: double tap discards and restores Ready in place, with no take', async () => {
  const { screen, ctx, bridge, takes } = ready({ sheetMusic: true })
  await settle()
  screen.onInput({ kind: 'tap' })
  await settle()
  screen.onInput({ kind: 'doubleTap' })
  await settle()
  assert.equal(takes.length, 0)
  assert.deepEqual(micStates(bridge), [true, false])
  assert.equal(ctx.redraws, 0)
  const shown = textByName(bridge)
  assert.equal(shown.titleL, 'Little Echo')
  assert.equal(shown.hintL, 'tap  ●')
  assert.equal(shown.rec.trim(), '')
  assert.equal(screen.allowsMenu, true)
})

test('recording (sheet music off): discard rebuilds Ready and resends the staff', async () => {
  const { screen, ctx, bridge } = ready({ sheetMusic: false })
  await settle()
  screen.onInput({ kind: 'tap' })
  await settle()
  screen.onInput({ kind: 'doubleTap' })
  await settle()
  assert.equal(ctx.redraws, 2)
  assert.equal(bridge.callsTo('updateImageRawData').length, 4)
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

test('taps while the mic is starting are ignored (no second start, no instant stop)', async () => {
  const { screen, bridge, takes } = ready()
  screen.onInput({ kind: 'tap' })
  screen.onInput({ kind: 'tap' })
  screen.onInput({ kind: 'doubleTap' })
  await settle()
  assert.deepEqual(micStates(bridge), [true])
  assert.equal(takes.length, 0)
  assert.equal(screen.name, 'recording')
})

test('a mic that fails to start returns to Ready', async () => {
  const { screen, bridge, takes } = ready({ micOk: false })
  await settle()
  screen.onInput({ kind: 'tap' })
  await settle()
  assert.equal(screen.name, 'ready')
  assert.equal(textByName(bridge).hintL, 'tap  ●')
  assert.equal(takes.length, 0)
})

test('a take stops by itself at 30s', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { screen, takes } = ready()
  screen.onInput({ kind: 'tap' })
  await settle()
  t.mock.timers.tick(30000)
  await settle()
  assert.equal(takes.length, 1)
})

test('closing the app mid-take discards it and turns the mic off', async () => {
  const { screen, bridge, takes } = ready()
  screen.onInput({ kind: 'tap' })
  await settle()
  screen.dispose()
  await settle()
  assert.deepEqual(micStates(bridge), [true, false])
  assert.equal(takes.length, 0)
})

// ── Saving (interim 04) ────────────────────────────────────────────────

function saving(result) {
  const { glasses, bridge } = fakeGlasses()
  const events = []
  let resolveUpload
  const screen = savingScreen({
    take: { durationSec: 2.4 },
    upload: () => new Promise(resolve => (resolveUpload = () => resolve(result))),
    onSaved: () => events.push('saved'),
    onFailed: () => events.push('failed'),
  })
  const ctx = mount(screen, glasses)
  return { screen, ctx, bridge, events, finish: () => resolveUpload() }
}

test('saving: shows progress, ignores input until the upload settles, and blocks the menu', async () => {
  const { screen, bridge, events } = saving({ ok: true })
  await settle()
  assert.equal(textByName(bridge).message, 'Saving take…')
  assert.equal(screen.allowsMenu, false)
  screen.onInput({ kind: 'tap' })
  screen.onInput({ kind: 'doubleTap' })
  assert.deepEqual(events, [])
})

test('saving: success says so, then tap continues to selection', async () => {
  const { screen, bridge, events, finish } = saving({ ok: true })
  finish()
  await settle()
  assert.equal(textByName(bridge).message, 'Take saved · 2.4s')
  screen.onInput({ kind: 'doubleTap' })
  screen.onInput({ kind: 'tap' })
  assert.deepEqual(events, ['saved'])
})

test('saving: failure gives the plain reason, then tap or double tap goes back to Ready', async () => {
  for (const kind of ['tap', 'doubleTap']) {
    const { screen, bridge, events, finish } = saving({ ok: false, reason: "Can't reach the server." })
    finish()
    await settle()
    assert.equal(textByName(bridge).message, "Couldn't save the take.\nCan't reach the server.")
    screen.onInput({ kind })
    assert.deepEqual(events, ['failed'], kind)
  }
})

test('saving: a result arriving after the player left does not redraw', async () => {
  const { ctx, bridge, finish } = saving({ ok: true })
  ctx.active = false
  finish()
  await settle()
  assert.equal(bridge.callsTo('textContainerUpgrade').length, 0)
})
