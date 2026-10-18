import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));

test('synthetic device runner rejects model-enabled backend before token access or POST', async t => {
  const seen = [];
  const server = createServer((request, response) => {
    seen.push({ method: request.method, path: request.url });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, modelConfigured: true }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const missingToken = '/tmp/encore-shipping-guard-token-does-not-exist';
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', 'acceptance/device-http.mjs', base, missingToken],
      { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => resolve({ code, output }));
  });
  assert.notEqual(result.code, 0);
  assert.match(result.output, /fixture runner requires offline coaching/);
  assert.doesNotMatch(result.output, /ENOENT|device-session-token/);
  assert.deepEqual(seen, [{ method: 'GET', path: '/health' }]);
});