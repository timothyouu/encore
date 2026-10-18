import type { PhonePersistence } from './storage.ts';

export type DisplaySettings = {
  schemaVersion: '1';
  showSheetMusicWhilePlaying: boolean;
  sheetMusicSize: 'standard' | 'large';
  showNoteNames: boolean;
};

type SettingsStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };
export const DISPLAY_SETTINGS_KEY = 'encore.display-settings.v1';
export const DEFAULT_DISPLAY_SETTINGS: Readonly<DisplaySettings> = Object.freeze({
  schemaVersion: '1', showSheetMusicWhilePlaying: true, sheetMusicSize: 'large', showNoteNames: true,
});
const EDITABLE_KEYS = new Set(['showSheetMusicWhilePlaying', 'sheetMusicSize', 'showNoteNames']);
const SETTINGS_SCREENS = new Set(['library', 'ready', 'review', 'guide', 'sheet', 'history', 'error']);

function plainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validPatch(value: unknown): value is Partial<Omit<DisplaySettings, 'schemaVersion'>> {
  if (!plainObject(value) || Object.keys(value).some(key => !EDITABLE_KEYS.has(key))) return false;
  return (!Object.hasOwn(value, 'showSheetMusicWhilePlaying') || typeof value.showSheetMusicWhilePlaying === 'boolean') &&
    (!Object.hasOwn(value, 'showNoteNames') || typeof value.showNoteNames === 'boolean') &&
    (!Object.hasOwn(value, 'sheetMusicSize') || value.sheetMusicSize === 'standard' || value.sheetMusicSize === 'large');
}

function parseSettings(raw: string): Readonly<DisplaySettings> {
  const saved: unknown = JSON.parse(raw);
  if (!plainObject(saved) || saved.schemaVersion !== '1' || typeof saved.showSheetMusicWhilePlaying !== 'boolean') throw new Error('Invalid display settings');
  const { schemaVersion: _version, ...patch } = saved;
  if (!validPatch(patch)) throw new Error('Invalid display settings');
  return Object.freeze({ ...DEFAULT_DISPLAY_SETTINGS, ...patch });
}

export class DisplaySettingsStore {
  private snapshot: Readonly<DisplaySettings> = DEFAULT_DISPLAY_SETTINGS;
  private opened = false;
  private storage: SettingsStorage | undefined;
  private persistence: PhonePersistence | undefined;
  private listeners = new Set<() => void>();
  storageWarning: string | null = null;

  constructor(storage?: SettingsStorage) {
    try {
      this.storage = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
      const raw = this.storage?.getItem(`${DISPLAY_SETTINGS_KEY}.migrated`) === '1' ? null : this.storage?.getItem(DISPLAY_SETTINGS_KEY);
      if (!raw) return;
      this.restore(raw);
    } catch {
      this.storageWarning = 'Display settings could not be loaded. Default preferences are in use.';
    }
  }

  async hydrate(persistence: PhonePersistence): Promise<void> {
    try {
      const raw = await persistence.load(DISPLAY_SETTINGS_KEY, value => {
        try { parseSettings(value); return true; } catch { return false; }
      });
      this.persistence = persistence;
      this.snapshot = DEFAULT_DISPLAY_SETTINGS;
      if (raw) this.restore(raw);
      this.storageWarning = persistence.warning;
    } catch {
      this.storageWarning = 'Local display settings storage is unavailable. Changes may last only for this session.';
    }
    this.emit();
  }

  private restore(raw: string): void {
    // Accept the original v1 single-toggle shape; new preferences retain their defaults.
    this.snapshot = parseSettings(raw);
  }

  get value(): Readonly<DisplaySettings> { return this.snapshot; }
  get isOpen(): boolean { return this.opened; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(): void { for (const listener of this.listeners) listener(); }

  open(screen: string): boolean {
    if (!SETTINGS_SCREENS.has(screen)) return false;
    if (!this.opened) { this.opened = true; this.emit(); }
    return true;
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.emit();
  }

  update(patch: unknown): boolean {
    if (!validPatch(patch)) return false;
    const next: Readonly<DisplaySettings> = Object.freeze({ ...this.snapshot, ...patch });
    if (next.showSheetMusicWhilePlaying === this.snapshot.showSheetMusicWhilePlaying &&
        next.sheetMusicSize === this.snapshot.sheetMusicSize && next.showNoteNames === this.snapshot.showNoteNames) return true;
    this.snapshot = next;
    if (this.persistence) {
      void this.persistence.save(DISPLAY_SETTINGS_KEY, JSON.stringify(next)).then(() => {
        this.storageWarning = null;
      }, () => {
        this.storageWarning = 'Display settings could not be saved. Changes apply to this session only.';
        this.emit();
      });
      this.emit();
      return true;
    }
    try {
      if (this.storage) {
        this.storage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(next));
        this.storageWarning = null;
      } else this.storageWarning = 'Display settings are available for this session only.';
    } catch {
      this.storageWarning = 'Display settings could not be saved. Changes apply to this session only.';
    }
    this.emit();
    return true;
  }
}
