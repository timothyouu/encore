import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { mountPaperVisualization, renderPaperSvg } from '../src/paper-renderer.ts'
import { VISUAL_KINDS, validateVisualPlan } from '../../shared/visual-plan.ts'

const names = Object.keys(VISUAL_KINDS)
function note(id, midiPitch, onsetBeat, durationBeats = 1) {
  return { id, midiPitch, onsetBeat, durationBeats }
}
function card(kind, variant = VISUAL_KINDS[kind].variants[0]) {
  const expected = [note('e1', 65, 4), note('e2', 67, 5), note('e3', 69, 6), note('e4', 71, 7)]
  const detected = [note('d1', 65, 4), note('d2', kind === 'wrong_note' ? 66 : 67, 5.25), note('d3', 69, 6.1), note('d4', 71, 7)]
  const metricsByKind = {
    wrong_note: {}, missing_note: {}, extra_note: {}, timing: { timingDeltaBeats: variant === 'late' ? 0.25 : -0.25 },
    duration: { expectedDurationBeats: 2, detectedDurationBeats: variant === 'long' ? 3 : 1 },
    unclear_audio: {}, tempo_drift: { driftPercent: 12 }, uneven_rhythm: {},
    unexpected_pause: { gapBeats: 1.5 }, rest_violation: {}, section_repeat_skip: {},
    recurring_trouble: { recurrenceCount: 3, recurrenceWindow: 3 },
  }
  const value = {
    id: 'fixture-1', kind, variant, priority: VISUAL_KINDS[kind].priority,
    focus: { startBeat: 5, endBeat: 6 },
    expected: { label: 'F4 G4 A4 B4', notes: expected },
    detected: { label: 'F4 G♭4 A4 B4', notes: detected },
    metrics: metricsByKind[kind],
    cue: 'Play G4 on beat 6',
    evidence: { source: 'fixture', measurement: kind === 'unclear_audio' ? 'audio_quality' :
      kind === 'recurring_trouble' ? 'history' :
      ['tempo_drift', 'uneven_rhythm', 'unexpected_pause', 'rest_violation', 'section_repeat_skip'].includes(kind) ? 'phrase_pattern' : 'note_alignment',
      findingIds: kind === 'unclear_audio' ? [] : ['f1'],
      referenceNoteIds: ['missing_note', 'extra_note', 'unclear_audio'].includes(kind) ? (kind === 'missing_note' ? ['e2'] : []) : ['e2'],
      detectedNoteIds: ['missing_note', 'unclear_audio'].includes(kind) ? [] : ['d2'] },
  }
  if (kind === 'unclear_audio') { value.expected.notes = []; value.detected.notes = [] }
  if (kind === 'rest_violation') { value.expected.notes = [note('e1', 65, 4, 1)]; value.detected.notes = [note('d2', 67, 5.2)]; value.evidence.referenceNoteIds = [] }
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
    { attemptId: 'a3', label: 'TAKE 3', flaggedBeats: [5] },
    { attemptId: 'a4', label: 'TAKE 4', flaggedBeats: [5] },
    { attemptId: 'a5', label: 'TAKE 5', flaggedBeats: [5] },
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

test('early measured onset does not shift the score beat label or timing target', () => {
  for (const kind of ['wrong_note', 'duration', 'timing']) {
    const value = card(kind)
    value.focus.startBeat = 4.9934
    value.detected.notes.find(note => note.id === 'd2').onsetBeat = 4.9934
    const svg = renderPaperSvg(value)
    assert.match(svg, /Beat 6 ·/)
    assert.doesNotMatch(svg, /Beat 5 ·/)
    if (kind === 'timing') assert.match(svg, /on 6/)
  }
})

test('keyboard overlays black keys and accidental keeps diatonic staff position', () => {
  const value = card('wrong_note', 'accidental')
  value.expected.notes = [note('e2', 61, 5)]
  value.detected.notes = [note('d2', 60, 5)]
  const svg = renderPaperSvg(value)
  assert.equal((svg.match(/ y="78" /g) ?? []).length, 12)
  assert.match(renderPaperSvg(value, 'correction'), /♯/)
})





test('every saved gallery example validates and renders', () => {
  const path = new URL('../../shared/visual-examples.json', import.meta.url)
  const examples = JSON.parse(readFileSync(path, 'utf8')).examples
  assert.ok(examples.length >= 12)
  for (const example of examples) {
    assert.ok(validateVisualPlan(example.plan), example.name)
    for (const item of example.plan.cards) {
      const svg = renderPaperSvg(item)
      assert.match(svg, /viewBox="0 0 576 288"/, example.name)
    }
  }
})



test('replay settles, restart cancels old timers, and destroy clears the screen', () => {
  const prior = { document: globalThis.document, window: globalThis.window,
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout }
  const scheduled = new Map()
  let nextId = 1
  try {
    globalThis.document = { createElement: () => ({
      className: '', innerHTML: '', attributes: {},
      setAttribute(name, value) { this.attributes[name] = value },
      replaceChildren() { this.innerHTML = '' },
    }) }
    globalThis.window = { matchMedia: () => ({ matches: false }) }
    globalThis.setTimeout = (callback, delay) => {
      const id = nextId++
      scheduled.set(id, { callback, delay, active: true })
      return id
    }
    globalThis.clearTimeout = id => { const timer = scheduled.get(id); if (timer) timer.active = false }
    const view = mountPaperVisualization(card('timing', 'early'))
    assert.match(view.element.innerHTML, /tap  ↻ replay/)
    view.replay()
    assert.match(view.element.innerHTML, /●○○/)
    const stale = [...scheduled.values()]
    view.replay()
    stale.forEach(timer => timer.callback())
    assert.match(view.element.innerHTML, /●○○/)
    const current = [...scheduled.values()].filter(timer => timer.active).sort((a, b) => a.delay - b.delay)
    assert.equal(current.length, 4)
    current[0].callback()
    assert.match(view.element.innerHTML, /●●○/)
    current[1].callback()
    assert.match(view.element.innerHTML, /●●●/)
    current[2].callback()
    assert.match(view.element.innerHTML, /Play G4 on beat 6/)
    current[3].callback()
    assert.match(view.element.innerHTML, /tap  ↻ replay/)
    view.replay()
    const pending = [...scheduled.values()].filter(timer => timer.active)
    view.destroy()
    pending.forEach(timer => timer.callback())
    assert.equal(view.element.innerHTML, '')
  } finally {
    Object.assign(globalThis, prior)
  }
})

test('reduced motion replay remains static without timers', () => {
  const prior = { document: globalThis.document, window: globalThis.window, setTimeout: globalThis.setTimeout }
  let scheduled = 0
  try {
    globalThis.document = { createElement: () => ({
      className: '', innerHTML: '', setAttribute() {}, replaceChildren() { this.innerHTML = '' },
    }) }
    globalThis.window = { matchMedia: () => ({ matches: true }) }
    globalThis.setTimeout = () => { scheduled++; return 1 }
    const view = mountPaperVisualization(card('missing_note'))
    const staticSvg = view.element.innerHTML
    view.replay()
    assert.equal(view.element.innerHTML, staticSvg)
    assert.equal(scheduled, 0)
    view.destroy()
  } finally {
    Object.assign(globalThis, prior)
  }
})
