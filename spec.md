# Encore for Even G2 — Engineering Specification

**Status:** Draft with unresolved review issues; choices and proposed defaults are explicitly marked OPEN or PROPOSED. This specification describes intended behavior, not verified implementation, and is not yet build-ready.

**Updated:** October 17, 2026 (Pacific time)  
**Audience:** Timothy, teammate, Devin, and coding agents  
**App name:** Encore
**Repository:** https://github.com/timothyouu/encore (verified under Timothy’s account)

**Team:** Two people: Timothy and one partner. There is no third teammate.

**Latest scope decision:** The October 17 Granola discussion, [Recording page audio pipeline and visualization architecture](https://notes.granola.ai/d/32613d5d-34e4-4c80-bbf1-be861adc3f34), defines two model responsibilities: **Spotify Basic Pitch for note detection and Gemini for the Coach Agent**. Gemini is the coach provider confirmed by Timothy's accompanying direction. There is no separate visual-generation model. The contracts below are proposed implementation details where the discussion did not specify them.

## 1. Product and scope

A glasses-first piano practice mentor helps a learner understand a mistake, see how to correct it, and choose what to play next. The experience is a simple loop:

**Choose song/passage → preview → record → review results and correction → return to song/passage selection → play again.**

Keep a count of recordings and let the player reopen past results from History. Playing again always begins with song/passage selection; there is no separate focused-practice, original-tempo retry, or progress state.

The proposed initial audience is beginner piano learners practicing short prepared passages. The phone handles setup and detailed history. G2 provides concise, glanceable feedback between attempts while keeping the player's attention on the instrument.

### Agreed scope

- Piano only; begin with one hand and single notes
- A small prepared passage library with reference notes/MIDI and tempo
- Audio recording through G2; phone microphone is a fallback to validate
- Two model stages: Spotify Basic Pitch detection, then Gemini coaching through the **Strands TypeScript SDK**; reference comparison and visualization use ordinary code
- Recording page captures audio, stops and saves WAV, normalizes its sample rate, and uploads it to a server URL; both analysis and coaching endpoints receive the same normalized WAV
- Basic Pitch runs on a **laptop**, not in the phone WebView
- Two feedback views: mistake review and corrective keyboard/finger schematic, each tailored to the specific supported error found in that attempt
- Deterministic HTML/JavaScript piano-key animations show incorrect notes and durations (for example quarter notes versus half notes); no separate Gemini visual model or live beat-synchronized animation requirement
- Optional static sheet music for the selected passage on G2 while playing, toggled with a **Hide/Show sheet music** item in the G2 system contextual menu (tap then hold)
- Return to song/passage selection after results to choose the same passage or another and play again
- Phone mirrors feedback, shows total and per-passage recording counts, and lets the player revisit past results
- No smartwatch integration

### Out of scope for the first build

Arbitrary song transcription, unrestricted song search, two-handed polyphonic coaching, pedal assessment, actual finger tracking, AR graphics anchored to physical keys, medical claims, autonomous multi-agent swarms, and continuous spoken interruption while playing. Six library entries are a target; one fully working passage takes priority over six partially working ones.

## 2. Quiet Tech design rules

1. **Minimal while playing:** while playing, hide coaching and feedback. Show only the selected passage's static sheet music (when enabled from the G2 system menu) and a small recording indicator; with sheet music off, show only the recording indicator.
2. **One useful cue:** prioritize a single supported issue after each phrase
3. **Show only meaningful changes:** selection, recording, processing, and feedback states must be distinguishable
4. **Monochrome first:** use outlines, labels, boxes, and symbols rather than color-dependent meaning
5. **Trust before detail:** if the recording or alignment is uncertain, invite another recording through song/passage selection instead of claiming a musical mistake
6. **Preserve agency:** never start recording without the player's action; allow cancellation and return to selection

Visualizations are error-specific, not generic decorations. Select the view and its highlights from the validated finding: for example, mark the expected and played keys for a wrong note, show the omitted key for a missed note, or use a beat/rhythm cue for an early or late note. Include only information supported by the audio analysis and passage data; if the finding is uncertain, do not show a corrective visualization.

Each feedback result answers: **Where? What happened? What should I try next?** Recording counts describe practice activity, not proof of improvement.

## 3. System architecture and tech stack

### Settled architectural flow

1. The recording page receives a bounded capture from the selected source. G2 microphone/bridge capture belongs to the glasses workstream; phone microphone capture belongs to mobile. Hardware integration remains unverified.
2. On stop/save, finalize WAV, normalize the sample rate through actual resampling, and upload the normalized recording to a server that returns its audio URL. Keep one attempt identity throughout.
3. Deliver that WAV to the reachable laptop analysis endpoint. Python runs Spotify Basic Pitch for pitch, note events and detector confidence, then deterministic reference alignment/scoring.
4. Forward the validated Basic Pitch output and reference findings to the protected coaching endpoint, together with the same WAV and passage identity. Both endpoints must receive the audio; analysis JSON alone is insufficient for the coaching request.
5. One Strands TypeScript workflow calls the Gemini Coach Agent with audio and structured evidence. It summarizes performance, flags supported specific mistakes, and prepares structured mistake data for visualization.
6. The endpoint returns a short cue, evidence references and constrained visualization data. It does not call a second visual model or generate executable rendering code.
7. Phone-owned HTML/JavaScript validates that data and deterministically renders the results and piano-key/duration animations in the phone DOM. Layout and animation rules are application code.
8. Separately, the glasses workstream adapts the shared result data to G2-compatible assets/text and owns SDK container updates. Mobile does not transmit visuals or control glasses (Section 9).

**Pipeline:** Recording → normalized WAV + server URL → Basic Pitch + reference comparison → Gemini Coach (same WAV + analysis) → validated mistake data → deterministic renderer. These are two model responsibilities, not two total infrastructure components; upload, alignment, validation, storage and rendering remain ordinary services/code. Endpoint names and WAV transfer mechanics remain proposed in Section 8.

### Components

| Component | Technology / responsibility | Status |
|---|---|---|
| Phone client | TypeScript web app; recording/session UI and phone DOM rendering; no Even Hub SDK import in mobile | Phone workstream; framework OPEN |
| G2 integration | EvenAppBridge, display containers, gestures, audio events | Agreed; hardware validation required |
| Audio analysis | Python + Spotify Basic Pitch, reference alignment | Agreed laptop placement; Python 3.10 proposed |
| Coaching | Strands SDK for TypeScript + Gemini Flash-family model | Agreed; exact model/package versions OPEN |
| Visual renderer | HTML/JavaScript piano-key and duration animations from validated coach mistake data | Agreed deterministic architecture; exact schema/layout proposed |
| Recording upload | Normalize WAV and store at a server URL; deliver the same audio to both model endpoints | Agreed flow; host, target format and transfer contract OPEN |
| Coaching API host | Protected HTTPS TypeScript service | Provider/runtime OPEN |
| Laptop connectivity | HTTPS endpoint/tunnel reachable by the phone | Method/owner OPEN |
| History | Demo recording counts and saved attempt results | No real accounts in v1; local structured history and bounded temporary WAV retention (Section 8) |
| Observability | Sentry Error Monitoring + Tracing | Phone implementation and synthetic ingestion verified; backend work and sponsor eligibility pending (Section 8) |

“Laptop” is a deployment choice for analysis, not an offline guarantee. The laptop must remain awake and reachable. Gemini still requires network access. Never embed permanent provider keys in the phone bundle, G2 package, public repository, or client logs. Secrets belong in the protected service environment.

An HTTPS tunnel may be necessary if venue networking prevents direct access. Whitelist approved endpoints in the app manifest and configure CORS for the actual client origin. CORS is not authentication.

## 4. Screens and state machine

### Phone screens

- **Library:** song/passage selection with prepared passages, tempo, difficulty, brief learning objective, total recording count, per-passage recording counts, and access to History
- **Passage:** notation/reference preview, connection state, recording-source selection
- **Session / Recording:** explicit record and stop/save controls; finalize WAV, normalize sample rate, upload, analyze, then coach. Show the current stage and actionable errors; never imply a G2 connection from phone capture alone
- **Results:** evidence, concise coach cue, correction diagram, recording counts, **Play again** → Library, and **View past results** → History
- **History:** individual attempts with passage, recording time, and processing/result/error status; select an entry to reopen its saved Results or status detail, and return to History without starting a recording. Long-term raw-audio playback is outside v1
- **Settings:** Library's top-right gear button → Settings; back returns to Library. Configure sheet music shown on G2 while playing, its size, and optional note names, as described below.

Search applies only to the prepared library in v1.

**Confirmed navigation:** Library → Passage → Session (recording/processing) → Results → Library. **Play again** always returns to Library, even when the player wants the same passage. The player selects a passage, previews it, and explicitly starts a new recording. Library and Results both provide access to History; History → saved Results → History is read-only. Opening a past result must never start capture, resubmit analysis, or increment a recording count. Historical results identify their original passage and attempt rather than being presented as a new result.

### Recording page and processing states

**Ready → Recording → Saving/normalizing WAV → Uploading → Analyzing → Coaching → Results.** These are stages within Session, not additional navigation destinations. Stop/save completes one capture; it does not create a second attempt for upload or coaching. Keep coaching hidden during capture. Disable duplicate submissions during processing and retain the completed attempt if a later stage fails. Cancellation before capture completion produces no submitted WAV. Show normalization, upload, analysis and coaching failures at their actual stage, with a retry of the same saved attempt where possible. The local implementation caps capture at 30 seconds and normalizes to 22,050 Hz mono PCM16 WAV; Section 8 defines temporary storage and retry limits.

### App Settings — agreed design

The editable Settings design is in [G2 Mobile App in Paper](https://app.paper.design/file/01M56HHCC29GHEHZ2V9FPV5FTR/p-1-0). The phone stores these preferences locally. Applying them to G2 remains a proposed integration that requires the glasses owner's agreement; the current G2 runtime uses its system contextual menu for Hide/Show sheet music. Phone settings do not send device commands or override that menu.

| Control | Behavior |
|---|---|
| Show sheet music on glasses | Store the requested reference-sheet-music preference locally for a future agreed device integration. When off, show only the recording indicator. This is prepared notation, not live transcription or coaching. |
| Sheet music size | Choose **Standard** or **Large** for the displayed notes and staff. “Score” means sheet music; use the clearer label **Sheet music size** in the app. Large increases notation size and may show less of the passage at once; it does not change pitch, tempo, or grading. |
| Note names | Toggle pitch labels such as C4, D4, and E4 beneath the displayed notes. This affects reference notation only, not analysis. |

- Keep Settings visually consistent with the app: paper background, existing typography, editable controls, and a compact G2 connection status. A disconnected status uses the agreed yellow warning treatment.
- Size and note-name controls apply when sheet music is enabled; disable them when it is off without discarding their selected values.
- Do not include **Preview on glasses** or **Keep phone awake during recording**; both were removed from the agreed design.
- No coaching or mistake suggestions appear during recording. Feedback remains after the attempt.
- **OPEN implementation decisions:** initial defaults (Paper illustrates sheet music on, Large, and note names on), on-device preference persistence validation, readable notation dimensions on physical G2, and how Large fits the passage within the static single-screen G2 layout below. Do not imply automatic score following is implemented.

### G2 states

| State | Display | Allowed transition |
|---|---|---|
| Disconnected | Phone explains reconnect | Connected → Selection |
| Selection | Song/passage selection prompt; phone shows Library | Select passage → Ready |
| Ready | Selected passage preview and start prompt | Tap → Recording; back → Selection |
| Recording | Small recording icon; plus static sheet music for the selected passage when sheet music is shown | Tap → Analyzing; double tap → discard → Ready |
| Analyzing | Short processing status | Success → Review; failure → Recoverable error |
| Review | One mistake card per screen from `CoachingResult.visualPlan` (up to 3, priority order): art (keys, staff, beat ruler, duration bars or mic), ●/○ Expected/Detected legend, one cue | Swipe down/up → next/previous card; tap → replay the card's correction; double tap → Selection (Play again) |
| Recoverable error | Brief reason and Play again option | Play again → Selection |

**Sheet music setting:** there is no app Settings screen on G2. The glasses OS draws a contextual menu on tap then hold, and Encore registers one item in it: **Hide sheet music** when shown, **Show sheet music** when hidden (verb labels, because the OS menu keeps no item state). Selecting it toggles the setting and re-declares the current page so the label updates; the player stays on the same state and view, with no capture started and no passage change. Recording and Analyzing omit the item, so the setting never changes mid-capture; change it before starting or after results.

Detailed History navigation is on the phone. When a saved result is mirrored on G2, Review remains read-only for that attempt; Play again returns to Selection. Opening a processing or failed entry shows its saved/current status rather than inventing a result or starting capture.

### Controls

- Single tap: start from Ready; stop and analyze from Recording; replay the current card in Review
- Swipe down: next mistake card; swipe up: previous card
- Double tap: go back one level; at root use the platform's exit behavior
- Tap then hold: OS contextual menu (system-drawn); Encore adds only the sheet-music item
- During recording, double tap discards the take immediately and returns to Ready (a dimmed `2× discard` hint says so); a discarded take is never saved as completed, counted or submitted
- Voice commands are optional later enhancements; do not block v1 on speech recognition
- **Gesture hints:** do not label system conventions (tap to select or move forward, double tap back, swipe to scroll). Show a dimmed hint only where the action is app-specific, destructive or hidden: Ready `tap ●` (start recording), Recording `tap ■` / `2× discard`, Review `▼ next` when another card follows

Test actual gesture events and exit behavior on G2. The SDK reports `LONG_PRESS_EVENT` at press start and a separate `LONG_PRESS_RELEASE_EVENT`; Encore assigns no action to them, but drops any tap that arrives during or just after a hold, and hardware tests must verify that opening the system menu never also registers as a single tap (which could start or stop a recording). Opening and closing the system menu deliver foreground enter/exit events; they must not trigger a redraw or state change. Debounce duplicate events. Disable duplicate submissions while processing. A late response from an older attempt must not replace the current attempt's view.

### Review cards on G2

The glasses adapt the shared visual plan (`shared/visual-contract.ts`) following the Paper **Mistake animations** page: solid = expected, hollow/dashed = detected, a shaded band marks the beat in question, and every card labels EXPECTED and DETECTED in words. The card the coach chose (its findings match `evidenceFindingIds`) uses `summary.next` as its cue when it fits three lines; other cards use their own `cue`. Evidence IDs cover each card's whole context, so the faulty note is found by pairing expected and detected notes one to one (same pitch, onset within 0.2 beats). Tap replays a card as keyframes in its picture slot, sent at Bluetooth pace with at least 0.7 s each: first only what was played (hollow notes, the heard onset, the held length), then the fix (the written notes, the onset on the beat, the full length), then back to the static card; the bottom row shows the frame caption and ●○○ progress, and swiping or leaving cancels it. There is no separate Guide state. Unclear audio shows words and a microphone only, because analysis reports no audio levels to meter.

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
  kind: 'wrong_note' | 'missing_note' | 'extra_note' | 'timing' | 'duration';
  referenceNoteId?: string;
  detectedNoteId?: string;
  timingDeltaMs?: number; // positive = late, negative = early
  durationDeltaMs?: number; // positive = held too long, negative = too short
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

Recording metadata includes attempt ID, capture source, source and normalized sample rates, channel count, encoding, duration, and passage version. Decode using the actual capture format, resample to the agreed target format, then encode a valid WAV; never normalize by changing only the sample-rate label. Retain source metadata for diagnosis. Both endpoints receive the same normalized artifact. For chunked capture, use sequence numbers and sample counts to detect gaps; packet arrival times are not note onset times.

**PROPOSED uploaded-audio contract:** an attempt-bound artifact ID, server audio URL, expiry, MIME type, normalized sample rate/channel count and duration. A server URL does not imply permanent public access. Define endpoint access and expiry before integration; do not persist an expiring URL as the only way to reopen structured results.

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
    mistakes: {
      findingId: string;
      referenceNoteId?: string;
      detectedNoteId?: string;
    }[];
  };
};
```

Validate every ID against the selected passage, findings, and an allowlisted pose library. Validate cue length. Proposed cue target: one sentence, at most 120 characters, shortened further if the hardware layout requires it. The model must not return executable drawing code, invented measurements, or arbitrary remote image URLs. Coaching does not define a separate retry exercise or change navigation; Play again is an application action that returns to Library.

The proposed `visual.mistakes` entries reference measured evidence; the renderer resolves expected/played pitches, onset and duration from the versioned passage and analysis. Ordinary code chooses key geometry, labels, highlights and animation timing. Show expected versus played keys and expected versus measured hold duration, including quarter/half-note labels when supported by the reference. Missing notes have no played-note event; extra notes may have no reference-note event. Reject mismatched references and unsupported duration claims. The coach selects supported mistakes, not layout or musical measurements. Save the validated data so History can render the same result without another model call. Slow finger poses, if retained, use authored suggestions and never imply observed finger tracking.

### Display settings

```ts
type DisplaySettings = {
  schemaVersion: '1';
  showSheetMusicWhilePlaying: boolean; // PROPOSED default: true
};
```

Persist settings through the phone-local storage adapter alongside demo history. IndexedDB is the browser implementation; actual Even WebView persistence must be verified on device before promising restart durability. Settings affect display only: they are not attempt data, do not change analysis, coaching, or recording counts, and are not stored on `AttemptRecord`.

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
    stage: 'capture' | 'normalization' | 'upload' | 'analysis' | 'coaching';
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
- Persist these records locally through the storage adapter described in Section 8. Raw audio is not required to revisit structured results. No cross-device recovery or permanent audio playback is promised in v1.

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

Gemini receives the same normalized WAV used by Basic Pitch, detected notes and confidence scores, the passage, validated findings, attempt history needed for comparison, and the permitted output schema. The coaching service must actually retrieve/attach the audio in the selected Gemini API's supported form; a URL string in a prompt alone does not establish audio delivery. The combined implementation verifies inline WAV encoding through the Strands adapter and one live Gemini 3.5 Flash-Lite synthetic request; real acoustic and physical-device validation remains open. It summarizes performance, chooses one priority cue and a bounded practice suggestion, and returns evidence-linked mistake data for the deterministic renderer. Audio context does not authorize invented measurements or overriding uncertain alignment with confident claims. If coaching fails, show the deterministic finding with a plain fallback instruction. If analysis is uncertain, show “I couldn't hear that clearly. Try again” rather than a grade.

The chosen visualization must correspond to the same evidence-backed finding as the cue. The renderer uses the finding kind and validated reference/detected note IDs to select and populate the appropriate deterministic diagram; it must not return a generic visual unrelated to the student's mistake or infer unsupported technique errors. If no suitable visualization is supported, return `kind: 'none'` and show the text cue only.

Use one Strands coaching workflow. V1 has only Basic Pitch and Gemini Coach as model responsibilities; a separate Gemini visualizer or other model/agent is out of scope. Strands is orchestration, not a third model. Lyria is excluded from note detection because its role is music generation.

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

- Upload service `POST /v1/recordings`: normalized WAV + attempt metadata; returns an attempt-bound audio artifact and its server URL
- Laptop `POST /v1/analyze`: WAV + attempt/passage metadata; returns AnalysisResult
- Hosted service `POST /v1/coach`: the same WAV + validated AnalysisResult + passage ID/version; returns CoachingResult
- `GET /health`: readiness and model-loaded state, without secrets

The meeting explicitly requires WAV delivery to both endpoints. **Selected local transport:** upload once, then pass the artifact ID to the protected server; it resolves the stored WAV and sends multipart bytes to Basic Pitch and inline audio to coaching. With URL delivery, both services must fetch the actual file, enforce size/format limits and restrict retrieval to the approved audio store. Coaching waits for matching analysis even if audio delivery overlaps. A missing, expired or mismatched artifact is a transport/input error, not a musical finding. The local implementation uploads to the protected coaching service, passes an artifact ID to analysis/coaching routes, and forwards actual WAV bytes from that store to each consumer. Section 8 defines expiry/retry behavior; deployment URLs and physical-device access remain to be configured.

For v1, bounded request/response is sufficient if measured inference fits the host time limit. Otherwise introduce a job ID and status polling. Enforce maximum clip duration, payload size, request timeout, and rate limits. Exact limits are OPEN pending tests.

Use attempt IDs for idempotency and correlation. Retry transient transport errors with bounded backoff against the same attempt record; never create duplicate history entries or unlimited model charges. If capture is interrupted by a disconnect, stop the microphone, preserve an explicit interrupted state, and offer a return to Library to start again. A disconnect after capture completed does not remove its recording count; preserve the completed attempt's processing/error status. Backend errors must not look like musical errors.

### Local history and temporary audio storage — accepted architecture

Decision confirmed October 17, 2026: v1 uses phone-local settings and structured attempt history plus temporary private server storage for WAV processing. No accounts, cloud profile database, cross-device sync, or permanent recording playback are required. Store only the minimal demo preferences needed; Even hosting the WebView does not establish an Encore cloud backup or authenticated backend identity.

- **Phone history/settings:** use a storage adapter, with IndexedDB as the browser implementation. Hydrate before enabling capture; serialize writes, validate saved records and preserve original attempt/passage identities. Migrate existing localStorage history/settings only after a durable write succeeds; mark migration so old data cannot later resurrect deleted history. Keep settings separate from attempt records. Retain at most 1,000 attempt records; when full, refuse a new capture with a visible explanation and preserve existing history rather than saving an unreadable snapshot. Surface unavailable/quota/corrupt-storage failures and honestly label session-only operation. Local browser data can be cleared or evicted; actual Even app persistence remains a hardware acceptance gate. Do not import the Even SDK into mobile to implement persistence.
- **Phone temporary audio:** persist normalized 22,050 Hz mono PCM16 WAV before upload to enable explicit retry after reload. Keep the same attempt ID and completed count. The local retry window is ten minutes from first save, with at most 24 clips and 32 MiB of pending WAV data. Reject additional durable saves with a visible warning rather than silently evicting unexpired pending clips. Remove audio on successful terminal results (including uncertain/insufficient-audio results), or expiry. Keep structured results after removing audio. If durable storage fails, allow honest session-only operation without claiming restart recovery.
- **Server temporary audio:** retain one immutable WAV per attempt for Basic Pitch and the Gemini coach. Store bytes separately from structured history. The demo uses a bounded in-memory artifact store behind the existing loopback/authenticated service, not a public bucket. A server restart loses artifacts; the phone can reupload an unexpired saved WAV using the same attempt ID. No durable server backup is claimed.
- **Retention and consumers:** upload retries must not extend the ten-minute artifact lifetime. Do not purge after Basic Pitch while coaching still needs audio. After both consumers finish, keep a 60-second response-retry grace bounded by the original expiry, then purge. A non-ok terminal analysis skips coaching and starts that same grace; technical failures remain retryable until expiry. Hard expiry removes the server artifact even if a consumer is pending; consumer response deadlines are bounded (analysis at most 65 seconds and coaching at most 60 seconds). A late completion after expiry must not revive the artifact. Third-party processing may retain its own already-delivered copy until it stops; deleting our artifact is not a claim of deletion from external providers. Run cleanup while idle as well as on requests, and release timers at server shutdown. Expiring a URL alone is not deletion.
- **Recovery:** History/reload never starts capture, upload, analysis or coaching automatically. Show interrupted processing honestly and offer explicit retry only while the local WAV remains available. An expired server receipt must trigger reupload on explicit retry, not a new attempt. Retain structured results/status even when audio expires. Late callbacks cannot update another attempt or revive deleted/expired artifacts.
- **Privacy and future scope:** no audio, signed URLs, credentials or personal content in telemetry. No-login demo mode still requires protected provider credentials and abuse controls. Longer playback retention requires a separate explicit product choice. If real accounts and cross-device recovery are later required, use Supabase Auth/Postgres for profiles and structured attempts and private Supabase Storage for audio, with owner access policies and short-lived authorized downloads. That future cloud solution is not part of this implementation.

Acceptance: verify migration and restart recovery; unavailable/quota/corrupt storage; serialized persistence and late-write handling; duplicate uploads, retries and counts; same WAV bytes at both consumers; consumer failure and skipped-coach cleanup; expiry without new traffic; bounded active jobs; server restart/reupload; History without network/model calls after audio deletion. Test browser IndexedDB as well as injected adapters. Physical Even/phone validation remains separate from desktop tests.

### Sentry: proposed two-product plan

**Implementation scope:** this checkout includes the phone client, local TypeScript coaching service, Python Basic Pitch service, and the separately owned G2 runtime. Phone Sentry instrumentation covers recorder stop, WAV normalization, artifact upload/validation, analysis/coaching request and validation, persistence, and rendering. Client request timings include network and server work; backend spans and distributed propagation remain future work. Prior synthetic Sentry ingestion is verified, including a linked error and root/child trace. Combined-code local verification is recorded in `docs/shipping-verification.md`; physical phone/G2 instrumentation remains unverified.

**Target:** use **Error Monitoring** and **Tracing** to answer two practical questions: why did an attempt fail, and why did feedback take so long? Timothy reports that the Sentry challenge requires two services. Treat these as the proposed pair, subject to confirmation that the organizer counts them as two qualifying products. The public tracks page did not expose readable challenge details during research on October 17, 2026. The phone implementation and synthetic ingestion are verified; the full backend design below remains proposed.

#### 1. Error Monitoring: diagnose failed practice attempts

Use Sentry's JavaScript SDK in the phone client and TypeScript coaching service, and its Python SDK in the analysis service. Exact packages/versions depend on the selected runtimes and require package approval before installation. Automatically capture unhandled exceptions; explicitly capture handled technical failures that would otherwise disappear behind the recoverable-error UI. Sentry supports manual exception capture and breadcrumbs leading to an error ([JavaScript error capture](https://docs.sentry.io/platforms/javascript/usage/)).

| Location | What to report | Why it helps |
|---|---|---|
| Phone capture/save | Unexpected WAV encoding or resampling failures | Distinguish a broken recording pipeline from poor playing |
| Upload/audio retrieval | Exhausted upload retries; missing, expired or attempt-mismatched audio artifacts | Explain why one or both model stages could not receive the WAV |
| Python analysis | Basic Pitch load/inference exceptions and reference-alignment crashes | Identify laptop/model failures instead of reporting musical mistakes |
| Coaching service | Exhausted Gemini timeouts/rate-limit retries; invalid structured output or unsupported evidence references rejected by validation | Diagnose unavailable or unusable coaching without displaying invented advice |
| Phone results/history | Rendering exceptions, failed result persistence and detected duplicate-count invariant violations | Protect saved attempts and reliable recording counts |

Attach sanitized context: opaque `attemptId`, prepared `passageId`/version, stage, capture source, retry number, release, environment and stable error code. Keep attempt IDs out of issue fingerprints so repeated instances of the same defect group together. Add breadcrumbs for stage changes and retries. Report a terminal failure once at its owning layer; correlate any separate client/server symptoms rather than creating an event for every retry. Permission denial, user cancellation, silence, uncertain alignment and wrong notes are expected outcomes, not software exceptions.

#### 2. Tracing: measure stop-to-feedback latency

Create a bounded `practice.process_attempt` root span when the player presses stop/save; finish it when phone Results renders or processing reaches a terminal error/cancellation/timeout. Exclude time spent playing from this latency. Add child spans around the actual work below; names are proposed Encore instrumentation names, not built-in Sentry operations.

| Proposed span | Measurement / investigation |
|---|---|
| `audio.finalize`, `audio.resample` | Is phone WAV preparation delaying submission? |
| `audio.upload` | Is recording size or venue networking the bottleneck? |
| `analysis.fetch_audio`, `analysis.basic_pitch`, `analysis.align` | Separate audio retrieval, inference and deterministic comparison |
| `coach.fetch_audio`, `coach.gemini`, `coach.validate` | Separate WAV retrieval, model response time and schema/evidence validation |
| `results.render`, `history.persist` | Measure phone rendering and saving after the service responds |

Record bounded metadata such as clip duration, byte count, sample rate, actual model/version, retry count, outcome and whether analysis was cold or warm. Measure model initialization separately when it occurs outside a request. Inspect total latency and the slowest stage; report individual demo timings and sample count, and use p50/p95 only once there are enough comparable attempts. Compare the same passage and clip conditions before claiming an improvement.

Propagate Sentry trace context through approved first-party HTTP calls so phone, upload, Python analysis and TypeScript coaching appear in one trace. Configure narrowly scoped `tracePropagationTargets`; allow `sentry-trace` and `baggage` in server CORS and ensure the tunnel preserves them. An attempt ID alone does not create a distributed trace. Do not propagate these headers indiscriminately to provider or arbitrary audio URLs. Manual spans around Basic Pitch and Strands/Gemini are the baseline; automatic support for this exact stack is not assumed. See [JavaScript distributed tracing](https://docs.sentry.io/platforms/javascript/tracing/distributed-tracing/) and [Python tracing](https://docs.sentry.io/platforms/python/tracing/).

Keep retry spans under the current processing operation. A later user-triggered retry may start a new trace linked by the same attempt ID; it must not create a new recording count. Reopening History should not start an analysis/coaching trace.

#### Scope, privacy and optional extension

- Timothy owns phone/coaching instrumentation; the analysis implementer owns Python instrumentation with Timothy's integration review. G2 disconnect/display telemetry is a future teammate-owned extension requiring the Section 9 integration contract. This plan does not authorize mobile code to subscribe to glasses events or transmit display updates.
- Send metadata only. Exclude WAV/audio attachments, signed audio URLs and query strings, credentials, request/response bodies, full prompts and coach text. Scrub automatic HTTP breadcrumbs, exception messages and span attributes as well as custom fields; disable default PII collection and inspect actual outgoing telemetry before acceptance.
- Telemetry must fail independently: a blocked Sentry request must not stop capture, processing or History. Use a dedicated demo environment, explicit sampling and bounded telemetry volume. Proposed demo trace sampling is 100% for a small controlled set; review quotas and reduce sampling for broader use.
- **Optional third product: Sentry Logs.** Structured events such as `attempt.stage_changed`, `retry.scheduled` and `audio.cleanup_completed` could explain successful recoveries or verify that cleanup waited for both consumers. This is additional scope, not required for the proposed pair; breadcrumbs are not a separate Logs integration. See [Sentry Logs for Node.js](https://docs.sentry.io/platforms/javascript/guides/node/logs/).

#### Acceptance and submission evidence

- [ ] Confirm the exact challenge wording and that Error Monitoring + Tracing qualify as the two services; save the organizer source with submission notes.
- [ ] Run one real audio-to-results attempt and show a connected trace with phone, analysis and coaching spans. Label fixture spans or injected delays explicitly; do not claim hardware coverage from phone-only capture.
- [ ] Inject a controlled expired-audio or invalid-coach-response failure in a test/demo environment. Show its Sentry issue, failing stage, sanitized context and related trace, while the phone preserves the attempt and offers the expected recovery.
- [ ] Retry the same attempt successfully and verify its recording count remains one. Show a successful trace as well as the failed one.
- [ ] Use a real observed issue or bottleneck to demonstrate diagnosis, an in-scope fix and a comparable rerun. If only failure injection was demonstrated, describe it as such rather than inventing a production incident or performance gain.
- [ ] Inspect emitted errors, breadcrumbs and spans for excluded content; block telemetry and verify the practice flow still works. Save sanitized issue/trace screenshots or links and identify the two products in the submission.

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
- [ ] Tap starts capture; the recording icon remains, with reference sheet music only when enabled in the G2 system menu; no coaching appears during capture
- [ ] Library gear button → Settings → Library works without starting capture or changing recording counts
- [ ] Phone settings persist locally without device writes; future G2 application of size/note-name preferences requires an agreed glasses-owner contract
- [ ] Verify both sheet-music visibility states, both sizes, note names on/off, and disconnected yellow status on the phone; validate notation legibility and static passage fit on physical G2
- [ ] Tap then hold opens the system menu from Selection, Ready, Review, and error states with Hide/Show sheet music; selecting it toggles the setting and returns to the same state unchanged
- [ ] During Recording/Analyzing the menu offers no sheet-music item, and opening the menu never stops capture or registers as a tap
- [ ] The sheet-music setting persists across app restarts and does not affect recording counts or analysis
- [ ] Tap stops capture and sends exactly one attempt
- [ ] Stop/save produces a valid WAV with actual sample-rate normalization; source and normalized metadata match decoded audio
- [ ] Upload returns a usable server URL; both analysis and coaching receive the same attempt's WAV bytes, and coaching receives its matching Basic Pitch output
- [ ] Analysis finds a deliberate mistake and cites the correct note
- [ ] Strands/Gemini returns one evidence-grounded cue
- [ ] Coach returns validated mistake data; deterministic phone rendering highlights the expected/played key and supported duration difference without a visual-model call
- [ ] Quarter-note versus half-note and wrong-key fixtures render correctly; missing/extra notes and uncertain duration data do not create invented events
- [ ] History reproduces saved visuals without model calls or retained raw audio
- [ ] Renderer shows the correct key/pose; swipes and back work on hardware
- [ ] Results → Play again returns to Library; selecting the same or another passage and explicitly starting capture creates a new attempt
- [ ] Library and Results show total and per-passage recording counts derived from the saved attempt records
- [ ] Library/Results → History → selected past Results → History works without capture, resubmission, or count changes

### Phase 3: Reliability and delivery

- [ ] Noisy input produces uncertainty, not false confidence
- [ ] Network loss, duplicate taps, stale responses and Gemini failure recover cleanly
- [ ] Normalization failure, expired WAV URL and failure at either audio consumer preserve the attempt and show the correct stage; retries do not double-count
- [ ] Temporary WAV cleanup waits for both consumers or the agreed expiry; provider credentials and audio URLs are absent from client logs
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
- Sentry: proposed **Error Monitoring + Tracing** pair, with failed-attempt diagnosis and stage-by-stage latency evidence (Section 8); phone implementation and synthetic ingestion verified; backend work and confirmation of the two-service eligibility rule remain pending
- StepFun: deferred for v1; revisit only with a useful runtime role. Gemini-first v1 does not satisfy a StepFun integration requirement

Track selection is not proof of eligibility. Confirm final submission requirements and include only integrations actually used. Mentor discussion about the overall idea is marked complete; this does not imply approval of every feature.

## 12. Remaining choices

1. Frontend framework remains OPEN; app name is Encore and verified repository is timothyouu/encore, which contains the G2 app scaffold and this specification
2. Phone OS and actual G2 capture compatibility; G2 microphone capture has not been tested. Planned demo/test input is laptop-speaker recorded playback, visibly labeled as such. Live piano availability remains unconfirmed.
3. Exact Gemini model/version, pinned Strands/Even SDK versions
4. Hosted coaching provider, laptop endpoint method and who configures access
5. Validate the accepted local-history/temporary-audio policy on the actual Even WebView; review proposed count edge cases. Permanent playback and accounts remain outside v1.
6. Partner name; there is no third teammate
7. Final passage selection, timing tolerances and acceptable measured demo latency
8. Confirm deployment endpoint/access details and physical-device reachability; local WAV format and retention defaults are specified in Section 8. Cloud provisioning is outside this change.
9. Gemini audio-input encoding, validated mistake schema, and deterministic key/duration animation details; no separate visual model is planned
10. Sentry challenge wording and acceptance of Error Monitoring + Tracing as two qualifying services; project/runtime SDK choices, sampling/quota and telemetry-scrubbing verification

These choices and unresolved review issues must be resolved before treating this draft as build-ready; they must not silently become claims that implementation is complete. This revision incorporates the October 17 recording-page, two-model audio pipeline and deterministic visualization decisions while preserving the selection, Settings, recording-count, History and workstream boundaries. Proposed contract details remain subject to integration review.

## References

- [Granola: Recording page audio pipeline and visualization architecture — October 17, 2026](https://notes.granola.ai/d/32613d5d-34e4-4c80-bbf1-be861adc3f34)
- [Spotify Basic Pitch](https://github.com/spotify/basic-pitch)
- [Strands model providers](https://strandsagents.com/docs/user-guide/sdk/model-providers/)
- [Even Hub device APIs](https://hub.evenrealities.com/docs/build/device-apis)
- [Even Hub display guidance](https://hub.evenrealities.com/docs/build/display)
- [Even Realities LA Hacks resources](https://evenrealities-lahacks.vercel.app/)
- [LA Hacks sponsor tracks](https://live.lahacks.com/tracks)
