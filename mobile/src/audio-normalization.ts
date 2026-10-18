export const TARGET_SAMPLE_RATE = 22_050;
export type NormalizedAudio = { wav: Uint8Array; sourceSampleRate: number; sampleRate: 22050; channels: 1; encoding: 'pcm_s16le'; durationSec: number };

const FILTER_RADIUS = 32;
const FILTER_PHASES = 256;
function lowPassKernels(cutoff: number): Float64Array[] {
  return Array.from({ length: FILTER_PHASES + 1 }, (_, phase) => {
    const fraction = phase / FILTER_PHASES;
    const kernel = new Float64Array(FILTER_RADIUS * 2 + 1);
    for (let tap = -FILTER_RADIUS; tap <= FILTER_RADIUS; tap += 1) {
      const distance = tap - fraction;
      const angle = Math.PI * cutoff * distance;
      const sinc = angle === 0 ? 1 : Math.sin(angle) / angle;
      const position = distance / FILTER_RADIUS;
      const window = Math.abs(position) >= 1 ? 0 :
        0.42 + 0.5 * Math.cos(Math.PI * position) + 0.08 * Math.cos(2 * Math.PI * position);
      kernel[tap + FILTER_RADIUS] = cutoff * sinc * window;
    }
    return kernel;
  });
}

/** Resample decoded channel samples, then write a real PCM16 RIFF/WAVE file. */
export function normalizeChannels(channels: readonly Float32Array[], sourceSampleRate: number): NormalizedAudio {
  if (!Number.isFinite(sourceSampleRate) || sourceSampleRate < 8_000 || sourceSampleRate > 192_000 ||
      channels.length < 1 || channels.length > 8 || channels[0].length < 1 ||
      channels.some(channel => channel.length !== channels[0].length)) throw new Error('Decoded audio is invalid.');
  const sourceLength = channels[0].length;
  const sampleCount = Math.max(1, Math.round(sourceLength * TARGET_SAMPLE_RATE / sourceSampleRate));
  if (sampleCount > TARGET_SAMPLE_RATE * 30) throw new Error('Recording exceeds 30 seconds.');
  const wav = new Uint8Array(44 + sampleCount * 2);
  const view = new DataView(wav.buffer);
  const ascii = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i += 1) wav[offset + i] = value.charCodeAt(i);
  };
  ascii(0, 'RIFF'); view.setUint32(4, wav.length - 8, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, sampleCount * 2, true);
  const mono = new Float32Array(sourceLength);
  for (let index = 0; index < sourceLength; index += 1) {
    let sum = 0;
    for (const channel of channels) sum += channel[index];
    if (!Number.isFinite(sum)) throw new Error('Decoded audio contains invalid samples.');
    mono[index] = sum / channels.length;
  }
  const kernels = sourceSampleRate > TARGET_SAMPLE_RATE ? lowPassKernels(TARGET_SAMPLE_RATE / sourceSampleRate) : null;
  for (let i = 0; i < sampleCount; i += 1) {
    const position = i * sourceSampleRate / TARGET_SAMPLE_RATE;
    const left = Math.floor(position);
    const fraction = position - left;
    let sample: number;
    if (kernels) {
      const kernel = kernels[Math.round(fraction * FILTER_PHASES)];
      let weighted = 0;
      let totalWeight = 0;
      for (let tap = -FILTER_RADIUS; tap <= FILTER_RADIUS; tap += 1) {
        const index = left + tap;
        if (index < 0 || index >= sourceLength) continue;
        const weight = kernel[tap + FILTER_RADIUS];
        weighted += mono[index] * weight;
        totalWeight += weight;
      }
      sample = totalWeight ? weighted / totalWeight : 0;
    } else {
      sample = mono[Math.min(left, sourceLength - 1)] * (1 - fraction) +
        mono[Math.min(left + 1, sourceLength - 1)] * fraction;
    }
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767), true);
  }
  return { wav, sourceSampleRate, sampleRate: 22050, channels: 1, encoding: 'pcm_s16le', durationSec: sampleCount / TARGET_SAMPLE_RATE };
}

export async function normalizeBlob(blob: Blob): Promise<NormalizedAudio> {
  const Context = globalThis.AudioContext;
  if (!Context) throw new Error('Audio decoding is unavailable in this browser.');
  const context = new Context();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    return normalizeChannels(Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index)), decoded.sampleRate);
  } catch (cause) {
    throw new Error(cause instanceof Error ? `Could not decode or normalize audio: ${cause.message}` : 'Could not decode or normalize audio.');
  } finally {
    await context.close();
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}
