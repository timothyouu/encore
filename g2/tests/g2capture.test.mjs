import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionStore } from '../../mobile/src/session.ts'
import { G2Capture, MAX_TAKE_MS } from '../src/g2capture.ts'
import { Recorder } from '../src/recorder.ts'
import { fakeGlasses, settle } from './fakes.mjs'

const micStates = bridge => bridge.callsTo('audioControl').map(call => call.isOpen)

function memory() {
  let value = null
  return { getItem: () => value, setItem: (_key, next) => (value = next) }
}

// The phone pipeline (normalize, upload, analyze, coach) is tested in mobile;
// here it is a stand-in that records what the G2 source hands over.
function setup({ micOk = true, glassesConnected = true } = {}) {
  const { glasses, bridge } = fakeGlasses({ micOk })
  const store = new SessionStore(memory())
  store.selectPassage('P02')
  const submitted = []
  const submit = async (record, audio) => {
    submitted.push({ record, audio })
  }
  const capture = new G2Capture({ store, submit, onChange() {} }, () => (glassesConnected ? glasses : null))
  return { store, capture, bridge, submitted }
}

async function record(capture, seconds = 1) {
  await capture.start()
  Recorder.feed(new Uint8Array(32000 * seconds))
}

test('a G2 take becomes one completed g2 attempt handed to the phone pipeline as WAV', async () => {
  const { store, capture, bridge, submitted } = setup()
  await record(capture)
  assert.equal(store.state.screen, 'recording')
  assert.equal(store.records[0].captureSource, 'g2')
  await capture.stop()

  assert.deepEqual(micStates(bridge), [true, false])
  assert.equal(store.count(), 1)
  assert.equal(submitted.length, 1)
  assert.equal(submitted[0].record.attemptId, store.records[0].attemptId)
  assert.equal(new DataView((await submitted[0].audio.arrayBuffer())).getUint32(24, true), 16000)
  assert.equal(submitted[0].record.captureStatus, 'completed')
  assert.equal(submitted[0].audio.type, 'audio/wav')
  const bytes = new Uint8Array(await submitted[0].audio.arrayBuffer())
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'RIFF')
  assert.equal(new DataView(bytes.buffer).getUint32(24, true), 16000) // G2's actual rate; the pipeline resamples
  assert.equal(bytes.length, 44 + 32000)
  assert.equal(capture.busy, false)
})

test('the attempt exists only once the mic is on; a mic that fails records nothing', async () => {
  const { store, capture, submitted } = setup({ micOk: false })
  await capture.start()
  assert.equal(store.records.length, 0)
  assert.equal(store.state.screen, 'ready')
  assert.equal(capture.error, 'The glasses microphone did not start.')
  assert.equal(capture.busy, false)
  assert.equal(submitted.length, 0)
})

test('without glasses there is no capture and the phone is told why', async () => {
  const { store, capture } = setup({ glassesConnected: false })
  await capture.start()
  assert.equal(store.records.length, 0)
  assert.equal(capture.error, 'Glasses are not connected.')
})

test('duplicate starts and stops make one attempt and one submission', async () => {
  const { store, capture, submitted } = setup()
  await Promise.all([capture.start(), capture.start()])
  Recorder.feed(new Uint8Array(32000))
  await Promise.all([capture.stop(), capture.stop()])
  assert.equal(store.records.length, 1)
  assert.equal(submitted.length, 1)
})

test('cancel while recording discards the take: mic off, not counted, not submitted', async () => {
  const { store, capture, bridge, submitted } = setup()
  await record(capture)
  capture.cancel()
  await settle()
  assert.deepEqual(micStates(bridge), [true, false])
  assert.equal(store.records[0].captureStatus, 'canceled')
  assert.equal(store.count(), 0)
  assert.equal(submitted.length, 0)
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

test('mic-off without confirmation interrupts and never submits a take', async () => {
  const { store, capture, bridge, submitted } = setup()
  const original = bridge.audioControl.bind(bridge)
  bridge.audioControl = (isOpen, source) => isOpen ? original(isOpen, source) : Promise.resolve(false)
  await record(capture)
  await capture.stop()
  assert.equal(store.records[0].captureStatus, 'interrupted')
  assert.equal(store.count(), 0)
  assert.equal(submitted.length, 0)
  assert.match(capture.error, /stop was not confirmed/)
})

test('an empty take is canceled, not counted, and is not submitted', async () => {
  const { store, capture, submitted } = setup()
  await capture.start()
  await capture.stop()
  assert.equal(store.records[0].captureStatus, 'canceled')
  assert.equal(store.count(), 0)
  assert.equal(submitted.length, 0)
})

test('odd-byte PCM is canceled before a completed attempt is counted', async () => {
  const { store, capture, submitted } = setup()
  await capture.start()
  Recorder.feed(new Uint8Array([1, 2, 3]))
  await capture.stop()
  assert.equal(store.records[0].captureStatus, 'canceled')
  assert.equal(store.count(), 0)
  assert.equal(submitted.length, 0)
  assert.match(capture.error, /Invalid PCM byte count/)
})

test('cancel during pending mic-off never submits or counts the take', async () => {
  const { store, capture, bridge, submitted } = setup()
  const original = bridge.audioControl.bind(bridge)
  let release
  bridge.audioControl = (isOpen, source) => isOpen ? original(isOpen, source) :
    new Promise(resolve => { release = async () => resolve(await original(isOpen, source)) })
  await record(capture)
  const stopping = capture.stop()
  await settle()
  capture.cancel()
  assert.equal(store.count(), 0)
  assert.equal(submitted.length, 0)
  await release()
  await stopping
  assert.equal(store.records[0].captureStatus, 'canceled')
  assert.equal(submitted.length, 0)
})

test('a take stops by itself at 30s', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { store, capture, submitted } = setup()
  await record(capture)
  t.mock.timers.tick(MAX_TAKE_MS)
  await settle()
  assert.equal(store.records[0].captureStatus, 'completed')
  assert.equal(submitted.length, 1)
})

test('closing the app mid-take turns the mic off and keeps an interrupted attempt', async () => {
  const { store, capture, bridge, submitted } = setup()
  await record(capture)
  capture.dispose()
  await settle()
  assert.deepEqual(micStates(bridge), [true, false])
  assert.equal(store.records[0].captureStatus, 'interrupted')
  assert.equal(store.count(), 0)
  assert.equal(submitted.length, 0)
})
