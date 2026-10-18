import { startPhoneApp } from './app.ts';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Encore app root is missing');
// The standalone phone build has no host source: Demo and Phone microphone only.
const app = await startPhoneApp(root, {
  storage: {
    getItem: (key: string): string | null => window.localStorage.getItem(key),
    setItem: (key: string, value: string): void => window.localStorage.setItem(key, value),
    removeItem: (key: string): void => window.localStorage.removeItem(key),
  },
  indexedDB: window.indexedDB,
  sentry: {
    VITE_SENTRY_ENABLED: import.meta.env.VITE_SENTRY_ENABLED,
    VITE_SENTRY_DSN: import.meta.env.VITE_SENTRY_DSN,
    VITE_SENTRY_ENVIRONMENT: import.meta.env.VITE_SENTRY_ENVIRONMENT,
  },
});
window.addEventListener('pagehide', () => app.dispose(), { once: true });
