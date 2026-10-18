import test from 'node:test'
import assert from 'node:assert/strict'
import examples from '../../shared/visual-examples.json' with { type: 'json' }
import { demoReview } from '../src/demo.ts'
import { artKind, keyFor, keyboardKeys, replaySteps, revealCounts } from '../src/review/art.ts'
import { cardViews, noteName, unmatched, viewsForCards } from '../src/review/model.ts'
import { analyzingScreen } from '../src/screens/analyzing.ts'
import { problemScreen } from '../src/screens/problem.ts'
import { reviewScreen } from '../src/screens/review.ts'
import { fakeGlasses, mount, settle, textByName } from './fakes.mjs'

const card = name => structuredClone(examples.examples.find(example => example.name === name).plan.cards[0])
const view = name => viewsForCards([card(name)], { evidenceFindingIds: [] })[0]

function coaching(cards, extra = {}) {
  return {
    schemaVersion: '1',
    attemptId: 'a1',
    coachingSource: 'gemini',
    cue: 'Coach cue.',
    evidenceFindingIds: [],
    visual: { kind: 'none', referenceNoteIds: [], poseIds: [], mistakes: [] },
    visualPlan: { schemaVersion: '1', attemptId: 'a1', passageId: 'P02', passageVersion: '1', source: 'fixture', cards },
    ...extra,
  }
}

// ── Which note is the mistake ─────────────────────────────────────────

test('note names use ASCII sharps', () => {
  assert.equal(noteName(60), 'C4')
  assert.equal(noteName(66), 'F#4')
  assert.equal(noteName(77), 'F5')
})

test('evidence lists every note, so the mistake is whatever stays unpaired', () => {
  const ids = name => {
    const left = unmatched(card(name))
    return { expected: left.expected.map(n => n.id), detected: left.detected.map(n => n.id) }
  }
  assert.deepEqual(ids('missing_note-missing'), { expected: ['r5'], detected: [] })
  assert.deepEqual(ids('extra_note-extra'), { expected: [], detected: ['d4.5'] })
  assert.deepEqual(ids('wrong_note-pitch'), { expected: ['r5'], detected: ['d5'] })
  assert.deepEqual(ids('missing_note-swapped_order'), { expected: ['r5', 'r6'], detected: ['d5.5', 'd6'] })
  assert.deepEqual(ids('recurring_trouble-recurring'), { expected: [], detected: [] })
})

test('pairing is one to one: one detected note cannot satisfy two expected notes', () => {
  const c = card('missing_note-missing')
  c.detected.notes = [{ id: 'd5', midiPitch: 65, onsetBeat: 4.5, durationBeats: 1 }]
  c.expected.notes = c.expected.notes.slice(0, 2).map(n => ({ ...n, onsetBeat: 4.5 }))
  assert.equal(unmatched(c).expected.length, 1)
})

// ── Card text ─────────────────────────────────────────────────────────

test('headers name the beat a player counts and the kind of mistake', () => {
  assert.equal(view('wrong_note-pitch').header, 'Beat 6 · wrong note')
  assert.equal(view('missing_note-missing').header, 'Beat 6 · missed note')
  assert.equal(view('extra_note-extra').header, 'Beat 5 · extra note')
  assert.equal(view('timing-early').header, 'Beat 6 · early')
  assert.equal(view('duration-short').header, 'Beat 6 · too short')
  assert.equal(view('unclear_audio-noisy').header, "Couldn't hear clearly")
  assert.equal(view('section_repeat_skip-repeated').header, 'Beats 5–8 · repeated bar')
})

test('legends: solid note = expected, × = heard, named in words', () => {
  assert.deepEqual(view('wrong_note-pitch').legend, ['● Expected  F4', '× Detected  E4'])
  assert.deepEqual(view('wrong_note-accidental').legend, ['● Expected  F#4', '× Detected  F4'])
  assert.deepEqual(view('missing_note-missing').legend, ['● Expected  F4', '× Detected  —'])
  assert.deepEqual(view('extra_note-extra').legend, ['● Expected  —', '× Detected  G4'])
  assert.deepEqual(view('missing_note-swapped_order').legend, ['● Expected  F4', '× Detected  D4'])
  assert.deepEqual(view('timing-early').legend, ['● Expected  on 6', '× Detected  ¼ early'])
  assert.deepEqual(view('timing-late').legend, ['● Expected  on 6', '× Detected  ¼ late'])
  assert.deepEqual(view('duration-short').legend, ['□ Expected  2 beats', '■ Detected  1 beat'])
  assert.deepEqual(view('duration-long').legend, ['□ Expected  1 beat', '■ Detected  1.5 beats'])
  assert.deepEqual(view('unclear_audio-quiet').legend, ['Expected  clear piano', 'Detected  very quiet'])
  assert.deepEqual(view('section_repeat_skip-repeated').legend, ['● Expected  Bar A, Bar B', '× Detected  Bar A twice'])
  assert.deepEqual(view('recurring_trouble-recurring').legend, ['Flagged  3 of last 3 takes', 'Latest take  beat 6'])
})

test('every example card produces a header, two legend lines and a cue', () => {
  for (const { name } of examples.examples) {
    const v = view(name)
    assert.ok(v.header && v.legend[0] && v.legend[1] && v.cue, name)
    assert.ok(!v.header.includes('undefined') && !v.legend.join().includes('undefined'), name)
  }
})

test("the coached card gets Gemini's next step; other cards keep their own cue", () => {
  const wrong = card('wrong_note-pitch')
  const late = card('timing-late')
  late.id = 'fixture-2'
  late.priority = 4
  const views = cardViews(
    coaching([wrong, late], {
      evidenceFindingIds: [wrong.evidence.findingIds[0]],
      summary: { where: 'Beat 6', what: 'heard E4', next: 'Find F4 and replay the bar.' },
    }),
  )
  assert.deepEqual(views.map(v => v.cue), ['Find F4 and replay the bar.', late.cue])
})

test("a next step too long for three lines falls back to the card's cue", () => {
  const wrong = card('wrong_note-pitch')
  const [v] = cardViews(
    coaching([wrong], {
      evidenceFindingIds: wrong.evidence.findingIds,
      summary: { where: 'x', what: 'y', next: 'word '.repeat(60).trim() },
    }),
  )
  assert.equal(v.cue, wrong.cue)
})

test('no usable visual plan: one text-only card from the coach summary', () => {
  const views = cardViews(
    coaching([{ broken: true }], { summary: { where: 'Beat 3', what: 'Heard D4.', next: 'Play E4.' } }),
  )
  assert.equal(views.length, 1)
  assert.equal(views[0].card, null)
  assert.deepEqual([views[0].header, views[0].legend[0], views[0].cue], ['Beat 3', 'Heard D4.', 'Play E4.'])
})

// ── Art geometry ──────────────────────────────────────────────────────

test('each kind gets its picture: keys, ruler, bars, mic or staff', () => {
  assert.equal(artKind(card('wrong_note-pitch')), 'keyboard')
  assert.equal(artKind(card('wrong_note-self_fix')), 'staff')
  assert.equal(artKind(card('timing-early')), 'ruler')
  assert.equal(artKind(card('duration-long')), 'duration')
  assert.equal(artKind(card('unclear_audio-uncertain')), 'mic')
  assert.equal(artKind(card('missing_note-missing')), 'staff')
  assert.equal(artKind(card('tempo_drift-rushing')), 'staff')
})

test('the keyboard shows at least an octave and both keys, sharps on black keys', () => {
  const keys = keyboardKeys([65, 66])
  assert.ok(keys.filter(k => !k.black).length >= 7)
  assert.equal(keyFor(keys, 65).black, false)
  assert.equal(keyFor(keys, 66).black, true)
  const octave = keyboardKeys([65, 77]) // F4 vs F5
  assert.ok(keyFor(octave, 65) && keyFor(octave, 77))
  for (const key of octave) assert.ok(key.x >= 0 && key.x + key.w <= 288)
})

// ── Review screen ─────────────────────────────────────────────────────

// Stand-in pictures: 'S' = a card's static art, 'P'/'W' = a replay frame's layer.
const pngs = async () => new Uint8Array([83])
const framePngs = async (_card, step) => new Uint8Array([step.layer === 'played' ? 80 : 87])
const sentArt = bridge => bridge.callsTo('updateImageRawData').map(u => String.fromCharCode(u.imageData[0]))

function review(cards, options = {}) {
  const { glasses, bridge } = fakeGlasses()
  let playAgain = 0
  const screen = reviewScreen({
    coaching: coaching(cards),
    onPlayAgain: () => playAgain++,
    renderArt: pngs,
    renderFrame: framePngs,
    frameDwellMs: 0,
    ...options,
  })
  const ctx = mount(screen, glasses)
  return { screen, ctx, bridge, playAgain: () => playAgain }
}

function twoCards() {
  const second = card('timing-late')
  second.id = 'fixture-2'
  second.priority = 4
  return [card('wrong_note-pitch'), second]
}

test('review: first card, counter, next hint and its art; no menu restriction', async () => {
  const { screen, bridge } = review(twoCards())
  await settle()
  const shown = textByName(bridge)
  assert.equal(shown.title, 'Beat 6 · wrong note')
  assert.equal(shown.counter, '1 / 2')
  assert.equal(shown.expected, '● Expected  F4')
  assert.equal(shown.next.trim(), '▼  next')
  assert.equal(bridge.callsTo('updateImageRawData').length, 1)
  assert.notEqual(screen.allowsMenu, false)
})

test('review: swipe down shows the next card in place; swipe up goes back; no rebuild', async () => {
  const { screen, bridge } = review(twoCards())
  await settle()
  screen.onInput({ kind: 'swipeDown' })
  await settle()
  let shown = textByName(bridge)
  assert.equal(shown.title, 'Beat 6 · late')
  assert.equal(shown.counter, '2 / 2')
  assert.equal(shown.next.trim(), '')
  screen.onInput({ kind: 'swipeDown' }) // already last: nothing
  screen.onInput({ kind: 'swipeUp' })
  await settle()
  shown = textByName(bridge)
  assert.equal(shown.title, 'Beat 6 · wrong note')
  assert.equal(bridge.callsTo('rebuildPageContainer').length, 0)
  assert.equal(bridge.callsTo('updateImageRawData').length, 3)
})

test('menu-style redraw keeps the selected card instead of rebuilding card one', async () => {
  const { screen, ctx, bridge } = review(twoCards())
  await settle()
  screen.onInput({ kind: 'swipeDown' })
  await settle()
  ctx.redraw()
  await settle()
  assert.equal(textByName(bridge).title, 'Beat 6 · late')
  assert.equal(textByName(bridge).counter, '2 / 2')
  assert.equal(sentArt(bridge).at(-1), 'S')
})

test('review: fast swipes only send the card that is still on screen', async () => {
  const cards = [card('missing_note-missing'), card('wrong_note-pitch'), card('timing-late')]
  cards.forEach((c, i) => (c.id = `c${i}`))
  const { screen, bridge } = review(cards, { coaching: coaching(cards), views: viewsForCards(cards, { evidenceFindingIds: [] }) })
  screen.onInput({ kind: 'swipeDown' })
  screen.onInput({ kind: 'swipeDown' })
  await settle()
  const titles = bridge.callsTo('textContainerUpgrade').filter(u => u.containerName === 'title').map(u => u.content)
  assert.deepEqual(titles, ['Beat 6 · late'])
})

test('review: double tap is play again', () => {
  const { screen, playAgain } = review(twoCards())
  screen.onInput({ kind: 'doubleTap' })
  assert.equal(playAgain(), 1)
})

// ── Replay ────────────────────────────────────────────────────────────

test('every kind replays what was played, then the fix; unclear audio has nothing to replay', () => {
  const layers = name => replaySteps(card(name)).map(step => `${step.art}:${step.layer}`)
  assert.deepEqual(layers('wrong_note-pitch'), ['staff:played', 'staff:both', 'keys:both'])
  assert.deepEqual(layers('missing_note-missing'), ['staff:played', 'staff:played', 'staff:written', 'staff:written', 'staff:written'])
  assert.deepEqual(layers('timing-early'), ['ruler:played', 'ruler:written'])
  assert.deepEqual(layers('duration-short'), ['duration:played', 'duration:written'])
  assert.deepEqual(layers('unclear_audio-noisy'), [])
  for (const { name } of examples.examples) {
    for (const step of replaySteps(card(name))) assert.ok(step.caption, name)
  }
})

test('staff replays reveal notes one at a time, at most four steps per phase', () => {
  assert.deepEqual(revealCounts(2), [1, 2])
  assert.deepEqual(revealCounts(3), [1, 2, 3])
  assert.deepEqual(revealCounts(5), [2, 3, 4, 5])
  assert.deepEqual(revealCounts(0), [0]) // e.g. a rest: nothing written, shown once
  const reveals = replaySteps(card('missing_note-missing')).map(step => `${step.layer}:${step.reveal}:${step.hold}`)
  assert.deepEqual(reveals, ['played:1:step', 'played:2:end', 'written:1:step', 'written:2:step', 'written:3:end'])
})

test('every staff replay ends on the written notes alone, with no × left over', () => {
  for (const { name } of examples.examples) {
    const steps = replaySteps(card(name))
    if (artKind(card(name)) !== 'staff' || !steps.length) continue
    const last = steps.at(-1)
    assert.equal(last.layer, 'written', name)
    assert.equal(last.reveal, Math.max(card(name).expected.notes.length, 0) || 0, name)
  }
})

test('replay: tap reveals what was played, then what is written, ends on the fix and restores the hints', async () => {
  const { screen, bridge } = review([card('missing_note-missing')])
  await settle()
  assert.equal(textByName(bridge).replay, 'tap  replay')
  screen.onInput({ kind: 'tap' })
  await settle(120)

  // Static card, two played frames, three written frames; no return to the comparison.
  assert.deepEqual(sentArt(bridge), ['S', 'P', 'P', 'W', 'W', 'W'])
  const captions = bridge.callsTo('textContainerUpgrade').filter(u => u.containerName === 'replay').map(u => u.content)
  assert.deepEqual(captions, ['what you played', 'what you played', "what's written", "what's written", "what's written", 'tap  replay'])
  const progress = bridge.callsTo('textContainerUpgrade').filter(u => u.containerName === 'next').map(u => u.content.trim())
  assert.deepEqual(progress, ['●○○○○', '●●○○○', '●●●○○', '●●●●○', '●●●●●', ''])
})

test('menu-style redraw after replay preserves the final correction frame', async () => {
  const { screen, ctx, bridge } = review([card('wrong_note-pitch')])
  await settle()
  screen.onInput({ kind: 'tap' })
  await settle(80)
  assert.equal(sentArt(bridge).at(-1), 'W')
  ctx.redraw()
  await settle()
  assert.equal(sentArt(bridge).at(-1), 'W')
  assert.equal(textByName(bridge).replay, 'tap  replay')
})

test('replay dwell begins after the image arrives, even on a slow bridge', async () => {
  const { screen, bridge } = review([card('duration-short')], { frameDwellMs: 120 })
  await settle()
  let release
  let block = true
  bridge.updateImageRawData = async update => {
    bridge.record('updateImageRawData', update)
    if (block) {
      block = false
      await new Promise(resolve => { release = resolve })
    }
    return 'success'
  }
  screen.onInput({ kind: 'tap' })
  await settle()
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.deepEqual(sentArt(bridge), ['S', 'P'])
  release()
  await settle()
  assert.deepEqual(sentArt(bridge), ['S', 'P'])
  await new Promise(resolve => setTimeout(resolve, 140))
  await settle()
  assert.deepEqual(sentArt(bridge).slice(0, 3), ['S', 'P', 'W'])
})

test('replay: swiping away and back shows the comparison card again', async () => {
  const { screen, bridge } = review(twoCards())
  await settle()
  screen.onInput({ kind: 'tap' })
  await settle(120)
  screen.onInput({ kind: 'swipeDown' })
  screen.onInput({ kind: 'swipeUp' })
  await settle(60)
  assert.equal(sentArt(bridge).at(-1), 'S')
})

test('replay: a second tap while replaying does not start another', async () => {
  const { screen, bridge } = review([card('timing-late')])
  await settle()
  screen.onInput({ kind: 'tap' })
  screen.onInput({ kind: 'tap' })
  await settle(200)
  assert.deepEqual(sentArt(bridge), ['S', 'P', 'W'])
})

test('replay: swiping away cancels the rest of the replay', async () => {
  const { screen, bridge } = review(twoCards())
  await settle()
  screen.onInput({ kind: 'tap' })
  screen.onInput({ kind: 'swipeDown' })
  await settle(60)
  // Card 1's frames never go out; card 2 gets its static art.
  assert.deepEqual(sentArt(bridge), ['S', 'S'])
  assert.equal(textByName(bridge).title, 'Beat 6 · late')
  assert.equal(textByName(bridge).replay, 'tap  replay')
})

test('replay: unclear audio shows no replay hint and tap does nothing', async () => {
  const { screen, bridge } = review([card('unclear_audio-quiet')])
  await settle()
  assert.equal(textByName(bridge).replay.trim(), '')
  screen.onInput({ kind: 'tap' })
  await settle(60)
  assert.deepEqual(sentArt(bridge), ['S'])
})

test('replay: reveal steps hold half as long as the frame that ends a phase', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const { screen, bridge } = review([card('missing_note-missing')], { frameDwellMs: 2000 })
  await settle()
  screen.onInput({ kind: 'tap' })
  await settle()
  assert.deepEqual(sentArt(bridge), ['S', 'P']) // played 1 of 2: a reveal step
  t.mock.timers.tick(999)
  await settle()
  assert.deepEqual(sentArt(bridge), ['S', 'P'])
  t.mock.timers.tick(1)
  await settle()
  assert.deepEqual(sentArt(bridge), ['S', 'P', 'P']) // played 2 of 2: ends the phase
  t.mock.timers.tick(1000)
  await settle()
  assert.deepEqual(sentArt(bridge), ['S', 'P', 'P'])
  t.mock.timers.tick(1000)
  await settle()
  assert.deepEqual(sentArt(bridge), ['S', 'P', 'P', 'W'])
})

test('review: fixture results carry a DEMO label', async () => {
  const { bridge } = review(twoCards(), { demo: true })
  await settle()
  assert.equal(textByName(bridge).counter, 'DEMO 1 / 2')
})

test('demo gallery holds every example card', () => {
  const { views } = demoReview()
  assert.equal(views.length, examples.examples.length)
})

// ── Analyzing and problem screens ─────────────────────────────────────

test('analyzing: status text, no menu, stage updates in place, no input', async () => {
  const { glasses, bridge } = fakeGlasses()
  const screen = analyzingScreen('Uploading')
  mount(screen, glasses)
  screen.setStage('Coaching')
  screen.onInput({ kind: 'tap' })
  await settle()
  const shown = textByName(bridge)
  assert.equal(shown.status, 'Listening back…')
  assert.equal(shown.stage, 'Coaching')
  assert.equal(screen.allowsMenu, false)
})

test('problem: plain reason, never a musical claim; tap or double tap plays again', async () => {
  const { glasses, bridge } = fakeGlasses()
  let playAgain = 0
  const screen = problemScreen({ reason: "Can't reach the server.", onPlayAgain: () => playAgain++ })
  mount(screen, glasses)
  await settle()
  assert.equal(textByName(bridge).reason, "Can't reach the server.")
  screen.onInput({ kind: 'tap' })
  screen.onInput({ kind: 'doubleTap' })
  assert.equal(playAgain, 2)
})
