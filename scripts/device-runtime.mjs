// Local verification launcher. Provider calls remain disabled until physical capture is verified.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as httpModule from '../server/src/http.ts';

const { createCoachServer, loadLibrary } = httpModule.default ?? httpModule;
const run = fileURLToPath(new URL('../.run/', import.meta.url));
mkdirSync(run, { recursive: true, mode: 0o700 });
const origin = process.env.ENCORE_DEVICE_ORIGIN ?? 'http://localhost:5196';
const parsed = new URL(origin);
if (parsed.origin !== origin || parsed.username || parsed.password ||
    !(parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)))) {
  throw new Error('One exact approved client origin is required.');
}
const tokenPath = '/home/tim/projects/encore-verify/.run/g2-tunnel-session-token';
const token = readFileSync(tokenPath, 'utf8').trim();
if (token.length < 32) throw new Error('Existing session token is unavailable.');
const port = Number(process.env.ENCORE_DEVICE_PORT ?? '8799');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local port.');
const server = createCoachServer({
  library: await loadLibrary(), chooser: null, token, allowedOrigin: origin,
  analysisUrl: 'http://127.0.0.1:8012/v1/analyze',
  publicBaseUrl: 'https://timothylggram.tail51e140.ts.net',
  observeRequest(event) {
    // Restrict diagnostics to the explicitly redacted server observation schema.
    appendFileSync(`${run}/device-requests.jsonl`, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n', { mode: 0o600 });
  },
});
server.requestTimeout = 70_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'device-backend-ready', port, allowedOrigin: origin, modelConfigured: false }));
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
