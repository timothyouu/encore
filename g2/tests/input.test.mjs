import test from 'node:test'
import assert from 'node:assert/strict'
import { filterInputs, toInput } from '../src/input.ts'

// SDK OsEventTypeList values.
const CLICK = 0, SCROLL_TOP = 1, SCROLL_BOTTOM = 2, DOUBLE = 3, FG_ENTER = 4, FG_EXIT = 5
const ABNORMAL_EXIT = 6, SYSTEM_EXIT = 7, LONG_PRESS = 9, LONG_RELEASE = 10

test('a tap arrives with eventType omitted (protobuf zero) and still reads as a tap', () => {
  assert.deepEqual(toInput({ sysEvent: { eventSource: 1 } }), { kind: 'tap' })
  assert.deepEqual(toInput({ sysEvent: { eventType: CLICK } }), { kind: 'tap' })
  assert.deepEqual(toInput({ textEvent: {} }), { kind: 'tap' })
})

test('an event with no envelope is not a tap', () => {
  assert.equal(toInput({}), null)
  assert.equal(toInput({ jsonData: {} }), null)
})

test('list clicks carry the selected index; index 0 arrives omitted', () => {
  assert.deepEqual(toInput({ listEvent: { currentSelectItemIndex: 2 } }), { kind: 'listSelect', index: 2 })
  assert.deepEqual(toInput({ listEvent: { containerID: 2 } }), { kind: 'listSelect', index: 0 })
})

test('double tap is recognised in every envelope', () => {
  for (const envelope of ['sysEvent', 'textEvent', 'listEvent']) {
    assert.deepEqual(toInput({ [envelope]: { eventType: DOUBLE } }), { kind: 'doubleTap' }, envelope)
  }
})

test('swipes on a text container map to up/down', () => {
  assert.deepEqual(toInput({ textEvent: { eventType: SCROLL_TOP } }), { kind: 'swipeUp' })
  assert.deepEqual(toInput({ textEvent: { eventType: SCROLL_BOTTOM } }), { kind: 'swipeDown' })
})

test('long press start and release are separate inputs', () => {
  assert.deepEqual(toInput({ sysEvent: { eventType: LONG_PRESS } }), { kind: 'longPress' })
  assert.deepEqual(toInput({ sysEvent: { eventType: LONG_RELEASE } }), { kind: 'longPressRelease' })
})

test('system menu selections carry the item ID', () => {
  assert.deepEqual(toInput({ menuItemClickEvent: { itemID: 1 } }), { kind: 'menuItem', itemID: 1 })
})

test('lifecycle events', () => {
  assert.deepEqual(toInput({ sysEvent: { eventType: FG_ENTER } }), { kind: 'foreground' })
  assert.equal(toInput({ sysEvent: { eventType: FG_EXIT } }), null)
  assert.deepEqual(toInput({ sysEvent: { eventType: SYSTEM_EXIT } }), { kind: 'exit' })
  assert.deepEqual(toInput({ sysEvent: { eventType: ABNORMAL_EXIT } }), { kind: 'exit' })
})

function filtered() {
  const seen = []
  return { seen, send: filterInputs(input => seen.push(input.kind)) }
}

test('a gesture repeated within 250ms is dropped, but not after', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 })
  const { seen, send } = filtered()
  send({ kind: 'tap' })
  t.mock.timers.tick(100)
  send({ kind: 'tap' })
  t.mock.timers.tick(300)
  send({ kind: 'tap' })
  assert.deepEqual(seen, ['tap', 'tap'])
})

test('taps and list clicks during a long press, or just after release, are dropped', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 })
  const { seen, send } = filtered()
  send({ kind: 'longPress' })
  t.mock.timers.tick(300)
  send({ kind: 'tap' }) // the simulator sends one of these with a hold
  send({ kind: 'listSelect', index: 1 })
  send({ kind: 'longPressRelease' })
  t.mock.timers.tick(200)
  send({ kind: 'tap' })
  t.mock.timers.tick(500)
  send({ kind: 'tap' })
  assert.deepEqual(seen, ['longPress', 'tap'])
})

test('double tap and swipes still pass during a hold', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 })
  const { seen, send } = filtered()
  send({ kind: 'longPress' })
  send({ kind: 'doubleTap' })
  send({ kind: 'swipeDown' })
  assert.deepEqual(seen, ['longPress', 'doubleTap', 'swipeDown'])
})

test('a hold whose release never arrives stops blocking taps after 4s', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 })
  const { seen, send } = filtered()
  send({ kind: 'longPress' })
  t.mock.timers.tick(3700)
  send({ kind: 'tap' }) // still held: dropped
  t.mock.timers.tick(400) // past 4s and past the duplicate window
  send({ kind: 'tap' })
  assert.deepEqual(seen, ['longPress', 'tap'])
})
