# Paper settings verification loop

Trigger: user-requested Paper mobile update. Worktree: codex/mobile-settings, based on latest main af94bc3. Modify mobile/ only; g2/ is read-only.

Acceptance units:
1. Exact Paper gear SVG, Settings controls and updated recording styling with truthful connection/provenance.
2. Validated, persistent display preferences independent of attempts; settings return to the precise prior UI state and cannot interrupt recording/processing.
3. Preferences affect static sheet rendering and mobile-side G2 integration, with no notation transfers initiated during capture; graceful disconnected/failed transport behavior.
4. Existing regression suite, new targeted edge-case tests, strict build, browser interaction checks and independent review pass.

Verifier: existing tests are locked. Coordinator owns new settings tests; workers may add isolated tests initially, then submitted tests are locked during fix iterations. Never remove assertions or change configuration to conceal failures. Test recording counts, cancellation, history, malformed storage, no-op/invalid settings, long-press release, race/lifecycle behavior and responsive controls.

Loop budget: five focused correction rounds or 45 minutes. Same failure twice without progress triggers diagnosis and report rather than a third identical retry. Continue independent work around any external hardware blocker. Stop when all local acceptance criteria pass; disclose untested hardware and live services. No recurring automation or deployments.

Append each submitted verification/correction outcome to docs/settings-verification.md. Initial baseline: 81 tests passing. Account usage start 15% weekly window, reset 1792881562; measurement start 2026-10-18 05:04:09 UTC. Counters are account-wide, not task-attributed.

## Final scope correction

User authorized separating deferred device integration while preserving the mobile-only boundary. Acceptance unit 3 now covers local phone preferences and previews only; actual device application is deferred in ../glasses-integration/README.md. All glasses transport/image code and its tests were removed from mobile. Final verification is 98 passing combined mobile tests plus strict build and browser flow; earlier 128-test results describe the superseded implementation.
