export const WAVEFORM_BARS = 40;

// RMS preserves the difference between quiet and loud input without inventing motion during silence.
export function waveformLevels(samples: Float32Array, bars = WAVEFORM_BARS): number[] {
  const levels: number[] = [];
  for (let bar = 0; bar < bars; bar += 1) {
    const start = Math.floor(bar * samples.length / bars);
    const end = Math.floor((bar + 1) * samples.length / bars);
    let sum = 0;
    for (let index = start; index < end; index += 1) sum += samples[index] ** 2;
    const rms = Math.sqrt(sum / Math.max(1, end - start));
    levels.push(rms < 0.003 ? 0 : Math.min(1, rms * 2));
  }
  return levels;
}

function closeContext(context: AudioContext): void {
  try { void context.close().catch(() => {}); } catch { /* Already closed or broken context. */ }
}

export class AudioMeter {
  private readonly context: AudioContext;
  private readonly source: MediaStreamAudioSourceNode;
  private readonly analyser: AnalyserNode;
  private readonly samples: Float32Array<ArrayBuffer>;
  private closed = false;

  private constructor(context: AudioContext, source: MediaStreamAudioSourceNode, analyser: AnalyserNode) {
    this.context = context;
    this.source = source;
    this.analyser = analyser;
    this.samples = new Float32Array(analyser.fftSize);
  }

  static create(stream: MediaStream): AudioMeter | null {
    if (typeof AudioContext === 'undefined') return null;
    let context: AudioContext | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let analyser: AnalyserNode | undefined;
    try {
      context = new AudioContext();
      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);
      // The analyser is intentionally never connected to the speakers.
      if (context.state === 'suspended') void context.resume().catch(() => {});
      return new AudioMeter(context, source, analyser);
    } catch {
      try { source?.disconnect(); } catch { /* Continue releasing the context. */ }
      try { analyser?.disconnect(); } catch { /* Continue releasing the context. */ }
      if (context) closeContext(context);
      return null;
    }
  }

  sample(): readonly number[] | null {
    if (this.closed || this.context.state === 'suspended' || this.context.state === 'closed') return null;
    try {
      this.analyser.getFloatTimeDomainData(this.samples);
      return waveformLevels(this.samples);
    } catch {
      this.dispose();
      return null;
    }
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.source.disconnect(); } catch { /* Continue releasing the context. */ }
    try { this.analyser.disconnect(); } catch { /* Continue releasing the context. */ }
    closeContext(this.context);
  }
}
