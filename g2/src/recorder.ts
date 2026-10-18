import { AudioInputSource } from '@evenrealities/even_hub_sdk'
import type { Glasses } from './glasses.ts'
import type { Passage } from './passages.ts'
import { status } from './status.ts'
import { pcmToWav, type PcmFormat } from './wav.ts'

// G2 mic output per the official Even Hub ASR template: s16le, 16 kHz, mono.
// The SDK does not report it, so each take also records the byte rate it
// actually received, letting the analysis side catch a wrong assumption.
export const G2_PCM: PcmFormat = { sampleRate: 16000, channels: 1, bitsPerSample: 16 }
const BYTES_PER_SECOND = (G2_PCM.sampleRate * G2_PCM.channels * G2_PCM.bitsPerSample) / 8

export type Take = {
  attemptId: string
  passageId: string
  passageVersion: string
  startedAt: string
  completedAt: string
  format: PcmFormat
  durationSec: number
  // Bytes received per wall-clock second of capture; ~32000 if the format holds.
  measuredBytesPerSec: number
  chunkCount: number
  clippedSampleCount: number
  wav: Uint8Array<ArrayBuffer>
}

function newAttemptId() {
  return crypto.randomUUID?.() ?? `att-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// One explicitly started capture (spec §5: one attempt ID per capture).
// Audio frames reach `push` from the app's event listener while active.
export class Recorder {
  attemptId: string = newAttemptId()
  private readonly startedAt = new Date()
  private firstChunkAt = 0
  private lastChunkAt = 0
  private chunks: Uint8Array[] = []
  private bytes = 0
  private active = true

  private readonly glasses: Glasses
  private readonly passage: Passage

  private constructor(glasses: Glasses, passage: Passage) {
    this.glasses = glasses
    this.passage = passage
  }

  // The app forwards every audio event here; frames outside a take are dropped.
  private static current: Recorder | null = null

  static feed(pcm: Uint8Array) {
    Recorder.current?.push(pcm)
  }

  static async start(glasses: Glasses, passage: Passage): Promise<Recorder> {
    const recorder = new Recorder(glasses, passage)
    Recorder.current = recorder
    const ok = await glasses
      .enqueue('mic on', () => glasses.bridge.audioControl(true, AudioInputSource.Glasses))
      .catch(() => false)
    if (!ok) {
      Recorder.current = null
      throw new Error('glasses microphone did not start')
    }
    status(`glasses microphone active (${passage.id}; assumed 16 kHz mono PCM16)`)
    return recorder
  }

  bindAttemptId(attemptId: string): void {
    if (!this.active) throw new Error('Cannot bind a completed take.')
    this.attemptId = attemptId
    status(`recording ${attemptId} (${this.passage.id})`)
  }

  private push(pcm: Uint8Array) {
    if (!this.active || pcm.length === 0) return
    const now = performance.now()
    if (!this.firstChunkAt) this.firstChunkAt = now
    this.lastChunkAt = now
    // The bridge may reuse its buffer; keep a copy.
    this.chunks.push(pcm.slice())
    this.bytes += pcm.length
  }

  // Stop and keep the take. Safe to call once; later calls are ignored.
  async stop(): Promise<Take | null> {
    if (!this.active) return null
    this.active = false
    Recorder.current = null
    await this.micOff()

    const durationSec = this.bytes / BYTES_PER_SECOND
    const wallSec = (this.lastChunkAt - this.firstChunkAt) / 1000
    const measuredBytesPerSec = wallSec > 0.5 ? Math.round(this.bytes / wallSec) : 0
    const wav = pcmToWav(this.chunks, G2_PCM)
    const samples = new DataView(wav.buffer)
    let clippedSampleCount = 0
    for (let offset = 44; offset + 1 < wav.length; offset += 2) {
      if (Math.abs(samples.getInt16(offset, true)) >= 32760) clippedSampleCount++
    }
    status(
      `take ${this.attemptId}: ${durationSec.toFixed(1)}s, ${this.chunks.length} chunks, ` +
        `${measuredBytesPerSec || '?'} B/s measured (expect ${BYTES_PER_SECOND}), ` +
        `${clippedSampleCount} near-limit samples`,
    )
    if (this.bytes % 2) status('odd PCM byte count: format may not be 16-bit', 'error')
    if (measuredBytesPerSec && measuredBytesPerSec < BYTES_PER_SECOND * 0.8)
      status('measured byte rate is low; capture timing or missing frames are possible', 'error')

    return {
      attemptId: this.attemptId,
      passageId: this.passage.id,
      passageVersion: this.passage.version,
      startedAt: this.startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      format: G2_PCM,
      durationSec,
      measuredBytesPerSec,
      chunkCount: this.chunks.length,
      clippedSampleCount,
      wav,
    }
  }

  // Throw the take away: never saved, counted or submitted.
  async discard() {
    if (!this.active) return
    this.active = false
    Recorder.current = null
    this.chunks = []
    try { await this.micOff() } catch { /* diagnostic already shown; no take is retained */ }
    status(`discarded ${this.attemptId}`)
  }

  private async micOff() {
    const confirmed = await this.glasses
      .enqueue('mic off', () => this.glasses.bridge.audioControl(false))
      .catch(() => false)
    if (!confirmed) {
      status('microphone did not confirm stop', 'error')
      throw new Error('microphone stop was not confirmed')
    }
  }
}
