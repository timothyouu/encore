import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionStore, fixtureAnalysis, fixtureCoaching } from '../../mobile/src/session.ts'
import examples from '../../shared/visual-examples.json' with { type: 'json' }
import { reviewData } from '../src/feedback.ts'
import { PASSAGES } from '../src/passages.ts'

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

test('missing coach for otherwise clear analysis has no invented correction or replay art', () => {
  const record = attempt()
  record.coaching = null
  const data = reviewData(record, PASSAGES[0])
  assert.equal(data.views[0].card, null)
  assert.equal(data.views[0].header, 'Feedback unavailable')
})
