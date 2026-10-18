import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChannels } from '../src/audio-normalization.ts';

test('48 kHz stereo tone is downmixed and really resampled to 22050 Hz PCM16 WAV', () => {
  const rate = 48_000;
  const duration = 0.2;
  const left = Float32Array.from({ length: rate * duration }, (_, i) => 0.6 * Math.sin(2 * Math.PI * 440 * i / rate));
  const right = Float32Array.from({ length: rate * duration }, (_, i) => 0.2 * Math.sin(2 * Math.PI * 440 * i / rate));
  const result = normalizeChannels([left, right], rate);
  const view = new DataView(result.wav.buffer);
  assert.equal(new TextDecoder().decode(result.wav.subarray(0, 4)), 'RIFF');
  assert.equal(new TextDecoder().decode(result.wav.subarray(8, 12)), 'WAVE');
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 22_050);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 2 * 4_410);
  assert.equal(result.durationSec, duration);
  assert.equal(result.sourceSampleRate, rate);
  const peak = Math.max(...Array.from({ length: 4_410 }, (_, i) => Math.abs(view.getInt16(44 + 2 * i, true))));
  assert.ok(peak > 12_000 && peak < 14_000, `downmixed peak ${peak}`);
  const zeroCrossings = Array.from({ length: 4_409 }, (_, i) => [view.getInt16(44 + 2 * i, true), view.getInt16(46 + 2 * i, true)])
    .filter(([a, b]) => a < 0 && b >= 0).length;
  assert.ok(zeroCrossings >= 86 && zeroCrossings <= 88, `tone crossings ${zeroCrossings}`);
});

test('invalid decoded audio is rejected before upload', () => {
  assert.throws(() => normalizeChannels([], 48000));
  assert.throws(() => normalizeChannels([new Float32Array(0)], 48000));
  assert.throws(() => normalizeChannels([new Float32Array(10)], 0));
});

test('downsampling suppresses a tone above the output Nyquist limit', () => {
  const rate = 48_000;
  const make = frequency => Float32Array.from({ length: 9_600 }, (_, i) =>
    0.4 * Math.sin(2 * Math.PI * frequency * i / rate));
  const rms = wav => {
    const view = new DataView(wav.buffer);
    let energy = 0;
    let count = 0;
    for (let i = 100; i < (wav.length - 44) / 2 - 100; i += 1) {
      const sample = view.getInt16(44 + 2 * i, true) / 32768;
      energy += sample * sample; count += 1;
    }
    return Math.sqrt(energy / count);
  };
  const passband = rms(normalizeChannels([make(440)], rate).wav);
  const aliased = rms(normalizeChannels([make(15_000)], rate).wav);
  assert.ok(passband > 0.25 && passband < 0.31, `440 Hz RMS ${passband}`);
  assert.ok(aliased < passband * 0.05, `15 kHz aliased RMS ${aliased}`);
});
