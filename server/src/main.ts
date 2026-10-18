import { loadProviderConfig } from './provider-config.js';
import { createGeminiChooser } from './coaching.js';
import { createCoachServer, isLoopbackHost, loadLibrary } from './http.js';

const host = process.env.ENCORE_COACH_HOST ?? '127.0.0.1';
const portText = process.env.ENCORE_COACH_PORT ?? '8788';
const port = Number(portText);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('ENCORE_COACH_PORT must be a valid port');
const token = process.env.ENCORE_COACH_TOKEN;
const allowedOrigin = process.env.ENCORE_ALLOWED_ORIGIN ?? (isLoopbackHost(host) ? 'http://localhost:5176' : undefined);
if (!isLoopbackHost(host) && (!token || token.length < 32 || !allowedOrigin || !allowedOrigin.startsWith('https://'))) {
  throw new Error('Remote binding requires ENCORE_COACH_TOKEN (32+ chars) and an HTTPS ENCORE_ALLOWED_ORIGIN');
}
if (!isLoopbackHost(host) && (!process.env.ENCORE_PUBLIC_BASE_URL ||
    !process.env.ENCORE_PUBLIC_BASE_URL.startsWith('https://'))) {
  throw new Error('Remote binding requires an HTTPS ENCORE_PUBLIC_BASE_URL');
}
const library = await loadLibrary();
const provider = loadProviderConfig();
const chooser = provider ? createGeminiChooser(provider.apiKey, provider.modelId) : null;
const server = createCoachServer({ library, chooser, token, allowedOrigin,
  analysisUrl: process.env.ENCORE_ANALYSIS_URL, publicBaseUrl: process.env.ENCORE_PUBLIC_BASE_URL });
server.requestTimeout = 70_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.listen(port, host, () => {
  process.stdout.write('Encore coaching listening on ' + host + ':' + String(port) + '; Gemini configured: ' + String(Boolean(provider)) + '\n');
});
