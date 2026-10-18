import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createCoachServer, loadLibrary } from './http.js';

const library = await loadLibrary();
const token = 'origin-test-only-token-with-32-characters';

test('opt-in loopback apps can change ports while protected routes still require the token', async t => {
  const server = createCoachServer({ library, chooser: null, token,
    allowedOrigin: 'https://approved.example', allowLoopbackClientOrigins: true });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const origin of ['http://127.0.0.1:50979', 'http://127.0.0.1:51068', 'http://localhost:62123', 'http://[::1]:5173']) {
    const preflight = await fetch(base + '/api/recordings', { method: 'OPTIONS', headers: { Origin: origin } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
    assert.equal((await fetch(base + '/api/recordings', { headers: { Origin: origin } })).status, 401);
    assert.equal((await fetch(base + '/api/recordings', { headers: { Origin: origin, Authorization: 'Bearer invalid' } })).status, 401);
    assert.equal((await fetch(base + '/api/recordings', { headers: { Origin: origin, Authorization: 'Bearer ' + token } })).status, 405);
  }
  for (const origin of ['https://evil.example', 'http://localhost.evil.example:51068', 'http://127.0.0.1.evil.example:51068',
    'null', 'http://user@127.0.0.1:51068', 'http://127.0.0.1:51068/path', 'http://192.168.1.2:51068']) {
    const response = await fetch(base + '/api/recordings', { headers: { Origin: origin, Authorization: 'Bearer ' + token } });
    assert.equal(response.status, 403, origin);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
});

test('strict origins remain the default and loopback flexibility cannot be enabled without strong authentication', async t => {
  assert.throws(() => createCoachServer({ library, chooser: null, allowLoopbackClientOrigins: true }), /session token/);
  assert.throws(() => createCoachServer({ library, chooser: null, token: 'short', allowLoopbackClientOrigins: true }), /session token/);
  const server = createCoachServer({ library, chooser: null, token, allowedOrigin: 'http://127.0.0.1:50979' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  assert.equal((await fetch(base + '/api/recordings', { headers: { Origin: 'http://127.0.0.1:51068', Authorization: 'Bearer ' + token } })).status, 403);
});
