import test from 'node:test'
import assert from 'node:assert/strict'
import { G2_PCM } from '../src/recorder.ts'
import { SHEET_MUSIC_MENU_ITEM, loadSettings, saveSettings, sheetMusicMenu } from '../src/settings.ts'
import { isValidUploadUrl, loadUploadUrl, saveUploadUrl, uploadTake } from '../src/upload.ts'
import { pcmToWav } from '../src/wav.ts'
import { fakeGlasses, settle } from './fakes.mjs'

const URL_OK = 'https://api.example/v1/recordings'

function take() {
  return {
    attemptId: 'att-1',
    passageId: 'P02',
    passageVersion: '1',
    startedAt: '2026-10-18T06:00:00.000Z',
    completedAt: '2026-10-18T06:00:03.000Z',
    format: G2_PCM,
    durationSec: 2.4,
    measuredBytesPerSec: 33086,
    chunkCount: 24,
    wav: pcmToWav([new Uint8Array([1, 2, 3, 4])], G2_PCM),
  }
}

test('uploads one multipart POST with the WAV and the attempt metadata', async t => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push({ url, init })
    return new Response('{}', { status: 200 })
  })
  const result = await uploadTake(URL_OK, take())
  assert.deepEqual(result, { ok: true })
  assert.equal(requests.length, 1)

  const { url, init } = requests[0]
  assert.equal(url, URL_OK)
  assert.equal(init.method, 'POST')
  const audio = init.body.get('audio')
  assert.equal(audio.name, 'att-1.wav')
  assert.equal(audio.type, 'audio/wav')
  assert.equal(audio.size, 44 + 4)

  const metadata = JSON.parse(init.body.get('metadata'))
  assert.deepEqual(metadata, {
    attemptId: 'att-1',
    passageId: 'P02',
    passageVersion: '1',
    startedAt: '2026-10-18T06:00:00.000Z',
    completedAt: '2026-10-18T06:00:03.000Z',
    format: { sampleRate: 16000, channels: 1, bitsPerSample: 16 },
    durationSec: 2.4,
    measuredBytesPerSec: 33086,
    chunkCount: 24,
    captureSource: 'g2',
    encoding: 'pcm_s16le',
    sampleRate: 16000,
    channels: 1,
  })
})

test('failures give a plain reason for the glasses', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 500 }))
  assert.deepEqual(await uploadTake(URL_OK, take()), { ok: false, reason: 'The server answered 500.' })

  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('Load failed')
  })
  assert.deepEqual(await uploadTake(URL_OK, take()), { ok: false, reason: "Can't reach the server." })
})

test('no upload URL means no request at all', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(''))
  assert.deepEqual(await uploadTake('', take()), { ok: false, reason: 'No upload URL is set on the phone.' })
  assert.equal(fetch.mock.callCount(), 0)
})

test('an upload that hangs is abandoned after 30s', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.mock.method(globalThis, 'fetch', (_url, init) =>
    new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
  )
  const pending = uploadTake(URL_OK, take())
  await settle()
  t.mock.timers.tick(30000)
  assert.deepEqual(await pending, { ok: false, reason: 'The upload timed out.' })
})

test('only http(s) URLs are accepted', () => {
  assert.ok(isValidUploadUrl('https://api.example/x'))
  assert.ok(isValidUploadUrl('http://172.20.10.7:8787/v1/recordings'))
  assert.equal(isValidUploadUrl('ftp://api.example/x'), false)
  assert.equal(isValidUploadUrl('not a url'), false)
  assert.equal(isValidUploadUrl(''), false)
})

test('the upload URL round-trips through Even app storage', async () => {
  const { glasses } = fakeGlasses()
  assert.equal(await loadUploadUrl(glasses), '')
  await saveUploadUrl(glasses, URL_OK)
  assert.equal(await loadUploadUrl(glasses), URL_OK)
})

test('display settings default to showing sheet music', async () => {
  const { glasses } = fakeGlasses()
  assert.deepEqual(await loadSettings(glasses), { schemaVersion: '1', showSheetMusicWhilePlaying: true })
})

test('display settings persist and reload', async () => {
  const { glasses, bridge } = fakeGlasses()
  saveSettings(glasses, { schemaVersion: '1', showSheetMusicWhilePlaying: false })
  await settle()
  assert.equal(JSON.parse(bridge.storage['encore.displaySettings']).showSheetMusicWhilePlaying, false)
  assert.equal((await loadSettings(glasses)).showSheetMusicWhilePlaying, false)
})

test('unreadable stored settings fall back to defaults', async () => {
  for (const stored of ['{not json', '{"schemaVersion":"2","showSheetMusicWhilePlaying":false}', '{"schemaVersion":"1"}']) {
    const { glasses } = fakeGlasses({ storage: { 'encore.displaySettings': stored } })
    assert.equal((await loadSettings(glasses)).showSheetMusicWhilePlaying, true, stored)
  }
})

test('the system menu item is a verb for what selecting it will do', () => {
  const label = show => sheetMusicMenu({ schemaVersion: '1', showSheetMusicWhilePlaying: show }).menuItems[0]
  assert.deepEqual(
    { id: label(true).itemID, name: label(true).itemName },
    { id: SHEET_MUSIC_MENU_ITEM, name: 'Hide sheet music' },
  )
  assert.equal(label(false).itemName, 'Show sheet music')
})
