import { SessionStore, fixtureAnalysis, fixtureCoaching } from './session.ts';
import { mountPhone } from './phone.ts';
import { PhoneCapture, validateEndpoints, type CaptureEndpoints } from './capture.ts';
import { mountConnection, type RecordingSource } from './connection.ts';
import { DisplaySettingsStore } from './settings.ts';

type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

/** A recording source with its own capture; PhoneCapture is one. */
export type CaptureDriver = {
  readonly busy: boolean;
  readonly recording: boolean;
  readonly error: string | null;
  start(): Promise<void>;
  stop(): Promise<void>;
  cancel(): void;
  dispose(): void;
};

export type PhoneAppOptions = {
  storage: Storage;
  /** A source supplied by the hosting page, e.g. a glasses microphone. The phone app never creates one itself. */
  hostSource?: { id: 'g2'; create(store: SessionStore, endpoints: CaptureEndpoints, onChange: () => void): CaptureDriver };
  /** Device connection text from the host; omitted, the phone says glasses are not connected. */
  deviceStatus?: () => string | null;
};

export type PhoneApp = {
  store: SessionStore;
  settings: DisplaySettingsStore;
  /** The same start/stop/cancel the phone controls use. */
  start(): void;
  stop(): void;
  cancel(): void;
  /** Re-render after host state (e.g. device status) changes. */
  refresh(): void;
  dispose(): void;
};

type Scenario = 'mistakes' | 'clean' | 'uncertain' | 'error';

/** Boots the phone UI into `root`. Phone DOM only; any device work belongs to the host's driver. */
export function startPhoneApp(root: HTMLElement, options: PhoneAppOptions): PhoneApp {
  const store = new SessionStore(options.storage);
  const settings = new DisplaySettingsStore(options.storage);
  const sources: RecordingSource[] = options.hostSource ? ['demo', 'phone', options.hostSource.id] : ['demo', 'phone'];
  let scenario: Scenario = 'mistakes';
  let activeScenario: Scenario = 'mistakes';
  let mode: RecordingSource = 'demo';
  let driver: CaptureDriver | undefined;
  let captureLimit: ReturnType<typeof setTimeout> | undefined;
  const pending = new Set<ReturnType<typeof setTimeout>>();
  root.addEventListener('encore:scenario', (event: Event) => {
    const value: unknown = (event as CustomEvent<{ scenario: unknown }>).detail?.scenario;
    if (value === 'mistakes' || value === 'clean' || value === 'uncertain' || value === 'error') scenario = value;
  });
  function start(): void {
    if (settings.isOpen) return;
    if (mode !== 'demo') { void driver?.start(); return; }
    if (!store.start()) return;
    activeScenario = scenario;
    captureLimit = setTimeout(stop, 30_000);
  }
  function stop(): void {
    if (mode !== 'demo') { void driver?.stop(); return; }
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
    if (mode !== 'demo') driver?.cancel(); else store.cancel();
  }
  const refresh = (): void => { root.dispatchEvent(new CustomEvent('encore:mode-change')); };
  const unmount = mountPhone(root, store, {
    start, stop, cancel, getMode: () => mode, isBusy: () => Boolean(driver?.busy), deviceStatus: options.deviceStatus,
  }, settings);
  const connection = mountConnection(store, root, next => {
    if (driver?.busy || driver?.recording || ['recording', 'processing'].includes(store.state.screen)) return 'Finish or cancel the current recording first.';
    if (next.mode !== 'demo' && !validateEndpoints(next)) return 'Enter both complete HTTPS endpoints (or HTTP localhost). URLs cannot include passwords or fragments.';
    driver?.dispose(); driver = undefined;
    mode = next.mode;
    const onChange = (): void => {
      refresh();
      connection.message(driver?.error ?? (driver?.busy && store.state.screen === 'ready' ? 'Waiting for microphone permission. You can cancel below.' : null));
      permissionCancel.hidden = !(driver?.busy && !driver.recording && store.state.screen === 'ready');
    };
    if (mode === 'phone') driver = new PhoneCapture(store, next, onChange);
    else if (mode !== 'demo' && options.hostSource?.id === mode) driver = options.hostSource.create(store, next, onChange);
    refresh();
    return null;
  }, sources);
  const permissionCancel = document.createElement('button');
  permissionCancel.type = 'button'; permissionCancel.hidden = true; permissionCancel.textContent = 'Cancel microphone request';
  permissionCancel.style.cssText = 'margin:12px auto;min-height:44px;padding:12px 24px;border:1px solid #625F58;border-radius:24px;';
  permissionCancel.addEventListener('click', () => driver?.cancel());
  root.after(permissionCancel);
  const unsubscribeSettings = settings.subscribe(() => connection.setVisible(!settings.isOpen));
  let disposed = false;
  return {
    store, settings, start, stop, cancel, refresh,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      clearTimeout(captureLimit);
      for (const timer of pending) clearTimeout(timer);
      store.interrupt();
      unsubscribeSettings(); driver?.dispose(); connection.dispose(); permissionCancel.remove(); unmount();
    },
  };
}
