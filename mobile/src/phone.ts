import './paper-renderer.css';
import { mountPaperVisualization } from './paper-renderer.ts';
import { resolveVisualPlan } from './paper-evidence.ts';
import './phone.css';
import { noteName, passages, suggestedFingerLabel, type Passage, type ReferenceNote } from './passages.ts';
import type { AttemptRecord, Finding, SessionStore } from './session.ts';
import { markTelemetryErrorReported, measureTelemetry, recordTelemetryFailure } from './telemetry.ts';
import { keyboardRange, resolveDurationEvidence, resolveMistakeVisualization, type MistakeVisualization } from './visualization.ts';

import { DisplaySettingsStore, type DisplaySettings } from './settings.ts';
import { correctionFor, detailFor, findingBeat, findingTitle, orderedFindings, referenceFor } from './feedback.ts';

type Scenario = 'mistakes' | 'clean' | 'uncertain' | 'error';
type Mode = 'demo' | 'phone' | 'g2';
type Actions = { start: () => void; stop: () => void; cancel: () => void; retry?: () => void; canRetry?: (attemptId: string) => boolean; importWav?: (blob: Blob) => void; getMode?: () => Mode; isBusy?: () => boolean; deviceStatus?: () => string | null };
// deviceStatus comes from a host that owns a real device connection; the phone-only app has none.
const NO_DEVICE = 'Glasses integration not connected';
type NodeContent = Node | string | null | undefined;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', content?: string): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (content !== undefined) item.textContent = content;
  return item;
}

function add(parent: HTMLElement, ...children: NodeContent[]): HTMLElement {
  for (const child of children) if (child !== null && child !== undefined) parent.append(child);
  return parent;
}

function control(label: string, className: string, action: () => void, disabled = false): HTMLButtonElement {
  const item = node('button', className, label);
  item.type = 'button';
  item.disabled = disabled;
  item.addEventListener('click', action);
  return item;
}

function heading(title: string, eyebrow?: string): HTMLElement {
  const wrap = node('div', 'page-heading');
  add(wrap, node('h1', '', title), eyebrow ? node('p', 'subtle', eyebrow) : null);
  return wrap;
}

function passageOf(id: string | null): Passage | undefined {
  return passages.find((passage) => passage.id === id);
}

function dateLabel(value: string): string {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? 'Unknown date' : timestamp.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function sourceLabel(record: AttemptRecord): string {
  return record.captureSource === 'test' ? 'Test WAV' : record.captureSource === 'g2' ? 'G2' : record.captureSource === 'phone' ? 'Phone mic' : 'Demo';
}

function coachingLabel(record: AttemptRecord): string | null {
  if (!record.coaching) return null;
  if (record.captureSource === 'demo') return 'Demo cue · prepared local result';
  if (record.coaching.coachingSource === 'gemini') return 'Gemini coaching';
  return 'Local fallback cue · Gemini coaching unavailable';
}

function recordLabel(record: AttemptRecord, records: AttemptRecord[]): string {
  const number = records.filter((item) => item.passageId === record.passageId && item.captureStatus === 'completed' && item.startedAt <= record.startedAt).length;
  return `Recording ${String(number).padStart(2, '0')} · ${sourceLabel(record)}`;
}

function statusLabel(record: AttemptRecord): string {
  if (record.captureStatus === 'canceled') return 'Canceled';
  if (record.captureStatus === 'interrupted') return 'Interrupted';
  if (record.captureStatus === 'recording') return 'Recording';
  if (record.processingStatus === 'processing') return 'Processing';
  if (record.processingStatus === 'error') return 'Processing error';
  if (record.analysis?.status === 'uncertain' || record.analysis?.status === 'insufficient_audio') return 'Audio unclear';
  if (record.analysis?.status === 'error') return 'Analysis unavailable';
  if (record.analysis?.findings.length === 0) return 'No supported mistakes';
  return 'Result';
}

function svgElement<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string>): SVGElementTagNameMap[K] {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

function svgText(x: number, y: number, value: string, className = ''): SVGTextElement {
  const text = svgElement('text', { x: String(x), y: String(y), class: className });
  text.textContent = value;
  return text;
}

// This staff uses actual reference beats, pitches, durations, and unoccupied beats.
function notation(passage: Passage, selected?: ReferenceNote, extraBeat?: number, preferences?: Readonly<DisplaySettings>): HTMLElement {
  const large = preferences?.sheetMusicSize === 'large';
  const showNames = preferences?.showNoteNames ?? false;
  const scale = large ? 1.25 : 1;
  const step = 48;
  const start = 48;
  const frame = node('div', `score-frame${large ? ' score-large' : ''}`);
  const totalBeats = Math.max(8, ...passage.notes.map((note) => note.onsetBeat + note.durationBeats));
  const width = Math.max(460, 54 + totalBeats * step);
  const occupied = new Set<number>();
  for (const note of passage.notes) for (let beat = note.onsetBeat; beat < note.onsetBeat + note.durationBeats; beat += 1) occupied.add(beat);
  const restBeats = Array.from({ length: Math.ceil(totalBeats) }, (_unused, beat) => beat).filter((beat) => !occupied.has(beat));
  const restLabel = restBeats.length ? `; quarter rests on beat${restBeats.length === 1 ? '' : 's'} ${restBeats.map((beat) => beat + 1).join(', ')}` : '';
  const svg = svgElement('svg', { viewBox: `0 0 ${width * scale} ${(showNames ? 158 : 144) * scale}`, role: 'img', 'aria-label': `Reference sheet music for ${passage.title}; ${passage.notes.map((note) => `${noteName(note.midiPitch)} at beat ${note.onsetBeat + 1} for ${note.durationBeats} beat${note.durationBeats === 1 ? '' : 's'}`).join(', ')}${restLabel}` });
  const canvas = large ? svgElement('g', { transform: 'scale(1.25)' }) : svg;
  if (large) svg.append(canvas);
  if (extraBeat !== undefined && Number.isFinite(extraBeat)) {
    const x = Math.max(start, Math.min(width - 24, start + extraBeat * step));
    canvas.append(svgElement('rect', { x: String(x - 18), y: '25', width: '36', height: '69', rx: '5', class: 'extra-beat-ring' }));
  }
  for (let line = 0; line < 5; line += 1) canvas.append(svgElement('line', { x1: '24', y1: String(36 + line * 10), x2: String(width - 20), y2: String(36 + line * 10), class: 'staff-line' }));
  canvas.append(svgText(3, 56, '𝄞', 'clef'));
  for (let bar = passage.beatsPerBar; bar < totalBeats; bar += passage.beatsPerBar) {
    const x = start + bar * step - 16;
    canvas.append(svgElement('line', { x1: String(x), y1: '36', x2: String(x), y2: '76', class: 'bar-line' }));
  }
  for (const note of passage.notes) {
    const x = start + note.onsetBeat * step;
    const naturalOffset = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].indexOf(note.midiPitch % 12);
    const diatonic = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][naturalOffset];
    // E4 sits on the bottom staff line at y=76; C4 needs one ledger line at y=86.
    const y = 86 - ((Math.floor(note.midiPitch / 12) - 5) * 7 + diatonic) * 5;
    for (let ledgerY = 86; ledgerY <= y; ledgerY += 10) canvas.append(svgElement('line', { x1: String(x - 12), y1: String(ledgerY), x2: String(x + 12), y2: String(ledgerY), class: 'staff-line' }));
    if (note.midiPitch % 12 === 1 || note.midiPitch % 12 === 3 || note.midiPitch % 12 === 6 || note.midiPitch % 12 === 8 || note.midiPitch % 12 === 10) canvas.append(svgText(x - 22, y + 5, '♯', 'accidental'));
    if (note.id === selected?.id) canvas.append(svgElement('circle', { cx: String(x), cy: String(y), r: '17', class: 'selected-note-ring' }));
    canvas.append(svgElement('ellipse', { cx: String(x), cy: String(y), rx: '8', ry: '5', transform: `rotate(-18 ${x} ${y})`, class: note.durationBeats >= 2 ? 'half-note' : 'quarter-note' }));
    canvas.append(svgElement('line', { x1: String(x + 7), y1: String(y - 1), x2: String(x + 7), y2: String(y - 32), class: 'note-stem' }));
    if (showNames) canvas.append(svgText(x, 120, noteName(note.midiPitch), 'score-note-name'));
    canvas.append(svgText(x - 5, showNames ? 146 : 128, String(note.onsetBeat + 1), 'beat-number'));
  }
  for (let beat = 0; beat < totalBeats; beat += 1) {
    if (occupied.has(beat)) continue;
    const x = start + beat * step;
    canvas.append(svgElement('path', { d: `M ${x - 4} 39 l 8 9 -6 7 8 9 -8 8 c -4 4 -1 9 5 8`, class: 'quarter-rest' }));
    canvas.append(svgText(x - 5, showNames ? 146 : 128, String(beat + 1), 'beat-number'));
  }
  frame.append(svg);
  return frame;
}

function keyboard(visual: MistakeVisualization): HTMLElement {
  const wrap = node('div', 'keyboard-wrap visual-sequence is-playing');
  const board = node('div', 'keyboard');
  const whites = keyboardRange(visual);
  board.setAttribute('role', 'img');
  board.setAttribute('aria-label', `Piano keys. Expected: ${visual.expected?.label ?? 'no reference event'}. Detected: ${visual.played?.label ?? 'no detected event'}.`);
  for (const [index, pitch] of whites.entries()) {
    const expected = pitch === visual.expected?.midiPitch ? ' key-expected' : '';
    const played = pitch === visual.played?.midiPitch ? ' key-played' : '';
    const white = node('div', `white-key${expected}${played}`, noteName(pitch).replace(/\d+$/, ''));
    board.append(white);
    if ([0, 2, 5, 7, 9].includes(pitch % 12)) {
      const blackPitch = pitch + 1;
      const black = node('div', `black-key${blackPitch === visual.expected?.midiPitch ? ' key-expected' : ''}${blackPitch === visual.played?.midiPitch ? ' key-played' : ''}`);
      black.style.left = `${(index + 1) * 100 / whites.length}%`;
      black.style.width = `${49 / whites.length}%`;
      board.append(black);
    }
  }
  const legend = add(node('div', 'visual-legend'), node('span', 'legend-expected', `Expected · ${visual.expected?.label ?? 'no note'}`), node('span', 'legend-played', `Detected · ${visual.played?.label ?? 'no note'}`));
  add(wrap, board, legend);
  return wrap;
}

function durationComparison(visual: MistakeVisualization): HTMLElement | null {
  const duration = visual.duration;
  if (!duration) return null;
  const maxBeats = Math.max(duration.expectedBeats, duration.playedBeats);
  const wrap = node('div', 'duration-comparison');
  for (const [kind, label, beats] of [['expected', `${duration.referenceValue} · ${duration.expectedBeats} beat${duration.expectedBeats === 1 ? '' : 's'}`, duration.expectedBeats], ['played', `Detected hold · ${duration.playedBeats.toFixed(2)} beats`, duration.playedBeats]] as const) {
    const row = node('div', `duration-row ${kind}`);
    const track = node('div', 'duration-track');
    const bar = node('div', 'duration-bar');
    bar.style.width = `${beats / maxBeats * 100}%`;
    bar.style.setProperty('--hold-ms', `${Math.round(beats * 650)}ms`);
    track.append(bar);
    add(row, node('span', 'duration-row-label', label), track);
    wrap.append(row);
  }
  wrap.setAttribute('aria-label', `Reference hold ${duration.expectedBeats} beat${duration.expectedBeats === 1 ? '' : 's'}; detected hold ${duration.playedBeats.toFixed(2)} beats.`);
  return wrap;
}

function durationLabel(note?: ReferenceNote): string {
  return note?.durationBeats === 2 ? 'Half note · Hold for 2 beats' : note?.durationBeats === 1 ? 'Quarter note · Hold for 1 beat' : note ? `Hold for ${note.durationBeats} beats` : 'Follow the reference rhythm';
}

export function mountPhone(root: HTMLElement, store: SessionStore, actions: Actions, settings: DisplaySettingsStore = new DisplaySettingsStore()): () => void {
  let query = '';
  let scenario: Scenario = 'mistakes';
  let cancelOpen = false;
  let settingsLayer: HTMLElement | null = null;
  let settingsScrollY = 0;
  let timer: number | undefined;
  let recordingTime: HTMLElement | null = null;
  let touchStart: number | null = null;
  let focusReturnSelector = '.recording-page .secondary-action';
  const mode = (): Mode => actions.getMode?.() ?? 'demo';
  const deviceStatus = (): string => actions.deviceStatus?.() ?? NO_DEVICE;
  const score = (passage: Passage, selected?: ReferenceNote, extraBeat?: number): HTMLElement => notation(passage, selected, extraBeat, settings.value);

  function currentRecord(): AttemptRecord | undefined { return store.records.find((record) => record.attemptId === store.state.attemptId); }
  function currentPassage(): Passage | undefined { return passageOf(store.state.passageId) ?? passageOf(currentRecord()?.passageId ?? null); }
  function returnFromResult(): void { if (store.state.historyOrigin) store.showHistory(); else store.showLibrary(); }
  function playAgain(): void { store.showLibrary(); }
  function openSheet(): void { store.showSheet(); }
  function closeSheet(): void { store.closeSheet(); root.querySelector<HTMLButtonElement>('.outline-action')?.focus(); }
  function openDialog(): void {
    const trigger = document.activeElement;
    focusReturnSelector = trigger instanceof HTMLElement && trigger.classList.contains('hub-link') ? '.hub-link' : '.recording-page .secondary-action';
    cancelOpen = true; render();
    root.querySelector<HTMLElement>('[role="dialog"] button')?.focus();
  }
  function closeDialog(): void { cancelOpen = false; render(); root.querySelector<HTMLElement>(focusReturnSelector)?.focus(); }

  function openSettings(): void {
    if (store.state.screen === 'recording' || store.state.screen === 'processing' || actions.isBusy?.()) return;
    settings.open(store.state.screen);
  }

  function gearIcon(): SVGSVGElement {
    const svg = svgElement('svg', { width: '22', height: '22', viewBox: '0 0 24 24', 'aria-hidden': 'true' });
    svg.append(
      svgElement('polygon', { points: '12.00,3.40 13.95,2.19 15.83,2.76 16.78,4.85 18.08,5.92 20.31,6.44 21.24,8.17 20.43,10.32 20.60,12.00 21.81,13.95 21.24,15.83 19.15,16.78 18.08,18.08 17.56,20.31 15.83,21.24 13.68,20.43 12.00,20.60 10.05,21.81 8.17,21.24 7.22,19.15 5.92,18.08 3.69,17.56 2.76,15.83 3.57,13.68 3.40,12.00 2.19,10.05 2.76,8.17 4.85,7.22 5.92,5.92 6.44,3.69 8.17,2.76 10.32,3.57', fill: 'none', stroke: '#625F58', 'stroke-width': '1.5', 'stroke-linejoin': 'round' }),
      svgElement('circle', { cx: '12', cy: '12', r: '3.5', fill: 'none', stroke: '#625F58', 'stroke-width': '1.5' }),
    );
    return svg;
  }

  function glassesIcon(): SVGSVGElement {
    const svg = svgElement('svg', { width: '20', height: '17', viewBox: '0 0 26 22', 'aria-hidden': 'true' });
    svg.append(
      svgElement('path', { d: 'M2 10L4 5H7M24 10L22 5H19M11 11C12 9.5 14 9.5 15 11', fill: 'none', stroke: '#625F58', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      svgElement('rect', { x: '2', y: '9', width: '9', height: '7', rx: '2.5', fill: 'none', stroke: '#625F58', 'stroke-width': '1.8' }),
      svgElement('rect', { x: '15', y: '9', width: '9', height: '7', rx: '2.5', fill: 'none', stroke: '#625F58', 'stroke-width': '1.8' }),
    );
    return svg;
  }

  function header(): HTMLElement {
    const bar = node('header', 'app-header');
    const back = control('‹ Library', 'hub-link', () => { if (store.state.screen === 'recording') openDialog(); else store.showLibrary(); });
    const wordmark = node('div', 'wordmark', 'encore');
    const gear = control('', 'settings-trigger', openSettings, store.state.screen === 'recording' || store.state.screen === 'processing' || Boolean(actions.isBusy?.()));
    gear.setAttribute('aria-label', 'Open Settings');
    gear.append(gearIcon());
    add(bar, back, wordmark, gear);
    return bar;
  }

  function settingsSwitch(label: string, description: string, checked: boolean, action: () => void, disabled = false): HTMLElement {
    const row = node('div', 'settings-row');
    const labelId = label === 'Note names' ? 'encore-note-names-label' : 'encore-show-sheet-label';
    const labelText = node('span', 'settings-label', label);
    labelText.id = labelId;
    const copy = add(node('div', 'settings-copy'), labelText, node('span', 'settings-description', description));
    const toggle = control('', `settings-switch${checked ? ' is-on' : ''}`, action, disabled);
    toggle.id = label === 'Note names' ? 'encore-note-names-switch' : 'encore-show-sheet-switch';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-labelledby', labelId);
    toggle.setAttribute('aria-checked', String(checked));
    toggle.append(node('span', 'settings-switch-thumb'));
    return add(row, copy, toggle);
  }

  function settingsPage(): HTMLElement {
    const page = node('main', 'settings-page');
    const bar = node('header', 'app-header settings-header');
    const back = control('‹ Back', 'hub-link settings-back', () => settings.close());
    back.id = 'encore-settings-back';
    back.setAttribute('aria-label', 'Return to previous screen');
    const gear = add(node('span', 'settings-current-icon'), gearIcon());
    add(bar, back, node('div', 'wordmark', 'encore'), gear);
    const body = node('div', 'settings-body');
    const intro = node('section', 'settings-intro');
    const status = add(node('div', 'settings-connection'), glassesIcon(), node('span', '', deviceStatus()));
    add(intro, node('h1', '', 'Settings'), status);
    body.append(intro);
    const value = settings.value;
    body.append(settingsSwitch('Show sheet music on glasses', 'See the sheet music while you play.', value.showSheetMusicWhilePlaying, () => settings.update({ showSheetMusicWhilePlaying: !value.showSheetMusicWhilePlaying })));
    const sizeSection = node('section', 'settings-size');
    const sizeLabel = node('h2', '', 'Sheet music size');
    sizeLabel.id = 'sheet-size-label';
    const choices = node('div', 'size-options');
    choices.setAttribute('role', 'radiogroup');
    choices.setAttribute('aria-labelledby', sizeLabel.id);
    for (const [choice, text] of [['standard', 'Standard'], ['large', 'Large']] as const) {
      const option = control(text, `size-option${value.sheetMusicSize === choice ? ' is-selected' : ''}`, () => settings.update({ sheetMusicSize: choice }), !value.showSheetMusicWhilePlaying);
      option.id = `encore-sheet-size-${choice}`;
      option.setAttribute('role', 'radio');
      option.setAttribute('aria-checked', String(value.sheetMusicSize === choice));
      option.tabIndex = value.sheetMusicSize === choice && value.showSheetMusicWhilePlaying ? 0 : -1;
      choices.append(option);
    }
    choices.addEventListener('keydown', (event) => {
      if (!value.showSheetMusicWhilePlaying || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const next = value.sheetMusicSize === 'standard' ? 'large' : 'standard';
      settings.update({ sheetMusicSize: next });
      settingsLayer?.querySelector<HTMLButtonElement>(`#encore-sheet-size-${next}`)?.focus();
    });
    add(sizeSection, sizeLabel, choices);
    body.append(sizeSection);
    body.append(settingsSwitch('Note names', 'Show C4, D4, E4 below the notes.', value.showNoteNames, () => settings.update({ showNoteNames: !value.showNoteNames }), !value.showSheetMusicWhilePlaying));
    if (settings.storageWarning) {
      const warning = node('p', 'storage-warning settings-warning', settings.storageWarning);
      warning.setAttribute('role', 'status');
      body.append(warning);
    }
    body.append(node('p', 'settings-sheet-status', 'Preferences are saved on this phone only. Applying them to glasses will be available with device integration.'));
    return add(page, bar, body);
  }

  function syncSettingsLayer(): void {
    if (settings.isOpen) {
      if (!settingsLayer) {
        settingsScrollY = window.scrollY;
        settingsLayer = settingsPage();
        for (const child of [...root.children]) {
          if (!(child instanceof HTMLElement)) continue;
          child.dataset.settingsWasInert = String(child.inert);
          child.inert = true;
          child.setAttribute('aria-hidden', 'true');
        }
        root.append(settingsLayer);
        settingsLayer.querySelector<HTMLButtonElement>('.settings-back')?.focus();
      } else {
        const focus = document.activeElement;
        const focusId = focus instanceof HTMLButtonElement && settingsLayer.contains(focus) ? focus.id : null;
        const scroll = settingsLayer.scrollTop;
        settingsLayer.replaceWith(settingsPage());
        settingsLayer = root.lastElementChild as HTMLElement;
        settingsLayer.scrollTop = scroll;
        if (focusId) {
          const buttons = [...settingsLayer.querySelectorAll<HTMLButtonElement>('button')];
          (buttons.find((button) => button.id === focusId && !button.disabled) ?? settingsLayer.querySelector<HTMLButtonElement>('.settings-back'))?.focus();
        }
      }
      return;
    }
    if (!settingsLayer) return;
    settingsLayer.remove();
    settingsLayer = null;
    for (const child of [...root.children]) {
      if (!(child instanceof HTMLElement)) continue;
      child.inert = child.dataset.settingsWasInert === 'true';
      delete child.dataset.settingsWasInert;
      child.removeAttribute('aria-hidden');
    }
    render();
    window.scrollTo({ top: settingsScrollY, behavior: 'instant' });
    root.querySelector<HTMLButtonElement>('.settings-trigger:not(:disabled)')?.focus();
  }

  function library(): HTMLElement {
    const page = node('main', 'page library-page');
    const intro = heading('Choose a passage');
    const count = control(`${store.count()} recording${store.count() === 1 ? '' : 's'} · View history ›`, 'text-link subtle', () => store.showHistory());
    intro.append(count);
    const search = node('label', 'search-box');
    const icon = node('span', 'search-icon', '⌕'); icon.setAttribute('aria-hidden', 'true');
    const input = node('input'); input.type = 'search'; input.placeholder = `Search ${passages.length} passages`; input.value = query; input.setAttribute('aria-label', 'Search passages');
    input.addEventListener('input', () => {
      query = input.value;
      const position = input.selectionStart;
      render();
      const replacement = root.querySelector<HTMLInputElement>('input[type="search"]');
      replacement?.focus();
      if (position !== null) replacement?.setSelectionRange(position, position);
    });
    add(search, icon, input);
    const list = node('div', 'passage-list');
    const matches = passages.filter((passage) => `${passage.title} ${passage.id}`.toLowerCase().includes(query.trim().toLowerCase()));
    if (!matches.length) add(list, node('p', 'empty-state', 'No passages match your search. Try another title.'));
    for (const passage of matches) {
      const row = control('', 'passage-row', () => store.selectPassage(passage.id));
      const title = node('span', 'passage-name', passage.title);
      const recordings = store.count(passage.id);
      const subtitle = node('span', 'passage-meta', `${passage.tempoBpm} BPM · Beginner · ${recordings} recording${recordings === 1 ? '' : 's'}`);
      const body = add(node('span', 'passage-row-body'), title, subtitle);
      add(row, node('span', 'passage-number', passage.id.slice(1)), body, node('span', 'chevron', '›'));
      list.append(row);
    }
    add(page, intro, search, list);
    return page;
  }

  function ready(passage: Passage): HTMLElement {
    const page = node('main', 'page ready-page');
    const top = control('‹ All passages', 'back-link', () => store.showLibrary());
    const preview = node('section', 'preview-card');
    add(preview, node('p', 'eyebrow', 'PASSAGE PREVIEW'), node('h2', '', passage.title), node('p', 'subtle', `${passage.tempoBpm} BPM · 4/4 · Right hand · No pedal`), score(passage));
    const noteLine = node('p', 'note-line', passage.notes.map((note) => noteName(note.midiPitch)).join('  ·  '));
    preview.append(noteLine);
    const source = node('div', 'source-card');
    add(source, node('strong', '', 'Before you play'), node('p', '', mode() === 'demo' ? 'Start a simulated recording when you are ready. The demo uses prepared results and no microphone audio.' : mode() === 'g2' ? 'Start a G2 microphone recording here or tap on the glasses. Analysis requires the configured services to be reachable.' : 'Start a phone microphone recording when you are ready. Analysis requires the configured services to be reachable.'));
    const selector = node('label', 'scenario-label', 'Demo result');
    if (mode() === 'demo') {
      const select = node('select'); select.setAttribute('aria-label', 'Demo result scenario');
      for (const [value, label] of [['mistakes', 'Mistakes'], ['clean', 'Clean'], ['uncertain', 'Unclear audio'], ['error', 'Processing error']] as const) {
        const option = node('option', '', label); option.value = value; select.append(option);
      }
      select.value = scenario;
      select.addEventListener('change', () => {
        scenario = select.value as Scenario;
        root.dispatchEvent(new CustomEvent('encore:scenario', { detail: { scenario }, bubbles: true }));
      });
      selector.append(select);
    }
    const start = control('Start recording →', 'primary-action', actions.start);
    const testUpload = node('label', 'test-wav-label', 'Use a test WAV recording');
    if (actions.importWav && mode() === 'phone') {
      const file = node('input');
      file.type = 'file'; file.accept = '.wav,audio/wav';
      file.setAttribute('aria-label', 'Import test WAV for this passage');
      file.addEventListener('change', () => {
        const selected = file.files?.[0];
        if (selected) actions.importWav?.(selected);
        file.value = '';
      });
      add(testUpload, file, node('span', 'subtle', 'Labeled as test audio in results and History.'));
    }
    add(page, top, heading(passage.title, 'Listen, then play the phrase'), preview, source, mode() === 'demo' ? selector : null, actions.importWav && mode() === 'phone' ? testUpload : null, node('div', 'grow'), start);
    return page;
  }

  function recording(passage: Passage, record?: AttemptRecord): HTMLElement {
    const page = node('main', 'page recording-page');
    const core = node('section', 'recording-core');
    const source = record?.captureSource ?? mode();
    const connectionBadge = add(node('div', 'recording-connection'), glassesIcon(), node('span', '', deviceStatus()));
    connectionBadge.setAttribute('role', 'status');
    page.append(connectionBadge);
    const dot = node('span', 'recording-dot'); dot.setAttribute('aria-hidden', 'true');
    recordingTime = node('span', 'recording-time', '00:00');
    const indicator = add(node('div', 'recording-indicator'), dot, node('span', '', 'Recording'), recordingTime);
    add(core, node('h1', 'recording-passage-title', passage.title), indicator);
    if (settings.value.showSheetMusicWhilePlaying && source !== 'demo') {
      const preview = add(node('div', 'recording-score'), score(passage));
      preview.setAttribute('aria-label', 'Static reference sheet music while recording');
      core.append(preview);
    } else if (source === 'demo') {
      const bars = node('div', 'recording-bars');
      bars.setAttribute('aria-hidden', 'true');
      for (const height of [4, 6, 8, 14, 24, 36, 48, 38, 24, 14, 10, 18, 30, 46, 62, 52, 34, 20, 12, 8, 12, 22, 38, 56, 66, 52, 36, 24, 16, 10, 18, 30, 40, 32, 22, 14, 8, 6, 4, 4]) {
        const bar = node('span', 'recording-bar'); bar.style.height = `${height}px`; bars.append(bar);
      }
      core.append(bars);
    }
    core.append(node('p', 'recording-provenance', source === 'demo' ? 'Demo · simulated capture and decorative waveform; no microphone audio' : source === 'g2' ? 'G2 microphone · reference sheet music is static' : 'Phone microphone · reference sheet music is static'));
    add(page, core, control('Stop & analyze', 'primary-action', actions.stop), control('Cancel', 'secondary-action', openDialog));
    if (record) updateTime(record);
    return page;
  }

  function updateTime(record: AttemptRecord): void {
    const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(record.startedAt)) / 1000));
    if (recordingTime) recordingTime.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function processing(passage?: Passage): HTMLElement {
    const page = node('main', 'page status-page');
    const center = node('div', 'status-center');
    const indicator = node('div', 'processing-mark', '···'); indicator.setAttribute('aria-hidden', 'true');
    const stage = store.processingStage;
    const title = stage === 'normalization' ? 'Saving WAV' : stage === 'upload' ? 'Uploading recording' : stage === 'analysis' ? 'Analyzing notes' : stage === 'coaching' ? 'Preparing coaching' : 'Listening back';
    const detail = stage === 'normalization' ? 'Normalizing the saved recording.' : stage === 'upload' ? 'Sending the normalized WAV to the configured server.' : stage === 'analysis' ? 'Checking detected notes against this passage.' : stage === 'coaching' ? 'Preparing a cue from the saved analysis.' : 'Your recording is saved. Preparing the result…';
    add(center, indicator, heading(title, passage?.title), node('p', 'subtle', detail));
    if (store.state.historyOrigin) page.append(control('‹ Back to history', 'back-link', () => store.showHistory()));
    add(page, center, node('p', 'fine-print', (currentRecord()?.captureSource ?? mode()) === 'demo' ? 'Demo analysis uses a prepared local result.' : 'A service error will be shown at the stage where it occurs.'));
    return page;
  }

  function resultHeader(passage: Passage, record: AttemptRecord): HTMLElement {
    const top = node('div', 'result-top');
    add(top, heading(passage.title, `${recordLabel(record, store.records)}${store.state.historyOrigin ? ' · Past result' : ''}`), store.state.historyOrigin ? node('p', 'history-badge', 'Saved result · Read only') : null);
    return top;
  }

  function carousel(findings: Finding[], passage: Passage, record: AttemptRecord): HTMLElement {
    const wrap = node('div', 'finding-carousel');
    const index = Math.min(store.state.findingIndex, findings.length - 1);
    const label = add(node('div', 'carousel-center'), node('span', 'carousel-label', `Mistake ${index + 1} of ${findings.length}`));
    const dots = node('div', 'carousel-dots');
    for (let i = 0; i < findings.length; i += 1) {
      const dot = node('span', i === index ? 'active' : ''); dot.setAttribute('aria-hidden', 'true'); dots.append(dot);
    }
    label.append(dots);
    add(wrap, control('‹', 'circle-button', () => store.moveFinding(-1), index === 0), label, control('›', 'circle-button', () => store.moveFinding(1), index === findings.length - 1));
    wrap.setAttribute('aria-label', `Finding ${index + 1} of ${findings.length} for ${passage.title}`);
    wrap.addEventListener('touchstart', (event) => { touchStart = event.changedTouches[0]?.clientX ?? null; }, { passive: true });
    wrap.addEventListener('touchend', (event) => {
      if (touchStart === null) return;
      const delta = (event.changedTouches[0]?.clientX ?? touchStart) - touchStart;
      touchStart = null;
      if (Math.abs(delta) > 35) store.moveFinding(delta < 0 ? 1 : -1);
    }, { passive: true });
    void record;
    return wrap;
  }

  function resultNav(): HTMLElement {
    const nav = node('div', 'result-nav');
    add(nav, control('Play again · Choose a passage', 'secondary-action', playAgain), control('View past results', 'text-link', () => store.showHistory()));
    return nav;
  }

  function review(passage: Passage, record: AttemptRecord): HTMLElement {
    const page = node('main', 'page result-page');
    const analysis = record.analysis;
    add(page, control(store.state.historyOrigin ? '‹ Back to history' : '‹ Library', 'back-link', returnFromResult), resultHeader(passage, record));
    const unclearCard = analysis ? resolveVisualPlan(analysis, passage, record.coaching).cards.find(card => card.kind === 'unclear_audio') : undefined;
    if (!analysis || analysis.status !== 'ok' || unclearCard) {
      const message = unclearCard || analysis?.status === 'uncertain' || analysis?.status === 'insufficient_audio' ? "I couldn't hear that clearly. Try again." : record.error?.message ?? 'This result is unavailable.';
      if (unclearCard) {
        const view = mountPaperVisualization(unclearCard);
        paperViews.push(view);
        add(page, view.element);
      }
      add(page, node('div', 'message-card', message), node('p', 'subtle', 'No musical judgment was made from this recording.'), node('div', 'grow'), resultNav());
      return page;
    }
    const findings = orderedFindings(record, passage);
    if (!findings.length) {
      add(page, node('div', 'clean-card', 'No supported mistakes found'), node('p', 'subtle', `${analysis.metrics.matchedNotes} of ${analysis.metrics.expectedNotes} reference notes matched. This result is not a grade.`), score(passage), node('div', 'grow'), resultNav());
      return page;
    }
    const finding = findings[Math.min(store.state.findingIndex, findings.length - 1)];
    const reference = referenceFor(finding, passage);
    const beat = findingBeat(finding, passage, record);
    const beatLabel = Number.isFinite(beat) && beat < Number.MAX_SAFE_INTEGER ? `Beat ${Math.floor(beat) + 1}` : 'Outside reference';
    const issue = node('section', 'review-issue');
    add(issue, node('h2', '', `${findings.length} thing${findings.length === 1 ? '' : 's'} to revisit`), node('p', 'subtle', `${beatLabel} · ${findingTitle(finding)}`));
    const comparison = node('div', 'comparison-grid');
    const detected = analysis.detectedNotes.find((note) => note.id === finding.detectedNoteId);
    const duration = resolveDurationEvidence(record, passage, finding);
    if (finding.kind === 'duration') {
      add(comparison,
        add(node('div', 'comparison-cell expected'), node('span', 'subtle', 'Reference'), node('strong', '', duration ? `${duration.expectedBeats} beat${duration.expectedBeats === 1 ? '' : 's'}` : '—')),
        add(node('div', 'comparison-cell heard'), node('span', 'subtle', 'Detected'), node('strong', '', duration ? `${duration.playedBeats.toFixed(2)} beats` : '—')));
    } else if (finding.kind === 'timing') {
      const delta = finding.timingDeltaMs ?? 0;
      add(comparison,
        add(node('div', 'comparison-cell expected'), node('span', 'subtle', 'Expected'), node('strong', '', reference ? noteName(reference.midiPitch) : 'Note')),
        add(node('div', 'comparison-cell heard timing'), node('span', 'subtle', 'Heard'), node('strong', '', `${Math.abs(Math.round(delta))} ms`), node('span', 'subtle', delta >= 0 ? 'late' : 'early')));
    } else {
      add(comparison,
        add(node('div', 'comparison-cell expected'), node('span', 'subtle', 'Expected'), node('strong', '', reference ? noteName(reference.midiPitch) : '—')),
        add(node('div', 'comparison-cell heard'), node('span', 'subtle', 'Heard'), node('strong', '', detected ? noteName(detected.midiPitch) : '—')));
    }
    const metrics = node('div', 'metrics-card');
    add(metrics, node('strong', '', `${analysis.metrics.matchedNotes} of ${analysis.metrics.expectedNotes} reference notes matched`), node('p', 'subtle', `${findings.filter((item) => item.kind === 'wrong_note').length} wrong · ${findings.filter((item) => item.kind === 'timing').length} timing · ${findings.filter((item) => item.kind === 'duration').length} hold · ${findings.filter((item) => item.kind === 'missing_note').length} missing · ${findings.filter((item) => item.kind === 'extra_note').length} extra`));
    add(page, carousel(findings, passage, record), issue, comparison, metrics, coachingLabel(record) ? node('p', 'fine-print', coachingLabel(record) ?? '') : null, control('View in sheet music', 'outline-action', openSheet), node('div', 'grow'), control('View correction →', 'primary-action', () => store.showGuide()), resultNav());
    if (reference) issue.dataset.referenceNoteId = reference.id;
    return page;
  }

  function guide(passage: Passage, record: AttemptRecord): HTMLElement {
    const page = node('main', 'page guide-page');
    const findings = orderedFindings(record, passage);
    const finding = findings[Math.min(store.state.findingIndex, findings.length - 1)];
    if (!finding) return review(passage, record);
    const reference = referenceFor(finding, passage);
    const coaching = record.coaching;
    const cue = coaching?.evidenceFindingIds.includes(finding.id) ? coaching.cue : correctionFor(finding, passage);
    const visual = resolveMistakeVisualization(record, passage, finding);
    const correction = node('div', 'correction-card', cue);
    const metadata = node('div', 'teaching-card');
    const fingerLabel = suggestedFingerLabel(reference);
    add(metadata, node('span', '', durationLabel(reference)), fingerLabel ? node('span', '', fingerLabel) : null);
    const paperCard = record.analysis ? resolveVisualPlan(record.analysis, passage, coaching).cards.find(card => card.evidence.findingIds.includes(finding.id)) : undefined;
    const paperView = paperCard ? mountPaperVisualization(paperCard) : null;
    if (paperView) paperViews.push(paperView);
    const sequence = paperView ? paperView.element : visual ? keyboard(visual) : node('p', 'subtle visual-unavailable', 'A supported key comparison is unavailable for this finding.');
    const replay = paperView ? control('Replay visualization', 'outline-action replay-action', () => paperView.replay()) : visual ? control(visual.duration ? 'Replay key and hold' : 'Replay key comparison', 'outline-action replay-action', () => {
      sequence.classList.remove('is-playing');
      void sequence.offsetWidth;
      sequence.classList.add('is-playing');
    }) : null;
    if (!paperView && visual) {
      const bars = durationComparison(visual);
      if (bars) sequence.append(bars);
    }
    add(page, control('‹ Back to review', 'back-link', () => store.showReview()), resultHeader(passage, record), carousel(findings, passage, record), heading('Your correction'), correction, coachingLabel(record) ? node('p', 'fine-print', coachingLabel(record) ?? '') : null, sequence, replay, metadata, control('View in sheet music', 'outline-action', openSheet), node('div', 'grow'), control('‹ Back to review', 'primary-action', () => store.showReview()), resultNav());
    return page;
  }

  function history(): HTMLElement {
    const page = node('main', 'page history-page');
    add(page, control('‹ Back to library', 'back-link', () => store.showLibrary()), heading('Past results', `${store.count()} completed recording${store.count() === 1 ? '' : 's'}`));
    if (!store.records.length) add(page, node('p', 'empty-state', 'No recordings yet. Choose a passage to begin.'));
    for (const record of [...store.records].reverse()) {
      const passage = passageOf(record.passageId);
      const row = control('', 'history-row', () => store.openAttempt(record.attemptId));
      add(row, add(node('span', 'history-main'), node('strong', '', passage?.title ?? record.passageId), node('span', 'subtle', `${dateLabel(record.startedAt)} · ${sourceLabel(record)}`)), add(node('span', 'history-side'), node('span', 'status-pill', statusLabel(record)), node('span', 'chevron', '›')));
      page.append(row);
    }
    return page;
  }

  function error(record?: AttemptRecord): HTMLElement {
    const page = node('main', 'page status-page');
    const passage = passageOf(record?.passageId ?? store.state.passageId);
    const reason = record?.error?.message ?? 'The result could not be prepared.';
    const stage = record?.error?.stage;
    const stageLabel = stage === 'normalization' ? 'WAV normalization' : stage === 'upload' ? 'Upload' : stage === 'analysis' ? 'Note analysis' : stage === 'coaching' ? 'Coaching' : 'Capture';
    add(page, control(store.state.historyOrigin ? '‹ Back to history' : '‹ Library', 'back-link', returnFromResult), node('div', 'grow'), heading(record ? statusLabel(record) : 'Result unavailable', passage?.title), node('p', 'eyebrow', `${stageLabel} issue`), node('div', 'message-card', reason));
    if (record?.analysis?.status === 'ok' && passage) {
      const findings = orderedFindings(record, passage);
      const first = findings[0];
      if (first) {
        const reference = referenceFor(first, passage);
        add(page, node('p', 'subtle', 'Analysis was saved. Coaching could not finish, so this correction comes directly from the recorded finding.'), node('div', 'finding-card', `${findingTitle(first)} · ${detailFor(first, passage, record)}`), node('div', 'correction-card', correctionFor(first, passage)), score(passage, reference));
      } else add(page, node('p', 'subtle', `${record.analysis.metrics.matchedNotes} of ${record.analysis.metrics.expectedNotes} reference notes matched. Coaching could not finish.`));
    } else page.append(node('p', 'subtle', record?.captureStatus === 'completed' ? 'This completed recording remains in your history. No musical judgment was made.' : 'This attempt did not count as a completed recording.'));
    add(page, node('div', 'grow'), record?.captureStatus === 'completed' && actions.retry && actions.canRetry?.(record.attemptId) ? control('Retry saved recording', 'outline-action', actions.retry) : null, control('Play again · Choose a passage', 'primary-action', playAgain), control('View past results', 'text-link', () => store.showHistory()));
    return page;
  }

  function sheet(passage: Passage, record?: AttemptRecord): HTMLElement {
    const page = node('main', 'page sheet-page');
    page.setAttribute('role', 'dialog'); page.setAttribute('aria-modal', 'true'); page.setAttribute('aria-label', 'Sheet music');
    const findings = record ? orderedFindings(record, passage) : [];
    const finding = findings[Math.min(store.state.findingIndex, findings.length - 1)];
    const reference = referenceFor(finding, passage);
    const extraBeat = finding?.kind === 'extra_note' && record ? findingBeat(finding, passage, record) : undefined;
    add(page, control('‹ Close sheet music', 'back-link', closeSheet), heading('Sheet music', passage.title), node('p', 'subtle', reference ? `${findingTitle(finding)} · ${noteName(reference.midiPitch)} · Beat ${reference.onsetBeat + 1}` : extraBeat !== undefined ? `Extra detected note near beat ${Math.floor(extraBeat) + 1}` : 'Reference phrase'), score(passage, reference, extraBeat), node('p', 'duration-caption', durationLabel(reference)), node('p', 'fine-print', reference ? 'The outlined note is the selected reference finding.' : 'The outlined beat marks the extra detected note; no reference note is prescribed there.'), node('div', 'grow'), control(`‹ Back to ${store.state.sheetOrigin}`, 'primary-action', closeSheet));
    return page;
  }

  function dialog(): HTMLElement | null {
    if (!cancelOpen) return null;
    const overlay = node('div', 'dialog-overlay');
    const panel = node('div', 'dialog-panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
    const title = node('h2', '', 'Cancel recording?'); title.id = 'encore-dialog-title'; panel.setAttribute('aria-labelledby', title.id);
    panel.append(title);
    add(panel, node('p', 'subtle', 'This capture will not count as a completed recording.'), control('Keep recording', 'primary-action', closeDialog), control('Cancel and return to library', 'secondary-action', () => { cancelOpen = false; actions.cancel(); }));
    overlay.append(panel);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeDialog(); });
    return overlay;
  }

  let lastScreen = store.state.screen;
  const paperViews: ReturnType<typeof mountPaperVisualization>[] = [];
  function clearPaperViews(): void { for (const view of paperViews.splice(0)) view.destroy(); }
  function renderContent(): void {
    if (settings.isOpen && settingsLayer) return;
    clearPaperViews();
    const screenChanged = lastScreen !== store.state.screen;
    lastScreen = store.state.screen;
    const record = currentRecord();
    const passage = currentPassage();
    const screen = store.state.screen;
    const shell = node('div', 'encore-shell');
    shell.append(header());
    const source = record ? record.captureSource ?? 'demo' : mode();
    const demo = node('div', 'demo-banner', source === 'demo' ? 'Demo · simulated audio and results' : source === 'test' ? 'Test WAV · recorded playback, not live piano' : source === 'g2' ? 'G2 source · hardware connection unverified' : 'Phone microphone · service connection unverified');
    demo.setAttribute('role', 'status'); shell.append(demo);
    if (store.storageWarning) shell.append(node('div', 'storage-warning', store.storageWarning));
    if (screen === 'library') shell.append(library());
    else if (screen === 'ready' && passage) shell.append(ready(passage));
    else if (screen === 'recording' && passage) shell.append(recording(passage, record));
    else if (screen === 'processing') shell.append(processing(passage));
    else if (screen === 'review' && passage && record) shell.append(review(passage, record));
    else if (screen === 'guide' && passage && record) shell.append(guide(passage, record));
    else if (screen === 'sheet' && passage && record) shell.append(store.state.sheetOrigin === 'guide' ? guide(passage, record) : review(passage, record));
    else if (screen === 'history') shell.append(history());
    else if (screen === 'error') shell.append(error(record));
    else shell.append(library());
    shell.append(node('div', 'safe-bottom'));
    const activeDialog = dialog(); if (activeDialog) shell.append(activeDialog);
    if (screen === 'sheet' && passage) {
      shell.inert = true;
      const overlay = node('div', 'sheet-overlay');
      overlay.append(sheet(passage, record));
      root.replaceChildren(shell, overlay);
      overlay.querySelector<HTMLButtonElement>('button')?.focus();
    } else root.replaceChildren(shell);
    if (screenChanged) window.scrollTo({ top: 0, behavior: 'instant' });
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
    if (screen === 'recording' && record) timer = window.setInterval(() => updateTime(record), 1000);
    if (settings.isOpen) syncSettingsLayer();
  }

  function render(): void {
    try { measureTelemetry('app.render', renderContent); }
    catch (cause) {
      markTelemetryErrorReported(cause);
      recordTelemetryFailure('render', 'render_failed', 'app');
      throw cause;
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (settings.isOpen) {
      if (event.key === 'Escape') { event.preventDefault(); settings.close(); }
      return;
    }
    if (cancelOpen) {
      if (event.key === 'Escape') { event.preventDefault(); closeDialog(); }
      if (event.key === 'Tab') {
        const buttons = [...root.querySelectorAll<HTMLButtonElement>('[role="dialog"] button:not(:disabled)')];
        const first = buttons[0]; const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      return;
    }
    if (store.state.screen === 'sheet') {
      if (event.key === 'Escape') { event.preventDefault(); closeSheet(); }
      if (event.key === 'Tab') {
        const buttons = [...root.querySelectorAll<HTMLButtonElement>('.sheet-overlay button:not(:disabled)')];
        const first = buttons[0]; const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      return;
    }
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && (store.state.screen === 'review' || store.state.screen === 'guide')) {
      event.preventDefault(); store.moveFinding(event.key === 'ArrowRight' ? 1 : -1);
    }
  }

  const unsubscribe = store.subscribe(render);
  const unsubscribeSettings = settings.subscribe(syncSettingsLayer);
  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('encore:mode-change', render);
  render();
  return () => {
    clearPaperViews();
    unsubscribe();
    unsubscribeSettings();
    root.removeEventListener('keydown', onKeyDown);
    root.removeEventListener('encore:mode-change', render);
    if (timer !== undefined) window.clearInterval(timer);
    root.replaceChildren();
  };
}
