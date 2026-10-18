import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  type EvenAppBridge,
  type ImageContainerProperty,
  type ListContainerProperty,
  type TextContainerProperty,
} from '@evenrealities/even_hub_sdk'

export type Page = {
  textObject?: TextContainerProperty[]
  listObject?: ListContainerProperty[]
  imageObject?: ImageContainerProperty[]
}

// A flaky BLE hop can hang a call for ~30s; cap each one so the queue keeps moving.
const CALL_TIMEOUT_MS = 5000

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), CALL_TIMEOUT_MS),
    ),
  ])
}

// Serializes every bridge call. Concurrent render/storage calls can drop the
// connection, so nothing talks to the glasses except through this queue.
export class Glasses {
  private chain: Promise<unknown> = Promise.resolve()
  private started = false

  constructor(readonly bridge: EvenAppBridge) {}

  enqueue<T>(label: string, call: () => Promise<T>): Promise<T> {
    const run = this.chain.then(() => withTimeout(call(), label))
    this.chain = run.catch(error => console.error(`[encore] ${label}:`, String(error)))
    return run
  }

  // The first page must go through createStartUpPageContainer exactly once;
  // every later layout change is a rebuild.
  showPage(page: Page): Promise<void> {
    const containerTotalNum =
      (page.textObject?.length ?? 0) + (page.listObject?.length ?? 0) + (page.imageObject?.length ?? 0)

    return this.enqueue('showPage', async () => {
      if (!this.started) {
        this.started = true
        const result = await this.bridge.createStartUpPageContainer(
          new CreateStartUpPageContainer({ containerTotalNum, ...page }),
        )
        if (result === 0) return
        // A WebView reload keeps the glasses session alive, so the startup
        // page may already exist; fall through and rebuild instead.
        console.warn(`[encore] createStartUpPageContainer returned ${result}; rebuilding`)
      }
      const ok = await this.bridge.rebuildPageContainer(
        new RebuildPageContainer({ containerTotalNum, ...page }),
      )
      if (!ok) throw new Error('rebuildPageContainer failed')
    })
  }

  // exitMode 1 shows the system confirmation dialog; cleanup happens on SYSTEM_EXIT_EVENT.
  requestExit(): Promise<boolean> {
    return this.enqueue('shutDown', () => this.bridge.shutDownPageContainer(1))
  }
}
