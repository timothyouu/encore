import type { CaptureDriver, HostSourceContext } from '../../mobile/src/app.ts'
import type { SessionStore } from '../../mobile/src/session.ts'
import type { Glasses } from './glasses.ts'
import { PASSAGES } from './passages.ts'
import { Recorder } from './recorder.ts'
import { status } from './status.ts'

// Spec §8: bound clip duration. Seed passages last 8 beats (≤ 8s at 60 bpm).
export const MAX_TAKE_MS = 30000

// The G2 microphone as a recording source for the phone session (CONTRACT.md).
// Phone buttons and glasses taps both arrive here through the phone app, so
// there is one take at a time and one attempt record per take. The mic is
// turned on before the attempt exists: a mic that never starts records nothing.
// Finished takes go to the phone's own pipeline (normalize, upload, analyze,
// coach, retry); this class only owns the device.
export class G2Capture implements CaptureDriver {
  busy = false
  recording = false
  error: string | null = null

  private recorder: Recorder | null = null
  private autoStop: ReturnType<typeof setTimeout> | undefined
  private activeAttemptId: string | null = null
  // Bumped by cancel/dispose so late mic or network results are ignored.
  private generation = 0
  private disposed = false

  private readonly store: SessionStore
  private readonly submit: HostSourceContext['submit']
  private readonly onChange: () => void
  private readonly glasses: () => Glasses | null

  constructor({ store, submit, onChange }: HostSourceContext, glasses: () => Glasses | null) {
    this.store = store
    this.submit = submit
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
      recorder.bindAttemptId(record.attemptId)
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
      if (!take || take.wav.length <= 44 || (take.wav.length - 44) % 2 !== 0) {
        this.error = !take || take.wav.length <= 44 ? 'No audio was recorded.' : 'Invalid PCM byte count; record again.'
        this.store.cancel()
        status(this.error, 'error')
        return
      }
      const record = this.store.stop()
      if (!record || record.attemptId !== this.activeAttemptId || take.attemptId !== record.attemptId) return
      status(`submit ${record.attemptId}: ${take.chunkCount} chunks, ${take.clippedSampleCount} near-limit samples`)
      // Busy ends here: processing state now belongs to the phone pipeline.
      this.busy = false
      this.activeAttemptId = null
      this.onChange()
      await this.submit(record, new Blob([take.wav], { type: 'audio/wav' }))
    } catch (cause) {
      if (generation === this.generation && !this.disposed) {
        this.error = cause instanceof Error && cause.message.includes('microphone stop')
          ? 'Glasses microphone stop was not confirmed. Reconnect before recording again.'
          : 'Recording could not finish.'
        this.store.interrupt()
        status(this.error, 'error')
      }
    } finally {
      if (generation === this.generation) {
        this.busy = false
        this.activeAttemptId = null
        this.onChange()
      }
    }
  }

  // Phone Cancel or glasses discard: a take is never saved, counted or
  // submitted. Canceling processing is the pipeline's job.
  cancel(): void {
    if (!this.busy && !this.recording) return
    this.generation += 1
    clearTimeout(this.autoStop)
    const recorder = this.recorder
    this.recorder = null
    void recorder?.discard()
    if (this.store.state.screen === 'recording') this.store.cancel()
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
}
