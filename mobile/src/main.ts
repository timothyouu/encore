import { SessionStore } from './session.ts';
import { mountPhone } from './phone.ts';
import { PhoneCapture, validateEndpoints } from './capture.ts';
import { mountConnection } from './connection.ts';
import { DisplaySettingsStore } from './settings.ts';
import { createIndexedDbPersistence, type PhonePersistence } from './storage.ts';
import { initializeSentry } from './telemetry.ts';

initializeSentry({
  VITE_SENTRY_ENABLED: import.meta.env.VITE_SENTRY_ENABLED,
  VITE_SENTRY_DSN: import.meta.env.VITE_SENTRY_DSN,
  VITE_SENTRY_ENVIRONMENT: import.meta.env.VITE_SENTRY_ENVIRONMENT,
});

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Encore app root is missing');
const storage = {
  getItem: (key: string): string | null => window.localStorage.getItem(key),
  setItem: (key: string, value: string): void => window.localStorage.setItem(key, value),
  removeItem: (key: string): void => window.localStorage.removeItem(key),
};
const store = new SessionStore(storage);
const settings = new DisplaySettingsStore(storage);
let persistence: PhonePersistence | undefined;
try {
  persistence = await createIndexedDbPersistence(window.indexedDB, storage);
  await store.hydrate(persistence);
  await settings.hydrate(persistence);
  await persistence.hydrateAudio();
  if (persistence.warning) store.warnStorage(persistence.warning);
} catch {
  store.warnStorage('Local storage is unavailable. History and recording retries may last only for this session.');
  settings.storageWarning = 'Local display settings storage is unavailable. Changes may last only for this session.';
  persistence = undefined;
}
let phone: PhoneCapture | undefined;
function start(): void {
  if (!settings.isOpen) void phone?.start();
}
function stop(): void { void phone?.stop(); }
function cancel(): void { phone?.cancel(); }
const unmount = mountPhone(root, store, { start, stop, cancel,
  retry: () => { void phone?.retry(); }, importWav: (blob: Blob) => { void phone?.processWavBlob(blob); },
  canRetry: (attemptId: string) => phone?.canRetry(attemptId) ?? false,
  isBusy: () => Boolean(phone?.busy),
  getWaveform: () => phone?.getWaveform() ?? null }, settings);
const connection = mountConnection(store, root, next => {
  if (phone?.busy || phone?.recording || ['recording', 'processing'].includes(store.state.screen)) return 'Finish or cancel the current recording first.';
  if (!validateEndpoints(next)) return 'Enter valid upload, analysis, and coaching endpoints. Use /api paths, HTTPS, or HTTP localhost.';
  return phone?.updateEndpoints(next) ? null : 'Could not update the connection while recording is active.';
});
const permissionCancel = document.createElement('button');
permissionCancel.type = 'button'; permissionCancel.hidden = true; permissionCancel.textContent = 'Cancel microphone request';
permissionCancel.style.cssText = 'margin:12px auto;min-height:44px;padding:12px 24px;border:1px solid #625F58;border-radius:24px;';
permissionCancel.addEventListener('click', () => phone?.cancel());
root.after(permissionCancel);
phone = new PhoneCapture(store, { upload: '/api/recordings', analysis: '/api/analyze', coaching: '/api/coach' }, () => {
  root.dispatchEvent(new CustomEvent('encore:mode-change'));
  connection.message(phone?.error ?? (phone?.busy && store.state.screen === 'ready' ? 'Waiting for microphone permission. You can cancel below.' : null));
  permissionCancel.hidden = !(phone?.busy && !phone.recording && store.state.screen === 'ready');
}, persistence);
const unsubscribeSettings = settings.subscribe(() => connection.setVisible(!settings.isOpen));
window.addEventListener('pagehide', () => {
  store.interrupt();
  unsubscribeSettings(); phone?.dispose(); connection.dispose(); unmount();
}, { once: true });
