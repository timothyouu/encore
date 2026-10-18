/** Real local browser → normalized WAV → Basic Pitch → offline coach → saved History.
 * Uses generated audio through Chromium's fake microphone, not a physical piano/G2.
 * No credential files or live model calls. Existing Playwright/Chrome are required.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = resolve(import.meta.dirname, '..');
const out = join(repo, '.run/segments');
await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL(process.env.ENCORE_PLAYWRIGHT ?? '/home/tim/Relay/node_modules/playwright/index.mjs').href);
const children = [];
const handles = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function port() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}
async function launch(name, executable, args, cwd = repo) {
  const log = await open(join(out, name + '.log'), 'w');
  handles.push(log);
  const child = spawn(executable, args, { cwd, stdio: ['ignore', log.fd, log.fd], env: { ...process.env, ENCORE_OFFLINE: 'true' } });
  children.push(child);
  return child;
}
async function ready(url, child) {
  for (let i = 0; i < 240; i++) {
    if (child.exitCode !== null) throw new Error('Local service exited: ' + url);
    try { if ((await fetch(url)).ok) return; } catch { /* startup */ }
    await pause(250);
  }
  throw new Error('Local service not ready: ' + url);
}
async function runPython(source) {
  const child = spawn(join(repo, 'analysis/.venv/bin/python'), ['-c', source], { cwd: repo, stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  assert.equal(code, 0);
}
let browser;
try {
  const analysisPort = await port();
  const coachPort = await port();
  const uiPort = await port();
  const url = 'http://localhost:' + uiPort;
  await runPython(`from pathlib import Path
from copy import deepcopy
import json
from analysis.smoke import synthetic_wav
p=deepcopy(json.loads(Path('shared/passages.json').read_text())[0])
for i in [1,5]: p['notes'][i]['midiPitch'] += 1
Path('.run/segments/input.wav').write_bytes(synthetic_wav(p))`);
  const analysis = await launch('analysis', join(repo, 'analysis/.venv/bin/python'), ['-m', 'uvicorn', 'analysis.service:app', '--host', '127.0.0.1', '--port', String(analysisPort)]);
  const serverEntry = join(out, 'server.mts');
  await writeFile(serverEntry, `import {createCoachServer,loadLibrary} from '../../server/src/http.ts';
const server=createCoachServer({library:await loadLibrary(),chooser:null,analysisUrl:'http://127.0.0.1:${analysisPort}/v1/analyze',allowedOrigin:'${url}'});
server.listen(${coachPort},'127.0.0.1');
process.on('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit());});
`);
  const coach = await launch('coach', process.execPath, ['--import', join(repo, 'server/node_modules/tsx/dist/loader.mjs'), serverEntry]);
  const config = join(out, 'vite.mjs');
  await writeFile(config, `export default {root:${JSON.stringify(join(repo, 'mobile'))},envDir:false,server:{host:'127.0.0.1',port:${uiPort},strictPort:true,fs:{allow:[${JSON.stringify(repo)}]},proxy:{'/api':{target:'http://127.0.0.1:${coachPort}',changeOrigin:true,rewrite:p=>'/v1'+p.slice(4)}}}};`);
  const vite = await launch('mobile', process.execPath, [join(repo, 'mobile/node_modules/vite/bin/vite.js'), '--config', config]);
  await ready('http://127.0.0.1:' + analysisPort + '/health', analysis);
  await ready('http://127.0.0.1:' + coachPort + '/health', coach);
  await ready(url, vite);
  browser = await chromium.launch({ executablePath: process.env.ENCORE_CHROME ?? '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + join(out, 'input.wav')] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors = [], calls = [], payloads = {}, resourceFailures = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('response', async response => {
    const path = new URL(response.url()).pathname;
    if (response.status() >= 400) resourceFailures.push({ path, status: response.status() });
    if (!['/api/recordings', '/api/analyze', '/api/coach'].includes(path)) return;
    calls.push(path);
    try { payloads[path] = await response.json(); } catch (error) { errors.push(String(error)); }
  });
  await page.goto(url);
  await page.getByRole('button', { name: /First Steps/ }).click();
  await page.getByRole('button', { name: 'Start recording →' }).click();
  await page.locator('.recording-page').waitFor();
  await pause(10_300);
  await page.getByRole('button', { name: 'Stop & analyze' }).click();
  await page.locator('.result-page').waitFor({ timeout: 90_000 });
  const result = payloads['/api/analyze'];
  const coaching = payloads['/api/coach'];
  await writeFile(join(out, 'analysis-response.json'), JSON.stringify(result, null, 2));
  assert.equal(result.schemaVersion, '2');
  assert.equal(result.status, 'ok');
  assert.ok(result.detectorVersion.startsWith('basic-pitch/'));
  assert.ok(result.findings.length > 3, 'recorded audio must exercise more than the summary cap');
  assert.ok(result.displaySegments.length >= 2, 'recorded errors must exercise both bars');
  assert.equal(coaching.schemaVersion, '2');
  assert.equal(coaching.coachingSource, 'fallback');
  assert.equal(coaching.fallbackReason, 'missing_key');
  assert.ok(result.displaySegments.some(segment => segment.id === coaching.primarySegmentId));
  assert.deepEqual(calls, ['/api/recordings', '/api/analyze', '/api/coach']);
  const uploaded = payloads['/api/recordings'];
  assert.equal(result.attemptId, uploaded.attemptId);
  assert.equal(coaching.attemptId, uploaded.attemptId);
  assert.equal(uploaded.sampleRate, 22050);
  assert.equal(uploaded.channels, 1);
  await page.screenshot({ path: join(out, 'review.png'), fullPage: true });
  // Public controls only; no injected session or API fixtures.
  const chips = page.locator('.segment-button');
  assert.ok(await chips.count() >= 2);
  const total = Number((await page.locator('.carousel-label').innerText()).match(/of (\d+)/)[1]);
  assert.ok(total > 3, 'all mistakes must remain browsable beyond the three-card summary');
  const visited = [];
  for (let index = 0; index < total; index++) {
    assert.equal(await page.locator('.carousel-label').innerText(), `Review ${index + 1} of ${total}`);
    const bar = await page.locator('.segment-button[aria-pressed="true"]').innerText();
    visited.push(bar);
    await page.getByRole('button', { name: 'View correction →' }).click();
    await page.locator('.guide-page').waitFor();
    assert.equal(await page.locator('.carousel-label').innerText(), `Guide ${index + 1} of ${total}`);
    assert.equal(await page.locator('.segment-button[aria-pressed="true"]').innerText(), bar);
    await page.locator('.finding-carousel .circle-button').first().click();
    await page.locator('.result-page').waitFor();
    assert.equal(await page.locator('.carousel-label').innerText(), `Review ${index + 1} of ${total}`);
    await page.locator('.finding-carousel .circle-button').last().click();
    await page.locator('.guide-page').waitFor();
    if (index < total - 1) await page.getByRole('button', { name: 'Next mistake →' }).click();
  }
  assert.ok(new Set(visited).size >= 2, 'navigation must reach both affected bars');
  // Direct bar selection returns to Review for that bar.
  await page.locator('.segment-button').last().click();
  if (await page.locator('.guide-page').count()) await page.getByRole('button', { name: '‹ Back to review', exact: true }).first().click();
  await page.getByRole('button', { name: 'View correction →' }).click();
  await page.locator('.guide-page').waitFor();
  await page.screenshot({ path: join(out, 'guide.png'), fullPage: true });
  await page.getByRole('button', { name: 'View in sheet music' }).click();
  await page.locator('.sheet-page').waitFor();
  await page.screenshot({ path: join(out, 'sheet.png'), fullPage: true });
  await page.getByRole('button', { name: '‹ Close sheet music' }).click();
  await page.getByRole('button', { name: 'View past results' }).click();
  await page.locator('.history-row').first().waitFor();
  await page.reload();
  await page.getByRole('button', { name: /View history/ }).click();
  await page.locator('.history-row').first().click();
  await page.locator('.result-page').waitFor();
  assert.match(await page.locator('.result-page').innerText(), /Saved result|Past result/);
  assert.deepEqual(calls, ['/api/recordings', '/api/analyze', '/api/coach'], 'History reload must not rerun inference');
  assert.deepEqual(resourceFailures, [], JSON.stringify(resourceFailures));
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(out, 'history.png'), fullPage: true });
  const evidence = { status: 'passed', input: 'generated harmonic tones via Chromium fake microphone',
    detector: result.detectorVersion, coachingSource: coaching.coachingSource, findings: result.findings.length,
    affectedBars: result.displaySegments.map(s => s.startBar), visitedPairs: total, visitedBars: visited, attemptId: result.attemptId,
    normalizedSampleRate: uploaded.sampleRate, calls, historyReloadWithoutInference: true, errors };
  await writeFile(join(out, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally {
  await browser?.close();
  for (const child of children.reverse()) child.kill('SIGTERM');
  await pause(300);
  for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  for (const handle of handles) await handle.close();
}
