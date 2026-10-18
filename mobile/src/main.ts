import { startPhoneApp } from './app.ts';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Encore app root is missing');
// The standalone phone build has no host source: Demo and Phone microphone only.
const app = startPhoneApp(root, {
  storage: {
    getItem: (key: string): string | null => window.localStorage.getItem(key),
    setItem: (key: string, value: string): void => window.localStorage.setItem(key, value),
  },
});
window.addEventListener('pagehide', () => app.dispose(), { once: true });
