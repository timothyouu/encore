# Project: Encore

## Project structure and ownership
- `mobile/` is Timothy's phone UI, phone microphone capture, session state, and history workstream.
- `glasses-integration/` documents the shared phone/G2 integration contract; it is not a runtime and mobile must not import it.
- `g2/` is the teammate's glasses UI, bridge, gestures, microphone, and display transport workstream. Mobile-only tasks must not edit it.
- `spec.md` describes the complete product; a glasses feature in that document does not authorize implementing it in `mobile/`.

## Architecture constraints
- Judge ownership by side effects, not file location. Code inside `mobile/` must never create, update, rebuild, or shut down glasses display containers, send graphics/text to glasses, or subscribe to glasses gestures.
- Do not import the Even Hub SDK, a G2 implementation, or a native glasses bridge into the mobile runtime. Do not restore a mobile display adapter, including behind a feature flag.
- The G2 host may import the phone app and share its SessionStore and recording pipeline. Imports flow G2 to mobile only; G2 owns capture drivers, gestures, and display effects. Do not add a second upload pipeline or History store in G2.
- Mobile screens, diagrams, demo results, and Settings controls render in the phone DOM only. Device preferences may be represented as phone-side data; actual device application requires a separately agreed contract and explicit authorization for the glasses workstream.
- Keep disconnected/unavailable integration status honest. A phone demo, a saved G2 capture-source label, or a proposed setting is not evidence of a connected device.
- Future integration must be reviewed with the glasses owner before implementation. Keep transport and device rendering in the glasses workstream; do not relocate offending mobile code into `g2/` during a mobile-only fix.

## Feedback integration
- WSL is the source of truth. Preserve the shared WAV artifact pipeline, temporary-audio retries, history persistence and telemetry when integrating phone or G2 feedback.
- New server results carry validated v2 bar segments; retain explicit legacy v1 History support without inventing saved locations. Use shared segment calculation and feedback ordering for phone and G2.
- Save all supported findings and let the phone scroll every mistake. Limit glasses feedback to the ten most important distinct mistakes: missing, extra, wrong pitch, onset timing, then duration; rank timing/duration by absolute deviation. Keep every selected finding/bar pair accessible. Anchor timing to the first reliably matched played note, preserving missed opening notes and the WAV clock. Review and Guide share one finding/bar selection; forward navigation is Review → Guide → next Review, with the reverse path on back navigation.
- A clearly detected piano phrase may contain mostly wrong pitches. Use supported beat correspondence to report wrong/missing notes when exact pitches cannot anchor it; do not label that case unclear audio solely for a reference mismatch. Keep silence, weak evidence, capture faults and unresolved multiple-take ambiguity gated.
- Glasses wrong-note Xs annotate the affected written notehead in the visible score; keep the bar underneath during review/replay. Show the clean written correction in Guide. Detected pitch/time remains available in the legend and keyboard detail.
- Gemini selects only allowed finding/action/component IDs. Code constructs cue text, visual evidence and segment selection; do not move musical measurements or range calculation into model output.

## Build and verification
From `mobile/`, using existing dependencies and Node 22.14+: `npm test` and `npm run build`.
Run the mobile boundary regression with the full session/capture suite. Verify the phone Library → preview → recording → results → History flow after changing boot or navigation. Check that `git diff -- g2` is empty for mobile-only changes.
For explicitly authorized shared integration changes, run `bash scripts/verify-storage.sh --include-g2`; retain the phone boundary tests and verify G2 Review paging/replay cancellation independently.
Package installation requires explicit approval. Do not claim hardware verification from mocks or browser checks.

## Last updated
October 17, 2026: mobile-only ownership applies to indirect device writes as well as edits under `g2/`.
