// Phone-local persistence. All writes share one queue so an older snapshot cannot win a race.
export type LegacyStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
};

export type SavedAudio = {
  attemptId: string;
  wav: Uint8Array;
  sampleRate: 22050;
  sourceSampleRate: number;
  channels: 1;
  encoding: 'pcm_s16le';
  durationSec: number;
  savedAt: number;
};

export type PersistenceBackend = {
  get(store: 'state' | 'audio', key: string): Promise<unknown>;
  put(store: 'state' | 'audio', key: string, value: unknown): Promise<void>;
  delete(store: 'state' | 'audio', key: IDBValidKey): Promise<void>;
  values(store: 'audio'): Promise<SavedAudio[]>;
  entries?(store: 'audio'): Promise<Array<[IDBValidKey, unknown]>>;
};

const DB_NAME = 'encore-phone-v1';
const AUDIO_TTL_MS = 10 * 60 * 1000;
const AUDIO_COUNT_CAP = 24;
const AUDIO_BYTE_CAP = 32 * 1024 * 1024;
type StoredState = { version: 1; value: string; migrated: true };

function validAudio(value: unknown, now: number): value is SavedAudio {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<SavedAudio>;
  return typeof row.attemptId === 'string' && row.attemptId.length > 0 && row.attemptId.length <= 100 &&
    row.wav instanceof Uint8Array && row.wav.byteLength > 0 && row.wav.byteLength <= AUDIO_BYTE_CAP &&
    row.sampleRate === 22050 && row.channels === 1 && row.encoding === 'pcm_s16le' &&
    typeof row.sourceSampleRate === 'number' && Number.isFinite(row.sourceSampleRate) &&
    row.sourceSampleRate >= 8000 && row.sourceSampleRate <= 192000 &&
    typeof row.durationSec === 'number' && Number.isFinite(row.durationSec) && row.durationSec > 0 && row.durationSec <= 600 &&
    typeof row.savedAt === 'number' && Number.isFinite(row.savedAt) && row.savedAt >= 0 && row.savedAt <= now + 1000;
}

export class IndexedDbBackend implements PersistenceBackend {
  private readonly db: IDBDatabase;
  private constructor(db: IDBDatabase) { this.db = db; }

  static async open(factory: IDBFactory): Promise<IndexedDbBackend> {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio');
    };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => { settled = true; reject(new Error('Local database did not open in time.')); }, 5000);
      request.onsuccess = () => {
        clearTimeout(timer);
        if (settled) request.result.close();
        else { settled = true; resolve(request.result); }
      };
      request.onerror = () => {
        clearTimeout(timer);
        if (!settled) { settled = true; reject(request.error ?? new Error('Local database could not open.')); }
      };
      request.onblocked = () => {
        clearTimeout(timer);
        if (!settled) { settled = true; reject(new Error('Local database is blocked by another tab.')); }
      };
    });
    db.onversionchange = () => db.close();
    return new IndexedDbBackend(db);
  }

  private transact<T>(store: 'state' | 'audio', mode: IDBTransactionMode, action: (objectStore: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, mode);
      const request = action(tx.objectStore(store));
      let result: T;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => { /* transaction rejection reports the error */ };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? request.error ?? new Error('Local database transaction failed.'));
      tx.onerror = () => reject(tx.error ?? request.error ?? new Error('Local database transaction failed.'));
    });
  }

  get(store: 'state' | 'audio', key: string): Promise<unknown> {
    return this.transact(store, 'readonly', objectStore => objectStore.get(key));
  }
  async put(store: 'state' | 'audio', key: string, value: unknown): Promise<void> {
    await this.transact(store, 'readwrite', objectStore => objectStore.put(value, key));
  }
  async delete(store: 'state' | 'audio', key: IDBValidKey): Promise<void> {
    await this.transact(store, 'readwrite', objectStore => objectStore.delete(key));
  }
  values(store: 'audio'): Promise<SavedAudio[]> {
    return this.transact(store, 'readonly', objectStore => objectStore.getAll()) as Promise<SavedAudio[]>;
  }
  entries(store: 'audio'): Promise<Array<[IDBValidKey, unknown]>> {
    return new Promise((resolve, reject) => {
      const rows: Array<[IDBValidKey, unknown]> = [];
      const tx = this.db.transaction(store, 'readonly');
      const request = tx.objectStore(store).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) { rows.push([cursor.key, cursor.value]); cursor.continue(); }
      };
      tx.oncomplete = () => resolve(rows);
      tx.onabort = () => reject(tx.error ?? new Error('Local audio database read failed.'));
      tx.onerror = () => reject(tx.error ?? new Error('Local audio database read failed.'));
    });
  }
}

export class PhonePersistence {
  warning: string | null = null;
  private queue: Promise<void> = Promise.resolve();
  private audioIds = new Set<string>();
  private audioRows = new Map<string, { size: number; savedAt: number }>();
  private expiredIds = new Set<string>();
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly backend: PersistenceBackend;
  private readonly legacy?: LegacyStorage;
  private readonly now: () => number;

  constructor(backend: PersistenceBackend, legacy?: LegacyStorage, now: () => number = Date.now) {
    this.backend = backend; this.legacy = legacy; this.now = now;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async load(key: string, validate?: (value: string) => boolean): Promise<string | null> {
    return this.enqueue(async () => {
      const current = await this.backend.get('state', key);
      if (typeof current === 'string') return current;
      if (current && typeof current === 'object' && (current as StoredState).version === 1 &&
          typeof (current as StoredState).value === 'string' && (current as StoredState).migrated === true) {
        return (current as StoredState).value;
      }
      if (current !== undefined) throw new Error('Saved state has an invalid format.');
      // The marker prevents a stale legacy copy from being restored after a prior migration.
      if (this.legacy?.getItem(`${key}.migrated`) === '1') return null;
      const old = this.legacy?.getItem(key);
      if (!old) return null;
      if (validate && !validate(old)) throw new Error('Legacy data is invalid.');
      await this.backend.put('state', key, { version: 1, value: old, migrated: true } satisfies StoredState);
      try { this.legacy?.setItem(`${key}.migrated`, '1'); } catch { /* Removal may still succeed. */ }
      try { this.legacy?.removeItem?.(key); } catch { /* IDB remains authoritative. */ }
      return old;
    });
  }

  save(key: string, value: string): Promise<void> {
    return this.enqueue(async () => { await this.backend.put('state', key, { version: 1, value, migrated: true } satisfies StoredState); });
  }

  async hydrateAudio(): Promise<void> {
    await this.enqueue(async () => {
      const rows = this.backend.entries ? await this.backend.entries('audio') :
        (await this.backend.values('audio')).map(row => [row?.attemptId ?? '', row] as [IDBValidKey, unknown]);
      this.audioIds.clear(); this.audioRows.clear();
      let expired = 0;
      let invalid = 0;
      let bytes = 0;
      for (const [key, value] of rows) {
        const row = value as SavedAudio;
        if (!validAudio(row, this.now()) || row.attemptId !== key || this.now() - row.savedAt > AUDIO_TTL_MS) {
          if (key !== '') await this.backend.delete('audio', key);
          if (typeof key === 'string') this.expiredIds.add(key);
          if (validAudio(row, this.now()) && this.now() - row.savedAt > AUDIO_TTL_MS) expired++;
          else invalid++;
          continue;
        }
        this.audioIds.add(row.attemptId);
        this.audioRows.set(row.attemptId, { size: row.wav.byteLength, savedAt: row.savedAt });
        bytes += row.wav.byteLength;
      }
      if (expired) this.warning = `${expired} saved recording${expired === 1 ? '' : 's'} expired after 10 minutes and can no longer be retried.`;
      if (invalid) this.warning = `${invalid} invalid saved recording${invalid === 1 ? ' was' : 's were'} removed from local retry storage.`;
      if (this.audioRows.size > AUDIO_COUNT_CAP || bytes > AUDIO_BYTE_CAP) {
        this.warning = 'Local retry storage exceeds its limit. Existing recordings were preserved; new recordings cannot be saved until space is available.';
      }
      this.scheduleExpiry();
    });
  }

  hasAudio(attemptId: string): boolean {
    const row = this.audioRows.get(attemptId);
    if (row && this.now() - row.savedAt > AUDIO_TTL_MS) void this.pruneExpired().catch(() => {
      this.warning = 'Expired local recordings could not be removed.';
    });
    return !!row && this.now() - row.savedAt <= AUDIO_TTL_MS;
  }

  canReserveAudio(bytes: number): boolean {
    const active = [...this.audioRows.values()].filter(row => this.now() - row.savedAt <= AUDIO_TTL_MS);
    return active.length < AUDIO_COUNT_CAP &&
      active.reduce((total, row) => total + row.size, 0) + bytes <= AUDIO_BYTE_CAP;
  }

  flush(): Promise<void> { return this.queue; }

  private scheduleExpiry(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    const earliest = Math.min(...[...this.audioRows.values()].map(row => row.savedAt + AUDIO_TTL_MS));
    if (!Number.isFinite(earliest)) return;
    this.expiryTimer = setTimeout(() => { void this.pruneExpired().catch(() => {
      this.warning = 'Expired local recordings could not be removed.';
    }); }, Math.max(1, earliest - this.now() + 1));
    (this.expiryTimer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  }

  private async pruneRows(): Promise<number> {
    let removed = 0;
    for (const [id, row] of this.audioRows) {
      if (this.now() - row.savedAt <= AUDIO_TTL_MS) continue;
      await this.backend.delete('audio', id);
      this.audioRows.delete(id); this.audioIds.delete(id); this.expiredIds.add(id); removed++;
    }
    if (removed) this.warning = `${removed} saved recording${removed === 1 ? '' : 's'} expired after 10 minutes and can no longer be retried.`;
    this.scheduleExpiry();
    return removed;
  }

  pruneExpired(): Promise<number> { return this.enqueue(() => this.pruneRows()); }

  getAudio(attemptId: string): Promise<SavedAudio | null> {
    return this.enqueue(async () => {
      if (!this.audioIds.has(attemptId)) return null;
      const row = await this.backend.get('audio', attemptId) as SavedAudio | undefined;
      if (!validAudio(row, this.now()) || row.attemptId !== attemptId || this.now() - row.savedAt > AUDIO_TTL_MS) {
        await this.backend.delete('audio', attemptId);
        this.audioIds.delete(attemptId); this.audioRows.delete(attemptId);
        this.expiredIds.add(attemptId);
        this.warning = 'Saved recording expired after 10 minutes and can no longer be retried.';
        this.scheduleExpiry();
        return null;
      }
      return row;
    });
  }

  saveAudio(audio: SavedAudio): Promise<void> {
    return this.enqueue(async () => {
      await this.pruneRows();
      const existing = this.audioRows.get(audio.attemptId);
      const original = { ...audio, savedAt: existing?.savedAt ?? audio.savedAt };
      if (this.expiredIds.has(audio.attemptId) || !validAudio(original, this.now()) ||
          this.now() - original.savedAt > AUDIO_TTL_MS) {
        this.warning = 'Recording retry window expired or audio is invalid. This recording is available only in this open session.';
        throw new Error(this.warning);
      }
      const bytes = [...this.audioRows.values()].reduce((total, row) => total + row.size, 0) - (existing?.size ?? 0);
      if ((!existing && this.audioRows.size >= AUDIO_COUNT_CAP) || bytes + audio.wav.byteLength > AUDIO_BYTE_CAP) {
        this.warning = 'Local recording retry storage is full (24 recordings or 32 MiB). This recording is available only in this open session.';
        throw new Error(this.warning);
      }
      await this.backend.put('audio', audio.attemptId, original);
      this.audioRows.set(audio.attemptId, { size: audio.wav.byteLength, savedAt: original.savedAt });
      this.audioIds.add(audio.attemptId);
      this.scheduleExpiry();
    });
  }

  deleteAudio(attemptId: string): Promise<void> {
    return this.enqueue(async () => {
      await this.backend.delete('audio', attemptId);
      this.audioRows.delete(attemptId); this.audioIds.delete(attemptId);
      this.scheduleExpiry();
    });
  }
}

export async function createIndexedDbPersistence(factory: IDBFactory, legacy?: LegacyStorage): Promise<PhonePersistence> {
  return new PhonePersistence(await IndexedDbBackend.open(factory), legacy);
}
