import test from 'node:test'
import assert from 'node:assert/strict'
import { SHEET_MUSIC_MENU_ITEM, loadSettings, saveSettings, sheetMusicMenu } from '../src/settings.ts'
import { fakeGlasses, settle } from './fakes.mjs'

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
