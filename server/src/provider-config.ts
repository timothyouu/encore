import { readFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';

export function parseProviderConfig(values: Record<string, string | undefined>): { apiKey: string; modelId: string } | null {
  const apiKey = values.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'PASTE_YOUR_FREE_TIER_KEY_HERE') return null;
  if (values.ENCORE_FREE_TIER_VERIFIED !== 'true' ||
      !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(values.ENCORE_FREE_TIER_PROJECT_ID ?? '')) {
    throw new Error('Confirm the key/project Free-tier status in server/.env before enabling Gemini.');
  }
  if (values.ENCORE_GEMINI_MODEL !== 'gemini-2.5-flash') {
    throw new Error('Only the configured Gemini model is allowed; no model fallback.');
  }
  return { apiKey, modelId: 'gemini-2.5-flash' };
}

export function loadProviderConfig(): ReturnType<typeof parseProviderConfig> {
  if (process.env.ENCORE_OFFLINE === 'true') return null;
  const path = new URL('../.env', import.meta.url);
  if (!existsSync(path)) return null;
  // Explicit file only: never fall back to ambient API keys or cloud credentials.
  return parseProviderConfig(parseEnv(readFileSync(path, 'utf8')));
}