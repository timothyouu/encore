import type { AnalysisResult, Passage, DetectedNote, DisplaySegment, Finding, FindingLocation } from './contracts.ts';

export type SegmentCalculation = {
  findings: (Finding & { location: FindingLocation | null; segmentIds: string[] })[];
  displaySegments: DisplaySegment[];
};

const EPSILON = 1e-7;

function close(left: number, right: number): boolean {
  return Math.abs(left - right) <= EPSILON;
}

export function validBarMap(passage: Passage): boolean {
  if (!Array.isArray(passage.bars) || passage.bars.length === 0 ||
      !Number.isFinite(passage.beatsPerBar) || passage.beatsPerBar <= 0) return false;
  const numbers = new Set<number>();
  for (const [index, bar] of passage.bars.entries()) {
    if (!Number.isInteger(bar.number) || numbers.has(bar.number) ||
        (index > 0 && bar.number <= passage.bars[index - 1].number) ||
        !Number.isFinite(bar.startBeat) || !Number.isFinite(bar.endBeat) ||
        bar.startBeat < 0 || bar.endBeat <= bar.startBeat ||
        (index === 0 ? bar.startBeat !== 0 : !close(passage.bars[index - 1].endBeat, bar.startBeat))) return false;
    numbers.add(bar.number);
  }
  const end = passage.bars[passage.bars.length - 1].endBeat;
  return passage.notes.every((note) => Number.isFinite(note.onsetBeat) &&
    Number.isFinite(note.durationBeats) && note.onsetBeat >= 0 && note.durationBeats > 0 &&
    note.onsetBeat < end && note.onsetBeat + note.durationBeats <= end + EPSILON);
}

/** Pure service-side calculation after alignment; does not modify input findings. */
export function calculateDisplaySegments(
  passage: Passage,
  findings: Finding[],
  detectedNotes: DetectedNote[],
  attemptTempoBpm: number,
  alignment: { offsetSec: number | null; reliable: boolean },
): SegmentCalculation {
  if (!validBarMap(passage) || !Number.isFinite(attemptTempoBpm) || attemptTempoBpm <= 0 ||
      (alignment.offsetSec !== null && !Number.isFinite(alignment.offsetSec))) {
    throw new Error('Invalid passage bars, attempt tempo, or alignment offset');
  }
  const bars = passage.bars!;
  const reference = new Map(passage.notes.map((note) => [note.id, note]));
  const detected = new Map(detectedNotes.map((note) => [note.id, note]));
  const affected = new Map<number, Set<string>>();
  const located = findings.map((finding) => {
    const note = finding.referenceNoteId ? reference.get(finding.referenceNoteId) : undefined;
    const event = finding.detectedNoteId ? detected.get(finding.detectedNoteId) : undefined;
    if ((finding.kind === 'extra_note' && !event) || (finding.kind !== 'extra_note' && !note)) {
      throw new Error(`Unresolvable finding ${finding.id}`);
    }
    const passageBeat = finding.kind === 'extra_note'
      ? (event!.onsetSec - (alignment.offsetSec ?? 0)) * attemptTempoBpm / 60
      : note!.onsetBeat;
    const barIndex = alignment.reliable && alignment.offsetSec !== null
      ? bars.findIndex((bar) => passageBeat >= bar.startBeat && passageBeat < bar.endBeat)
      : -1;
    const location: FindingLocation | null = barIndex < 0 ? null : {
      barNumber: bars[barIndex].number,
      beatInBar: passageBeat - bars[barIndex].startBeat + 1,
      passageBeat,
    };
    const barIndexes = location === null ? [] : finding.kind !== 'extra_note' && note
      ? bars.flatMap((bar, index) => note.onsetBeat < bar.endBeat &&
          note.onsetBeat + note.durationBeats > bar.startBeat ? [index] : [])
      : [barIndex];
    for (const index of barIndexes) {
      if (!affected.has(index)) affected.set(index, new Set());
      affected.get(index)!.add(finding.id);
    }
    return { ...finding, location, barIndexes };
  });
  const segmentIndex = new Map<number, string>();
  const displaySegments: DisplaySegment[] = [...affected].sort(([a], [b]) => a - b).map(([index, findingIds], order) => {
    const bar = bars[index];
    const id = `segment-${order + 1}`;
    segmentIndex.set(index, id);
    return {
      id, startBar: bar.number, endBar: bar.number,
      startBeat: bar.startBeat, endBeat: bar.endBeat,
      referenceNoteIds: passage.notes.filter((note) => note.onsetBeat < bar.endBeat &&
        note.onsetBeat + note.durationBeats > bar.startBeat).map((note) => note.id),
      findingIds: [...findingIds],
    };
  });
  return {
    findings: located.map(({ barIndexes, ...finding }) => ({
      ...finding, segmentIds: barIndexes.map((index) => segmentIndex.get(index)!),
    })),
    displaySegments,
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function sameIds(value: unknown, expected: string[]): boolean {
  return Array.isArray(value) && value.length === expected.length &&
    new Set(value).size === value.length && value.every((id, index) => id === expected[index]);
}

/** Validate authored geometry and every reciprocal link, rather than trusting saved locations. */
export function analysisSegmentsValid(analysis: AnalysisResult, passage: Passage): boolean {
  if (analysis.schemaVersion === '1') return analysis.displaySegments === undefined &&
    analysis.findings.every(finding => finding.location === undefined && finding.segmentIds === undefined);
  if (analysis.schemaVersion !== '2' || !validBarMap(passage) ||
      !Array.isArray(analysis.displaySegments) || !Array.isArray(analysis.findings) ||
      analysis.passageId !== passage.id || analysis.passageVersion !== passage.version) return false;
  const segments = analysis.displaySegments;
  if (analysis.status !== 'ok') return segments.length === 0 && analysis.findings.length === 0;
  let expected: SegmentCalculation;
  try {
    expected = calculateDisplaySegments(passage, analysis.findings, analysis.detectedNotes,
      analysis.attemptTempoBpm, analysis.alignment);
  } catch { return false; }
  if (segments.length !== expected.displaySegments.length) return false;
  const ids = new Set<string>();
  const byBar = new Map<number, DisplaySegment>();
  for (const [index, segment] of segments.entries()) {
    const calculated = expected.displaySegments[index];
    if (!object(segment) || typeof segment.id !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(segment.id) || ids.has(segment.id) ||
        segment.startBar !== calculated.startBar || segment.endBar !== calculated.endBar ||
        segment.startBeat !== calculated.startBeat || segment.endBeat !== calculated.endBeat ||
        !sameIds(segment.referenceNoteIds, calculated.referenceNoteIds) ||
        !sameIds(segment.findingIds, calculated.findingIds)) return false;
    ids.add(segment.id);
    byBar.set(segment.startBar, segment as DisplaySegment);
  }
  return analysis.findings.every((finding, index) => {
    const calculated = expected.findings[index];
    if (calculated.location === null) return finding.location === null && sameIds(finding.segmentIds, []);
    const location = finding.location;
    if (!object(location) || location.barNumber !== calculated.location.barNumber ||
        typeof location.beatInBar !== 'number' || !Number.isFinite(location.beatInBar) ||
        typeof location.passageBeat !== 'number' || !Number.isFinite(location.passageBeat) ||
        !close(location.beatInBar, calculated.location.beatInBar) ||
        !close(location.passageBeat, calculated.location.passageBeat)) return false;
    const linked = expected.displaySegments.filter(segment => segment.findingIds.includes(finding.id))
      .map(segment => byBar.get(segment.startBar)!.id);
    return sameIds(finding.segmentIds, linked);
  });
}

/** Only the trusted server enriches legacy inference results; clients retain genuine v1 history. */
export function enrichAnalysisSegments(analysis: AnalysisResult, passage: Passage): AnalysisResult {
  if (analysis.schemaVersion === '2') {
    if (!analysisSegmentsValid(analysis, passage)) throw new Error('Invalid analysis segments');
    return analysis;
  }
  const mapped = analysis.status === 'ok'
    ? calculateDisplaySegments(passage, analysis.findings, analysis.detectedNotes,
      analysis.attemptTempoBpm, analysis.alignment)
    : { findings: analysis.findings.map(finding => ({ ...finding, location: null, segmentIds: [] })),
      displaySegments: [] };
  const enriched: AnalysisResult = { ...analysis, schemaVersion: '2', ...mapped };
  if (!analysisSegmentsValid(enriched, passage)) throw new Error('Invalid enriched analysis segments');
  return enriched;
}
