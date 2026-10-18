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
    renderKeys: async () => new Uint8Array([7]),
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

test('full loop from the glasses: record, stop, Review, Guide and back, Play again', async () => {
  const { store, controller, input, bridge } = setup()
  await input('listSelect', { index: 0 })
  await input('tap')
  assert.equal(store.state.screen, 'recording')
  assert.equal(textByName(bridge).rec, '■')
  await input('tap')
  assert.equal(store.state.screen, 'review')
  assert.equal(controller.current.name, 'review')
  // Same order as the phone (visual plan): the missing note comes first.
  assert.equal(textByName(bridge).body, 'Beat 6 · Missing note  (1 of 3)\nExpected F4 · Not detected\nPlay F4 on beat 6.')
  assert.equal(textByName(bridge).titleR, 'Demo')
  await input('swipeDown')
  assert.equal(store.state.screen, 'guide')
  assert.equal(controller.current.name, 'guide')
  await input('swipeUp')
  assert.equal(store.state.screen, 'review')
  await input('tap')
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
  assert.equal(controller.current.name, 'error')
  assert.equal(textByName(bridge).body, "Couldn't finish this take.\nCan't reach the server.")
  await input('tap')
  assert.equal(store.state.screen, 'library')
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

test('swipes page through the findings: Guide of one, Review of the next', async () => {
  const { store, input } = setup()
  await input('listSelect', { index: 0 })
  await input('tap')
  await input('tap')
  assert.equal(store.state.screen, 'review')
  assert.equal(store.state.findingIndex, 0)
  await input('swipeDown') // → Guide of finding 1
  assert.equal(store.state.screen, 'guide')
  assert.equal(store.state.findingIndex, 0)
  await input('swipeDown') // → Review of finding 2
  assert.equal(store.state.screen, 'review')
  assert.equal(store.state.findingIndex, 1)
  await input('swipeDown') // → Guide of finding 2
  assert.equal(store.state.screen, 'guide')
  assert.equal(store.state.findingIndex, 1)
  await input('swipeUp') // back → Review of finding 2
  assert.equal(store.state.screen, 'review')
  assert.equal(store.state.findingIndex, 1)
  await input('swipeUp') // previous page → Guide of finding 1
  assert.equal(store.state.screen, 'guide')
  assert.equal(store.state.findingIndex, 0)
})

test('swipe down on the last finding\'s Guide does not leave the result', async () => {
  const { store, input } = setup()
  await input('listSelect', { index: 0 })
  await input('tap')
  await input('tap')
  store.moveFinding(1)
  store.moveFinding(1) // third of three
  await settle()
  assert.equal(store.state.findingIndex, 2)
  await input('swipeDown') // → Guide of finding 3
  assert.equal(store.state.screen, 'guide')
  await input('swipeDown') // nothing after it
  assert.equal(store.state.screen, 'guide')
  assert.equal(store.state.findingIndex, 2)
})

test('a swipe down while the phone sheet is open closes it into Guide', async () => {
  const { store, input } = setup()
  await input('listSelect', { index: 0 })
  await input('tap')
  await input('tap')
  store.showSheet()
  await settle()
  assert.equal(store.state.screen, 'sheet')
  await input('swipeDown')
  assert.equal(store.state.screen, 'guide')
})

test('moving between findings on the phone updates the glasses Review', async () => {
  const { store, input, bridge } = setup()
  await input('listSelect', { index: 0 })
  await input('tap')
  await input('tap')
  store.moveFinding(1)
  await settle()
  // The coaching cue appears with the finding it cites.
  assert.equal(textByName(bridge).body, 'Beat 3 · Note mismatch  (2 of 3)\nExpected E4 · Heard F4\nTry the highlighted key, then play the phrase again.')
})

test('double tap on Selection asks to exit', async () => {
  const { input, exits } = setup()
  await input('doubleTap')
  assert.equal(exits(), 1)
})
