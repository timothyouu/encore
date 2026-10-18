# Encore for Even G2 — Engineering Specification

**Status:** Build-ready draft; unresolved choices are explicitly marked OPEN or PROPOSED. This specification describes intended behavior, not verified implementation.

**Updated:** October 17, 2026 (Pacific time)  
**Audience:** Timothy, teammate, Devin, and coding agents  
**App name:** Encore
**Repository:** https://github.com/timothyouu/encore (verified under Timothy’s account)

**Team:** Two people: Timothy and one partner. There is no third teammate.

## 1. Product and scope

A glasses-first piano practice mentor helps a learner understand a mistake, see how to correct it, and try again without repeatedly reaching for a phone. The experience is a focused loop:

**Choose passage → preview → play → review one issue → see correction → focused retry → compare progress.**

The proposed initial audience is beginner piano learners practicing short prepared passages. The phone handles setup and detailed history. G2 provides concise, glanceable feedback between attempts while keeping the player's attention on the instrument.

### Agreed scope

- Piano only; begin with one hand and single notes
- A small prepared passage library with reference notes/MIDI and tempo
- Audio recording through G2; phone microphone is a fallback to validate
- Measured note/timing comparison followed by Gemini coaching through the **Strands TypeScript SDK**
- Basic Pitch runs on a **laptop**, not in the phone WebView
- Two feedback views: mistake review and corrective keyboard/finger schematic
- Static diagrams with slow pose changes; no beat-synchronized animation requirement
- Focused practice followed by retry at the original passage tempo
- Phone mirrors feedback and provides session history
- No smartwatch integration

### Out of scope for the first build

Arbitrary song transcription, unrestricted song search, two-handed polyphonic coaching, pedal assessment, actual finger tracking, AR graphics anchored to physical keys, medical claims, autonomous multi-agent swarms, and continuous spoken interruption while playing. Six library entries are a target; one fully working passage takes priority over six partially working ones.

## 2. Quiet Tech design rules

1. **Empty is the default:** while playing, hide notation and coaching; retain only a small recording indicator
2. **One useful cue:** prioritize a single supported issue after each phrase
3. **Show only meaningful changes:** recording, processing, feedback, and retry states must be distinguishable
4. **Monochrome first:** use outlines, labels, boxes, and symbols rather than color-dependent meaning
5. **Trust before detail:** if the recording or alignment is uncertain, request a retry instead of claiming a musical mistake
6. **Preserve agency:** never start recording without the player's action; allow cancellation and return to selection

Each feedback result answers: **Where? What happened? What should I try? What improved?**

## 3. System architecture and tech stack

### Settled architectural flow

1. G2 microphone sends audio through Bluetooth and EvenAppBridge to the phone's Even Hub WebView
2. The phone collects a bounded recording and sends it, with passage identity, to a reachable laptop analysis service
3. Laptop Python runs Basic Pitch and deterministic reference alignment/scoring
4. Structured analysis returns to the phone
5. The phone sends validated analysis to a protected hosted TypeScript endpoint
6. A Strands TypeScript workflow calls Gemini Flash-family coaching with those findings
7. The endpoint returns a short cue and constrained visual specification
8. The phone validates the response and renders deterministic monochrome assets/text
9. Even Hub SDK sends containers and updates to G2; the phone mirrors results

### Components

| Component | Technology / responsibility | Status |
|---|---|---|
| Phone client | TypeScript web app in Even Hub WebView; `@evenrealities/even_hub_sdk` | Agreed platform; framework OPEN |
| G2 integration | EvenAppBridge, display containers, gestures, audio events | Agreed; hardware validation required |
| Audio analysis | Python + Spotify Basic Pitch, reference alignment | Agreed laptop placement; Python 3.10 proposed |
| Coaching | Strands SDK for TypeScript + Gemini Flash-family model | Agreed; exact model/package versions OPEN |
| Visual renderer | Deterministic code from validated note/pose data | Proposed implementation of agreed diagrams |
| Coaching API host | Protected HTTPS TypeScript service | Provider/runtime OPEN |
| Laptop connectivity | HTTPS endpoint/tunnel reachable by the phone | Method/owner OPEN |
| History | Demo session results and retry comparisons | No real accounts in v1; storage/retention details OPEN |
| Observability | Sentry | Selected integration; implementation pending |

“Laptop” is a deployment choice for analysis, not an offline guarantee. The laptop must remain awake and reachable. Gemini still requires network access. Never embed permanent provider keys in the phone bundle, G2 package, public repository, or client logs. Secrets belong in the protected service environment.

An HTTPS tunnel may be necessary if venue networking prevents direct access. Whitelist approved endpoints in the app manifest and configure CORS for the actual client origin. CORS is not authentication.

## 4. Screens and state machine

### Phone screens

- **Library:** prepared passages, tempo, difficulty, brief learning objective
- **Passage:** notation/reference preview, connection state, recording-source selection
- **Session:** mirrors current G2 state; start/stop fallback controls and explicit errors
- **Results:** evidence, concise coach cue, correction diagram, focused retry and original-tempo retry
- **History:** past attempts and comparisons; raw-audio playback remains OPEN

Search applies only to the prepared library in v1.

### G2 states

| State | Display | Allowed transition |
|---|---|---|
| Disconnected | Phone explains reconnect | Connected → Ready |
| Ready | Passage preview and start prompt | Tap → Recording |
| Recording | Small recording icon only | Tap → Uploading/Analyzing |
| Analyzing | Short processing status | Success → Review; failure → Recoverable error |
| Review | Boxed note/beat and one short cue | Swipe down → Guide; retry action → Ready |
| Guide | Keyboard schematic and static/slow pose sequence | Swipe up → Review; retry action → Ready |
| Retry ready | Focused notes and slower tempo | Tap → Recording |
| Progress | Comparable original-tempo attempt result | Repeat or next passage |
| Recoverable error | Brief reason and retry option | Retry → Ready or back → selection |

### Controls

- Single tap: start from Ready; stop and analyze from Recording
- Swipe down: next feedback/guide page; swipe up: previous page
- Double tap: go back one level; at root use the platform's exit behavior
- Proposed cancellation behavior to validate: during recording, double tap asks to cancel; it must never silently submit a partial attempt
- Voice commands are optional later enhancements; do not block v1 on speech recognition

Test actual gesture events and exit behavior on G2. Debounce duplicate events. Disable duplicate submissions while processing. A late response from an older attempt must not replace the current attempt's view.

Use `rebuildPageContainer` only when the layout changes. Update existing text/image containers for content changes. Serialize image updates and avoid an unbounded Bluetooth queue. The schematic is inside the display, not positioned over physical piano keys.

## 5. Data contracts

Shared contracts live in one versioned TypeScript package, with equivalent validation in Python. The following are proposed application contracts, not claims about provider SDK method names.

### Reference passage

```ts
type ReferenceNote = {
  id: string;
  midiPitch: number;       // integer MIDI pitch; C4 = 60
  onsetBeat: number;       // relative to passage start
  durationBeats: number;
  hand: 'right' | 'left';
  suggestedFinger?: 1 | 2 | 3 | 4 | 5;
};
type Passage = {
  id: string;
  version: string;
  title: string;
  tempoBpm: number;
  beatsPerBar: number;
  notes: ReferenceNote[];
};
```

Convert reference beats to seconds using `seconds = beats * 60 / tempoBpm`. Store the actual attempt tempo separately from original tempo. Finger suggestions are authored teaching metadata, never inferred observations of the player's fingers.

### Recording and analysis

```ts
type DetectedNote = {
  id: string;
  midiPitch: number;
  onsetSec: number;
  durationSec: number;
  detectorScore?: number; // not a calibrated probability
};
type Finding = {
  id: string;
  kind: 'wrong_note' | 'missing_note' | 'extra_note' | 'timing';
  referenceNoteId?: string;
  detectedNoteId?: string;
  timingDeltaMs?: number; // positive = late, negative = early
};
type AnalysisResult = {
  schemaVersion: '1';
  attemptId: string;
  passageId: string;
  passageVersion: string;
  attemptTempoBpm: number;
  status: 'ok' | 'uncertain' | 'insufficient_audio' | 'error';
  detectorVersion: string;
  scoringVersion: string;
  audioQuality: { clipped: boolean; hasDropouts: boolean; warnings: string[] };
  alignment: { offsetSec: number | null; reliable: boolean };
  detectedNotes: DetectedNote[];
  findings: Finding[];
  metrics: { matchedNotes: number; expectedNotes: number; medianAbsTimingErrorMs: number | null };
};
```

Recording metadata includes attempt ID, capture source, actual sample rate, channel count, encoding, duration, and passage version. Preserve G2's actual PCM format when wrapping WAV; never change only the sample-rate label. For chunked capture, use sequence numbers and sample counts to detect gaps; packet arrival times are not note onset times.

### Coaching and visual response

```ts
type CoachingResult = {
  schemaVersion: '1';
  attemptId: string;
  cue: string;
  evidenceFindingIds: string[];
  visual: {
    kind: 'keyboard' | 'rhythm_strip' | 'none';
    referenceNoteIds: string[];
    poseIds: string[];
  };
  retry: { referenceNoteIds: string[]; tempoBpm: number } | null;
};
```

Validate every ID against the selected passage, findings, and an allowlisted pose library. Validate tempo bounds and cue length. Proposed cue target: one sentence, at most 120 characters, shortened further if the hardware layout requires it. The model must not return executable drawing code, invented measurements, or arbitrary remote image URLs.

## 6. Analysis and coaching behavior

Basic Pitch produces candidate note events. Ordinary code aligns these to the reference and identifies supported discrepancies. Strands coordinates the coaching call; it does not replace the detector or calculate musical truth through prose.

- Separate recording-start delay from musical timing errors
- Use a count-in or estimate a global offset; flag ambiguous alignment
- Match notes one-to-one so one detected note cannot satisfy multiple reference notes
- Handle repeated pitches, missing notes, and extra notes explicitly
- Do not time-warp away the timing errors being measured
- Calibrate timing tolerances using labeled recordings; do not invent universal grading thresholds
- Suppress firm judgments if audio is clipped, missing, too noisy, or ambiguously aligned
- No observation of fingering, posture, hand tension, or technique can be claimed from pitch data alone

Gemini receives the passage, validated findings, attempt history needed for comparison, and the permitted output schema. It chooses one priority cue and a bounded practice suggestion. If coaching fails, show the deterministic finding with a plain fallback instruction. If analysis is uncertain, show “I couldn't hear that clearly. Try again” rather than a grade.

Use one Strands coaching workflow initially. Additional models or agents require a separate justified responsibility and measured benefit. Lyria is excluded from note detection because its role is music generation.

## 7. Approved six-entry seed library

These are the **six original exercise names and passages approved by the team**. They are original practice patterns, not transcriptions of existing songs. Each note is one quarter-note beat unless stated; use right hand, no pedal. They can later be replaced by licensed/public-domain song excerpts with checked references.

| ID | Title | MIDI pitches | BPM | Purpose |
|---|---|---|---:|---|
| P01 | First Steps | 60,62,64,65,67,65,64,60 | 60 | Adjacent-note accuracy |
| P02 | Little Echo | 64,64,67,67,65,65,62,62 | 60 | Repeated onsets |
| P03 | Open Windows | 60,64,67,64,62,65,69,65 | 60 | Skipped-key selection |
| P04 | Hold the Moment | 60,64,67,65,64,62 | 60 | Durations: 2,1,1,2,1,1 beats |
| P05 | Room to Breathe | 60,64,67,65,64,60 | 60 | Onset beats: 0,2,3,4,5,7; rests on beats 1 and 6 |
| P06 | Small Climb | 60,62,64,67,69,67,64,62 | 72 | Steady timing at a faster tempo |

Generate reference MIDI and clean piano audio from the same versioned passage data. Separately produce controlled wrong-note, missing-note, and delayed-note test variants. Label playback as a test performance, never as live piano playing.

## 8. API boundaries and resilience

Proposed endpoints:

- Laptop `POST /v1/analyze`: multipart audio + attempt metadata; returns AnalysisResult
- Hosted service `POST /v1/coach`: validated AnalysisResult + passage ID/version; returns CoachingResult
- `GET /health`: readiness and model-loaded state, without secrets

For v1, bounded request/response is sufficient if measured inference fits the host time limit. Otherwise introduce a job ID and status polling. Enforce maximum clip duration, payload size, request timeout, and rate limits. Exact limits are OPEN pending tests.

Use attempt IDs for idempotency and correlation. Retry transient transport errors with bounded backoff; never create duplicate history entries or unlimited model charges. On disconnect, stop the microphone, preserve an explicit interrupted state, and offer restart. Backend errors must not look like musical errors.

Demo-first is agreed: no real accounts in v1. Use a demo session; proposed history implementation is browser-local structured results, with no cross-device persistence promise. Exact storage and retention details remain OPEN. No-login demo mode still needs protected provider credentials and abuse controls. Raw audio retention is OPEN; recommended default is delete after analysis, save only structured session results, and require explicit opt-in for audio playback storage. Do not log audio or full personal content to Sentry.

## 9. Ownership and coding-agent boundaries

| Workstream | Human owner | Suggested module boundary |
|---|---|---|
| Phone UI and session flow | Timothy | `apps/phone/` |
| G2 bridge, gestures, mic and display transport | Teammate, name OPEN | `packages/g2/` |
| Basic Pitch, reference alignment and tests | Devin implementation; Timothy review/integration | `services/analysis/` |
| Strands TypeScript + Gemini coaching endpoint | Timothy | `services/coaching/` |
| Shared schemas and passage library | Joint review; one editor at a time | `packages/contracts/`, `packages/passages/` |
| Final integration, hardware test and demo | Both | `tests/integration/`, demo documentation |

Devin and other coding agents work within assigned modules and branches. Their human owners review results. Devin is assigned the standalone Basic Pitch service and reference matcher, including their unit tests and fixture validation. Do not concurrently edit shared contracts; agree on schema changes before implementation. Start against clearly labeled fixtures so phone and G2 work can proceed while analysis is validated. Never substitute fixtures for real results without a visible demo/test label.

## 10. Implementation order and acceptance tests

### Phase 1: Prove analysis

- [ ] Pin dependencies and load Basic Pitch once on the chosen laptop
- [ ] Run one clean reference recording before connecting the complete app
- [ ] Check detected notes against independently known performed notes/MIDI
- [ ] Test correct, wrong, missing, extra, repeated, late, silent and noisy recordings
- [ ] Measure note precision/recall, timing error, false corrections and inference latency
- [ ] Record actual G2 audio and repeat the checks; evaluate phone mic fallback if needed

### Phase 2: Complete one real loop

- [ ] Phone selects a passage; G2 preview matches its version
- [ ] Tap starts capture; only the recording icon remains
- [ ] Tap stops capture and sends exactly one attempt
- [ ] Analysis finds a deliberate mistake and cites the correct note
- [ ] Strands/Gemini returns one evidence-grounded cue
- [ ] Renderer shows the correct key/pose; swipes and back work on hardware
- [ ] Focused retry runs, then original-tempo retry provides a valid comparison

### Phase 3: Reliability and delivery

- [ ] Noisy input produces uncertainty, not false confidence
- [ ] Network loss, duplicate taps, stale responses and Gemini failure recover cleanly
- [ ] Phone history matches G2 results and does not duplicate attempts
- [ ] Bluetooth image updates remain bounded and readable
- [ ] Test on physical G2 and package/deploy to Even Hub Beta
- [ ] Prepare simulator mirror, live demo, README and submission video

Do not claim performance gains from different passages or tempos. Record actual measured latency rather than promising instant feedback.

## 11. Sponsor tracks and evidence

Core targets: **Even Realities, Paper, Cognition, Google Gemini, Sentry**. **StepFun is deferred for v1**. Main track: **Beyond the Digital**.

- Even Realities: working glasses-first practice experience, physical G2 test and Beta packaging
- Paper: phone UI design and contextual, minimal presentation; consultation remains pending
- Cognition: document genuine Devin development/testing contribution
- Gemini: actual runtime coaching through the Gemini API
- Sentry: useful tracing/logging and demonstrated debugging; confirm challenge-specific requirements
- StepFun: deferred for v1; revisit only with a useful runtime role. Gemini-first v1 does not satisfy a StepFun integration requirement

Track selection is not proof of eligibility. Confirm final submission requirements and include only integrations actually used. Mentor discussion about the overall idea is marked complete; this does not imply approval of every feature.

## 12. Remaining choices

1. Frontend framework; app name is Encore and verified repository is timothyouu/encore, reported empty when checked
2. Phone OS and actual G2 capture compatibility; G2 microphone capture has not been tested. Planned demo/test input is laptop-speaker recorded playback, visibly labeled as such. Live piano availability remains unconfirmed.
3. Exact Gemini model/version, pinned Strands/Even SDK versions
4. Hosted coaching provider, laptop endpoint method and who configures access
5. Demo history storage and raw-audio retention/playback; no real accounts for v1
6. Partner name; there is no third teammate
7. Final passage selection, timing tolerances and acceptable measured demo latency

These choices can be resolved during setup; they must not silently become claims that implementation is complete.

## References

- [Spotify Basic Pitch](https://github.com/spotify/basic-pitch)
- [Strands model providers](https://strandsagents.com/docs/user-guide/sdk/model-providers/)
- [Even Hub device APIs](https://hub.evenrealities.com/docs/build/device-apis)
- [Even Hub display guidance](https://hub.evenrealities.com/docs/build/display)
- [Even Realities LA Hacks resources](https://evenrealities-lahacks.vercel.app/)
- [LA Hacks sponsor tracks](https://live.lahacks.com/tracks)
