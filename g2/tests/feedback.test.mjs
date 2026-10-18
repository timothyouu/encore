import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionStore, fixtureAnalysis, fixtureCoaching } from '../../mobile/src/session.ts'
import examples from '../../shared/visual-examples.json' with { type: 'json' }
import { reviewData } from '../src/feedback.ts'
import { PASSAGES } from '../src/passages.ts'
import { calculateDisplaySegments } from '../../shared/segments.ts'
import { replaySteps, rulerNotes } from '../src/review/art.ts'

function attempt(scenario = 'mistakes') {
  const store = new SessionStore({ getItem: () => null, setItem() {} })
  store.selectPassage('P01')
  const started = store.start('demo')
  store.stop()
  const analysis = fixtureAnalysis(started, scenario)
  return { ...started, analysis, coaching: scenario === 'mistakes' ? fixtureCoaching({ ...started, analysis }) : null }
}

test('saved analysis cards use exact finding IDs for beats, keys, and authored fingers', () => {
  const data = reviewData(attempt(), PASSAGES[0])
  assert.equal(data.tag, 'Demo · local cue')
  assert.deepEqual(data.views.map(view => view.header), ['Beat 6 · missed note', 'Beat 3 · wrong note', 'Beat 5 · late'])
  assert.match(data.views[0].cue, /Finger 4 \(score\)/)
  assert.match(data.views[1].cue, /Finger 3 \(score\)/)
  assert.equal(data.views[0].legend[0], '● Expected  F4')
  assert.equal(data.views[0].legend[1], '× Detected  —')
  assert.ok(data.views.every(view => !view.segment && !view.position))
})

test('an attached fixture plan cannot replace the deterministic saved-attempt evidence', () => {
  const record = attempt()
  record.coaching.visualPlan = examples.examples[0].plan
  assert.equal(reviewData(record, PASSAGES[0]).views[0].card.id, 'finding-3')
})

test('uncertain and insufficient audio without coaching remain neutral microphone cards', () => {
  for (const status of ['uncertain', 'insufficient_audio']) {
    const record = attempt('uncertain')
    record.analysis.status = status
    const data = reviewData(record, PASSAGES[0])
    assert.equal(data.views[0].card.kind, 'unclear_audio')
    assert.match(data.views[0].header, /hear clearly/)
    assert.doesNotMatch(data.views[0].cue, /play [A-G][#]?\d/i)
  }
})

test('missing coach for otherwise clear analysis preserves deterministic findings and local cues', () => {
  const record = attempt()
  record.coaching = null
  const data = reviewData(record, PASSAGES[0])
  assert.equal(data.views.length, 3)
  assert.equal(data.views[0].card.evidence.source, 'analysis')
  assert.match(data.views[0].cue, /^Play F4/)
  assert.match(data.tag, /local cue/)
})

test('all v2 finding/bar pairs remain available beyond the top-three overview, with exact bar windows', () => {
  const record = attempt()
  const passage = PASSAGES[0]
  const analysis = record.analysis
  analysis.findings.push(
    { id: 'finding-4', kind: 'missing_note', referenceNoteId: passage.notes[0].id },
    { id: 'finding-5', kind: 'duration', referenceNoteId: passage.notes[7].id, detectedNoteId: 'detected-8', durationDeltaMs: -500 },
  )
  Object.assign(analysis, { schemaVersion: '2', ...calculateDisplaySegments(passage, analysis.findings,
    analysis.detectedNotes, analysis.attemptTempoBpm, analysis.alignment) })
  record.coaching = null
  const { views } = reviewData(record, passage)
  assert.equal(views.length, 5)
  assert.deepEqual(new Set(views.map(view => view.findingId)), new Set(analysis.findings.map(finding => finding.id)))
  assert.ok(views.every(view => view.position.match(/^Bar \d · beat /)))
  for (const view of views) {
    assert.equal(view.segment.startBar, view.segment.endBar)
    assert.deepEqual(view.card.focus, { startBeat: view.segment.startBeat, endBeat: view.segment.endBeat })
    assert.ok([...view.card.expected.notes, ...view.card.detected.notes].every(note =>
      note.onsetBeat >= view.segment.startBeat && note.onsetBeat + note.durationBeats <= view.segment.endBeat))
    assert.equal(view.card.evidence.findingIds[0], view.findingId)
  }
})

test('a sustained finding in two bars clips each notation interval without changing saved evidence', () => {
  const passage = structuredClone(PASSAGES[0])
  passage.notes[3].durationBeats = 2
  const record = attempt()
  record.analysis.findings = [{ id: 'sustain', kind: 'duration', referenceNoteId: passage.notes[3].id,
    detectedNoteId: 'detected-4', durationDeltaMs: -1000 }]
  Object.assign(record.analysis, { schemaVersion: '2', ...calculateDisplaySegments(passage, record.analysis.findings,
    record.analysis.detectedNotes, record.analysis.attemptTempoBpm, record.analysis.alignment) })
  record.coaching = null
  const snapshot = JSON.stringify(record)
  const { views } = reviewData(record, passage)
  assert.equal(views.length, 2)
  const notes = views.map(view => view.card.expected.notes.find(note => note.id === passage.notes[3].id))
  assert.deepEqual(notes.map(note => [note.onsetBeat, note.durationBeats]), [[3, 1], [4, 1]])
  assert.equal(views[1].position, 'Bar 2 · continued')
  assert.equal(JSON.stringify(record), snapshot)
})

test('v2 unlocated events never invent a bar, beat highlight, or correction picture', () => {
  const record = attempt()
  record.analysis.detectedNotes.push({ id: 'outside', midiPitch: 64, onsetSec: 20, durationSec: 0.5 })
  record.analysis.findings = [{ id: 'outside-finding', kind: 'extra_note', detectedNoteId: 'outside' }]
  Object.assign(record.analysis, { schemaVersion: '2', ...calculateDisplaySegments(PASSAGES[0], record.analysis.findings,
    record.analysis.detectedNotes, record.analysis.attemptTempoBpm, record.analysis.alignment) })
  record.coaching = null
  const [view] = reviewData(record, PASSAGES[0]).views
  assert.equal(view.findingId, 'outside-finding')
  assert.equal(view.card, null)
  assert.equal(view.segment, undefined)
  assert.equal(view.position, undefined)
  assert.equal(view.header, 'Position unavailable')
})

test('a late onset in the next bar never becomes an unrelated contextual note in timing replay', () => {
  const record = attempt('clean')
  const passage = PASSAGES[0]
  record.analysis.detectedNotes[3].onsetSec = 4.1
  record.analysis.findings = [{ id: 'late-boundary', kind: 'timing', referenceNoteId: passage.notes[3].id,
    detectedNoteId: 'detected-4', timingDeltaMs: 1100 }]
  Object.assign(record.analysis, { schemaVersion: '2', ...calculateDisplaySegments(passage, record.analysis.findings,
    record.analysis.detectedNotes, record.analysis.attemptTempoBpm, record.analysis.alignment) })
  const [view] = reviewData(record, passage).views
  assert.deepEqual(view.card.focus, { startBeat: 0, endBeat: 4 })
  assert.equal(view.card.detected.notes[0].id, 'detected-1') // context exists but is not the measured event
  assert.equal(rulerNotes(view.card).expected.id, passage.notes[3].id)
  assert.equal(rulerNotes(view.card).detected, undefined)
  assert.deepEqual(replaySteps(view.card, true, true), [
    { caption: "this bar's written notes", layer: 'written', art: 'staff', hold: 'end' },
  ])
})
