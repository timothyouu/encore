import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionStore, fixtureAnalysis, fixtureCoaching } from '../../mobile/src/session.ts'
import { startController } from '../src/controller.ts'
import { demoReview } from '../src/demo.ts'
import { calculateDisplaySegments } from '../../shared/segments.ts'
import { PASSAGES } from '../src/passages.ts'
import { fakeGlasses, settle, textByName } from './fakes.mjs'

const tiles = async () => ({ left: new Uint8Array([1]), right: new Uint8Array([2]), hasClef: true })

function memory() {
  let value = null
  return { getItem: () => value, setItem: (_key, next) => (value = next) }
}

// Demo-style session actions, like startPhoneApp's demo source.
function demoActions(store, { startWorks = true, coachAll = false } = {}) {
  return {
    async start() {
      if (startWorks) store.start('demo')
    },
    async stop() {
      const record = store.stop()
      if (!record) return
      store.applyAnalysis(record.attemptId, fixtureAnalysis(record, 'mistakes'))
      const saved = store.records.find(r => r.attemptId === record.attemptId)
      const coaching = fixtureCoaching(saved)
      if (coachAll) {
        coaching.evidenceFindingIds = saved.analysis.findings.map(finding => finding.id)
        coaching.visual.referenceNoteIds = [...new Set(saved.analysis.findings.map(finding => finding.referenceNoteId).filter(Boolean))]
        coaching.visual.mistakes = saved.analysis.findings.map(finding => ({ findingId: finding.id,
          ...(finding.referenceNoteId && { referenceNoteId: finding.referenceNoteId }),
          ...(finding.detectedNoteId && { detectedNoteId: finding.detectedNoteId }),
        }))
      }
      store.applyCoaching(record.attemptId, coaching)
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
    renderArt: options?.renderArt ?? (async () => new Uint8Array([83])),
    renderFrame: options?.renderFrame ?? (async (_card, step, context) => {
      options?.onFrame?.(step, context)
      return new Uint8Array([step.layer === 'played' ? 80 : 87])
    }),
    frameDwellMs: 0,
    gallery: options?.gallery,
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

test('explicit DEV gallery presents fixture cards and returns to the shared Library without an attempt', async () => {
  const { store, controller, input, bridge } = setup({ gallery: demoReview() })
  await settle()
  assert.equal(controller.current.name, 'review')
  assert.match(textByName(bridge).counter, /DEMO/)
  assert.equal(store.records.length, 0)
  await input('doubleTap')
  assert.equal(controller.current.name, 'selection')
  assert.equal(store.state.screen, 'library')
  assert.equal(store.records.length, 0)
})

test('a passage picked on the phone opens Ready on the glasses', async () => {
  const { store, controller, bridge } = setup()
  store.selectPassage('P03')
  await settle()
  assert.equal(controller.current.name, 'ready')
  assert.equal(textByName(bridge).titleL, 'Open Windows')
})

test('full loop from the glasses: record, stop, evidence cards, replay, Play again', async () => {
  const { store, controller, input, bridge } = setup()
  await input('listSelect', { index: 0 })
  await input('tap')
  assert.equal(store.state.screen, 'recording')
  assert.equal(textByName(bridge).rec, '■')
  await input('tap')
  assert.equal(store.state.screen, 'review')
  assert.equal(controller.current.name, 'review')
  assert.match(textByName(bridge).title, /Beat 6 · missed note/)
  assert.match(textByName(bridge).phase, /^Review/)
  assert.match(textByName(bridge).counter, /Demo · local cue/)
  assert.equal(bridge.callsTo('updateImageRawData').at(-1).containerName, 'art')
  await input('swipeDown')
  assert.equal(store.state.screen, 'guide')
  assert.match(textByName(bridge).cue, /Finger 4 \(score\)/)
  assert.match(textByName(bridge).counter, /1 \/ 3/)
  await input('swipeDown')
  assert.equal(store.state.screen, 'review')
  assert.match(textByName(bridge).counter, /2 \/ 3/)
  await input('swipeUp')
  assert.equal(store.state.screen, 'guide')
  assert.match(textByName(bridge).title, /Beat 6 · missed note/)
  await input('tap')
  assert.equal(store.state.screen, 'guide')
  assert.ok(bridge.callsTo('updateImageRawData').some(update => update.imageData[0] === 80))
  await input('doubleTap')
  assert.equal(store.state.screen, 'library')
  assert.equal(controller.current.name, 'selection')
  assert.equal(store.count(), 1)
})

test('a saved coached finding adds one grounded key frame in Guide before the written correction', async () => {
  const frames = []
  const { input } = setup({ coachAll: true, onFrame: (step, context) => frames.push({ step, context }) })
  await input('listSelect', { index: 0 })
  await input('tap')
  await input('tap')
  // Review tap opens this finding's Guide; the next tap replays it.
  await input('tap')
  await input('tap')
  const contextFrames = frames.filter(({ step }) => step.art === 'context')
  assert.equal(contextFrames.length, 1)
  assert.equal(contextFrames[0].context.kind, 'missing_note')
  assert.equal(contextFrames[0].context.expected.label, 'F4')
  assert.equal(contextFrames[0].context.played, undefined)
  assert.equal(frames.at(-1).step.layer, 'written')
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

test('moving between findings on the phone updates the glasses Review', async () => {
  const { store, input, bridge } = setup()
  await input('listSelect', { index: 0 })
  await input('tap')
  await input('tap')
  assert.equal(store.records[0].analysis.findings[0].kind, 'wrong_note')
  assert.match(textByName(bridge).title, /missed note/)
  store.moveFinding(1)
  await settle()
  assert.match(textByName(bridge).title, /Beat 3 · wrong note/)
  store.showGuide()
  await settle()
  assert.equal(store.state.screen, 'guide')
  // The same pair opens from the phone and exposes its own correction.
  assert.match(textByName(bridge).cue, /Finger 3 \(score\)/)
})

test('double tap on Selection asks to exit', async () => {
  const { input, exits } = setup()
  await input('doubleTap')
  assert.equal(exits(), 1)
})

function saveSegmentedAttempt(store) {
  store.selectPassage('P01')
  const record = store.start('demo')
  store.stop()
  const passage = PASSAGES[0]
  const analysis = fixtureAnalysis(record, 'mistakes')
  analysis.findings.push(
    { id: 'more-1', kind: 'missing_note', referenceNoteId: passage.notes[0].id },
    { id: 'more-2', kind: 'missing_note', referenceNoteId: passage.notes[7].id },
  )
  Object.assign(analysis, { schemaVersion: '2', ...calculateDisplaySegments(passage, analysis.findings,
    analysis.detectedNotes, analysis.attemptTempoBpm, analysis.alignment) })
  assert.equal(store.applyAnalysis(record.attemptId, analysis), true)
  const coaching = fixtureCoaching(record)
  coaching.schemaVersion = '2'
  coaching.primarySegmentId = analysis.findings[0].segmentIds[0]
  assert.equal(store.applyCoaching(record.attemptId, coaching), true)
  return record
}

test('segmented G2 navigation visits every finding/bar pair as Review then Guide, and reverses exactly', async () => {
  const { store, input, controller, bridge } = setup()
  saveSegmentedAttempt(store)
  await settle()
  const entries = store.entries()
  assert.equal(entries.length, 5)
  const forward = []
  for (let position = 0; position < entries.length * 2; position++) {
    const index = Math.floor(position / 2)
    const phase = position % 2 ? 'guide' : 'review'
    const entry = entries[index]
    assert.equal(controller.current.name, phase)
    assert.equal(store.selectedEntry().finding.id, entry.finding.id)
    assert.equal(store.selectedEntry().segment.id, entry.segment.id)
    assert.match(textByName(bridge).phase, new RegExp(`^${phase === 'guide' ? 'Guide' : 'Review'} · Bar ${entry.segment.startBar}`))
    forward.push(`${phase}:${entry.finding.id}:${entry.segment.id}`)
    if (phase === 'review') {
      const title = textByName(bridge).title
      const positionText = textByName(bridge).phase.replace('Review', '')
      await input('swipeDown')
      assert.equal(textByName(bridge).title, title)
      assert.equal(textByName(bridge).phase.replace('Guide', ''), positionText)
    } else if (position < entries.length * 2 - 1) await input('swipeDown')
  }
  await input('swipeDown')
  assert.equal(store.state.findingIndex, entries.length - 1)
  assert.equal(store.state.screen, 'guide')
  const backward = []
  for (let position = forward.length - 1; position >= 0; position--) {
    backward.push(`${store.state.screen}:${store.selectedEntry().finding.id}:${store.selectedEntry().segment.id}`)
    await input('swipeUp')
  }
  assert.deepEqual(backward, [...forward].reverse())
  assert.equal(store.state.findingIndex, 0)
  assert.equal(store.state.screen, 'review')
})

test('paired saved History results and replay remain read-only; Play again returns to Selection', async () => {
  const { store, input, controller, bridge } = setup()
  const record = saveSegmentedAttempt(store)
  const snapshot = JSON.stringify(store.records)
  store.showHistory()
  store.openAttempt(record.attemptId)
  await settle()
  assert.match(textByName(bridge).phase, /^Saved Review/)
  const selected = store.selectedEntry()
  await input('tap')
  assert.equal(store.state.screen, 'guide')
  assert.deepEqual(store.selectedEntry(), selected)
  assert.match(textByName(bridge).phase, /^Saved Guide/)
  await input('tap')
  await input('swipeDown')
  await input('swipeUp')
  assert.equal(JSON.stringify(store.records), snapshot)
  await input('doubleTap')
  assert.equal(controller.current.name, 'selection')
  assert.equal(store.state.screen, 'library')
  assert.equal(store.count(), 1)
  assert.equal(JSON.stringify(store.records), snapshot)
})

test('leaving a Guide while its replay renders cancels late images and captions', async () => {
  let release
  const { store, input, bridge } = setup({ renderFrame: () => new Promise(resolve => { release = resolve }) })
  saveSegmentedAttempt(store)
  await settle()
  await input('swipeDown')
  await input('tap')
  assert.equal(typeof release, 'function')
  await input('swipeDown')
  const title = textByName(bridge).title
  release(new Uint8Array([99]))
  await settle()
  assert.equal(store.state.screen, 'review')
  assert.equal(store.state.findingIndex, 1)
  assert.equal(textByName(bridge).title, title)
  assert.equal(bridge.callsTo('updateImageRawData').some(update => update.imageData[0] === 99), false)
  assert.equal(textByName(bridge).replay, 'tap  guide')
})
