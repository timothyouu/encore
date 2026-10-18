import type { Glasses } from './glasses'
import { status } from './status'

// Spec §5 display settings. Display only: never part of attempt data,
// analysis, coaching or recording counts.
export type DisplaySettings = {
  schemaVersion: '1'
  showSheetMusicWhilePlaying: boolean
}

const STORAGE_KEY = 'encore.displaySettings'
const DEFAULTS: DisplaySettings = { schemaVersion: '1', showSheetMusicWhilePlaying: true }

export async function loadSettings(glasses: Glasses): Promise<DisplaySettings> {
  try {
    const raw = await glasses.readStorage(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw)
    if (parsed?.schemaVersion === '1' && typeof parsed.showSheetMusicWhilePlaying === 'boolean') {
      return { schemaVersion: '1', showSheetMusicWhilePlaying: parsed.showSheetMusicWhilePlaying }
    }
    status('stored settings unreadable; using defaults', 'error')
  } catch (error) {
    status(`settings load failed: ${String(error)}`, 'error')
  }
  return { ...DEFAULTS }
}

export function saveSettings(glasses: Glasses, settings: DisplaySettings) {
  glasses.writeStorage(STORAGE_KEY, JSON.stringify(settings)).then(ok => {
    if (!ok) status('settings save failed', 'error')
  }, () => {})
}
