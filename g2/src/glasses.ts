import {
  CreateStartUpPageContainer,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  type EvenAppBridge,
  type ImageContainerProperty,
  type ListContainerProperty,
} from '@evenrealities/even_hub_sdk'
import { status } from './status'

export type Page = {
  textObject?: TextContainerProperty[]
  listObject?: ListContainerProperty[]
  imageObject?: ImageContainerProperty[]
}

const STARTUP_RESULT: Record<number, string> = {
  0: 'success',
  1: 'invalid',
  2: 'oversize',
  3: 'out of memory',
}

function errorPage(message: string) {
  return {
    containerTotalNum: 1,
    textObject: [
      new TextContainerProperty({
        xPosition: 0,
        yPosition: 0,
        width: 576,
        height: 288,
        borderWidth: 0,
        borderColor: 0,
        paddingLength: 8,
        containerID: 1,
        containerName: 'error',
        content: message,
        isEventCapture: 1,
      }),
    ],
  }
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
    this.chain = run.catch(error => status(`${label}: ${String(error)}`, 'error'))
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
        status(`glasses: startup page → ${result} (${STARTUP_RESULT[result] ?? 'unknown'})`)
        if (result === 0) return

        // The glasses stay on the loading screen until a startup page succeeds,
        // so try a bare text page that names the failure.
        const fallback = await this.bridge.createStartUpPageContainer(
          new CreateStartUpPageContainer(errorPage(`Encore could not draw this screen (code ${result}).`)),
        )
        status(`glasses: fallback page → ${fallback}`)
        if (fallback === 0) return
        // Both refused: a WebView reload keeps the glasses session alive, so the
        // startup page may already exist. Fall through and rebuild instead.
      }
      const ok = await this.bridge.rebuildPageContainer(
        new RebuildPageContainer({ containerTotalNum, ...page }),
      )
      if (!ok) {
        status('glasses: rebuild page failed', 'error')
        throw new Error('rebuildPageContainer failed')
      }
    })
  }

  // Image sends take ~0.5–2s over BLE and must never overlap; the queue
  // guarantees that. `stillWanted` is checked right before sending so a frame
  // queued for a screen the player already left is dropped.
  updateImage(container: { id: number; name: string }, imageData: Uint8Array, stillWanted: () => boolean) {
    return this.enqueue(`image ${container.name}`, async () => {
      if (!stillWanted()) return
      const result = await this.bridge.updateImageRawData(
        new ImageRawDataUpdate({ containerID: container.id, containerName: container.name, imageData }),
      )
      if (result !== ImageRawDataUpdateResult.success) {
        status(`image ${container.name}: ${result}`, 'error')
      }
    })
  }

  // Flicker-free content change; the ID and name must match the live container.
  updateText(container: { id: number; name: string }, content: string) {
    return this.enqueue(`text ${container.name}`, async () => {
      const ok = await this.bridge.textContainerUpgrade(
        new TextContainerUpgrade({ containerID: container.id, containerName: container.name, content }),
      )
      if (!ok) status(`text ${container.name}: update failed`, 'error')
    })
  }

  // Even app storage persists across app restarts. It shares the BLE queue.
  readStorage(key: string): Promise<string> {
    return this.enqueue(`read ${key}`, () => this.bridge.getLocalStorage(key))
  }

  writeStorage(key: string, value: string): Promise<boolean> {
    return this.enqueue(`write ${key}`, () => this.bridge.setLocalStorage(key, value))
  }

  // exitMode 1 shows the system confirmation dialog; cleanup happens on SYSTEM_EXIT_EVENT.
  requestExit(): Promise<boolean> {
    return this.enqueue('shutDown', () => this.bridge.shutDownPageContainer(1))
  }
}
