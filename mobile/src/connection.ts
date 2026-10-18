import type { SessionStore } from './session.ts';
import type { CaptureEndpoints } from './capture.ts';

export type RecordingSource = 'g2';
export type Connection = { mode: RecordingSource; upload: string; analysis: string; coaching: string };
const SOURCE_LABELS: Record<RecordingSource, string> = { g2: 'G2' };

/** Optional deployment connection controls, separate from the quiet practice flow. */
export function mountConnection(store: SessionStore, root: HTMLElement, change: (next: Connection) => string | null,
  options: { sources?: RecordingSource[]; defaults: CaptureEndpoints; locked?: boolean; onSessionToken?: (token: string) => void }): { message(value: string | null): void; setVisible(visible: boolean): void; dispose(): void } {
  const sources = options.sources ?? ['g2'];
  const panel = document.createElement('details');
  panel.className = 'connection-settings';
  panel.style.cssText = 'max-width:390px;margin:0 auto 24px;padding:16px 24px;font:14px/1.5 system-ui;color:#625F58;box-sizing:border-box;';
  const summary = document.createElement('summary');
  summary.textContent = 'Connection settings';
  summary.style.cssText = 'cursor:pointer;min-height:44px;display:flex;align-items:center;';
  panel.append(summary);
  const form = document.createElement('form');
  form.style.cssText = 'display:grid;gap:12px;';
  const explanation = document.createElement('p');
  explanation.textContent = 'Recording sends normalized WAV audio through upload, analysis, and coaching. Results and history use that analysis. Raw audio is not saved in History.';
  form.append(explanation);
  const modeLabel = document.createElement('label');
  modeLabel.textContent = 'Recording source';
  const mode = document.createElement('select');
  mode.name = 'source'; mode.setAttribute('aria-label', 'Recording source');
  for (const value of sources) {
    const option = document.createElement('option'); option.value = value; option.textContent = SOURCE_LABELS[value]; mode.append(option);
  }
  mode.value = 'g2';
  modeLabel.append(mode);
  if (sources.length > 1) form.append(modeLabel);
  function field(label: string, placeholder: string): HTMLInputElement {
    const wrapper = document.createElement('label'); wrapper.textContent = label;
    const input = document.createElement('input'); input.type = 'text'; input.inputMode = 'url'; input.placeholder = placeholder; input.setAttribute('aria-label', label); input.autocomplete = 'off';
    wrapper.append(input); form.append(wrapper); return input;
  }
  const upload = field('Upload endpoint', options.defaults.upload); upload.value = options.defaults.upload;
  const analysis = field('Analysis endpoint', options.defaults.analysis); analysis.value = options.defaults.analysis;
  const coaching = field('Coaching endpoint', options.defaults.coaching); coaching.value = options.defaults.coaching;
  if (options.locked) for (const input of [upload, analysis, coaching]) input.readOnly = true;
  if (options.onSessionToken) {
    const label = document.createElement('label'); label.textContent = 'Service token (this session only)';
    const token = document.createElement('input'); token.type = 'password'; token.autocomplete = 'off';
    token.setAttribute('aria-label', 'Service token');
    token.style.cssText = 'display:block;width:100%;min-height:44px;margin-top:4px;padding:10px;border:1px solid #D8D2C7;border-radius:10px;background:#F6F2EA;color:#171714;font:inherit;box-sizing:border-box;';
    token.addEventListener('input', () => options.onSessionToken?.(token.value));
    label.append(token); form.append(label);
  }
  const apply = document.createElement('button'); apply.type = 'submit'; apply.textContent = 'Apply connection'; form.append(apply);
  for (const input of [mode, upload, analysis, coaching, apply]) input.style.cssText = 'display:block;width:100%;min-height:44px;margin-top:4px;padding:10px;border:1px solid #D8D2C7;border-radius:10px;background:#F6F2EA;color:#171714;font:inherit;box-sizing:border-box;';
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.style.cssText = 'overflow-wrap:anywhere;';
  panel.append(form, status); root.after(panel);
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (apply.disabled) return;
    const error = change({ mode: sources.find(source => source === mode.value) ?? 'g2', upload: upload.value.trim(), analysis: analysis.value.trim(), coaching: coaching.value.trim() });
    status.textContent = error ?? 'Connection applied. Choose a passage to begin.';
    if (!error) panel.open = false;
  });
  const unsubscribe = store.subscribe(() => {
    apply.disabled = ['recording', 'processing'].includes(store.state.screen);
    for (const input of [mode, upload, analysis, coaching]) input.disabled = apply.disabled;
  });
  return {
    setVisible(visible): void { panel.hidden = !visible; },
    message(value): void { status.textContent = value ?? ''; if (value) panel.open = true; },
    dispose(): void { unsubscribe(); panel.remove(); },
  };
}
