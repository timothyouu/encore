import { SessionStore, fixtureAnalysis, fixtureCoaching } from './session.ts';
import { mountPhone } from './phone.ts';
import { PhoneCapture, validateEndpoints } from './capture.ts';
import { mountConnection } from './connection.ts';
import { connectDisplay } from './display.ts';
import { DisplaySettingsStore } from './settings.ts';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Encore app root is missing');
const storage = {
  getItem: (key: string): string | null => window.localStorage.getItem(key),
  setItem: (key: string, value: string): void => window.localStorage.setItem(key, value),
};
const store = new SessionStore(storage);
const settings = new DisplaySettingsStore(storage);
type Scenario = 'mistakes' | 'clean' | 'uncertain' | 'error';
let scenario: Scenario = 'mistakes';
let activeScenario: Scenario = 'mistakes';
let mode: 'demo' | 'phone' = 'demo';
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
const display = connectDisplay(store, { start, stop, cancel, getMode: () => mode }, { settings, canOpenSettings: () => !phone?.busy });
const unmount = mountPhone(root, store, { start, stop, cancel, exit: () => { void display.exit(); }, getMode: () => mode, isBusy: () => Boolean(phone?.busy) }, settings);
const connection = mountConnection(store, root, next => {
  if (phone?.busy || phone?.recording || ['recording', 'processing'].includes(store.state.screen)) return 'Finish or cancel the current recording first.';
  if (next.mode === 'phone' && !validateEndpoints(next)) return 'Enter both complete HTTPS endpoints (or HTTP localhost). URLs cannot include passwords or fragments.';
  phone?.dispose(); phone = undefined;
  mode = next.mode;
  if (mode === 'phone') phone = new PhoneCapture(store, next, () => {
    root.dispatchEvent(new CustomEvent('encore:mode-change'));
    connection.message(phone?.error ?? (phone?.busy && store.state.screen === 'ready' ? 'Waiting for microphone permission. You can cancel below.' : null));
    permissionCancel.hidden = !(phone?.busy && !phone.recording && store.state.screen === 'ready');
  });
  root.dispatchEvent(new CustomEvent('encore:mode-change'));
  return null;
});
const permissionCancel = document.createElement('button');
permissionCancel.type = 'button'; permissionCancel.hidden = true; permissionCancel.textContent = 'Cancel microphone request';
permissionCancel.style.cssText = 'margin:12px auto;min-height:44px;padding:12px 24px;border:1px solid #625F58;border-radius:24px;';
permissionCancel.addEventListener('click', () => phone?.cancel());
root.after(permissionCancel);
const unsubscribeSettings = settings.subscribe(() => connection.setVisible(!settings.isOpen));
window.addEventListener('pagehide', () => {
  clearTimeout(captureLimit);
  for (const timer of pending) clearTimeout(timer);
  store.interrupt();
  unsubscribeSettings(); phone?.dispose(); display.dispose(); connection.dispose(); unmount();
}, { once: true });
