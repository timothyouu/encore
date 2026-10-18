import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { serviceForOrigin, CURRENT_SERVICE_ORIGIN } from '../src/service.ts'
import { exactOrigin, prepareNetwork } from '../scripts/prepare-network.mjs'

const endpoints = {
  upload: `${CURRENT_SERVICE_ORIGIN}/api/recordings`,
  analysis: `${CURRENT_SERVICE_ORIGIN}/api/analyze`,
  coaching: `${CURRENT_SERVICE_ORIGIN}/api/coach`,
}

test('G2 host uses only the packaged exact HTTPS API origin', () => {
  assert.deepEqual(serviceForOrigin(CURRENT_SERVICE_ORIGIN), { origin: CURRENT_SERVICE_ORIGIN, endpoints })
  assert.equal(serviceForOrigin(undefined), null)
  assert.equal(exactOrigin(CURRENT_SERVICE_ORIGIN), CURRENT_SERVICE_ORIGIN)
  for (const value of ['https://evil.example', 'https://*.tail51e140.ts.net',
    `${CURRENT_SERVICE_ORIGIN}/api`, `${CURRENT_SERVICE_ORIGIN}?token=x`,
    'http://127.0.0.1:8799']) {
    assert.throws(() => serviceForOrigin(value), value)
    assert.throws(() => exactOrigin(value), value)
  }
})

test('generated manifest has one exact whitelist origin and SDK minimum', async () => {
  const output = await prepareNetwork(CURRENT_SERVICE_ORIGIN)
  const manifest = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(manifest.min_app_version, '2.2.10')
  assert.deepEqual(manifest.permissions.find(permission => permission.name === 'network').whitelist, [CURRENT_SERVICE_ORIGIN])
  const source = JSON.parse(await readFile(new URL('../app.json', import.meta.url), 'utf8'))
  assert.deepEqual(source.permissions.find(permission => permission.name === 'network').whitelist, [])
})
