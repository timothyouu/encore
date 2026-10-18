# Encore mobile handoff

## Current mobile-only boundary correction — October 17, 2026

The earlier implementation record below is historical and includes a now-removed glasses adapter. It must not be used as permission to restore device control in the mobile app.

Repo-wide audit found an unconditional `main.ts → connectDisplay` path: `display.ts` created a G2 page, upgraded its text, listened to glasses gestures, and could shut the page down. Calling this adapter optional or mobile-side was incorrect. The mobile manifest also reused the G2 package ID. These paths and mobile Even Hub dependencies/packaging have been removed; `g2/` is unchanged.

The current app owns phone DOM/SVG, phone microphone capture, demo fixtures, session state, and local History only. Historical G2 provenance can still be displayed without controlling a device. Phone-side preferences do not imply physical G2 settings have been applied. Repository `AGENTS.md` and spec section 9 define the durable side-effect boundary.

Current checks and final regression counts are recorded in `mobile-boundary-verification.md`. From the current checkout use `cd mobile`, `npm test`, and `npm run build` with approved existing dependencies. The older worktree paths, display-test count, and SDK browser warning below are historical evidence only.

## Outcome and location

Implemented the phone companion in the existing strict TypeScript/Vite app. Implementation was prepared on `codex/mobile-ui` in `/home/tim/projects/encore-mobile-ui`, an isolated WSL worktree based on `91ab3de`. The original Windows checkout remains unchanged. No app deployment was performed. The later authorized branch publication and merge are tracked by the shipping PR.

Run with Node 22.14 or newer:

```sh
cd /home/tim/projects/encore-mobile-ui/g2
npm test
npm run build
npm run dev -- --host 0.0.0.0 --port 5174
```

Dependencies were installed with the user's explicit approval using the existing lockfile. No new dependency packages were added. Development server was left running at http://localhost:5174.

## Sources and decisions

- Repository `spec.md` fetched/current at `91ab3de`; scope is phone selection, preview, capture, results, guide and read-only History.
- Notion Musical Instrument Coach (`3fc34afeaa2b8063827fdc09b4d5c4d1`) read in Chrome after connector access failed. Its older retry/improvement language conflicts with the newer spec; implemented the spec's return-to-Library behavior.
- Paper file: https://app.paper.design/file/01M56HHCC29GHEHZ2V9FPV5FTR/p-1-0 (G2 Mobile App). Exported exact JSX/styles for Library, Review, Guide and carousel instructions into `docs/paper/`. Reused existing Paper & Keys tokens. Added editable Preview, History and uncertain-audio recovery artboards to that same file and inspected screenshots.
- Plain TypeScript preserves the scaffold and avoids unnecessary framework dependencies. Completed capture counts once, including processing errors. Canceled/interrupted captures do not count. Browser-local metadata/results only; no raw audio persistence or accounts.

## Files

- `mobile/src/phone.ts`, `phone.css`, `index.html`: responsive Paper-derived UI, search, previews, quiet recording, cancel confirmation, finding carousel, deterministic keyboard and notation, History, errors, accessible dialogs and reduced-motion styling.
- `mobile/src/passages.ts`, `session.ts`: six approved versioned passages, validation, state transitions, durable attempt records, count and stale-response protection.
- `mobile/src/main.ts`, `connection.ts`: app boot, explicitly labeled demo driver, optional endpoint configuration and phone capture routing.
- `mobile/src/capture.ts`: explicit microphone acquisition, actual MediaRecorder encoding, 30-second capture bound, 5-second recorder-finalization bound, 30-second service request bounds, lifecycle cleanup, response validation. Full analysis and coaching endpoint URLs are entered in Connection settings and retained only for this page session.
- `mobile/src/display.ts`: nonblocking SDK display adapter, gesture envelope routing, cancellation confirmation, read-only result mirroring, serial/coalesced text updates. G2 guide is a text key schematic, not the phone's graphical SVG rendering.
- `mobile/tests/*.test.mjs`, `mobile/package.json`: built-in Node test runner; no added test dependencies.
- `LOOP.md`: bounded loop contract and immutable-verifier rule for implementation workers.

## Verification

Final automated result: **81 tests passed, 0 failed** (13 capture, 23 display, 45 session). `npm run build` passed TypeScript strict checks and Vite production bundling. `git diff --check` passed.

Tests use fake microphone/bridge/network objects, not real devices or hosted services. They cover exact seed data, silence/uncertainty validation, unknown references, invalid coaching, duplicate stops, completed-count semantics, canceled/interrupted attempts, corrupted/unavailable storage, reload recovery, stale responses, read-only History, finding bounds, MIME/metadata forwarding, permission failures and races, cancel/dispose cleanup, service failures, gesture envelopes, display queue bounds, and phone/G2 finding ordering.

Browser checks in Chrome:

- 390px library/preview → explicit start → stop → processing → three-finding result: passed.
- Reload → History → saved result: passed, count unchanged and saved identity visible.
- Finding 2 → correction → sheet → return: passed; selection and Guide origin preserved.
- Play again → Library, search match and no-match: passed.
- Cancel confirmation → Library: passed; count unchanged.
- Unclear-audio fixture: passed; no musical judgment or correction claimed.
- Processing-error fixture: passed; completed attempt remains saved and counted.
- Empty endpoint configuration cannot enable real recording: passed.
- 320px Guide and 430px uncertainty layout: no horizontal page overflow; vertical scrolling retained. 390px main flow visually reviewed.
- Console: no application errors observed; expected SDK warning in ordinary Chrome that the Flutter handler is unavailable.

## Loop record

Three fixed acceptance units from LOOP.md accepted locally: mobile screens, session semantics, and integrated verification. Initial implementation passed its tests; three bounded correction rounds resolved coordinator and independent-review findings without weakening existing assertions:

1. Paper result-card fidelity, notation pitch/rest rendering, dialog focus restoration; capture permission navigation and recorder finalization errors.
2. G2 lifecycle microphone cleanup and consistent ordering for unsorted service findings, with independent regressions.
3. Late rejected permission request cannot interrupt a newer capture; provenance labels and navigation scroll/beat consistency.

Workers used Sol high for session/display, phone UI and capture; independent review used Astra high. Coordinator inspected changes and ran integrated gates. Measurement interval started 2026-10-18 04:29:59 UTC and stopping snapshot was 04:42:37 UTC (12m38s; excludes initial source discovery). Weekly allowance moved 5% to 13%, an observed account-wide +8 percentage points, not attributable solely to this task. No comparative efficiency claim.

## Live integration limitations

- Demo mode simulates capture and analysis and is visibly labeled. Its test recordings remain in this browser's local history.
- Real phone microphone/service flow is implemented and mock-tested but not exercised with live permission/audio or reachable services. Configure HTTPS endpoints with compatible multipart audio decoding and CORS/auth before using on a phone. Provider keys remain server-side.
- No Basic Pitch/Strands/Gemini backend was created or invoked in this mobile workstream. No secrets were read.
- G2 microphone capture belongs to the hardware workstream and is not implemented here. Actual gestures, exit semantics, display readability, Bluetooth behavior and Even Hub packaging still require hardware validation.
- History is local to this browser/device, with a visible warning on storage failure. It is not cross-device progress tracking.

## Your steps

- Supply reachable analysis and coaching endpoints in Connection settings for live phone testing.
- Verify microphone permission/encoding on the target phone and run a physical G2 acceptance pass with the teammate's capture implementation.

## Separation and shipping follow-up

Moved the complete companion application to `mobile/` at the user's request. Restored all initial `g2/` changes before fast-forwarding the branch to `c54da4f`, preserving the teammate's new glasses passage-selection work. The phone app uses port 5174 to avoid the glasses scaffold's port 5173. Validation and merge outcome are recorded in the shipping PR.
