import test from 'node:test'
import assert from 'node:assert/strict'
import { PASSAGES } from '../src/passages.ts'
import { G2_PCM, Recorder } from '../src/recorder.ts'
import { pcmToWav } from '../src/wav.ts'
import { fakeGlasses } from './fakes.mjs'

const LITTLE_ECHO = PASSAGES.find(passage => passage.id === 'P02')

function readWavHeader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (offset, length) => String.fromCharCode(...bytes.slice(offset, offset + length))
  return {
    riff: ascii(0, 4),
    riffSize: view.getUint32(4, true),
    wave: ascii(8, 4),
    fmt: ascii(12, 4),
    audioFormat: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    data: ascii(36, 4),
    dataSize: view.getUint32(40, true),
  }
}

test('WAV header describes 16 kHz mono s16 PCM and the samples follow untouched', () => {
  const chunks = [new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6])]
  const wav = pcmToWav(chunks, G2_PCM)
  assert.deepEqual(readWavHeader(wav), {
    riff: 'RIFF',
    riffSize: 36 + 6,
    wave: 'WAVE',
    fmt: 'fmt ',
    audioFormat: 1,
    channels: 1,
    sampleRate: 16000,
    byteRate: 32000,
    blockAlign: 2,
    bitsPerSample: 16,
    data: 'data',
    dataSize: 6,
  })
  assert.deepEqual([...wav.slice(44)], [1, 2, 3, 4, 5, 6])
})

test('a take turns the mic on, keeps fed audio, and turns it off', async () => {
  const { glasses, bridge } = fakeGlasses()
  const recorder = await Recorder.start(glasses, LITTLE_ECHO)
  Recorder.feed(new Uint8Array(32000)) // one second of s16 mono at 16 kHz
  Recorder.feed(new Uint8Array(16000))
  const take = await recorder.stop()

  assert.deepEqual(
    bridge.callsTo('audioControl').map(call => call.isOpen),
    [true, false],
  )
  assert.equal(take.attemptId, recorder.attemptId)
  assert.equal(take.passageId, 'P02')
  assert.equal(take.passageVersion, LITTLE_ECHO.version)
  assert.equal(take.durationSec, 1.5)
  assert.equal(take.chunkCount, 2)
  assert.equal(take.wav.length, 44 + 48000)
})

test('the bridge may reuse its buffer, so fed audio is copied', async () => {
  const { glasses } = fakeGlasses()
  const recorder = await Recorder.start(glasses, LITTLE_ECHO)
  const buffer = new Uint8Array([7, 7])
  Recorder.feed(buffer)
  buffer.fill(0)
  const take = await recorder.stop()
  assert.deepEqual([...take.wav.slice(44)], [7, 7])
})

test('audio outside a take is ignored', async () => {
  const { glasses } = fakeGlasses()
  Recorder.feed(new Uint8Array(100)) // before any take
  const recorder = await Recorder.start(glasses, LITTLE_ECHO)
  Recorder.feed(new Uint8Array(4))
  const take = await recorder.stop()
  Recorder.feed(new Uint8Array(100)) // after the take
  assert.equal(take.wav.length, 44 + 4)
})

test('each take gets its own attempt ID', async () => {
  const { glasses } = fakeGlasses()
  const first = await Recorder.start(glasses, LITTLE_ECHO)
  await first.stop()
  const second = await Recorder.start(glasses, LITTLE_ECHO)
  await second.stop()
  assert.notEqual(first.attemptId, second.attemptId)
})

test('stop is idempotent: a duplicate stop yields no second take', async () => {
  const { glasses } = fakeGlasses()
  const recorder = await Recorder.start(glasses, LITTLE_ECHO)
  assert.ok(await recorder.stop())
  assert.equal(await recorder.stop(), null)
})

test('a discarded take keeps nothing and turns the mic off', async () => {
  const { glasses, bridge } = fakeGlasses()
  const recorder = await Recorder.start(glasses, LITTLE_ECHO)
  Recorder.feed(new Uint8Array(10))
  await recorder.discard()
  assert.equal(await recorder.stop(), null)
  assert.deepEqual(
    bridge.callsTo('audioControl').map(call => call.isOpen),
    [true, false],
  )
})

test('a mic that refuses to start is reported and leaves no active take', async () => {
  const { glasses } = fakeGlasses({ micOk: false })
  await assert.rejects(Recorder.start(glasses, LITTLE_ECHO), /microphone did not start/)
  // Nothing is listening for audio afterwards.
  Recorder.feed(new Uint8Array(10))
})
