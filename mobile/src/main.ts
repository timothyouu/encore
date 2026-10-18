import { SessionStore, fixtureAnalysis, fixtureCoaching } from './session.ts';
import { mountPhone } from './phone.ts';
import { PhoneCapture, validateEndpoints } from './capture.ts';
import { mountConnection } from './connection.ts';
import { DisplaySettingsStore } from './settings.ts';
import { createIndexedDbPersistence, type PhonePersistence } from './storage.ts';

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
type Scenario = 'mistakes' | 'clean' | 'uncertain' | 'error';
let scenario: Scenario = 'mistakes';
let activeScenario: Scenario = 'mistakes';
let mode: 'demo' | 'phone' = 'phone';
let phone: PhoneCapture | undefined;
let captureLimit: ReturnType<typeof setTimeout> | undefined;
const pending = new Set<ReturnType<typeof setTimeout>>();
root.addEventListener('encore:scenario', (event: Event) => {
  const value: unknown = (event as CustomEvent<{ scenario: unknown }>).detail?.scenario;
  if (value === 'mistakes' || value === 'clean' || value === 'uncertain' || value === 'error') scenario = value;
});
function start(): void {
  if (settings.isOpen) return;
  if (mode === 'phone') { void phone?.start(); return; }
  if (!store.start()) return;
  activeScenario = scenario;
  captureLimit = setTimeout(stop, 30_000);
}
function stop(): void {
  if (mode === 'phone') { void phone?.stop(); return; }
  const record = store.stop();
  if (!record) return;
  clearTimeout(captureLimit);
  const selectedScenario = activeScenario;
  // Demo driver: no microphone is used and no audio is uploaded.
  const timer = setTimeout(() => {
    pending.delete(timer);
    if (selectedScenario === 'error') {
      store.fail(record.attemptId, 'analysis', 'Demo analysis service unavailable. Your completed recording is still saved.');
      return;
    }
    if (store.applyAnalysis(record.attemptId, fixtureAnalysis(record, selectedScenario))) {
      const saved = store.records.find(item => item.attemptId === record.attemptId);
      if (saved?.analysis?.status === 'ok') store.applyCoaching(record.attemptId, fixtureCoaching(saved));
    }
  }, 900);
  pending.add(timer);
}
function cancel(): void {
  clearTimeout(captureLimit);
  if (mode === 'phone') phone?.cancel(); else store.cancel();
}
const unmount = mountPhone(root, store, { start, stop, cancel,
  retry: () => { void phone?.retry(); }, importWav: (blob: Blob) => { void phone?.processWavBlob(blob); },
  canRetry: (attemptId: string) => phone?.canRetry(attemptId) ?? false,
  getMode: () => mode, isBusy: () => Boolean(phone?.busy) }, settings);
const connection = mountConnection(store, root, next => {
  if (phone?.busy || phone?.recording || ['recording', 'processing'].includes(store.state.screen)) return 'Finish or cancel the current recording first.';
  if (next.mode === 'phone' && !validateEndpoints(next)) return 'Enter valid upload, analysis, and coaching endpoints. Use /api paths, HTTPS, or HTTP localhost.';
  if (mode === 'phone' && next.mode === 'phone' && phone) {
    return phone.updateEndpoints(next) ? null : 'Could not update the connection while recording is active.';
  }
  phone?.dispose(); phone = undefined;
  mode = next.mode;
  if (mode === 'phone') phone = new PhoneCapture(store, next, () => {
    root.dispatchEvent(new CustomEvent('encore:mode-change'));
    connection.message(phone?.error ?? (phone?.busy && store.state.screen === 'ready' ? 'Waiting for microphone permission. You can cancel below.' : null));
    permissionCancel.hidden = !(phone?.busy && !phone.recording && store.state.screen === 'ready');
  }, persistence);
  root.dispatchEvent(new CustomEvent('encore:mode-change'));
  return null;
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
  clearTimeout(captureLimit);
  for (const timer of pending) clearTimeout(timer);
  store.interrupt();
  unsubscribeSettings(); phone?.dispose(); connection.dispose(); unmount();
}, { once: true });
