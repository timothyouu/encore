import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderPaperSvg } from '../src/paper-renderer.ts'
import { VISUAL_KINDS } from '../../shared/visual-plan.ts'

const names = Object.keys(VISUAL_KINDS)
function note(id, midiPitch, onsetBeat, durationBeats = 1) {
  return { id, midiPitch, onsetBeat, durationBeats }
}
function card(kind, variant = VISUAL_KINDS[kind].variants[0]) {
  const expected = [note('e1', 65, 4), note('e2', 67, 5), note('e3', 69, 6), note('e4', 71, 7)]
  const detected = [note('d1', 65, 4), note('d2', kind === 'wrong_note' ? 66 : 67, 5.25), note('d3', 69, 6.1), note('d4', 71, 7)]
  const value = {
    id: 'fixture-1', kind, variant, priority: VISUAL_KINDS[kind].priority,
    focus: { startBeat: 5, endBeat: 6 },
    expected: { label: 'F4 G4 A4 B4', notes: expected },
    detected: { label: 'F4 G♭4 A4 B4', notes: detected },
    metrics: { timingDeltaBeats: variant === 'late' ? 0.25 : -0.25,
      expectedDurationBeats: 2, detectedDurationBeats: variant === 'long' ? 3 : 1,
      gapBeats: 1.5, recurrenceCount: 3, recurrenceWindow: 3 },
    cue: 'Play G4 on beat 5',
    evidence: { source: 'fixture', measurement: kind === 'unclear_audio' ? 'audio_quality' : kind === 'recurring_trouble' ? 'history' : 'note_alignment',
      findingIds: kind === 'unclear_audio' ? [] : ['f1'], referenceNoteIds: ['e2'], detectedNoteIds: ['d2'] },
  }
  if (kind === 'unclear_audio') { value.expected.notes = []; value.detected.notes = [] }
  if (kind === 'section_repeat_skip') {
    value.segments = [
      { id: 's1', label: 'E E', startBeat: 1, endBeat: 2 },
      { id: 's2', label: 'G G', startBeat: 2, endBeat: 3 },
      { id: 's3', label: 'F F', startBeat: 3, endBeat: 4 },
      { id: 's4', label: 'D', startBeat: 4, endBeat: 5 },
    ]
    value.expected.segmentIds = ['s1', 's2', 's3', 's4']
    value.detected.segmentIds = variant === 'skipped' ? ['s1', 's2', 's4'] : ['s1', 's2', 's1', 's3', 's4']
  }
  if (kind === 'recurring_trouble') value.historyRows = [
    { attemptId: 'a3', label: 'TAKE 3', flaggedBeats: [6] },
    { attemptId: 'a4', label: 'TAKE 4', flaggedBeats: [5, 6] },
    { attemptId: 'a5', label: 'TAKE 5', flaggedBeats: [6] },
  ]
  return value
}

test('all twelve Paper kinds render bounded, labelled, distinct replay frames', () => {
  assert.equal(names.length, 12)
  for (const kind of names) {
    const value = card(kind)
    const frames = ['static', 'detected', 'correction', 'resolved'].map(phase => renderPaperSvg(value, phase))
    for (const svg of frames) {
      assert.match(svg, /viewBox="0 0 576 288"/, kind)
      assert.match(svg, /EXPECTED|Expected/, kind)
      assert.match(svg, /DETECTED|Detected/, kind)
      assert.doesNotMatch(svg, /(?:NaN|Infinity|undefined|null)/, kind)
      assert.doesNotMatch(svg, /<script|onload=/i, kind)
    }
    assert.equal(new Set(frames).size, 4, kind)
  }
})

test('timing, duration, section, and keyboard variants express their direction', () => {
  assert.match(renderPaperSvg(card('timing', 'early')), /early/)
  assert.match(renderPaperSvg(card('timing', 'late')), /late/)
  assert.match(renderPaperSvg(card('duration', 'short')), /short/)
  assert.match(renderPaperSvg(card('duration', 'long')), /long/)
  assert.match(renderPaperSvg(card('section_repeat_skip', 'skipped')), /skipped/)
  assert.match(renderPaperSvg(card('section_repeat_skip', 'repeated')), /restarted|×2/)
  assert.match(renderPaperSvg(card('wrong_note', 'octave')), /G/)
  assert.match(renderPaperSvg(card('wrong_note', 'accidental')), /♯|♭/)
})

test('untrusted text is escaped, bounded, and invalid data rejected', () => {
  const value = card('wrong_note')
  value.cue = 'Play & "listen" carefully'
  let svg = renderPaperSvg(value)
  assert.match(svg, /&amp;/)
  assert.match(svg, /&quot;/)
  value.cue = 'Continue to count steadily and keep listening for the expected key until you can play it naturally across many repeated takes'
  svg = renderPaperSvg(value)
  assert.match(svg, /…/)
  assert.match(svg, /● Expected:/)
  assert.match(svg, /○ Detected:/)
  value.cue = '<script>alert(1)</script>'
  assert.throws(() => renderPaperSvg(value), /Invalid Paper visual card/)
  value.cue = 'Try again'
  value.metrics.timingDeltaBeats = Number.POSITIVE_INFINITY
  assert.throws(() => renderPaperSvg(value), /Invalid Paper visual card/)
})

test('beat labels are one-based and timing preserves measured offset', () => {
  for (const [delta, shown] of [[-0.1, '0.1 beats early'], [0.75, '¾ beats late'], [2, '2 beats late']]) {
    const value = card('timing', delta < 0 ? 'early' : 'late')
    value.metrics.timingDeltaBeats = delta
    const svg = renderPaperSvg(value)
    assert.match(svg, /Beat 6/)
    assert.ok(svg.includes(shown), shown)
  }
})

test('single-note boundaries do not draw invented neighbors', () => {
  const missing = card('missing_note')
  missing.expected.notes = [note('e2', 67, 5)]
  missing.detected.notes = []
  const missingSvg = renderPaperSvg(missing)
  assert.equal((missingSvg.match(/<ellipse /g) ?? []).length, 1)
  const extra = card('extra_note')
  extra.expected.notes = []
  extra.detected.notes = [note('d2', 67, 5.5)]
  const extraSvg = renderPaperSvg(extra)
  assert.equal((extraSvg.match(/<ellipse /g) ?? []).length, 1)
})

test('keyboard overlays black keys and accidental keeps diatonic staff position', () => {
  const value = card('wrong_note', 'accidental')
  value.expected.notes = [note('e2', 61, 5)]
  value.detected.notes = [note('d2', 60, 5)]
  const svg = renderPaperSvg(value)
  assert.equal((svg.match(/ y="78" /g) ?? []).length, 12)
  assert.match(renderPaperSvg(value, 'correction'), /♯/)
})


