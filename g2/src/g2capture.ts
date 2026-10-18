import type { CaptureDriver } from '../../mobile/src/app.ts'
import { submitAttempt, type CaptureEndpoints, type SubmissionStage } from '../../mobile/src/capture.ts'
import type { AttemptRecord, SessionStore } from '../../mobile/src/session.ts'
import type { Glasses } from './glasses.ts'
import { PASSAGES } from './passages.ts'
import { Recorder } from './recorder.ts'
import { status } from './status.ts'

// Spec §8: bound clip duration. Seed passages last 8 beats (≤ 8s at 60 bpm).
export const MAX_TAKE_MS = 30000

type Stage = 'capture' | 'upload' | 'analysis' | 'coaching'

// The G2 microphone as a recording source for the phone session (CONTRACT.md).
// Phone buttons and glasses taps both arrive here through the phone app, so
// there is one take at a time and one attempt record per take. The mic is
// turned on before the attempt exists: a mic that never starts records nothing.
export class G2Capture implements CaptureDriver {
  busy = false
  recording = false
  error: string | null = null

  private recorder: Recorder | null = null
  private autoStop: ReturnType<typeof setTimeout> | undefined
  private request: AbortController | null = null
  private requestStage: SubmissionStage = 'upload'
  private activeAttemptId: string | null = null
  // Bumped by cancel/dispose so late mic or network results are ignored.
  private generation = 0
  private disposed = false

  private readonly store: SessionStore
  private readonly endpoints: CaptureEndpoints
  private readonly onChange: () => void
  private readonly glasses: () => Glasses | null

  constructor(store: SessionStore, endpoints: CaptureEndpoints, onChange: () => void, glasses: () => Glasses | null) {
    this.store = store
    this.endpoints = endpoints
    this.onChange = onChange
    this.glasses = glasses
  }

  async start(): Promise<void> {
    if (this.disposed || this.busy || this.recording || this.store.state.screen !== 'ready') return
    const glasses = this.glasses()
    const passage = PASSAGES.find(item => item.id === this.store.state.passageId)
    if (!glasses || !passage) {
      this.error = glasses ? 'The selected passage is unavailable.' : 'Glasses are not connected.'
      this.onChange()
      return
    }
    this.error = null
    this.busy = true
    const generation = ++this.generation
    const readyState = this.store.state
    this.onChange()
    try {
      const recorder = await Recorder.start(glasses, passage)
      // Canceled, closed or navigated away while the mic was starting.
      if (generation !== this.generation || this.disposed || this.store.state !== readyState) {
        await recorder.discard()
        return
      }
      const record = this.store.start('g2')
      if (!record) {
        await recorder.discard()
        throw new Error('The passage is no longer ready to record.')
      }
      this.recorder = recorder
      this.activeAttemptId = record.attemptId
      this.recording = true
      this.autoStop = setTimeout(() => {
        status(`take reached ${MAX_TAKE_MS / 1000}s; stopping`)
        void this.stop()
      }, MAX_TAKE_MS)
    } catch (cause) {
      if (generation !== this.generation) return
      this.error = cause instanceof Error && cause.message.includes('microphone')
        ? 'The glasses microphone did not start.'
        : cause instanceof Error ? cause.message : 'Recording failed.'
      status(`could not start recording: ${String(cause)}`, 'error')
    } finally {
      if (generation === this.generation) {
        this.busy = false
        this.onChange()
      }
    }
  }

  async stop(): Promise<void> {
    if (this.disposed || this.busy || !this.recording || !this.recorder) return
    const recorder = this.recorder
    const generation = this.generation
    this.busy = true
    this.recording = false
    this.recorder = null
    clearTimeout(this.autoStop)
    this.onChange()
    try {
      const take = await recorder.stop()
      if (generation !== this.generation || this.disposed) return
      const record = this.store.stop()
      if (!take || !record || record.attemptId !== this.activeAttemptId) return
      if (take.wav.length <= 44) {
        this.fail(record, 'capture', 'No audio was recorded.')
        return
      }
      await submitAttempt(this.store, this.endpoints, record, {
        blob: new Blob([take.wav], { type: 'audio/wav' }),
        filename: `${record.attemptId}.wav`,
        metadata: {
          encoding: `pcm_s${take.format.bitsPerSample}le`,
          sampleRateHz: take.format.sampleRate,
          channelCount: take.format.channels,
          durationMs: Math.round(take.durationSec * 1000),
          measuredBytesPerSec: take.measuredBytesPerSec,
          chunkCount: take.chunkCount,
        },
      }, {
        isCurrent: () => generation === this.generation && !this.disposed,
        track: (request, stage) => {
          this.request = request
          this.requestStage = stage
        },
        untrack: request => {
          if (this.request === request) this.request = null
        },
        fail: (failed, stage, detail) => this.fail(failed, stage, detail),
      })
    } finally {
      if (generation === this.generation) {
        this.busy = false
        this.activeAttemptId = null
        this.onChange()
      }
    }
  }

  // Phone Cancel or glasses discard: a take is never saved, counted or
  // submitted; an analysis in flight is abandoned and marked as canceled.
  cancel(): void {
    if (!this.busy && !this.recording) return
    this.generation += 1
    clearTimeout(this.autoStop)
    this.request?.abort()
    this.request = null
    const recorder = this.recorder
    this.recorder = null
    void recorder?.discard()
    if (this.store.state.screen === 'recording') this.store.cancel()
    else if (this.activeAttemptId) this.store.fail(this.activeAttemptId, this.requestStage, 'Processing canceled.')
    this.recording = false
    this.busy = false
    this.activeAttemptId = null
    this.onChange()
  }

  // App closing or glasses gone mid-take: the attempt is kept as interrupted.
  dispose(): void {
    if (this.disposed) return
    if (this.recording) {
      this.generation += 1
      clearTimeout(this.autoStop)
      const recorder = this.recorder
      this.recorder = null
      this.recording = false
      void recorder?.discard()
      this.store.interrupt()
      status('capture interrupted', 'error')
    } else {
      this.cancel()
    }
    this.disposed = true
  }

  private fail(record: AttemptRecord, stage: Stage, detail: string) {
    this.error = detail
    this.store.fail(record.attemptId, stage, detail)
    this.onChange()
  }
}
