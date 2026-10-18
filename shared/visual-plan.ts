import type { AnalysisResult, DetectedNote, Finding, Passage, ReferenceNote } from './contracts.ts';
import type { VisualCard, VisualKind, VisualNote, VisualPlan } from './visual-contract.ts';

export const VISUAL_KINDS = {
  wrong_note: { priority: 3, variants: ['pitch', 'octave', 'accidental', 'self_fix'], availability: 'analysis' },
  missing_note: { priority: 2, variants: ['missing', 'swapped_order'], availability: 'analysis' },
  extra_note: { priority: 2, variants: ['extra', 'swapped_order'], availability: 'analysis' },
  timing: { priority: 4, variants: ['early', 'late'], availability: 'analysis' },
  duration: { priority: 5, variants: ['short', 'long'], availability: 'analysis' },
  unclear_audio: { priority: 1, variants: ['uncertain', 'no_piano', 'noisy', 'quiet'], availability: 'analysis' },
  tempo_drift: { priority: 4, variants: ['rushing', 'slowing'], availability: 'fixture' },
  uneven_rhythm: { priority: 4, variants: ['alternating'], availability: 'fixture' },
  unexpected_pause: { priority: 4, variants: ['pause'], availability: 'fixture' },
  rest_violation: { priority: 4, variants: ['rest'], availability: 'fixture' },
  section_repeat_skip: { priority: 2, variants: ['repeated', 'skipped'], availability: 'fixture' },
  recurring_trouble: { priority: 4, variants: ['recurring', 'resolved'], availability: 'fixture' }
} as const satisfies Record<VisualKind, { priority: 1 | 2 | 3 | 4 | 5; variants: readonly string[]; availability: 'analysis' | 'fixture' }>;
const FIXTURE_ONLY_VARIANTS: Partial<Record<VisualKind, readonly string[]>> = {
  wrong_note: ['self_fix'], missing_note: ['swapped_order'], extra_note: ['swapped_order'],
  unclear_audio: ['noisy', 'quiet']
};

type Plain = Record<string, unknown>;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
function object(value: unknown): value is Plain { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function keys(value: Plain, required: readonly string[], optional: readonly string[] = []): boolean {
  return required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function id(value: unknown): value is string { return typeof value === 'string' && value.length <= 80 && idPattern.test(value); }
function label(value: unknown, max = 120): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f<>]/.test(value);
}
function number(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
function list(value: unknown, max: number, check: (entry: unknown) => boolean): value is unknown[] {
  return Array.isArray(value) && value.length <= max && value.every(check);
}
function uniqueIds(value: unknown, max: number): value is string[] {
  return list(value, max, id) && new Set(value).size === value.length;
}
function validNote(value: unknown): value is VisualNote {
  return object(value) && keys(value, ['id', 'midiPitch', 'onsetBeat', 'durationBeats']) &&
    id(value.id) && Number.isInteger(value.midiPitch) && number(value.midiPitch, 21, 108) &&
    number(value.onsetBeat, 0, 256) && number(value.durationBeats, 0.001, 64);
}
function validSequence(value: unknown): boolean {
  return object(value) && keys(value, ['label', 'notes'], ['segmentIds']) && label(value.label, 80) &&
    list(value.notes, 16, validNote) && new Set(value.notes.map(note => (note as VisualNote).id)).size === value.notes.length &&
    (value.segmentIds === undefined || list(value.segmentIds, 16, id));
}
function validMetrics(value: unknown): boolean {
  if (!object(value) || !keys(value, [], ['timingDeltaBeats', 'expectedDurationBeats', 'detectedDurationBeats',
    'driftPercent', 'gapBeats', 'recurrenceCount', 'recurrenceWindow'])) return false;
  return (value.timingDeltaBeats === undefined || number(value.timingDeltaBeats, -128, 128)) &&
    (value.expectedDurationBeats === undefined || number(value.expectedDurationBeats, 0.001, 64)) &&
    (value.detectedDurationBeats === undefined || number(value.detectedDurationBeats, 0.001, 64)) &&
    (value.driftPercent === undefined || number(value.driftPercent, -100, 100)) &&
    (value.gapBeats === undefined || number(value.gapBeats, 0, 128)) &&
    (value.recurrenceCount === undefined || (Number.isInteger(value.recurrenceCount) && number(value.recurrenceCount, 0, 10))) &&
    (value.recurrenceWindow === undefined || (Number.isInteger(value.recurrenceWindow) && number(value.recurrenceWindow, 1, 10)));
}
function validEvidence(value: unknown): boolean {
  return object(value) && keys(value, ['source', 'measurement', 'findingIds', 'referenceNoteIds', 'detectedNoteIds']) &&
    (value.source === 'analysis' || value.source === 'fixture') &&
    ['note_alignment', 'audio_quality', 'phrase_pattern', 'history'].includes(String(value.measurement)) &&
    uniqueIds(value.findingIds, 16) && uniqueIds(value.referenceNoteIds, 16) && uniqueIds(value.detectedNoteIds, 16);
}
function validSegments(value: unknown): boolean {
  return list(value, 16, item => object(item) && keys(item, ['id', 'label', 'startBeat', 'endBeat']) &&
    id(item.id) && label(item.label, 40) && number(item.startBeat, 0, 256) &&
    number(item.endBeat, 0, 256) && item.endBeat > item.startBeat);
}
function validHistory(value: unknown): boolean {
  return list(value, 3, item => object(item) && keys(item, ['attemptId', 'label', 'flaggedBeats']) &&
    id(item.attemptId) && label(item.label, 40) &&
    list(item.flaggedBeats, 16, beat => number(beat, 0, 256)));
}

export function validateVisualCard(value: unknown): value is VisualCard {
  if (!object(value) || !keys(value, ['id', 'kind', 'variant', 'priority', 'focus', 'expected', 'detected',
    'metrics', 'cue', 'evidence'], ['segments', 'historyRows'])) return false;
  if (!id(value.id) || typeof value.kind !== 'string' || !Object.hasOwn(VISUAL_KINDS, value.kind)) return false;
  const kind = value.kind as VisualKind;
  const spec = VISUAL_KINDS[kind];
  if (!spec.variants.some(variant => variant === value.variant) || value.priority !== spec.priority) return false;
  if (!object(value.focus) || !keys(value.focus, ['startBeat', 'endBeat']) ||
      !number(value.focus.startBeat, 0, 256) || !number(value.focus.endBeat, 0, 256) ||
      value.focus.endBeat <= value.focus.startBeat) return false;
  if (!validSequence(value.expected) || !validSequence(value.detected) || !validMetrics(value.metrics) ||
      !label(value.cue, 140) || !validEvidence(value.evidence)) return false;
  const evidence = value.evidence as VisualCard['evidence'];
  if (evidence.source === 'analysis' && spec.availability === 'fixture') return false;
  if (evidence.source === 'analysis' && FIXTURE_ONLY_VARIANTS[kind]?.includes(String(value.variant))) return false;
  if (evidence.source === 'analysis' && (value.segments !== undefined || value.historyRows !== undefined)) return false;
  if (value.segments !== undefined && !validSegments(value.segments)) return false;
  if (value.historyRows !== undefined && !validHistory(value.historyRows)) return false;
  if (kind === 'unclear_audio') {
    if (evidence.measurement !== 'audio_quality' || evidence.findingIds.length > 0 ||
        (evidence.source === 'analysis' && value.variant !== 'uncertain' && value.variant !== 'no_piano')) return false;
    if ((value.expected as VisualCard['expected']).notes.length > 0 || (value.detected as VisualCard['detected']).notes.length > 0) return false;
  } else if (evidence.source === 'analysis' && (evidence.measurement !== 'note_alignment' || evidence.findingIds.length === 0)) return false;
  if (kind === 'recurring_trouble' && (evidence.source !== 'fixture' || evidence.measurement !== 'history' ||
      value.historyRows === undefined)) return false;
  if (kind === 'section_repeat_skip' && (evidence.source !== 'fixture' || value.segments === undefined ||
      !(value.expected as VisualCard['expected']).segmentIds || !(value.detected as VisualCard['detected']).segmentIds)) return false;
  if (kind === 'section_repeat_skip') {
    const segmentIds = new Set((value.segments as VisualCard['segments'] ?? []).map(segment => segment.id));
    const expectedPath = (value.expected as VisualCard['expected']).segmentIds ?? [];
    const detectedPath = (value.detected as VisualCard['detected']).segmentIds ?? [];
    if (new Set(expectedPath).size !== expectedPath.length ||
        [...expectedPath, ...detectedPath].some(segmentId => !segmentIds.has(segmentId))) return false;
  }
  return true;
}

export function validateVisualPlan(value: unknown): value is VisualPlan {
  if (!object(value) || !keys(value, ['schemaVersion', 'attemptId', 'passageId', 'passageVersion', 'source', 'cards']) ||
      value.schemaVersion !== '1' || !id(value.attemptId) || !id(value.passageId) || !id(value.passageVersion) ||
      (value.source !== 'analysis' && value.source !== 'fixture') || !list(value.cards, 3, validateVisualCard)) return false;
  const cards = value.cards as VisualCard[];
  if (new Set(cards.map(card => card.id)).size !== cards.length || cards.some(card => card.evidence.source !== value.source)) return false;
  if (cards.some((card, index) => index > 0 && (card.priority < cards[index - 1].priority ||
      (card.priority === cards[index - 1].priority && card.focus.startBeat < cards[index - 1].focus.startBeat)))) return false;
  if (cards.some(card => card.kind === 'unclear_audio') && cards.length !== 1) return false;
  return true;
}

function beatFromSeconds(seconds: number, analysis: AnalysisResult): number {
  return Math.max(0, (seconds - (analysis.alignment.offsetSec ?? 0)) * analysis.attemptTempoBpm / 60);
}
function visualReference(note: ReferenceNote): VisualNote {
  return { id: note.id, midiPitch: note.midiPitch, onsetBeat: note.onsetBeat, durationBeats: note.durationBeats };
}
function visualDetected(note: DetectedNote, analysis: AnalysisResult): VisualNote {
  return { id: note.id, midiPitch: note.midiPitch, onsetBeat: beatFromSeconds(note.onsetSec, analysis),
    durationBeats: note.durationSec * analysis.attemptTempoBpm / 60 };
}
function midiName(pitch: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return names[pitch % 12] + String(Math.floor(pitch / 12) - 1);
}
function noteContext<T extends { id: string; onsetBeat: number }>(notes: T[], beat: number, focalId?: string): T[] {
  const nearby = notes.filter(note => Math.abs(note.onsetBeat - beat) <= 2).slice(0, 16);
  const focal = focalId ? notes.find(note => note.id === focalId) : undefined;
  if (focal && !nearby.some(note => note.id === focal.id)) {
    if (nearby.length === 16) nearby.pop();
    nearby.push(focal);
    nearby.sort((a, b) => a.onsetBeat - b.onsetBeat);
  }
  return nearby;
}
function cardForFinding(analysis: AnalysisResult, passage: Passage, finding: Finding): VisualCard | null {
  const reference = passage.notes.find(note => note.id === finding.referenceNoteId);
  const detected = analysis.detectedNotes.find(note => note.id === finding.detectedNoteId);
  if ((finding.kind !== 'extra_note' && !reference) ||
      ((finding.kind === 'extra_note' || finding.kind === 'wrong_note' || finding.kind === 'duration') && !detected)) return null;
  const beat = reference?.onsetBeat ?? (detected ? beatFromSeconds(detected.onsetSec, analysis) : 0);
  const detectedBeat = detected ? beatFromSeconds(detected.onsetSec, analysis) : beat;
  const expectedNotes = noteContext(passage.notes, beat, reference?.id).map(visualReference);
  const detectedNotes = noteContext(analysis.detectedNotes.map(note => visualDetected(note, analysis)), beat, detected?.id);
  const base: Omit<VisualCard, 'variant' | 'cue'> = {
    id: finding.id,
    kind: finding.kind,
    priority: VISUAL_KINDS[finding.kind].priority,
    focus: { startBeat: Math.min(beat, detectedBeat),
      endBeat: Math.max(beat + Math.max(0.25, reference?.durationBeats ?? 0.5), detectedBeat + 0.25) },
    expected: { label: 'EXPECTED', notes: expectedNotes },
    detected: { label: 'DETECTED', notes: detectedNotes },
    metrics: {},
    evidence: { source: 'analysis', measurement: 'note_alignment', findingIds: [finding.id],
      referenceNoteIds: reference ? [reference.id] : [], detectedNoteIds: detected ? [detected.id] : [] }
  };
  if (finding.kind === 'wrong_note' && reference && detected) {
    const variant = Math.abs(reference.midiPitch - detected.midiPitch) === 12 ? 'octave' :
      (reference.midiPitch % 12 !== detected.midiPitch % 12 && Math.abs(reference.midiPitch - detected.midiPitch) === 1 ? 'accidental' : 'pitch');
    return { ...base, kind: finding.kind, variant, cue: 'Play ' + midiName(reference.midiPitch) + ' on this beat.' };
  }
  if (finding.kind === 'missing_note' && reference) {
    return { ...base, kind: finding.kind, variant: 'missing', cue: 'Play ' + midiName(reference.midiPitch) + ' on this beat.' };
  }
  if (finding.kind === 'extra_note' && detected) {
    return { ...base, kind: finding.kind, variant: 'extra', cue: 'Leave this beat clear before the next note.' };
  }
  if (finding.kind === 'timing' && reference && finding.timingDeltaMs !== undefined) {
    const delta = finding.timingDeltaMs * analysis.attemptTempoBpm / 60_000;
    return { ...base, kind: finding.kind, variant: delta < 0 ? 'early' : 'late',
      metrics: { timingDeltaBeats: delta }, cue: delta < 0 ? 'Wait for the beat, then play.' : 'Play on the beat without waiting.' };
  }
  if (finding.kind === 'duration' && reference && detected && finding.durationDeltaMs !== undefined) {
    return { ...base, kind: finding.kind, variant: finding.durationDeltaMs < 0 ? 'short' : 'long',
      metrics: { expectedDurationBeats: reference.durationBeats, detectedDurationBeats: detected.durationSec * analysis.attemptTempoBpm / 60 },
      cue: finding.durationDeltaMs < 0 ? 'Hold for the full written length.' : 'Release before the next note.' };
  }
  return null;
}

export function buildVisualPlan(analysis: AnalysisResult, passage: Passage, _selectedFindingId?: string): VisualPlan {
  const empty: VisualPlan = { schemaVersion: '1', attemptId: analysis.attemptId, passageId: passage.id,
    passageVersion: passage.version, source: 'analysis', cards: [] };
  if (analysis.passageId !== passage.id || analysis.passageVersion !== passage.version || analysis.status === 'error') return empty;
  if (analysis.status !== 'ok' || !analysis.alignment.reliable || analysis.audioQuality.clipped || analysis.audioQuality.hasDropouts) {
    return { ...empty, cards: [{ id: 'audio-quality', kind: 'unclear_audio', variant: analysis.status === 'insufficient_audio' ? 'no_piano' : 'uncertain',
      priority: 1, focus: { startBeat: 0, endBeat: 1 }, expected: { label: 'EXPECTED CLEAR PIANO', notes: [] },
      detected: { label: 'DETECTED AUDIO UNCERTAIN', notes: [] }, metrics: {},
      cue: 'Check the microphone and try again.',
      evidence: { source: 'analysis', measurement: 'audio_quality', findingIds: [], referenceNoteIds: [], detectedNoteIds: [] } }] };
  }
  const cards = analysis.findings.map(finding => cardForFinding(analysis, passage, finding))
    .filter((card): card is VisualCard => card !== null && validateVisualCard(card))
    .sort((a, b) => a.priority - b.priority || a.focus.startBeat - b.focus.startBeat || a.id.localeCompare(b.id));
  return { ...empty, cards: cards.slice(0, 3) };
}
