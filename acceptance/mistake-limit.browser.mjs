/** Fixture-based phone UI/History acceptance; no microphone, credentials, or model calls. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = resolve(import.meta.dirname, '..');
const out = join(repo, '.run/mistake-limit');
await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL(process.env.ENCORE_PLAYWRIGHT ?? '/home/tim/Relay/node_modules/playwright/index.mjs').href);
const { createServer } = await import(pathToFileURL(join(repo, 'mobile/node_modules/vite/dist/node/index.js')).href);
await writeFile(join(out, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mistake review fixture</title><div id="root"></div><script type="module">
import {mountPhone} from '/mobile/src/phone.ts';
import {SessionStore,fixtureAnalysis,fixtureCoaching} from '/mobile/src/session.ts';
import {passages} from '/mobile/src/passages.ts';
const store=new SessionStore(localStorage);
if(!store.records.length){
 store.selectPassage('P01');const record=store.start('demo');store.stop();
 const analysis=fixtureAnalysis(record,'mistakes');
 analysis.findings=[{id:'missing',kind:'missing_note',referenceNoteId:passages[0].notes[0].id},
 ...Array.from({length:19},(_,i)=>({id:'t'+i,kind:'timing',referenceNoteId:passages[0].notes[3].id,detectedNoteId:'detected-4',timingDeltaMs:170+i*10}))];
 if(!store.applyAnalysis(record.attemptId,analysis)||!store.applyCoaching(record.attemptId,fixtureCoaching(record)))throw Error('fixture invalid');
}
store.showHistory();store.openAttempt(store.records[0].attemptId);
window.testStore=store;
mountPhone(document.querySelector('#root'),store,{start(){},stop(){},cancel(){}});
</script></html>`);
const server = await createServer({ configFile: false, root: repo, envDir: false, cacheDir: join(out, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  browser = await chromium.launch({ executablePath: process.env.ENCORE_CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/.run/mistake-limit/index.html`);
  await page.locator('.result-page').waitFor();
  await page.getByText('All mistakes (20)', { exact: true }).click();
  assert.equal(await page.locator('.all-mistakes-item').count(), 20);
  assert.match(await page.locator('.all-mistakes-item').first().innerText(), /Missing note/);
  assert.equal(await page.locator('.all-mistakes-list').evaluate(element => element.scrollHeight > element.clientHeight), true);
  await page.locator('.all-mistakes-item').last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(out, 'all-mistakes.png'), fullPage: true });
  await page.locator('.all-mistakes-item').last().click();
  assert.equal(await page.evaluate(() => window.testStore.state.findingIndex), 19);
  await page.reload();
  await page.locator('.result-page').waitFor();
  await page.getByText('All mistakes (20)', { exact: true }).click();
  assert.equal(await page.locator('.all-mistakes-item').count(), 20);
  assert.equal(await page.evaluate(() => window.testStore.records[0].analysis.findings.length), 20);
  assert.deepEqual(errors, []);
  const evidence = { status: 'passed', input: 'simulated saved-analysis fixture', savedFindings: 20,
    scrollable: true, lastMistakeSelectable: true, historyReloadPreservesAll: true, errors };
  await writeFile(join(out, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally {
  await browser?.close();
  await server.close();
}
