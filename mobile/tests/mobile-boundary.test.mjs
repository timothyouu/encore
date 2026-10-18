import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobile = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = join(mobile, 'src');
const forbiddenApi = /@evenrealities|\b(?:waitForEvenAppBridge|EvenAppBridge|onEvenHubEvent|createStartUpPageContainer|rebuildPageContainer|shutDownPageContainer|textContainerUpgrade|graphicContainerUpgrade|updateImageRawData|flutter_inappwebview|ReactNativeWebView|messageHandlers|callHandler)\b|encore:connection/;

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

function assertPhoneOnlySource(content, path) {
  assert.doesNotMatch(content, forbiddenApi, relative(mobile, path));
  for (const match of content.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g)) {
    const specifier = match[1];
    assert.doesNotMatch(specifier, /(?:^|\/)g2(?:\/|$)|(?:^|\/)display(?:\.[jt]s)?$/i, `${relative(mobile, path)} imports ${specifier}`);
    if (!specifier.startsWith('.')) {
      assert.equal(path, join(mobile, 'vite.config.ts'), `${relative(mobile, path)} imports external package ${specifier}`);
      assert.equal(specifier, 'vite');
      continue;
    }
    const target = resolve(dirname(path), specifier);
    const withinSource = relative(sourceRoot, target);
    assert.ok(withinSource && withinSource !== '..' && !withinSource.startsWith(`..${sep}`), `${relative(mobile, path)} escapes src: ${specifier}`);
    assert.ok(existsSync(target), `${relative(mobile, path)} imports a missing file: ${specifier}`);
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

test('boundary rejects an SDK display adapter and native bridge routes', () => {
  const path = join(sourceRoot, 'fixture.ts');
  for (const source of [
    "import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk';",
    'bridge.updateImageRawData(image);',
    "globalThis.flutter_inappwebview.callHandler('display', content);",
    "window.webkit.messageHandlers.glasses.postMessage(content);",
    'window.ReactNativeWebView.postMessage(content);',
    "import { display } from '../../g2/bridge.ts';",
  ]) {
    assert.throws(() => assertPhoneOnlySource(source, path), { name: 'AssertionError' }, source);
  }
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
