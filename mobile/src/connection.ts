import type { SessionStore } from './session.ts';

export type RecordingSource = 'demo' | 'phone' | 'g2';
export type Connection = { mode: RecordingSource; upload: string; analysis: string; coaching: string };
const SOURCE_LABELS: Record<RecordingSource, string> = { demo: 'Demo (simulated)', phone: 'Phone microphone', g2: 'G2 microphone' };

/** Optional deployment connection controls, separate from the quiet practice flow. */
export function mountConnection(store: SessionStore, root: HTMLElement, change: (next: Connection) => string | null, sources: RecordingSource[] = ['demo', 'phone']): { message(value: string | null): void; setVisible(visible: boolean): void; dispose(): void } {
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
  explanation.textContent = 'Phone recording sends normalized WAV audio through upload, analysis, and coaching. Demo uses simulated results and is labeled separately. Raw audio is not saved in History.';
  form.append(explanation);
  const modeLabel = document.createElement('label');
  modeLabel.textContent = 'Recording source';
  const mode = document.createElement('select');
  mode.name = 'source'; mode.setAttribute('aria-label', 'Recording source');
  for (const value of sources) {
    const option = document.createElement('option'); option.value = value; option.textContent = SOURCE_LABELS[value]; mode.append(option);
  }
  mode.value = 'phone';
  modeLabel.append(mode); form.append(modeLabel);
  function field(label: string, placeholder: string): HTMLInputElement {
    const wrapper = document.createElement('label'); wrapper.textContent = label;
    const input = document.createElement('input'); input.type = 'text'; input.inputMode = 'url'; input.placeholder = placeholder; input.setAttribute('aria-label', label); input.autocomplete = 'off';
    wrapper.append(input); form.append(wrapper); return input;
  }
  const upload = field('Upload endpoint', '/api/recordings'); upload.value = '/api/recordings';
  const analysis = field('Analysis endpoint', '/api/analyze'); analysis.value = '/api/analyze';
  const coaching = field('Coaching endpoint', '/api/coach'); coaching.value = '/api/coach';
  const apply = document.createElement('button'); apply.type = 'submit'; apply.textContent = 'Apply connection'; form.append(apply);
  for (const input of [mode, upload, analysis, coaching, apply]) input.style.cssText = 'display:block;width:100%;min-height:44px;margin-top:4px;padding:10px;border:1px solid #D8D2C7;border-radius:10px;background:#F6F2EA;color:#171714;font:inherit;box-sizing:border-box;';
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.style.cssText = 'overflow-wrap:anywhere;';
  panel.append(form, status); root.after(panel);
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (apply.disabled) return;
    const error = change({ mode: sources.find(source => source === mode.value) ?? 'demo', upload: upload.value.trim(), analysis: analysis.value.trim(), coaching: coaching.value.trim() });
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
