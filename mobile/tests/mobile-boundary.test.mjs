import test from 'node:test';
import { stripTypeScriptTypes } from 'node:module';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobile = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = join(mobile, 'src');
const sharedPassages = resolve(mobile, '../shared/passages.ts');
const forbiddenApi = /@evenrealities|\b(?:waitForEvenAppBridge|EvenAppBridge|onEvenHubEvent|createStartUpPageContainer|rebuildPageContainer|shutDownPageContainer|textContainerUpgrade|graphicContainerUpgrade|updateImageRawData|flutter_inappwebview|ReactNativeWebView|messageHandlers|callHandler)\b|encore:connection/;

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

const sharedTypes = new Set(['contracts.ts', 'visual-contract.ts'].map(name => resolve(mobile, '../shared', name)));
const sharedRuntime = resolve(mobile, '../shared/visual-plan.ts');
function assertPhoneOnlySource(content, path, visited = new Set()) {
  if (visited.has(path)) return;
  visited.add(path);
  assert.doesNotMatch(content, forbiddenApi, relative(mobile, path));
  for (const match of content.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g)) {
    const specifier = match[1];
    assert.notEqual(path, sharedPassages, 'shared passage data must have no imports');
    assert.doesNotMatch(specifier, /(?:^|\/)g2(?:\/|$)|(?:^|\/)display(?:\.[jt]s)?$/i, `${relative(mobile, path)} imports ${specifier}`);
    if (!specifier.startsWith('.')) {
      const allowed = (path === join(mobile, 'vite.config.ts') && specifier === 'vite') ||
        (path === join(sourceRoot, 'telemetry.ts') && specifier === '@sentry/browser');
      assert.ok(allowed, `${relative(mobile, path)} imports external package ${specifier}`);
      continue;
    }
    const target = resolve(dirname(path), specifier);
    if (sharedTypes.has(target)) {
      const declaration = content.slice(content.lastIndexOf('\n', match.index) + 1, match.index);
      assert.match(declaration, /^\s*(?:import|export)\s+type\s*\{[^}]+\}\s*$/,
        'shared contracts may only be imported or exported as types');
      const emitted = stripTypeScriptTypes(readFileSync(target, 'utf8'));
      assert.equal(emitted.replace(/export\s*\{\s*\}\s*;?/g, '').trim(), '', 'shared contracts must contain no executable code');
      continue;
    }
    if (target === sharedRuntime) {
      const source = readFileSync(target, 'utf8');
      assert.doesNotMatch(source, /\b(?:window|document|fetch|WebSocket|eval|Function)\b|\bimport\s*\(/,
        'shared visual planner must remain pure and device-independent');
      assertPhoneOnlySource(source, target, visited);
      continue;
    }
    if (target === resolve(mobile, '../shared/visual-examples.json')) {
      assert.ok(path === join(sourceRoot, 'paper-gallery.ts'), 'only fixture gallery imports example data');
      assert.doesNotThrow(() => JSON.parse(readFileSync(target, 'utf8')));
      continue;
    }
    const withinSource = relative(sourceRoot, target);
    const isInSource = withinSource && withinSource !== '..' && !withinSource.startsWith(`..${sep}`);
    assert.ok(isInSource || target === sharedPassages, `${relative(mobile, path)} escapes src: ${specifier}`);
    assert.ok(existsSync(target), `${relative(mobile, path)} imports a missing file: ${specifier}`);
    if (target === sharedPassages && !visited.has(target)) {
      assertPhoneOnlySource(readFileSync(target, 'utf8'), target, visited);
    }
  }
}

function resolveLockedPackage(packages, from, name) {
  let directory = from;
  while (true) {
    const candidate = `${directory ? `${directory}/` : ''}node_modules/${name}`;
    if (packages[candidate]) return candidate;
    const nested = directory.lastIndexOf('/node_modules/');
    if (nested >= 0) directory = directory.slice(0, nested);
    else if (directory) directory = '';
    else return null;
  }
}

test('phone entrypoint and build config cannot load a glasses bridge', () => {
  const html = readFileSync(join(mobile, 'index.html'), 'utf8');
  assert.match(html, /<script\b[^>]*\btype="module"[^>]*\bsrc="\/src\/main\.ts"/);
  assert.doesNotMatch(html, /@evenrealities|\/g2\/|display\.ts|evenhub/i);
  assert.ok(existsSync(join(sourceRoot, 'main.ts')));

  for (const path of [...sourceFiles(sourceRoot), join(mobile, 'vite.config.ts')]) {
    assertPhoneOnlySource(readFileSync(path, 'utf8'), path);
  }
});

test('only the telemetry module may import Sentry', () => {
  assert.throws(() => assertPhoneOnlySource("import * as Sentry from '@sentry/browser';", join(sourceRoot, 'capture.ts')), { name: 'AssertionError' });
  assert.doesNotThrow(() => assertPhoneOnlySource("import * as Sentry from '@sentry/browser';", join(sourceRoot, 'telemetry.ts')));
  assert.throws(() => assertPhoneOnlySource("import * as Other from '@sentry/core';", join(sourceRoot, 'telemetry.ts')), { name: 'AssertionError' });
});

test('boundary rejects an SDK display adapter and native bridge routes', () => {
  const path = join(sourceRoot, 'fixture.ts');
  for (const source of [
    "import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk';",
    'bridge.updateImageRawData(image);',
    "globalThis.flutter_inappwebview.callHandler('display', content);",
    "window.webkit.messageHandlers.glasses.postMessage(content);",
    'window.ReactNativeWebView.postMessage(content);',
    "import { display } from '../../g2/bridge.ts';",
    "import { AnalysisResult } from '../../shared/contracts.ts';",
  ]) {
    assert.throws(() => assertPhoneOnlySource(source, path), { name: 'AssertionError' }, source);
  }
});

test('only the import-free authored passage module can cross the phone source boundary', () => {
  const path = join(sourceRoot, 'fixture.ts');
  assert.doesNotThrow(() => assertPhoneOnlySource("import { PASSAGES } from '../../shared/passages.ts';", path));
  assert.throws(() => assertPhoneOnlySource("import { helper } from '../../shared/other.ts';", path), { name: 'AssertionError' });
  assert.throws(() => assertPhoneOnlySource("import { helper } from '../../g2/src/passages.ts';", path), { name: 'AssertionError' });
  assert.throws(() => assertPhoneOnlySource("import { helper } from '../mobile-peer.ts';", path), { name: 'AssertionError' });
  assert.throws(() => assertPhoneOnlySource("import { helper } from '../g2/passages.ts';", sharedPassages), { name: 'AssertionError' });
});

test('mobile package and lock contain only phone build dependencies', () => {
  const manifest = JSON.parse(readFileSync(join(mobile, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(mobile, 'package-lock.json'), 'utf8'));
  assert.deepEqual(lock.packages[''].dependencies ?? {}, manifest.dependencies ?? {});
  assert.deepEqual(lock.packages[''].devDependencies ?? {}, manifest.devDependencies ?? {});
  assert.deepEqual(Object.keys(manifest.scripts).sort(), ['build', 'dev', 'preview', 'test']);
  assert.ok(!existsSync(join(mobile, 'app.json')));
  assert.ok(!existsSync(join(sourceRoot, 'display.ts')));
  for (const name of Object.keys(lock.packages)) assert.doesNotMatch(name, /@evenrealities|evenhub|\/g2(?:\/|$)/i);

  const reachable = new Set(['']);
  const pending = [''];
  while (pending.length) {
    const from = pending.shift();
    const entry = lock.packages[from];
    const groups = [entry.dependencies, from === '' ? entry.devDependencies : undefined, entry.optionalDependencies, entry.peerDependencies];
    for (const [index, dependencies] of groups.entries()) {
      for (const name of Object.keys(dependencies ?? {})) {
        if (index === 3 && entry.peerDependenciesMeta?.[name]?.optional) continue;
        const target = resolveLockedPackage(lock.packages, from, name);
        if (index !== 2) assert.ok(target, `${from || 'root'} is missing ${name}`);
        if (target && !reachable.has(target)) { reachable.add(target); pending.push(target); }
      }
    }
  }
  assert.equal(reachable.size, Object.keys(lock.packages).length, 'lockfile has orphan packages');
});
