import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionStore, fixtureAnalysis, fixtureCoaching } from '../../mobile/src/session.ts'
import { startController } from '../src/controller.ts'
import { fakeGlasses, settle, textByName } from './fakes.mjs'

const tiles = async () => ({ left: new Uint8Array([1]), right: new Uint8Array([2]), hasClef: true })

function memory() {
  let value = null
  return { getItem: () => value, setItem: (_key, next) => (value = next) }
}

// Demo-style session actions, like startPhoneApp's demo source.
function demoActions(store, { startWorks = true } = {}) {
  return {
    async start() {
      if (startWorks) store.start('demo')
    },
    async stop() {
      const record = store.stop()
      if (!record) return
      store.applyAnalysis(record.attemptId, fixtureAnalysis(record, 'mistakes'))
      store.applyCoaching(record.attemptId, fixtureCoaching(store.records.find(r => r.attemptId === record.attemptId)))
    },
    cancel() {
      store.cancel()
    },
  }
}

function setup(options) {
  const { glasses, bridge } = fakeGlasses()
  const store = new SessionStore(memory())
  let exits = 0
  const controller = startController({
    glasses,
    store,
    actions: demoActions(store, options),
    sheetMusic: () => true,
    menu: () => undefined,
    onExit: () => exits++,
    renderTiles: tiles,
  })
  const input = async (kind, extra = {}) => {
    controller.onInput({ kind, ...extra })
    await settle()
  }
  const pages = () => bridge.callsTo('createStartUpPageContainer').length + bridge.callsTo('rebuildPageContainer').length
  return { store, bridge, controller, input, pages, exits: () => exits }
}

test('glasses start on Selection; picking a passage there opens it on the phone too', async () => {
  const { store, controller, input } = setup()
  await settle()
  assert.equal(controller.current.name, 'selection')
  await input('listSelect', { index: 1 })
  assert.equal(store.state.screen, 'ready')
  assert.equal(store.state.passageId, 'P02')
  assert.equal(controller.current.name, 'ready')
})

test('a passage picked on the phone opens Ready on the glasses', async () => {
  const { store, controller, bridge } = setup()
  store.selectPassage('P03')
  await settle()
  assert.equal(controller.current.name, 'ready')
  assert.equal(textByName(bridge).titleL, 'Open Windows')
})

test('full loop from the glasses: record, stop, Review cards, Play again', async () => {
  const { store, controller, input, bridge } = setup()
  await input('listSelect', { index: 0 })
  await input('tap')
  assert.equal(store.state.screen, 'recording')
  assert.equal(textByName(bridge).rec, '■')
  await input('tap')
  assert.equal(store.state.screen, 'review')
  assert.equal(controller.current.name, 'review')
  // Fixture results are labelled on the glasses too (spec §9).
  assert.match(textByName(bridge).counter, /^DEMO/)
  // No Guide state on G2: swipes page cards inside Review; tap is replay.
  await input('swipeDown')
  await input('tap')
  assert.equal(store.state.screen, 'review')
  assert.equal(controller.current.name, 'review')
  await input('doubleTap')
  assert.equal(store.state.screen, 'library')
  assert.equal(controller.current.name, 'selection')
  assert.equal(store.count(), 1)
})

test('glasses discard: not counted, back to Ready for the same passage, in place', async () => {
  const { store, controller, input, pages } = setup()
  await input('listSelect', { index: 1 })
  await input('tap')
  const before = pages()
  await input('doubleTap')
  assert.equal(store.records[0].captureStatus, 'canceled')
  assert.equal(store.count(), 0)
  assert.equal(store.state.screen, 'ready')
  assert.equal(store.state.passageId, 'P02')
  assert.equal(controller.current.name, 'ready')
  assert.equal(pages(), before) // no Selection flash, no rebuild
})

test('recording started and canceled on the phone is mirrored on the glasses', async () => {
  const { store, controller, bridge } = setup()
  store.selectPassage('P01')
  store.start('demo')
  await settle()
  assert.equal(controller.current.name, 'recording')
  assert.equal(textByName(bridge).rec, '■')
  store.cancel()
  await settle()
  assert.equal(controller.current.name, 'selection')
})

test('a start that does not record puts the glasses back on Ready', async () => {
  const { store, controller, input, bridge } = setup({ startWorks: false })
  await input('listSelect', { index: 0 })
  await input('tap')
  assert.equal(store.state.screen, 'ready')
  assert.equal(controller.current.name, 'ready')
  assert.equal(textByName(bridge).hintL, 'tap  ●')
})

test('a processing error shows a plain reason; tap returns to Selection', async () => {
  const { store, controller, input, bridge } = setup()
  store.selectPassage('P01')
  const record = store.start('demo')
  store.stop()
  await settle()
  assert.equal(controller.current.name, 'analyzing')
  store.fail(record.attemptId, 'upload', "Can't reach the server.")
  await settle()
  assert.equal(controller.current.name, 'problem')
  assert.equal(textByName(bridge).reason, "Can't reach the server.")
  await input('tap')
  assert.equal(store.state.screen, 'library')
})

test('Analyzing shows the phone pipeline stage and updates it in place', async () => {
  const { store, controller, bridge, pages } = setup()
  store.selectPassage('P01')
  const record = store.start('phone')
  store.stop()
  store.setProcessingStage(record.attemptId, 'upload')
  await settle()
  assert.equal(controller.current.name, 'analyzing')
  assert.equal(textByName(bridge).stage, 'Uploading recording')
  const before = pages()
  store.setProcessingStage(record.attemptId, 'analysis')
  await settle()
  assert.equal(textByName(bridge).stage, 'Analyzing notes')
  assert.equal(pages(), before)
})

test('unclear audio is a Review card, not an error', async () => {
  const { store, controller, bridge } = setup()
  store.selectPassage('P01')
  const record = store.start('demo')
  store.stop()
  store.applyAnalysis(record.attemptId, fixtureAnalysis(record, 'uncertain'))
  await settle()
  assert.equal(store.state.screen, 'review')
  assert.equal(controller.current.name, 'review')
  assert.equal(textByName(bridge).title, 'Audio unclear')
})

test('browsing History on the phone leaves the glasses on Selection without redrawing', async () => {
  const { store, pages } = setup()
  await settle()
  const before = pages()
  store.showHistory()
  await settle()
  assert.equal(pages(), before)
})

test('a passage picked on the glasses while the phone shows History opens it', async () => {
  const { store, input } = setup()
  store.showHistory()
  await input('listSelect', { index: 2 })
  assert.equal(store.state.screen, 'ready')
  assert.equal(store.state.passageId, 'P03')
})

test("the phone's Guide, sheet and finding changes keep the glasses Review card", async () => {
  const { store, input, pages, controller } = setup()
  await input('listSelect', { index: 0 })
  await input('tap')
  await input('tap')
  const before = pages()
  store.moveFinding(1)
  store.showGuide()
  store.showSheet()
  store.closeSheet()
  await settle()
  assert.equal(pages(), before)
  assert.equal(controller.current.name, 'review')
})

test('double tap on Selection asks to exit', async () => {
  const { input, exits } = setup()
  await input('doubleTap')
  assert.equal(exits(), 1)
})
