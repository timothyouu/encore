import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProviderConfig } from './provider-config.js';
import { isQuotaError } from './quota.js';

test('placeholder disables provider; unverified keys and alternate models are rejected', () => {
  assert.equal(parseProviderConfig({ GEMINI_API_KEY: 'PASTE_YOUR_FREE_TIER_KEY_HERE' }), null);
  assert.throws(() => parseProviderConfig({ GEMINI_API_KEY: 'test-key' }), /Confirm/);
  const verified = { GEMINI_API_KEY: 'test-key', ENCORE_FREE_TIER_VERIFIED: 'true', ENCORE_FREE_TIER_PROJECT_ID: 'my-free-project', ENCORE_GEMINI_MODEL: 'gemini-2.5-flash' };
  assert.equal(parseProviderConfig(verified)?.modelId, 'gemini-2.5-flash');
  assert.throws(() => parseProviderConfig({ ...verified, ENCORE_GEMINI_MODEL: 'another-provider' }));
});
test('quota recognition handles SDK wrappers without leaking error messages', () => {
  assert.equal(isQuotaError({ cause: { status: 429 } }), true);
  assert.equal(isQuotaError({ error: { status: 'RESOURCE_EXHAUSTED' } }), true);
  assert.equal(isQuotaError(new Error('ordinary failure')), false);
});