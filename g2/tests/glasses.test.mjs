import test from 'node:test'
import assert from 'node:assert/strict'
import { Glasses } from '../src/glasses.ts'
import { fakeGlasses, settle } from './fakes.mjs'

test('the first page uses createStartUpPageContainer once; later pages rebuild', async () => {
  const { glasses, bridge } = fakeGlasses()
  await glasses.showPage({ textObject: [] })
  await glasses.showPage({ textObject: [] })
  await glasses.showPage({ textObject: [] })
  assert.equal(bridge.callsTo('createStartUpPageContainer').length, 1)
  assert.equal(bridge.callsTo('rebuildPageContainer').length, 2)
})

test('containerTotalNum counts text, list and image containers', async () => {
  const { glasses, bridge } = fakeGlasses()
  await glasses.showPage({ textObject: [{}, {}], listObject: [{}], imageObject: [{}, {}] })
  assert.equal(bridge.callsTo('createStartUpPageContainer')[0].containerTotalNum, 5)
})

test('a refused startup page falls back to a text page naming the code', async () => {
  const { glasses, bridge } = fakeGlasses({ startupResult: [1, 0] })
  await glasses.showPage({ textObject: [] })
  const [, fallback] = bridge.callsTo('createStartUpPageContainer')
  assert.match(fallback.textObject[0].content, /code 1/)
  assert.equal(bridge.callsTo('rebuildPageContainer').length, 0)
})

test('if startup and fallback are both refused (WebView reload), it rebuilds', async () => {
  const { glasses, bridge } = fakeGlasses({ startupResult: 1 })
  await glasses.showPage({ textObject: [] })
  assert.equal(bridge.callsTo('createStartUpPageContainer').length, 2)
  assert.equal(bridge.callsTo('rebuildPageContainer').length, 1)
})

test('bridge calls never overlap, even when issued together', async () => {
  let inFlight = 0
  let maxInFlight = 0
  const slow = async () => {
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise(resolve => setTimeout(resolve, 5))
    inFlight -= 1
  }
  const glasses = new Glasses({})
  await Promise.all([glasses.enqueue('a', slow), glasses.enqueue('b', slow), glasses.enqueue('c', slow)])
  assert.equal(maxInFlight, 1)
})

test('a hung call times out after 5s and the queue keeps moving', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const glasses = new Glasses({})
  const hung = glasses.enqueue('hung', () => new Promise(() => {}))
  const next = glasses.enqueue('next', async () => 'ran')
  await settle()
  t.mock.timers.tick(5000)
  await assert.rejects(hung, /hung timed out/)
  assert.equal(await next, 'ran')
})

test('an image queued for a screen the player has left is not sent', async () => {
  const { glasses, bridge } = fakeGlasses()
  let wanted = true
  const first = glasses.updateImage({ id: 10, name: 'staffL' }, new Uint8Array([1]), () => wanted)
  const second = glasses.updateImage({ id: 11, name: 'staffR' }, new Uint8Array([2]), () => wanted)
  wanted = false
  await Promise.all([first, second])
  assert.equal(bridge.callsTo('updateImageRawData').length, 0)
})

test('text updates address the container by ID and name', async () => {
  const { glasses, bridge } = fakeGlasses()
  await glasses.updateText({ id: 3, name: 'value' }, 'Off')
  const [update] = bridge.callsTo('textContainerUpgrade')
  assert.equal(update.containerID, 3)
  assert.equal(update.containerName, 'value')
  assert.equal(update.content, 'Off')
})

test('exit asks for the system confirmation dialog', async () => {
  const { glasses, bridge } = fakeGlasses()
  await glasses.requestExit()
  assert.deepEqual(bridge.callsTo('shutDownPageContainer'), [1])
})
