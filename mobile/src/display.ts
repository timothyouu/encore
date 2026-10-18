import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';
import { noteName, passages } from './passages.ts';
import { renderSheetImage, SHEET_HEIGHT, SHEET_WIDTH } from './score-image.ts';
import { type AttemptRecord, type Finding, SessionStore } from './session.ts';
import { type DisplaySettingsStore } from './settings.ts';

type DisplayBridge = Pick<EvenAppBridge,
  'createStartUpPageContainer' | 'textContainerUpgrade' | 'onEvenHubEvent' | 'shutDownPageContainer'> &
  Partial<Pick<EvenAppBridge, 'rebuildPageContainer' | 'updateImageRawData'>>;
type Actions = { getMode?: () => 'demo' | 'phone'; start: () => void | Promise<void>; stop: () => void | Promise<void>; cancel: () => void | Promise<void> };
type Gesture = 'tap' | 'double' | 'up' | 'down' | 'long' | 'release' | 'lifecycle';
type Dependencies = { waitForBridge?: () => Promise<DisplayBridge>; now?: () => number;
  settings?: DisplaySettingsStore; canOpenSettings?: () => boolean;
  renderImage?: typeof renderSheetImage };
const CONTAINER_ID = 1;
const CONTAINER_NAME = 'encore-main';
const IMAGE_ID = 2;
const IMAGE_NAME = 'encore-sheet';
const GESTURE_DEBOUNCE_MS = 250;
const SYNTHETIC_TAP_WINDOW_MS = 650;

function notifyConnection(connected: boolean): void {
  if (typeof document === 'undefined' || typeof CustomEvent === 'undefined') return;
  document.querySelector('#app')?.dispatchEvent(new CustomEvent('encore:connection', {
    detail: { connected },
  }));
}

function notifySheet(status: 'ready' | 'unavailable' | 'preparing' | 'off', message?: string): void {
  if (typeof document === 'undefined' || typeof CustomEvent === 'undefined') return;
  document.querySelector('#app')?.dispatchEvent(new CustomEvent('encore:sheet-status', {
    detail: { status, ...(message ? { message } : {}) },
  }));
}

export function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  // Protobuf omits CLICK_EVENT=0. An absent envelope is not a click.
  if (!envelope) return null;
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT;
}

export function interpretEvenEvent(event: EvenHubEvent): Gesture | null {
  const sys = eventTypeOf(event.sysEvent);
  const text = eventTypeOf(event.textEvent);
  const list = eventTypeOf(event.listEvent);
  if (sys === OsEventTypeList.FOREGROUND_EXIT_EVENT ||
      sys === OsEventTypeList.SYSTEM_EXIT_EVENT ||
      sys === OsEventTypeList.ABNORMAL_EXIT_EVENT) return 'lifecycle';
  if (sys === OsEventTypeList.LONG_PRESS_EVENT || text === OsEventTypeList.LONG_PRESS_EVENT ||
      list === OsEventTypeList.LONG_PRESS_EVENT) return 'long';
  if (sys === OsEventTypeList.LONG_PRESS_RELEASE_EVENT || text === OsEventTypeList.LONG_PRESS_RELEASE_EVENT ||
      list === OsEventTypeList.LONG_PRESS_RELEASE_EVENT) return 'release';
  if (sys === OsEventTypeList.DOUBLE_CLICK_EVENT || text === OsEventTypeList.DOUBLE_CLICK_EVENT) return 'double';
  if (sys === OsEventTypeList.CLICK_EVENT || text === OsEventTypeList.CLICK_EVENT) return 'tap';
  if (sys === OsEventTypeList.SCROLL_BOTTOM_EVENT || text === OsEventTypeList.SCROLL_BOTTOM_EVENT) return 'down';
  if (sys === OsEventTypeList.SCROLL_TOP_EVENT || text === OsEventTypeList.SCROLL_TOP_EVENT) return 'up';
  return null;
}

function currentRecord(store: SessionStore): AttemptRecord | undefined {
  return store.records.find((record) => record.attemptId === store.state.attemptId);
}
function marker(record: AttemptRecord | undefined): string {
  return !record || record.captureSource === undefined || record.captureSource === 'demo' ? 'DEMO\n' : '';
}
function location(record: AttemptRecord, finding: Finding): string {
  const passage = passages.find((item) => item.id === record.passageId);
  const note = passage?.notes.find((item) => item.id === finding.referenceNoteId);
  if (!passage || !note) return 'After the phrase';
  const bar = Math.floor(note.onsetBeat / passage.beatsPerBar) + 1;
  const beat = note.onsetBeat % passage.beatsPerBar + 1;
  return 'Bar ' + bar + ', beat ' + beat;
}
function findingText(record: AttemptRecord, finding: Finding): string {
  const passage = passages.find((item) => item.id === record.passageId);
  const reference = passage?.notes.find((note) => note.id === finding.referenceNoteId);
  const detected = record.analysis?.detectedNotes.find((note) => note.id === finding.detectedNoteId);
  if (finding.kind === 'wrong_note' && reference && detected) {
    return 'Expected ' + noteName(reference.midiPitch) + '; heard ' + noteName(detected.midiPitch) + '.';
  }
  if (finding.kind === 'missing_note' && reference) return 'Could not hear ' + noteName(reference.midiPitch) + '.';
  if (finding.kind === 'extra_note' && detected) return 'Extra ' + noteName(detected.midiPitch) + '.';
  if (finding.kind === 'timing' && finding.timingDeltaMs !== undefined) {
    return Math.abs(finding.timingDeltaMs) + ' ms ' + (finding.timingDeltaMs < 0 ? 'early.' : 'late.');
  }
  return 'Review this part of the phrase.';
}
function selectedFinding(store: SessionStore): Finding | undefined {
  const record = currentRecord(store);
  const passage = passages.find(item => item.id === record?.passageId);
  if (!record || !passage) return undefined;
  const beat = (finding: Finding): number => {
    const reference = passage.notes.find(note => note.id === finding.referenceNoteId);
    if (reference) return reference.onsetBeat;
    const detected = record.analysis?.detectedNotes.find(note => note.id === finding.detectedNoteId);
    return detected ? detected.onsetSec * (record.analysis?.attemptTempoBpm ?? passage.tempoBpm) / 60 : Number.MAX_SAFE_INTEGER;
  };
  return [...(record.analysis?.findings ?? [])].sort((a, b) => beat(a) - beat(b))[store.state.findingIndex];
}
function reviewText(store: SessionStore, record: AttemptRecord): string {
  const analysis = record.analysis;
  if (!analysis || analysis.status === 'uncertain' || analysis.status === 'insufficient_audio') {
    return "I couldn't hear that clearly.\nTry again from Library.";
  }
  if (analysis.status === 'error') return 'Analysis could not complete.\nReturn to Library.';
  const finding = selectedFinding(store);
  if (!finding) return record.coaching?.cue ?? 'No supported mistake found.\nChoose a passage to play again.';
  const cue = record.coaching?.evidenceFindingIds.includes(finding.id)
    ? record.coaching.cue : 'Try this spot again on your next pass.';
  return 'REVIEW ' + (store.state.findingIndex + 1) + '/' + analysis.findings.length + '\n' +
    location(record, finding) + '\n' + findingText(record, finding) + '\n' + cue;
}
function guideText(store: SessionStore, record: AttemptRecord): string {
  const finding = selectedFinding(store);
  const passage = passages.find((item) => item.id === record.passageId);
  const reference = passage?.notes.find((note) => note.id === finding?.referenceNoteId);
  if (!finding || !reference) return 'GUIDE\nListen, then choose a passage to try again.';
  const key = noteName(reference.midiPitch);
  const left = noteName(reference.midiPitch - 1);
  const right = noteName(reference.midiPitch + 1);
  const finger = reference.suggestedFinger ? '\nSuggested finger ' + reference.suggestedFinger : '';
  return 'GUIDE ' + (store.state.findingIndex + 1) + '/' + (record.analysis?.findings.length ?? 1) +
    '\nKeyboard: ' + left + ' [' + key + '] ' + right + finger +
    '\nStatic key guide';
}

export function renderDisplay(store: SessionStore, confirmCancel = false, mode: 'demo' | 'phone' = 'demo',
  settings?: DisplaySettingsStore): string {
  const state = store.state;
  const record = currentRecord(store);
  const demo = record ? marker(record) : mode === 'demo' ? 'DEMO\n' : '';
  const passage = passages.find((item) => item.id === state.passageId);
  if (settings?.isOpen) return demo + 'SETTINGS\nSheet music while playing: ' +
    (settings.value.showSheetMusicWhilePlaying ? 'On' : 'Off') + '\nTap to toggle · double tap to return';
  if (confirmCancel && state.screen === 'recording') return demo + 'Cancel recording?\nTap to confirm · double tap to keep';
  switch (state.screen) {
    case 'library': return demo + 'ENCORE\nChoose a passage on the phone.';
    case 'ready': return demo + (passage?.title ?? 'Passage') + ' · ' + (passage?.tempoBpm ?? 0) +
      ' BPM\nTap to record.';
    case 'recording': return demo + '● Recording';
    case 'processing': return demo + 'Analyzing...';
    case 'review': return demo + (state.historyOrigin ? 'SAVED ATTEMPT\n' : '') +
      (record ? reviewText(store, record) : 'No attempt selected.');
    case 'guide': return demo + (state.historyOrigin ? 'SAVED ATTEMPT\n' : '') +
      (record ? guideText(store, record) : 'No attempt selected.');
    case 'sheet': return demo + (state.historyOrigin ? 'SAVED ATTEMPT\n' : '') +
      (record ? 'REFERENCE\n' + (passage?.title ?? '') + '\n' +
        passage?.notes.map((note) => noteName(note.midiPitch)).join(' ') : 'No passage selected.');
    case 'history': return demo + 'History is on the phone.\nSelect a saved attempt.';
    case 'error': return demo + (state.historyOrigin ? 'SAVED ATTEMPT\n' : '') +
      'Could not continue.\n' + (record?.error?.message ?? 'Return to Library.');
  }
}

export function createLatestTextQueue(write: (content: string) => Promise<unknown>): {
  update(content: string): void; dispose(): void; idle(): Promise<void>;
} {
  let pending: string | null = null;
  let running = false;
  let disposed = false;
  const idleWaiters: Array<() => void> = [];
  function settle(): void {
    if (running || pending !== null) return;
    for (const resolve of idleWaiters.splice(0)) resolve();
  }
  async function drain(): Promise<void> {
    if (running) return;
    running = true;
    while (!disposed && pending !== null) {
      const next = pending;
      pending = null;
      try { await write(next); } catch { /* Display transport may be unavailable. */ }
    }
    running = false;
    settle();
  }
  return {
    update(content: string): void {
      if (disposed) return;
      pending = content;
      void drain();
    },
    dispose(): void {
      disposed = true;
      pending = null;
      settle();
    },
    idle(): Promise<void> {
      if (!running && pending === null) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
  };
}

export function connectDisplay(store: SessionStore, actions: Actions, dependencies: Dependencies = {}): {
  exit(): Promise<void>; dispose(): void;
} {
  let disposed = false;
  let bridge: DisplayBridge | undefined;
  let unsubscribeStore: (() => void) | undefined;
  let unsubscribeBridge: (() => void) | undefined;
  let unsubscribeSettings: (() => void) | undefined;
  let queue: ReturnType<typeof createLatestTextQueue> | undefined;
  let priorityTextQueue: ReturnType<typeof createLatestTextQueue> | undefined;
  let confirmCancel = false;
  let lastGesture: Gesture | null = null;
  let lastAt = -Infinity;
  let lastContent = '';
  let suppressTapUntil = -Infinity;
  let longPressHeld = false;
  let visualRevision = 0;
  let visualRunning = false;
  let imageTransferPending = false;
  let layout: 'text' | 'image' = 'text';
  let loadedImageKey: string | null = null;
  let failedImageKey: string | null = null;
  let lastSheetStatus = '';
  const now = dependencies.now ?? Date.now;
  const settings = dependencies.settings;

  function sheetStatus(status: 'ready' | 'unavailable' | 'preparing' | 'off', message?: string): void {
    const key = status + ':' + (message ?? '');
    if (key === lastSheetStatus) return;
    lastSheetStatus = key;
    notifySheet(status, message);
  }
  function textProperty(content: string, compact: boolean): TextContainerProperty {
    return new TextContainerProperty({
      xPosition: 0, yPosition: 0, width: 576, height: compact ? 56 : 288,
      borderWidth: 0, borderColor: 5, paddingLength: 4,
      containerID: CONTAINER_ID, containerName: CONTAINER_NAME, content,
      isEventCapture: 1, zOrderIndex: 1,
    });
  }
  function imageKey(): string | null {
    if (!settings || settings.isOpen || !settings.value.showSheetMusicWhilePlaying) return null;
    if (store.state.screen !== 'ready' && store.state.screen !== 'recording') return null;
    const passage = passages.find(item => item.id === store.state.passageId);
    if (!passage) return null;
    return [passage.id, passage.version, settings.value.sheetMusicSize, settings.value.showNoteNames].join(':');
  }
  async function rebuild(next: 'text' | 'image', content: string): Promise<boolean> {
    const active = bridge;
    if (!active?.rebuildPageContainer) return false;
    const includeImage = next === 'image';
    const success = await active.rebuildPageContainer(new RebuildPageContainer({
      containerTotalNum: includeImage ? 2 : 1,
      textObject: [textProperty(content, includeImage)],
      ...(includeImage ? { imageObject: [new ImageContainerProperty({
        xPosition: 144, yPosition: 72, width: SHEET_WIDTH, height: SHEET_HEIGHT,
        containerID: IMAGE_ID, containerName: IMAGE_NAME, zOrderIndex: 2,
      })] } : {}),
    }));
    if (success) { layout = next; lastContent = content; }
    return success;
  }
  function desiredContent(): string {
    return renderDisplay(store, confirmCancel, actions.getMode?.(), settings);
  }
  async function writeText(content: string): Promise<void> {
    if (!bridge || content === lastContent) return;
    const success = await bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: CONTAINER_ID, containerName: CONTAINER_NAME, content,
    }));
    if (success) lastContent = content;
  }
  async function flushVisual(): Promise<void> {
    if (visualRunning || !bridge || !settings) return;
    visualRunning = true;
    try {
      while (!disposed) {
        const revision = visualRevision;
        const key = imageKey();
        const content = desiredContent();
        const canRender = !!(bridge.rebuildPageContainer && bridge.updateImageRawData);
        if (!key || !canRender || failedImageKey === key ||
            (store.state.screen === 'recording' && loadedImageKey !== key)) {
          if (layout === 'image' && !await rebuild('text', content)) {
            sheetStatus('unavailable', 'Sheet layout could not be cleared on G2.');
            break;
          }
          else await writeText(content);
          if (!key) sheetStatus('off');
          else if (!canRender) sheetStatus('unavailable', 'Sheet image is unavailable on this connection.');
          else if (failedImageKey === key) sheetStatus('unavailable', 'Sheet image could not be sent to G2.');
          else sheetStatus('unavailable', 'Sheet image was still preparing when recording began.');
        } else if (loadedImageKey === key && layout === 'image') {
          await writeText(content);
          sheetStatus('ready');
        } else if (store.state.screen === 'ready') {
          if (layout === 'image') {
            if (!await rebuild('text', content)) {
              failedImageKey = key;
              sheetStatus('unavailable', 'Sheet layout could not be cleared on G2.');
              break;
            }
            loadedImageKey = null;
          }
          if (disposed || revision !== visualRevision) continue;
          sheetStatus('preparing');
          try {
            const passage = passages.find(item => item.id === store.state.passageId);
            if (!passage) throw new Error('Missing selected passage');
            const bytes = (dependencies.renderImage ?? renderSheetImage)(passage, settings.value);
            if (disposed || revision !== visualRevision || store.state.screen !== 'ready') continue;
            if (!await rebuild('image', content)) throw new Error('Image layout failed');
            if (disposed || revision !== visualRevision || store.state.screen !== 'ready') continue;
            imageTransferPending = true;
            let result: ImageRawDataUpdateResult;
            try {
              result = await bridge.updateImageRawData!(new ImageRawDataUpdate({
                containerID: IMAGE_ID, containerName: IMAGE_NAME, imageData: bytes,
              }));
            } finally {
              imageTransferPending = false;
              // A delayed priority write may still carry an older screen. Let it
              // finish before the visual drain reconciles the latest state.
              await priorityTextQueue?.idle();
            }
            if (result !== ImageRawDataUpdateResult.success) throw new Error('Image transfer failed');
            if (!disposed && revision === visualRevision && store.state.screen === 'ready') {
              loadedImageKey = key;
              sheetStatus('ready');
            }
          } catch {
            failedImageKey = key;
            loadedImageKey = null;
            sheetStatus('unavailable', 'Sheet image could not be sent to G2.');
            // Remove the empty image container on the next serialized pass.
            visualRevision += 1;
          }
        }
        if (revision === visualRevision) break;
      }
    } catch {
      sheetStatus('unavailable', 'G2 display transport is unavailable.');
    } finally {
      visualRunning = false;
    }
  }

  function update(): void {
    if (disposed) return;
    if (settings) {
      if (store.state.screen !== 'ready' && store.state.screen !== 'recording') failedImageKey = null;
      if (imageTransferPending) {
        priorityTextQueue?.update(desiredContent());
      }
      visualRevision += 1;
      void flushVisual();
      return;
    }
    if (!queue) return;
    const content = renderDisplay(store, confirmCancel, actions.getMode?.());
    if (content === lastContent) return;
    lastContent = content;
    queue.update(content);
  }
  function invoke(action: () => void | Promise<void>): void {
    try { void Promise.resolve(action()).catch(() => undefined); } catch { /* Caller owns capture errors. */ }
  }
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    unsubscribeStore?.();
    unsubscribeSettings?.();
    unsubscribeBridge?.();
    queue?.dispose();
    priorityTextQueue?.dispose();
    notifyConnection(false);
  }
  async function exit(): Promise<void> {
    const activeBridge = bridge;
    dispose();
    if (activeBridge) {
      try { await activeBridge.shutDownPageContainer(0); } catch { /* Page may already have closed. */ }
    }
  }
  function onGesture(gesture: Gesture): void {
    if (disposed) return;
    if (gesture === 'lifecycle') {
      store.interrupt();
      invoke(actions.cancel);
      dispose();
      return;
    }
    const at = now();
    if (gesture === 'long') {
      suppressTapUntil = at + SYNTHETIC_TAP_WINDOW_MS;
      if (longPressHeld) return;
      longPressHeld = true;
      if (settings && dependencies.canOpenSettings?.() !== false &&
          store.state.screen !== 'recording' && store.state.screen !== 'processing') {
        settings.open(store.state.screen);
      }
      return;
    }
    if (gesture === 'release') {
      longPressHeld = false;
      suppressTapUntil = at + SYNTHETIC_TAP_WINDOW_MS;
      return;
    }
    // Recover input if a transport disconnect drops the matching release event.
    if (longPressHeld && at > suppressTapUntil + 1500) longPressHeld = false;
    if (gesture === 'tap' && (longPressHeld || at <= suppressTapUntil)) return;
    if (lastGesture === gesture && at - lastAt < GESTURE_DEBOUNCE_MS) return;
    lastGesture = gesture;
    lastAt = at;
    const screen = store.state.screen;
    if (settings?.isOpen) {
      if (gesture === 'tap') settings.update({ showSheetMusicWhilePlaying: !settings.value.showSheetMusicWhilePlaying });
      else if (gesture === 'double') settings.close();
      return;
    }
    if (gesture === 'tap') {
      if (screen === 'recording' && confirmCancel) {
        confirmCancel = false;
        invoke(actions.cancel);
        update();
      } else if (screen === 'ready') invoke(actions.start);
      else if (screen === 'recording') invoke(actions.stop);
    } else if (gesture === 'double') {
      if (screen === 'recording') {
        confirmCancel = !confirmCancel;
        update();
      } else if (screen === 'library') {
        void exit();
      } else if (screen === 'sheet') store.closeSheet();
      else if (screen === 'guide') store.showReview();
      else if (screen === 'history') store.showLibrary();
      else if (screen === 'review' || screen === 'processing' || screen === 'error') {
        if (store.state.historyOrigin) store.showHistory();
        else store.showLibrary();
      } else if (screen === 'ready') store.showLibrary();
    } else if (gesture === 'down') {
      if (screen === 'review') store.showGuide();
      else if (screen === 'guide') {
        const length = currentRecord(store)?.analysis?.findings.length ?? 0;
        if (store.state.findingIndex < length - 1) {
          store.moveFinding(1);
          store.showReview();
        }
      }
    } else if (gesture === 'up') {
      if (screen === 'guide') store.showReview();
      else if (screen === 'review' && store.state.findingIndex > 0) {
        store.moveFinding(-1);
        store.showGuide();
      }
    }
  }

  void (dependencies.waitForBridge ?? waitForEvenAppBridge)().then(async (readyBridge) => {
    if (disposed) return;
    bridge = readyBridge;
    const initial = renderDisplay(store, false, actions.getMode?.(), settings);
    const result = await readyBridge.createStartUpPageContainer(new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [new TextContainerProperty({
        xPosition: 0, yPosition: 0, width: 576, height: 288, borderWidth: 0,
        borderColor: 5, paddingLength: 4, containerID: CONTAINER_ID,
        containerName: CONTAINER_NAME, content: initial, isEventCapture: 1,
      })],
    }));
    if (disposed) return;
    if (result !== 0) {
      notifyConnection(false);
      return;
    }
    notifyConnection(true);
    lastContent = initial;
    if (!settings) queue = createLatestTextQueue((content) => readyBridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: CONTAINER_ID, containerName: CONTAINER_NAME, content })));
    else priorityTextQueue = createLatestTextQueue(async (content) => {
      if (disposed) return;
      const success = await readyBridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: CONTAINER_ID, containerName: CONTAINER_NAME, content,
      }));
      if (success && !disposed) lastContent = content;
    });
    unsubscribeStore = store.subscribe(update);
    unsubscribeSettings = settings?.subscribe(update);
    unsubscribeBridge = readyBridge.onEvenHubEvent((event) => {
      const gesture = interpretEvenEvent(event);
      if (gesture) onGesture(gesture);
    });
    update();
  }).catch(() => notifyConnection(false));

  return { exit, dispose };
}
