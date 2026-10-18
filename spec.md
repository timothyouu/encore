# Encore for Even G2 — Engineering Specification

**Status:** Draft with unresolved review issues; choices and proposed defaults are explicitly marked OPEN or PROPOSED. This specification describes intended behavior, not verified implementation, and is not yet build-ready.

**Updated:** October 17, 2026 (Pacific time)  
**Audience:** Timothy, teammate, Devin, and coding agents  
**App name:** Encore
**Repository:** https://github.com/timothyouu/encore (verified under Timothy’s account)

**Team:** Two people: Timothy and one partner. There is no third teammate.

## 1. Product and scope

A glasses-first piano practice mentor helps a learner understand a mistake, see how to correct it, and choose what to play next. The experience is a simple loop:

**Choose song/passage → preview → record → review results and correction → return to song/passage selection → play again.**

Keep a count of recordings and let the player reopen past results from History. Playing again always begins with song/passage selection; there is no separate focused-practice, original-tempo retry, or progress state.

The proposed initial audience is beginner piano learners practicing short prepared passages. The phone handles setup and detailed history. G2 provides concise, glanceable feedback between attempts while keeping the player's attention on the instrument.

### Agreed scope

- Piano only; begin with one hand and single notes
- A small prepared passage library with reference notes/MIDI and tempo
- Audio recording through G2; phone microphone is a fallback to validate
- Measured note/timing comparison followed by Gemini coaching through the **Strands TypeScript SDK**
- Basic Pitch runs on a **laptop**, not in the phone WebView
- Two feedback views: mistake review and corrective keyboard/finger schematic, each tailored to the specific supported error found in that attempt
- Static diagrams with slow pose changes; no beat-synchronized animation requirement
- Optional static sheet music for the selected passage on G2 while playing, toggled with a **Hide/Show sheet music** item in the G2 system contextual menu (tap then hold)
- Return to song/passage selection after results to choose the same passage or another and play again
- Phone mirrors feedback, shows total and per-passage recording counts, and lets the player revisit past results
- No smartwatch integration

### Out of scope for the first build

Arbitrary song transcription, unrestricted song search, two-handed polyphonic coaching, pedal assessment, actual finger tracking, AR graphics anchored to physical keys, medical claims, autonomous multi-agent swarms, and continuous spoken interruption while playing. Six library entries are a target; one fully working passage takes priority over six partially working ones.

## 2. Quiet Tech design rules

1. **Minimal while playing:** while playing, hide coaching and feedback. Show only the selected passage's static sheet music (when enabled from the system menu) and a small recording indicator; with sheet music off, show only the recording indicator
2. **One useful cue:** prioritize a single supported issue after each phrase
3. **Show only meaningful changes:** selection, recording, processing, and feedback states must be distinguishable
4. **Monochrome first:** use outlines, labels, boxes, and symbols rather than color-dependent meaning
5. **Trust before detail:** if the recording or alignment is uncertain, invite another recording through song/passage selection instead of claiming a musical mistake
6. **Preserve agency:** never start recording without the player's action; allow cancellation and return to selection

Visualizations are error-specific, not generic decorations. Select the view and its highlights from the validated finding: for example, mark the expected and played keys for a wrong note, show the omitted key for a missed note, or use a beat/rhythm cue for an early or late note. Include only information supported by the audio analysis and passage data; if the finding is uncertain, do not show a corrective visualization.

Each feedback result answers: **Where? What happened? What should I try next?** Recording counts describe practice activity, not proof of improvement.

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
| History | Demo recording counts and saved attempt results | No real accounts in v1; storage/retention details OPEN |
| Observability | Sentry | Selected integration; implementation pending |

“Laptop” is a deployment choice for analysis, not an offline guarantee. The laptop must remain awake and reachable. Gemini still requires network access. Never embed permanent provider keys in the phone bundle, G2 package, public repository, or client logs. Secrets belong in the protected service environment.

An HTTPS tunnel may be necessary if venue networking prevents direct access. Whitelist approved endpoints in the app manifest and configure CORS for the actual client origin. CORS is not authentication.

## 4. Screens and state machine

### Phone screens

- **Library:** song/passage selection with prepared passages, tempo, difficulty, brief learning objective, total recording count, per-passage recording counts, and access to History
- **Passage:** notation/reference preview, connection state, recording-source selection
- **Session:** mirrors current G2 state, including whether sheet music is shown while playing; start/stop fallback controls and explicit errors
- **Results:** evidence, concise coach cue, correction diagram, recording counts, **Play again** → Library, and **View past results** → History
- **History:** individual attempts with passage, recording time, and processing/result/error status; select an entry to reopen its saved Results or status detail, and return to History without starting a recording. Raw-audio playback remains OPEN

Search applies only to the prepared library in v1.

**Confirmed navigation:** Library → Passage → Session (recording/processing) → Results → Library. **Play again** always returns to Library, even when the player wants the same passage. The player selects a passage, previews it, and explicitly starts a new recording. Library and Results both provide access to History; History → saved Results → History is read-only. Opening a past result must never start capture, resubmit analysis, or increment a recording count. Historical results identify their original passage and attempt rather than being presented as a new result.

### G2 states

| State | Display | Allowed transition |
|---|---|---|
| Disconnected | Phone explains reconnect | Connected → Selection |
| Selection | Song/passage selection prompt; phone shows Library | Select passage → Ready |
| Ready | Selected passage preview and start prompt | Tap → Recording; back → Selection |
| Recording | Small recording icon; plus static sheet music for the selected passage when sheet music is shown | Tap → Analyzing; double tap → discard → Ready |
| Analyzing | Short processing status | Success → Review; failure → Recoverable error |
| Review | Boxed note/beat and one short cue | Swipe down → Guide; Play again → Selection |
| Guide | Keyboard schematic and static/slow pose sequence | Swipe up → Review; Play again → Selection |
| Recoverable error | Brief reason and Play again option | Play again → Selection |

**Sheet music setting:** there is no app Settings screen on G2. The glasses OS draws a contextual menu on tap then hold, and Encore registers one item in it: **Hide sheet music** when shown, **Show sheet music** when hidden (verb labels, because the OS menu keeps no item state). Selecting it toggles the setting and re-declares the current page so the label updates; the player stays on the same state and view, with no capture started and no passage change. Recording and Analyzing omit the item, so the setting never changes mid-capture; change it before starting or after results.

Detailed History navigation is on the phone. When a saved result is mirrored on G2, Review and Guide remain read-only for that attempt; Play again returns to Selection. Opening a processing or failed entry shows its saved/current status rather than inventing a result or starting capture.

### Controls

- Single tap: start from Ready; stop and analyze from Recording
- Swipe down: next feedback/guide page; swipe up: previous page
- Double tap: go back one level; at root use the platform's exit behavior
- Tap then hold: OS contextual menu (system-drawn); Encore adds only the sheet-music item
- During recording, double tap discards the take immediately and returns to Ready (a dimmed `2× discard` hint says so); a discarded take is never saved as completed, counted or submitted
- Voice commands are optional later enhancements; do not block v1 on speech recognition
- **Gesture hints:** do not label system conventions (tap to select or move forward, double tap back, swipe to scroll). Show a dimmed hint only where the action is app-specific, destructive or hidden: Ready `tap ●` (start recording), Recording `tap ■` / `2× discard`, Review `▼ guide`

Test actual gesture events and exit behavior on G2. The SDK reports `LONG_PRESS_EVENT` at press start and a separate `LONG_PRESS_RELEASE_EVENT`; Encore assigns no action to them, but drops any tap that arrives during or just after a hold, and hardware tests must verify that opening the system menu never also registers as a single tap (which could start or stop a recording). Opening and closing the system menu deliver foreground enter/exit events; they must not trigger a redraw or state change. Debounce duplicate events. Disable duplicate submissions while processing. A late response from an older attempt must not replace the current attempt's view.

### Sheet music while playing

- Render the selected passage's notation deterministically from the versioned `Passage` data as a monochrome image (staff, clef, note heads/durations, rests, bar lines); no model-generated notation
- Show the whole passage statically; no playhead, scrolling, or beat-synchronized highlighting, and no correctness marks during capture
- Build and send the sheet-music image before capture starts (on entering Ready or on the Ready → Recording transition), so no image transfers compete with microphone audio over Bluetooth during recording. If the image cannot be sent, start recording with the indicator only and note it on the phone; never block or delay capture on notation
- The recording indicator must remain visible and distinguishable from the notation
- Exact image size/layout within the 576×288 canvas is OPEN pending hardware readability tests; the six seed passages must each fit on one screen

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
};
```

Validate every ID against the selected passage, findings, and an allowlisted pose library. Validate cue length. Proposed cue target: one sentence, at most 120 characters, shortened further if the hardware layout requires it. The model must not return executable drawing code, invented measurements, or arbitrary remote image URLs. Coaching does not define a separate retry exercise or change navigation; Play again is an application action that returns to Library.

### Display settings

```ts
type DisplaySettings = {
  schemaVersion: '1';
  showSheetMusicWhilePlaying: boolean; // PROPOSED default: true
};
```

Persist settings so the choice survives app restarts; G2 currently stores them in Even app storage (`setLocalStorage`, key `encore.displaySettings`), PROPOSED. Settings affect display only: they are not attempt data, do not change analysis, coaching, or recording counts, and are not stored on `AttemptRecord`.

### Recording counts and saved results

The user confirmed recording counts and access to past results. **PROPOSED default for count edge cases:** a completed capture counts once when the player stops and submits it, even if upload, analysis, or coaching later fails or the audio is insufficient. Canceled or interrupted captures do not count. These edge cases were not specified by the user and remain subject to review.

```ts
type AttemptRecord = {
  attemptId: string;       // unique per capture; reused for processing retries
  passageId: string;
  passageVersion: string;
  startedAt: string;       // ISO timestamp
  completedAt: string | null;
  captureStatus: 'recording' | 'completed' | 'canceled' | 'interrupted';
  processingStatus: 'not_started' | 'processing' | 'result' | 'error';
  analysis: AnalysisResult | null;
  coaching: CoachingResult | null;
  error: {
    stage: 'capture' | 'upload' | 'analysis' | 'coaching';
    message: string;
  } | null;
};
```

- Create one record with a unique attempt ID for each explicitly started capture. Persist completed capture metadata before starting upload/analysis, then update that same record with processing, result, or error status
- Derive the total recording count from records where `captureStatus === 'completed'`; derive each passage's count from the same records filtered by `passageId`. Counts cover the retained demo history, not an account-wide or cross-device lifetime total
- Count completion once per unique attempt ID. Duplicate stop events, request retries, repeated callbacks, reopening History, or viewing a result must not create another record or increment the count
- Preserve completed recordings in History while processing and after errors, even when no successful result exists. Keep any available analysis or coaching data if a later stage fails; show the relevant status and fallback rather than dropping the attempt
- Preserve an explicit canceled/interrupted state for incomplete captures, exclude them from recording counts, and never label them as completed results
- Bind stored analysis and coaching to the record's attempt ID and passage ID/version. Opening an entry reads that record; it does not rerun capture or analysis. Back returns to History; Play again returns to Library
- Browser-local storage of these records is PROPOSED for the demo, consistent with Section 8. Raw audio is not required to revisit structured results; exact storage and retention remain OPEN

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

The chosen visualization must correspond to the same evidence-backed finding as the cue. The renderer uses the finding kind and validated reference/detected note IDs to select and populate the appropriate deterministic diagram; it must not return a generic visual unrelated to the student's mistake or infer unsupported technique errors. If no suitable visualization is supported, return `kind: 'none'` and show the text cue only.

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

Use attempt IDs for idempotency and correlation. Retry transient transport errors with bounded backoff against the same attempt record; never create duplicate history entries or unlimited model charges. If capture is interrupted by a disconnect, stop the microphone, preserve an explicit interrupted state, and offer a return to Library to start again. A disconnect after capture completed does not remove its recording count; preserve the completed attempt's processing/error status. Backend errors must not look like musical errors.

Demo-first is agreed: no real accounts in v1. Use a demo session; proposed history implementation is browser-local attempt records and structured results, with counts derived from those records and no cross-device persistence promise. Exact storage and retention details remain OPEN. No-login demo mode still needs protected provider credentials and abuse controls. Raw audio retention is OPEN; recommended default is delete after analysis, save only structured session results, and require explicit opt-in for audio playback storage. Do not log audio or full personal content to Sentry.

## 9. Ownership and coding-agent boundaries

### Current checkout boundary (mandatory)

The current directories are `mobile/` (Timothy's phone UI) and `g2/` (the teammate's glasses workstream). The suggested module paths below describe future architecture, not permission to cross this boundary.

**Mobile-only work must have no glasses side effects, even when the calling function lives in `mobile/`.** Mobile code renders phone DOM/SVG only; it must not import the Even Hub SDK or glasses implementation, create/update/rebuild/shut down display containers, transmit text/images to glasses, or register glasses gesture handlers. The mobile display adapter was removed because it violated this boundary. Do not restore it behind an optional flag or copy it into the teammate's directory as part of mobile work.

The complete-product architecture and G2 states above remain intended integration requirements owned by the glasses workstream. Phone Settings may describe/store preferences, but applying them to G2 requires an explicitly authorized, owner-reviewed integration contract. Until then, describe device integration as unavailable and do not claim Settings affect physical glasses. See `AGENTS.md` for the durable coding rule and run the mobile boundary tests before accepting mobile changes.

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
- [ ] Tap starts capture; with sheet music on, the passage notation and recording icon are shown; with it off, only the recording icon remains
- [ ] Tap then hold opens the system menu from Selection, Ready, Review, Guide, and error states with Hide/Show sheet music; selecting it toggles the setting and returns to the same state unchanged
- [ ] During Recording/Analyzing the menu offers no sheet-music item, and opening the menu never stops capture or registers as a tap
- [ ] The sheet-music setting persists across app restarts and does not affect recording counts or analysis
- [ ] Tap stops capture and sends exactly one attempt
- [ ] Analysis finds a deliberate mistake and cites the correct note
- [ ] Strands/Gemini returns one evidence-grounded cue
- [ ] Renderer shows the correct key/pose; swipes and back work on hardware
- [ ] Results → Play again returns to Library; selecting the same or another passage and explicitly starting capture creates a new attempt
- [ ] Library and Results show total and per-passage recording counts derived from the saved attempt records
- [ ] Library/Results → History → selected past Results → History works without capture, resubmission, or count changes

### Phase 3: Reliability and delivery

- [ ] Noisy input produces uncertainty, not false confidence
- [ ] Network loss, duplicate taps, stale responses and Gemini failure recover cleanly
- [ ] Phone history matches G2 results, retains each attempt's processing/result/error status, and does not duplicate attempts
- [ ] Under the proposed count default, completed captures count once even if upload/analysis/coaching fails; canceled and interrupted captures do not count
- [ ] Duplicate stop events, processing retries, late responses, and reopening past results leave counts unchanged and update only the matching attempt
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

1. Frontend framework remains OPEN; app name is Encore and verified repository is timothyouu/encore, which contains the G2 app scaffold and this specification
2. Phone OS and actual G2 capture compatibility; G2 microphone capture has not been tested. Planned demo/test input is laptop-speaker recorded playback, visibly labeled as such. Live piano availability remains unconfirmed.
3. Exact Gemini model/version, pinned Strands/Even SDK versions
4. Hosted coaching provider, laptop endpoint method and who configures access
5. Demo history storage and raw-audio retention/playback; review proposed completed/canceled/interrupted recording-count defaults; no real accounts for v1
6. Partner name; there is no third teammate
7. Final passage selection, timing tolerances and acceptable measured demo latency

These choices and unresolved review issues must be resolved before treating this draft as build-ready; they must not silently become claims that implementation is complete. This revision updates the confirmed selection, recording-count, and result-history flow, and adds optional sheet music while playing, toggled from the G2 system contextual menu; broader review recommendations remain unresolved unless separately approved.

## References

- [Spotify Basic Pitch](https://github.com/spotify/basic-pitch)
- [Strands model providers](https://strandsagents.com/docs/user-guide/sdk/model-providers/)
- [Even Hub device APIs](https://hub.evenrealities.com/docs/build/device-apis)
- [Even Hub display guidance](https://hub.evenrealities.com/docs/build/display)
- [Even Realities LA Hacks resources](https://evenrealities-lahacks.vercel.app/)
- [LA Hacks sponsor tracks](https://live.lahacks.com/tracks)
