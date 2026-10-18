// Stand-ins for the Even bridge so screens and transport run without glasses.
import { Glasses } from '../src/glasses.ts'

export class FakeBridge {
  constructor({ startupResult = 0, rebuildOk = true, micOk = true, storage = {} } = {}) {
    this.calls = []
    this.startupResults = Array.isArray(startupResult) ? [...startupResult] : [startupResult]
    this.rebuildOk = rebuildOk
    this.micOk = micOk
    this.storage = { ...storage }
  }

  record(name, arg) {
    this.calls.push({ name, arg })
  }

  callsTo(name) {
    return this.calls.filter(call => call.name === name).map(call => call.arg)
  }

  async createStartUpPageContainer(container) {
    this.record('createStartUpPageContainer', container)
    return this.startupResults.length > 1 ? this.startupResults.shift() : this.startupResults[0]
  }

  async rebuildPageContainer(container) {
    this.record('rebuildPageContainer', container)
    return this.rebuildOk
  }

  async textContainerUpgrade(update) {
    this.record('textContainerUpgrade', update)
    return true
  }

  async updateImageRawData(update) {
    this.record('updateImageRawData', update)
    return 'success'
  }

  async audioControl(isOpen, source) {
    this.record('audioControl', { isOpen, source })
    return isOpen ? this.micOk : true
  }

  async getLocalStorage(key) {
    this.record('getLocalStorage', key)
    return this.storage[key] ?? ''
  }

  async setLocalStorage(key, value) {
    this.record('setLocalStorage', { key, value })
    this.storage[key] = value
    return true
  }

  async shutDownPageContainer(mode) {
    this.record('shutDownPageContainer', mode)
    return true
  }
}

export function fakeGlasses(options) {
  const bridge = new FakeBridge(options)
  return { bridge, glasses: new Glasses(bridge) }
}

// Lets queued bridge calls and promise chains run to completion.
export async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i++) await new Promise(resolve => setImmediate(resolve))
}

// Text currently shown per container name, from the last page plus later upgrades.
export function textByName(bridge) {
  const shown = {}
  for (const { name, arg } of bridge.calls) {
    if (name === 'createStartUpPageContainer' || name === 'rebuildPageContainer') {
      for (const key of Object.keys(shown)) delete shown[key]
      for (const t of arg.textObject ?? []) shown[t.containerName] = t.content
    } else if (name === 'textContainerUpgrade') {
      shown[arg.containerName] = arg.content
    }
  }
  return shown
}

// Runs a screen the way main.ts does: render its page, then enter().
export function mount(screen, glasses) {
  const ctx = {
    glasses,
    active: true,
    isActive: () => ctx.active,
    redraws: 0,
    redraw: () => {
      ctx.redraws += 1
      glasses.showPage(screen.page())
      screen.enter?.(ctx)
    },
  }
  glasses.showPage(screen.page())
  screen.enter?.(ctx)
  return ctx
}
