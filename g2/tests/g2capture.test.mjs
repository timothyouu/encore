import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionStore, fixtureAnalysis, fixtureCoaching } from '../../mobile/src/session.ts'
import { G2Capture, MAX_TAKE_MS } from '../src/g2capture.ts'
import { Recorder } from '../src/recorder.ts'
import { fakeGlasses, settle } from './fakes.mjs'

const ENDPOINTS = { analysis: 'https://analysis.test/v1/analyze', coaching: 'https://coach.test/v1/coach' }
const micStates = bridge => bridge.callsTo('audioControl').map(call => call.isOpen)

function memory() {
  let value = null
  return { getItem: () => value, setItem: (_key, next) => (value = next) }
}

function setup({ micOk = true, glassesConnected = true } = {}) {
  const { glasses, bridge } = fakeGlasses({ micOk })
  const store = new SessionStore(memory())
  store.selectPassage('P02')
  let changes = 0
  const capture = new G2Capture(store, ENDPOINTS, () => changes++, () => (glassesConnected ? glasses : null))
  return { store, capture, bridge, changes: () => changes }
}

// Answers like the real services, using the store's own fixtures for valid shapes.
function services(t, store, { analysisStatus = 200 } = {}) {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options })
    const record = store.records.at(-1)
    if (url === ENDPOINTS.analysis) {
      if (analysisStatus !== 200) return new Response('', { status: analysisStatus })
      return Response.json(fixtureAnalysis(record, 'mistakes'))
    }
    return Response.json(fixtureCoaching(record))
  })
  return requests
}

async function record(capture, seconds = 1) {
  await capture.start()
  Recorder.feed(new Uint8Array(32000 * seconds))
}

test('a G2 take becomes one completed g2 attempt with analysis and coaching', async t => {
  const { store, capture, bridge } = setup()
  const requests = services(t, store)
  await record(capture)
  assert.equal(store.state.screen, 'recording')
  assert.equal(store.records[0].captureSource, 'g2')
  await capture.stop()

  assert.deepEqual(micStates(bridge), [true, false])
  assert.equal(store.count(), 1)
  assert.equal(store.records[0].processingStatus, 'result')
  assert.equal(store.state.screen, 'review')
  assert.deepEqual(requests.map(request => request.url), [ENDPOINTS.analysis, ENDPOINTS.coaching])
  const form = requests[0].options.body
  assert.equal(form.get('audio').type, 'audio/wav')
  const metadata = JSON.parse(form.get('metadata'))
  assert.equal(metadata.attemptId, store.records[0].attemptId)
  assert.equal(metadata.captureSource, 'g2')
  assert.equal(metadata.encoding, 'pcm_s16le')
  assert.equal(metadata.sampleRateHz, 16000)
  assert.equal(metadata.channelCount, 1)
  assert.equal(metadata.durationMs, 1000)
})

test('the attempt exists only once the mic is on; a mic that fails records nothing', async () => {
  const { store, capture } = setup({ micOk: false })
  await capture.start()
  assert.equal(store.records.length, 0)
  assert.equal(store.state.screen, 'ready')
  assert.equal(capture.error, 'The glasses microphone did not start.')
  assert.equal(capture.busy, false)
})

test('without glasses there is no capture and the phone is told why', async () => {
  const { store, capture } = setup({ glassesConnected: false })
  await capture.start()
  assert.equal(store.records.length, 0)
  assert.equal(capture.error, 'Glasses are not connected.')
})

test('duplicate starts and stops make one attempt and one submission', async t => {
  const { store, capture } = setup()
  const requests = services(t, store)
  await Promise.all([capture.start(), capture.start()])
  Recorder.feed(new Uint8Array(32000))
  await Promise.all([capture.stop(), capture.stop()])
  assert.equal(store.records.length, 1)
  assert.equal(requests.filter(request => request.url === ENDPOINTS.analysis).length, 1)
})

test('cancel while recording discards the take: mic off, not counted, not submitted', async t => {
  const { store, capture, bridge } = setup()
  const requests = services(t, store)
  await record(capture)
  capture.cancel()
  await settle()
  assert.deepEqual(micStates(bridge), [true, false])
  assert.equal(store.records[0].captureStatus, 'canceled')
  assert.equal(store.count(), 0)
  assert.equal(requests.length, 0)
})

test('cancel while the mic is starting leaves no attempt and turns the mic back off', async () => {
  const { store, capture, bridge } = setup()
  const starting = capture.start()
  capture.cancel()
  await starting
  await settle()
  assert.equal(store.records.length, 0)
  assert.deepEqual(micStates(bridge), [true, false])
})

test('an empty take is a capture error, not a musical result', async t => {
  const { store, capture } = setup()
  const requests = services(t, store)
  await capture.start()
  await capture.stop()
  assert.equal(store.records[0].processingStatus, 'error')
  assert.equal(store.records[0].error.stage, 'capture')
  assert.equal(store.count(), 1)
  assert.equal(requests.length, 0)
})

test('an unreachable analysis service keeps the completed attempt with an upload error', async t => {
  const { store, capture } = setup()
  services(t, store, { analysisStatus: 503 })
  await record(capture)
  await capture.stop()
  assert.equal(store.count(), 1)
  assert.equal(store.records[0].error.stage, 'upload')
  assert.equal(store.state.screen, 'error')
})

test('a take stops by itself at 30s', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { store, capture } = setup()
  services(t, store)
  await record(capture)
  t.mock.timers.tick(MAX_TAKE_MS)
  await settle()
  assert.equal(store.records[0].captureStatus, 'completed')
})

test('closing the app mid-take turns the mic off and keeps an interrupted attempt', async () => {
  const { store, capture, bridge } = setup()
  await record(capture)
  capture.dispose()
  await settle()
  assert.deepEqual(micStates(bridge), [true, false])
  assert.equal(store.records[0].captureStatus, 'interrupted')
  assert.equal(store.count(), 0)
})
