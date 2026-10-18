import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AnalysisResult, CoachingResult, Finding, Passage } from '../../shared/contracts.ts';
import { analysisSegmentsValid, calculateDisplaySegments, enrichAnalysisSegments, validBarMap } from '../../shared/segments.ts';
import { feedbackEntries } from '../../shared/feedback.ts';
import { PASSAGES } from '../../shared/passages.ts';
import { fallback, coach } from './coaching.ts';
import { parseCoachRequest, parsePassages, InputError } from './validation.ts';

const passage: Passage = {
  id: 'pickup', version: '1', title: 'Pickup and cross bar', tempoBpm: 60, beatsPerBar: 4,
  bars: [{ number: 0, startBeat: 0, endBeat: 1 }, { number: 1, startBeat: 1, endBeat: 5 },
    { number: 2, startBeat: 5, endBeat: 9 }, { number: 3, startBeat: 9, endBeat: 13 }],
  notes: [
    { id: 'n0', midiPitch: 60, onsetBeat: 0, durationBeats: 1, hand: 'right' },
    { id: 'n1', midiPitch: 62, onsetBeat: 4.5, durationBeats: 1, hand: 'right' },
    { id: 'n2', midiPitch: 64, onsetBeat: 6, durationBeats: 1, hand: 'right' },
    { id: 'n3', midiPitch: 65, onsetBeat: 9, durationBeats: 1, hand: 'right' },
  ],
};
const findings: Finding[] = [
  { id: 'cross', kind: 'duration', referenceNoteId: 'n1', detectedNoteId: 'd1', durationDeltaMs: -300 },
  { id: 'extra', kind: 'extra_note', detectedNoteId: 'dx' },
  { id: 'before', kind: 'extra_note', detectedNoteId: 'db' },
  { id: 'after', kind: 'extra_note', detectedNoteId: 'da' },
];
function analysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return { schemaVersion: '1', attemptId: 'a1', passageId: passage.id, passageVersion: passage.version,
    attemptTempoBpm: 60, status: 'ok', detectorVersion: 'fixture', scoringVersion: 'fixture',
    audioQuality: { clipped: false, hasDropouts: false, warnings: [] },
    alignment: { offsetSec: 2, reliable: true }, detectedNotes: [
      { id: 'd1', midiPitch: 62, onsetSec: 6.5, durationSec: 0.7 },
      { id: 'dx', midiPitch: 67, onsetSec: 7.5, durationSec: 0.2 },
      { id: 'db', midiPitch: 67, onsetSec: 1.5, durationSec: 0.2 },
      { id: 'da', midiPitch: 67, onsetSec: 15, durationSec: 0.2 },
    ], findings, metrics: { matchedNotes: 4, expectedNotes: 4, medianAbsTimingErrorMs: 0 }, ...overrides };
}
function enriched(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return enrichAnalysisSegments(analysis(overrides), passage);
}
function coaching(primarySegmentId: string, evidenceFindingIds: string[]): CoachingResult {
  return { schemaVersion: '2', attemptId: 'a1', coachingSource: 'fallback', cue: 'Practice this bar.',
    evidenceFindingIds, primarySegmentId,
    visual: { kind: 'none', referenceNoteIds: [], poseIds: [], mistakes: [] } };
}

test('all six original passages retain identity and notes with authored full two-bar maps', () => {
  assert.equal(PASSAGES.length, 6);
  for (const [index, seed] of PASSAGES.entries()) {
    assert.equal(seed.id, 'P0' + String(index + 1));
    assert.equal(seed.version, '1');
    assert.deepEqual(seed.bars, [{ number: 1, startBeat: 0, endBeat: 4 }, { number: 2, startBeat: 4, endBeat: 8 }]);
    assert.equal(validBarMap(seed), true);
  }
  assert.equal(parsePassages(PASSAGES)[0].bars?.length, 2);
  assert.throws(() => parsePassages([{ ...passage, bars: [{ number: 1, startBeat: 1, endBeat: 13 }] }]), InputError);
});

test('pickup numbering, cross-bar sustain, aligned extras and out-of-bounds extras use authored bars', () => {
  const before = JSON.stringify(findings);
  const result = enriched();
  assert.equal(JSON.stringify(findings), before);
  assert.deepEqual(result.findings[0].location, { barNumber: 1, beatInBar: 4.5, passageBeat: 4.5 });
  assert.deepEqual(result.findings[0].segmentIds, ['segment-1', 'segment-2']);
  assert.deepEqual(result.findings[1].location, { barNumber: 2, beatInBar: 1.5, passageBeat: 5.5 });
  assert.deepEqual(result.findings.slice(2).map(finding => [finding.location, finding.segmentIds]),
    [[null, []], [null, []]]);
  assert.deepEqual(result.displaySegments?.map(segment => [segment.startBar, segment.startBeat, segment.endBeat]),
    [[1, 1, 5], [2, 5, 9]]);
  assert.deepEqual(result.displaySegments?.[1].referenceNoteIds, ['n1', 'n2']);
  assert.equal(analysisSegmentsValid(result, passage), true);
  const pickup = enriched({ findings: [{ id: 'pickup-f', kind: 'missing_note', referenceNoteId: 'n0' }] });
  assert.deepEqual(pickup.findings[0].location, { barNumber: 0, beatInBar: 1, passageBeat: 0 });
});

test('unreliable alignment never supplies a fake location and invalid maps fail', () => {
  const result = enriched({ alignment: { offsetSec: null, reliable: false } });
  assert.deepEqual(result.displaySegments, []);
  assert.equal(result.findings.every(finding => finding.location === null && finding.segmentIds?.length === 0), true);
  assert.equal(analysisSegmentsValid(result, passage), true);
  assert.throws(() => calculateDisplaySegments({ ...passage, bars: undefined }, findings, [], 60, { reliable: true, offsetSec: 0 }));
  assert.throws(() => calculateDisplaySegments(passage, [{ id: 'bad', kind: 'missing_note', referenceNoteId: 'unknown' }],
    [], 60, { reliable: true, offsetSec: 0 }));
});

test('v2 rejects missing fields, wrong bounds, nonreciprocal links and fabricated locations', () => {
  const good = enriched();
  const mutations: ((value: AnalysisResult) => void)[] = [
    value => { delete value.displaySegments; },
    value => { delete value.findings[0].location; },
    value => { delete value.findings[0].segmentIds; },
    value => { value.displaySegments![0].endBeat = 6; },
    value => { value.displaySegments![0].findingIds = []; },
    value => { value.findings[0].segmentIds = ['segment-2']; },
    value => { value.findings[0].location!.beatInBar = 1; },
    value => { value.displaySegments![0].referenceNoteIds = []; },
    value => { value.displaySegments!.reverse(); },
  ];
  for (const mutate of mutations) {
    const forged = structuredClone(good); mutate(forged);
    assert.equal(analysisSegmentsValid(forged, passage), false);
    assert.deepEqual(feedbackEntries(forged, passage), []);
    assert.throws(() => parseCoachRequest({ artifactId: 'artifact', passageId: passage.id,
      passageVersion: passage.version, analysis: forged }, [passage]), InputError);
  }
  const parsed = parseCoachRequest({ artifactId: 'artifact', passageId: passage.id,
    passageVersion: passage.version, analysis: good }, [passage]);
  assert.deepEqual(parsed.request.analysis, good);
  assert.equal(analysisSegmentsValid({ ...analysis(), displaySegments: [] }, passage), false);
});

test('feedback keeps every finding/bar pair beyond the three-card cap and unlocated findings last', () => {
  const value = enriched({ findings: [...findings,
    { id: 'pickup-f', kind: 'missing_note', referenceNoteId: 'n0' },
    { id: 'last', kind: 'wrong_note', referenceNoteId: 'n3', detectedNoteId: 'd1' },
  ] });
  const entries = feedbackEntries(value, passage);
  assert.equal(entries.filter(entry => entry.finding.id === 'cross').length, 2);
  assert.equal(entries.some(entry => entry.finding.id === 'last'), true);
  assert.equal(entries.some(entry => entry.finding.id === 'pickup-f'), true);
  assert.deepEqual(entries.slice(-2).map(entry => [entry.finding.id, entry.segment]), [['before', null], ['after', null]]);
  assert.equal(entries.length, value.findings.length + 1);
  const legacy = analysis();
  assert.equal(feedbackEntries(legacy, passage).length, findings.length);
  assert.equal(feedbackEntries(legacy, passage).every(entry => entry.segment === null), true);
  assert.equal(legacy.schemaVersion, '1');
});

test('validated coaching segment and selected evidence outrank earlier lower-priority issues in the same bar', () => {
  const value = enriched({ findings: [
    { id: 'early-timing', kind: 'timing', referenceNoteId: 'n1', detectedNoteId: 'd1', timingDeltaMs: 200 },
    { id: 'later-wrong', kind: 'wrong_note', referenceNoteId: 'n2', detectedNoteId: 'dx' },
    { id: 'first-bar', kind: 'missing_note', referenceNoteId: 'n0' },
  ] });
  const segment = value.displaySegments!.find(item => item.findingIds.includes('later-wrong'))!;
  const selected = feedbackEntries(value, passage, coaching(segment.id, ['later-wrong']));
  assert.equal(selected[0].segment?.id, segment.id);
  assert.equal(selected[0].finding.id, 'later-wrong');
  const forged = feedbackEntries(value, passage, coaching(segment.id, ['first-bar']));
  assert.equal(forged[0].finding.id, 'first-bar');
  const sameBarPriority = feedbackEntries(value, passage).filter(entry => entry.segment?.id === segment.id);
  assert.equal(sameBarPriority[0].finding.id, 'later-wrong');
  const legacy = analysis({ findings: value.findings.map(({ location: _location, segmentIds: _segmentIds, ...finding }) => finding) });
  assert.deepEqual(feedbackEntries(legacy, passage).map(entry => entry.finding.id),
    ['first-bar', 'later-wrong', 'early-timing']);
  assert.equal(feedbackEntries(legacy, passage).every(entry => entry.segment === null), true);
});

test('v2 coaching keeps schema and derives primary segment from evidence; uncertain and clean remain null', async () => {
  const value = enriched({ findings: [{ id: 'wrong', kind: 'wrong_note', referenceNoteId: 'n2', detectedNoteId: 'dx' }] });
  const request = { artifactId: 'artifact', passageId: passage.id, passageVersion: passage.version, analysis: value };
  const result = await coach(request, passage, new Uint8Array([1]), async () =>
    ({ findingId: 'wrong', actionId: 'slow_key', componentKind: 'wrong_note' }));
  assert.equal(result.schemaVersion, '2');
  assert.equal(result.primarySegmentId, value.displaySegments![0].id);
  assert.equal(result.coachingSource, 'gemini');
  const fallbackResult = fallback(value, passage);
  assert.equal(fallbackResult.primarySegmentId, value.displaySegments![0].id);
  const uncertain = enriched({ status: 'uncertain', findings: [] });
  assert.equal(fallback(uncertain, passage).primarySegmentId, null);
  const clean = enriched({ findings: [] });
  assert.equal(fallback(clean, passage).primarySegmentId, null);
  assert.equal(analysisSegmentsValid({ ...clean, status: 'uncertain', findings: [value.findings[0]] }, passage), false);
  assert.throws(() => enriched({ status: 'uncertain' }));
});
