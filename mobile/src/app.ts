import { SessionStore, type AttemptRecord } from './session.ts';
import { mountPhone } from './phone.ts';
import { PhoneCapture, validateEndpoints, type CaptureEndpoints } from './capture.ts';
import { mountConnection, type RecordingSource } from './connection.ts';
import { DisplaySettingsStore } from './settings.ts';
import { createIndexedDbPersistence, type LegacyStorage, type PhonePersistence } from './storage.ts';
import { initializeSentry } from './telemetry.ts';

/** A recording source with its own capture, supplied by a hosting page. */
export type CaptureDriver = {
  readonly busy: boolean;
  readonly recording: boolean;
  readonly error: string | null;
  start(): Promise<void>;
  stop(): Promise<void>;
  cancel(): void;
  dispose(): void;
};

/** What a host source gets: the session, the shared processing pipeline, and a change callback. */
export type HostSourceContext = {
  store: SessionStore;
  /** Normalize, upload, analyze and coach a completed G2 attempt. */
  submit(record: AttemptRecord, audio: Blob): Promise<void>;
  onChange(): void;
};

export type PhoneAppOptions = {
  storage: LegacyStorage;
  indexedDB?: IDBFactory;
  sentry?: Parameters<typeof initializeSentry>[0];
  /** The G2 capture driver supplied by the hosting page. */
  hostSource?: { id: 'g2'; create(context: HostSourceContext): CaptureDriver };
  /** Device connection text from the host; omitted, the phone says glasses are not connected. */
  deviceStatus?: () => string | null;
  /** Host-only protected service; token lives in the host WebView session, never in persistence. */
  service?: { endpoints: CaptureEndpoints; origin: string; getSessionToken(): string; setSessionToken(token: string): void };
};

export type PhoneApp = {
  store: SessionStore;
  settings: DisplaySettingsStore;
  /** The same start/stop/cancel the phone controls use; start/stop settle when the capture source has. */
  start(): Promise<void>;
  stop(): Promise<void>;
  cancel(): void;
  /** Re-render after host state (e.g. device status) changes. */
  refresh(): void;
  dispose(): void;
};

const DEFAULT_ENDPOINTS: CaptureEndpoints = { upload: '/api/recordings', analysis: '/api/analyze', coaching: '/api/coach' };

/** Boots the phone UI into `root`. Capture is supplied by the G2 host. */
export async function startPhoneApp(root: HTMLElement, options: PhoneAppOptions): Promise<PhoneApp> {
  if (options.sentry) initializeSentry(options.sentry);
  const storage = options.storage;
  const store = new SessionStore(storage);
  const settings = new DisplaySettingsStore(storage);
  let persistence: PhonePersistence | undefined;
  try {
    if (!options.indexedDB) throw new Error('IndexedDB is unavailable');
    persistence = await createIndexedDbPersistence(options.indexedDB, storage);
    await store.hydrate(persistence);
    await settings.hydrate(persistence);
    await persistence.hydrateAudio();
    if (persistence.warning) store.warnStorage(persistence.warning);
  } catch {
    store.warnStorage('Local storage is unavailable. History and recording retries may last only for this session.');
    settings.storageWarning = 'Local display settings storage is unavailable. Changes may last only for this session.';
    persistence = undefined;
  }
  const sources: RecordingSource[] = ['g2'];
  let mode: RecordingSource = 'g2';
  // The shared pipeline processes host recordings, while capture itself stays in G2.
  let phone: PhoneCapture | undefined;
  let driver: CaptureDriver | undefined;
  async function start(): Promise<void> {
    if (settings.isOpen) return;
    if (!driver) { connection.message('G2 is unavailable. Start the G2 app to record.'); return; }
    await driver.start();
  }
  async function stop(): Promise<void> {
    await driver?.stop();
  }
  function cancel(): void {
    driver?.cancel(); phone?.cancel();
  }
  const refresh = (): void => { root.dispatchEvent(new CustomEvent('encore:mode-change')); };
  const busy = (): boolean => Boolean(phone?.busy || driver?.busy);
  const recording = (): boolean => Boolean(phone?.recording || driver?.recording);
  const unmount = mountPhone(root, store, {
    start: () => { void start(); }, stop: () => { void stop(); }, cancel,
    retry: () => { void phone?.retry(); },
    canRetry: (attemptId: string) => phone?.canRetry(attemptId) ?? false,
    getMode: () => mode, isBusy: busy, isCaptureAvailable: () => Boolean(driver), deviceStatus: options.deviceStatus,
  }, settings);
  function onChange(): void {
    refresh();
    connection.message(driver?.error ?? phone?.error ?? (busy() && store.state.screen === 'ready' ? 'Waiting for G2 input. You can cancel below.' : null));
    permissionCancel.hidden = !(busy() && !recording() && store.state.screen === 'ready');
  }
  function pipeline(endpoints: CaptureEndpoints): PhoneCapture {
    return new PhoneCapture(store, endpoints, onChange, persistence, options.service ? () => {
      const token = options.service?.getSessionToken();
      return token ? { token, origin: options.service!.origin } : undefined;
    } : undefined);
  }
  const connection = mountConnection(store, root, next => {
    if (busy() || recording() || ['recording', 'processing'].includes(store.state.screen)) return 'Finish or cancel the current recording first.';
    if (!validateEndpoints(next)) return 'Enter valid upload, analysis, and coaching endpoints. Use /api paths, HTTPS, or HTTP localhost.';
    if (options.service && (next.upload !== options.service.endpoints.upload ||
        next.analysis !== options.service.endpoints.analysis || next.coaching !== options.service.endpoints.coaching))
      return 'This G2 package is limited to its approved service origin.';
    if (next.mode === mode && phone) {
      return phone.updateEndpoints(next) ? null : 'Could not update the connection while recording is active.';
    }
    driver?.dispose(); driver = undefined;
    phone?.dispose(); phone = undefined;
    mode = next.mode;
    phone = pipeline(next);
    driver = createHostDriver(phone);
    refresh();
    return null;
  }, { sources, defaults: options.service?.endpoints ?? DEFAULT_ENDPOINTS,
    locked: Boolean(options.service), onSessionToken: options.service?.setSessionToken });
  function createHostDriver(processor: PhoneCapture | undefined): CaptureDriver | undefined {
    if (!processor || options.hostSource?.id !== 'g2') return undefined;
    return options.hostSource.create({
      store, onChange,
      submit: (record, audio) => processor.processRecording(record, audio),
    });
  }
  const permissionCancel = document.createElement('button');
  permissionCancel.type = 'button'; permissionCancel.hidden = true; permissionCancel.textContent = 'Cancel input request';
  permissionCancel.style.cssText = 'margin:12px auto;min-height:44px;padding:12px 24px;border:1px solid #625F58;border-radius:24px;';
  permissionCancel.addEventListener('click', () => { driver?.cancel(); phone?.cancel(); });
  root.after(permissionCancel);
  phone = pipeline(options.service?.endpoints ?? DEFAULT_ENDPOINTS);
  driver = createHostDriver(phone);
  const unsubscribeSettings = settings.subscribe(() => connection.setVisible(!settings.isOpen));
  let disposed = false;
  return {
    store, settings, start, stop, cancel, refresh,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      store.interrupt();
      unsubscribeSettings(); driver?.dispose(); phone?.dispose(); connection.dispose(); permissionCancel.remove(); unmount();
    },
  };
}
