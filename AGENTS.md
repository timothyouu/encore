# Project: Encore

## Project structure and ownership
- `mobile/` is Timothy's phone UI, phone microphone capture, session state, and history workstream.
- `glasses-integration/` documents the deferred device integration contract; it is not a runtime and mobile must not import it.
- `g2/` is the teammate's glasses UI, bridge, gestures, microphone, and display transport workstream. Mobile-only tasks must not edit it.
- `spec.md` describes the complete product; a glasses feature in that document does not authorize implementing it in `mobile/`.

## Architecture constraints
- Judge ownership by side effects, not file location. Code inside `mobile/` must never create, update, rebuild, or shut down glasses display containers, send graphics/text to glasses, or subscribe to glasses gestures.
- Do not import the Even Hub SDK, a G2 implementation, or a native glasses bridge into the mobile runtime. Do not restore a mobile display adapter, including behind a feature flag.
- Mobile screens, diagrams, demo results, and Settings controls render in the phone DOM only. Device preferences may be represented as phone-side data; actual device application requires a separately agreed contract and explicit authorization for the glasses workstream.
- Keep disconnected/unavailable integration status honest. A phone demo, a saved G2 capture-source label, or a proposed setting is not evidence of a connected device.
- Future integration must be reviewed with the glasses owner before implementation. Keep transport and device rendering in the glasses workstream; do not relocate offending mobile code into `g2/` during a mobile-only fix.

## Build and verification
From `mobile/`, using existing dependencies and Node 22.14+: `npm test` and `npm run build`.
Run the mobile boundary regression with the full session/capture suite. Verify the phone Library → preview → recording → results → History flow after changing boot or navigation. Check that `git diff -- g2` is empty for mobile-only changes.
Package installation requires explicit approval. Do not claim hardware verification from mocks or browser checks.

## Last updated
October 17, 2026: mobile-only ownership applies to indirect device writes as well as edits under `g2/`.
