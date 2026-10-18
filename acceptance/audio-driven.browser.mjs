// Locked browser acceptance for the phone microphone path. Run from the repository root.
// Chromium receives a generated WAV through its fake media device; this is not physical microphone verification.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = resolve(import.meta.dirname, '..');
const playwrightFile = process.env.ENCORE_PLAYWRIGHT ?? '/home/tim/Relay/node_modules/playwright/index.mjs';
const chromeFile = process.env.ENCORE_CHROME ?? '/usr/bin/google-chrome';
const { chromium } = await import(pathToFileURL(playwrightFile).href);

function fakeMicrophoneWav() {
  const rate = 48_000;
  const seconds = 8;
  const samples = rate * seconds;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const level = t < 1 || t >= 6 ? 0 : t < 3 ? 0.06 : t < 5 ? 0.42 : 0.06;
    wav.writeInt16LE(Math.round(level * 32767 * Math.sin(2 * Math.PI * 440 * t)), 44 + i * 2);
  }
  return wav;
}

function inspectUploadedWav(base64) {
  const wav = Buffer.from(base64, 'base64');
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(20), 1, 'upload must be PCM');
  assert.equal(wav.readUInt16LE(22), 1, 'upload must be mono');
  assert.equal(wav.readUInt32LE(24), 22_050, 'upload must have normalized rate');
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40) + 44, wav.length, 'WAV header must describe exact payload');
  const samples = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.length - 44) / 2);
  const windows = [];
  const step = 4_410;
  for (let start = 0; start + step <= samples.length; start += step) {
    let energy = 0;
    for (let i = start; i < start + step; i++) energy += (samples[i] / 32768) ** 2;
    windows.push(Math.sqrt(energy / step));
  }
  assert.ok(windows.length >= 15, `recording too short: ${windows.length} windows`);
  const peak = Math.max(...windows);
  const floor = Math.min(...windows);
  assert.ok(peak > 0.09, `known loud input missing in upload: RMS ${peak}`);
  assert.ok(floor < 0.025, `known silence missing in upload: RMS ${floor}`);
  assert.ok(peak > floor * 4, 'uploaded signal must retain loud and quiet phases');
  const loudWindow = windows.indexOf(peak) * step;
  const offset = loudWindow + 220;
  let bestLag = 0, bestScore = -Infinity;
  for (let lag = 35; lag <= 65; lag++) {
    let score = 0;
    for (let i = 0; i < 1_000; i++) score += samples[offset + i] * samples[offset + i + lag];
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  const frequency = 22_050 / bestLag;
  assert.ok(frequency > 420 && frequency < 460, `expected supplied A4 tone, measured ${frequency}`);
  return { wav, peak, floor, frequency, sampleCount: samples.length };
}

function serviceResponses(page) {
  const evidence = { calls: [], error: null, normalized: null, analysis: null };
  page.route('**/api/**', async route => {
    try {
      const url = new URL(route.request().url());
      const body = route.request().postDataJSON();
      evidence.calls.push(url.pathname);
      let response;
      if (url.pathname === '/api/recordings') {
        assert.equal(body.metadata.captureSource, 'phone');
        assert.equal(body.metadata.passageId, 'P01');
        assert.equal(body.metadata.sampleRate, 22_050);
        evidence.normalized = inspectUploadedWav(body.wavBase64);
        evidence.attemptId = body.metadata.attemptId;
        response = { ...body.metadata, artifactId: 'acceptance-artifact', attemptId: evidence.attemptId,
          audioUrl: '/api/audio/acceptance-artifact', expiresAt: new Date(Date.now() + 60_000).toISOString(),
          sha256: createHash('sha256').update(evidence.normalized.wav).digest('hex') };
      } else if (url.pathname === '/api/analyze') {
        assert.equal(body.attemptId, evidence.attemptId);
        assert.equal(body.artifactId, 'acceptance-artifact');
        const observedPitch = Math.round(69 + 12 * Math.log2(evidence.normalized.frequency / 440));
        assert.equal(observedPitch, 69);
        response = { schemaVersion: '1', attemptId: evidence.attemptId, passageId: 'P01', passageVersion: '1',
          attemptTempoBpm: 60, status: 'ok', detectorVersion: 'acceptance-observed-audio', scoringVersion: 'acceptance',
          audioQuality: { clipped: false, hasDropouts: false, warnings: [] },
          alignment: { offsetSec: 0, reliable: true },
          detectedNotes: [{ id: 'observed-a4', midiPitch: observedPitch, onsetSec: 1, durationSec: 2, detectorScore: 0.9 }],
          findings: [{ id: 'observed-mismatch', kind: 'wrong_note', referenceNoteId: 'P01-N01', detectedNoteId: 'observed-a4' }],
          metrics: { matchedNotes: 7, expectedNotes: 8, medianAbsTimingErrorMs: 0 } };
        evidence.analysis = response;
      } else if (url.pathname === '/api/coach') {
        assert.equal(body.analysis.attemptId, evidence.attemptId);
        assert.equal(body.analysis.detectedNotes[0].midiPitch, 69);
        response = { schemaVersion: '1', attemptId: evidence.attemptId, coachingSource: 'fallback',
          fallbackReason: 'missing_key', cue: 'Heard A4. Revisit the first C4.',
          evidenceFindingIds: ['observed-mismatch'], visual: { kind: 'keyboard',
            referenceNoteIds: ['P01-N01'], poseIds: [], mistakes: [{ findingId: 'observed-mismatch',
              referenceNoteId: 'P01-N01', detectedNoteId: 'observed-a4' }] } };
      } else throw new Error(`Unexpected endpoint ${url.pathname}`);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
    } catch (error) {
      evidence.error = error;
      await route.fulfill({ status: 500, body: String(error) });
    }
  });
  return evidence;
}

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitFor(url) {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* server still starting */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Vite did not become ready at ${url}`);
}

async function selectFirstPassage(page, url) {
  await page.goto(url);
  await page.getByRole('button', { name: /First Steps/ }).click();
  await page.getByRole('button', { name: 'Start recording →' }).waitFor();
}

async function microphoneFlow(browser, url) {
  console.error('acceptance: opening browser page');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const evidence = serviceResponses(page);
  try {
    await selectFirstPassage(page, url);
    console.error('acceptance: passage selected');
    await page.evaluate(() => {
      window.__acceptance = { stopped: 0, capturedTracks: 0, contexts: 0, closed: 0 };
      const OriginalContext = window.AudioContext;
      window.AudioContext = class extends OriginalContext {
        constructor(...args) { super(...args); window.__acceptance.contexts++; }
        async close() { window.__acceptance.closed++; return super.close(); }
      };
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        const stream = await original(constraints);
        window.__acceptance.capturedTracks += stream.getTracks().length;
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => { window.__acceptance.stopped++; stop(); };
        }
        return stream;
      };
    });
    await page.getByRole('button', { name: 'Start recording →' }).click();
    await page.locator('.recording-page').waitFor();
    console.error('acceptance: recording screen');
    await page.locator('.recording-bars .recording-bar').first().waitFor({ timeout: 3_000 });
    await page.waitForTimeout(3_500);
    await page.screenshot({ path: join(repo, '.run/recording-waveform.png') });
    const heights = await page.evaluate(async () => {
      const output = [];
      for (let i = 0; i < 85; i++) {
        const bars = [...document.querySelectorAll('.recording-page .recording-bar')];
        if (!bars.length) throw new Error('Live recording waveform disappeared');
        output.push(Math.max(...bars.map(bar => parseFloat(getComputedStyle(bar).height))));
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return output;
    });
    assert.ok(Math.max(...heights) >= 20, `loud input did not move waveform: max ${Math.max(...heights)}`);
    console.error('acceptance: waveform sampled');
    assert.ok(Math.min(...heights) <= 7, `silence did not flatten waveform: min ${Math.min(...heights)}`);
    assert.ok(Math.max(...heights) >= Math.min(...heights) * 3, 'waveform did not respond to dynamic input');
    await page.getByRole('button', { name: 'Stop & analyze' }).click();
    await page.locator('.result-page').waitFor({ timeout: 20_000 });
    console.error('acceptance: result screen');
    assert.equal(evidence.error, null, evidence.error?.stack);
    assert.deepEqual(evidence.calls, ['/api/recordings', '/api/analyze', '/api/coach']);
    assert.match(await page.locator('.result-page').innerText(), /A4|1 thing to revisit/);
    assert.match(await page.locator('.result-page').innerText(), /7 of 8 reference notes matched/);
    assert.equal(await page.locator('.demo-banner').innerText(), 'Phone microphone · service connection unverified');
    const tracks = await page.evaluate(() => window.__acceptance);
    assert.equal(tracks.capturedTracks, 1);
    assert.ok(tracks.stopped >= 1, 'stopping capture must stop microphone track');
    assert.ok(tracks.contexts >= 2, 'meter and WAV normalization must use audio contexts');
    assert.equal(tracks.closed, tracks.contexts, 'stopping must close meter and decoder contexts');
    await page.screenshot({ path: join(repo, '.run/recorded-result.png') });
    await page.getByRole('button', { name: 'View past results' }).click();
    assert.match(await page.locator('.history-page').innerText(), /First Steps[\s\S]*Phone mic[\s\S]*Result/);
    await page.reload();
    console.error('acceptance: reloaded');
    await page.getByRole('button', { name: /View history/ }).click();
    await page.locator('.history-row').first().click();
    assert.match(await page.locator('.result-page').innerText(), /7 of 8 reference notes matched/);
    assert.deepEqual(evidence.calls, ['/api/recordings', '/api/analyze', '/api/coach'], 'reload must read saved history');
    return { waveformMin: Math.min(...heights), waveformMax: Math.max(...heights),
      uploadBytes: evidence.normalized.wav.length, toneHz: evidence.normalized.frequency };
  } finally { await context.close(); }
}

async function deniedAndCanceled(browser, url) {
  console.error('acceptance: denied and canceled cases');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await selectFirstPassage(page, url);
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied by acceptance test', 'NotAllowedError'); };
    });
    await page.getByRole('button', { name: 'Start recording →' }).click();
    await page.getByText('Permission denied by acceptance test').waitFor();
    assert.equal(await page.locator('.recording-page').count(), 0);
    assert.equal(await page.locator('.history-row').count(), 0);
    await page.reload();
    await page.getByRole('button', { name: /View history/ }).click();
    assert.match(await page.locator('.history-page').innerText(), /No recordings yet/);
    await page.getByRole('button', { name: '‹ Back to library' }).click();
    await page.getByRole('button', { name: /First Steps/ }).click();
    await page.evaluate(() => {
      window.__acceptance = { resolve: null, stopped: 0 };
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = () => new Promise(resolve => {
        window.__acceptance.resolve = async () => {
          const stream = await original({ audio: true });
          navigator.mediaDevices.getUserMedia = original;
          for (const track of stream.getTracks()) {
            const stop = track.stop.bind(track);
            track.stop = () => { window.__acceptance.stopped++; stop(); };
          }
          resolve(stream);
        };
      });
    });
    await page.getByRole('button', { name: 'Start recording →' }).click();
    await page.getByRole('button', { name: 'Cancel microphone request' }).click();
    await page.evaluate(() => window.__acceptance.resolve());
    await page.waitForFunction(() => window.__acceptance.stopped > 0);
    assert.equal(await page.locator('.recording-page').count(), 0);
    assert.equal(await page.locator('.history-row').count(), 0);
    await page.getByRole('button', { name: '‹ All passages' }).click();
    await page.getByRole('button', { name: /View history/ }).click();
    assert.match(await page.locator('.history-page').innerText(), /No recordings yet/);
    const canceledPendingTrackStops = await page.evaluate(() => window.__acceptance.stopped);
    await page.getByRole('button', { name: '‹ Back to library' }).click();
    await page.getByRole('button', { name: /First Steps/ }).click();
    await page.evaluate(() => {
      window.__acceptance = { stopped: 0, contexts: 0, closed: 0 };
      const OriginalContext = window.AudioContext;
      window.AudioContext = class extends OriginalContext {
        constructor(...args) { super(...args); window.__acceptance.contexts++; }
        async close() { window.__acceptance.closed++; return super.close(); }
      };
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        const stream = await original(constraints);
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => { window.__acceptance.stopped++; stop(); };
        }
        return stream;
      };
    });
    await page.getByRole('button', { name: 'Start recording →' }).click();
    await page.locator('.recording-page').waitFor();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel and return to library' }).click();
    await page.locator('.library-page').waitFor();
    const canceledActive = await page.evaluate(() => window.__acceptance);
    assert.ok(canceledActive.stopped >= 1, 'cancel must stop active microphone track');
    assert.ok(canceledActive.contexts >= 1, 'active recording must have metering context');
    assert.equal(canceledActive.closed, canceledActive.contexts, 'cancel must close metering context');
    await page.getByRole('button', { name: /View history/ }).click();
    assert.match(await page.locator('.history-page').innerText(), /0 completed recordings[\s\S]*Canceled/);
    return { canceledPendingTrackStops, canceledActiveTrackStops: canceledActive.stopped,
      canceledActiveContextsClosed: canceledActive.closed };
  } finally { await context.close(); }
}

async function run() {
  await mkdir(join(repo, '.run'), { recursive: true });
  const directory = await mkdtemp(join(tmpdir(), 'encore-fake-mic-'));
  const fixture = join(directory, 'controlled-a4.wav');
  await writeFile(fixture, fakeMicrophoneWav());
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  const vite = spawn(process.execPath, [join(repo, 'mobile/node_modules/vite/bin/vite.js'),
    '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { cwd: join(repo, 'mobile'), stdio: 'ignore' });
  let browser;
  try {
    await waitFor(url);
    console.error(`acceptance: vite ready at ${url}`);
    browser = await chromium.launch({ executablePath: chromeFile, headless: true,
      args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
        `--use-file-for-fake-audio-capture=${fixture}`] });
    console.error('acceptance: chromium ready');
    const full = await microphoneFlow(browser, url);
    const edge = await deniedAndCanceled(browser, url);
    console.log(JSON.stringify({ status: 'passed', input: 'Chromium fake media device fed by generated WAV', ...full, ...edge }));
  } finally {
    await browser?.close();
    vite.kill('SIGTERM');
    await rm(directory, { recursive: true, force: true });
  }
}

await run();
