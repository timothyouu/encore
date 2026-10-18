# Segment and Review → Guide integration handoff

Outcome: integrate the Windows segment/navigation feature into WSL while preserving WSL's newer WAV pipeline, durable storage/retries, telemetry and constrained coaching.

Checkout: `/home/tim/projects/encore-ship`, local branch `codex/segment-review-guide`, based on current GitHub main `c0f29f8`. Implementation prepared for publication through a branch PR against main. Original Windows and other WSL worktrees were not replaced. Implementation verification used no package installs, secret-file reads, live provider calls or deployment.

## Decisions implemented

- Server validates Python Basic Pitch/alignment output, calculates authored affected-bar segments in shared TypeScript, and returns v2. WAV normalization, immutable upload artifact identity, expiry and retry paths are preserved.
- Top supported mistakes/segments come first; every affected bar and finding is still available beyond the three-card summary. Cross-bar notes have a pair per affected bar. Unlocated findings remain accessible without invented highlights.
- Phone and G2 use the same selected finding/bar pair. Forward/reverse navigation walks Review → Guide → next Review. Bar chips, Guide, focused sheet notation and saved History retain the corresponding evidence.
- Gemini still chooses only allowed finding/action/component IDs. Ordinary code constructs cue text, visuals and primary segment. No free-form model cue or model-generated location contract was adopted.
- Saved v1 History stays explicitly legacy, with no fabricated saved v2 locations. Malformed v2 ranges, IDs and reciprocal links fail validation.
- `spec.md`, root guidance and `glasses-integration/CONTRACT.md` describe this behavior; existing G2 OS menu and capture gestures remain in place.

## Verification and evidence

394 automated tests passed across the full verification runner and affected final reruns:

| Suite | Passed |
|---|---:|
| Server | 38 |
| Mobile | 180 |
| Python analysis | 17 |
| Duration acceptance | 4 |
| Paper contract | 8 |
| G2 | 134 |
| Combined shipping and storage integration | 13 |

Server strict typecheck, mobile/G2 strict typechecks and production builds, exact passage synchronization, and final whitespace checks passed. G2 emitted the existing nonfatal bundle-size warning (507.20 kB JS). The original full-run log is `.run/segments-full-check.log`; its stale uncertain-storage fixture initially failed because it carried musical findings. The fixture was corrected to represent a real non-ok response with no findings, constrained chooser assertions were strengthened, and the final combined 13 integration tests passed. Mobile and G2 suites/builds were rerun after their review fixes; unchanged Python/Paper/server checks were reused.

Real local Chromium flow: generated harmonic tones through Chromium's fake microphone → actual browser MediaRecorder and 22,050 Hz mono WAV normalization → upload → real Basic Pitch 0.4.0 → deterministic v2 segmentation → explicitly labeled offline fallback coaching → Review/Guide/Sheet → History and full reload. Six finding/bar pairs across bars 1 and 2 were visited in both navigation directions. Exactly one upload, analysis and coaching request occurred; History reload made no new inference requests. Browser errors and failed resource requests: zero. Evidence and inspected screenshots: `.run/segments/evidence.json`, `review.png`, `guide.png`, `sheet.png`, `history.png`.

The actual G2 controller/source/HTTP acceptance uses a fake bridge and checks one attempt ID, correct normalized bytes, no duplicate capture/submission, phase synchronization, saved read-only results and replay cancellation. G2 renderer browser fixture `g2/tests/segments-browser.html` was inspected for both bars with side-by-side Review/Guide; screenshots and fixture identities are in `.run/segments/g2-paired-bar*.png` and `g2-visual-check.json`. These are browser approximations of firmware text, not device evidence.

Independent integration review found two issues, both fixed and re-inspected: a valid unlocated-extra cue with null primary was rejected when other located findings existed; and G2 timing replay could substitute an unrelated contextual note after clipping the cited detection. Regressions exercise the actual server fallback and the exact bar-crossing replay case. No unresolved code blocker remained from review.

## Reproduce

From this WSL checkout, with existing dependencies:

```sh
ENCORE_OFFLINE=true bash scripts/verify-storage.sh --include-g2
node acceptance/segments.browser.mjs
```

The browser runner uses existing `/home/tim/Relay/node_modules/playwright/index.mjs` and `/usr/bin/google-chrome`; override with `ENCORE_PLAYWRIGHT` / `ENCORE_CHROME` when needed. It starts its own loopback services on free ports, disables Vite environment-file loading, constructs a key-free server directly, and stops only its own children. No existing preview processes are changed.

## Remaining acceptance limits

Physical piano/phone microphone quality, Even WebView persistence, physical G2 gesture/Bluetooth behavior and one-bar legibility are not established here. Gemini generation itself was not rerun against a live provider; its constrained request/output path is covered by unit and injected-chooser integration tests. When a measured event lies wholly outside the selected bar, the renderer uses a supported written comparison/text instead of moving that event or inventing a marker.

## Changed files

- `docs/segment-review-handoff.md`
- `AGENTS.md`
- `acceptance/shipping-pipeline.test.mjs`
- `acceptance/shipping-reconciliation.test.mjs`
- `acceptance/shipping-review.test.mjs`
- `acceptance/storage-server.test.mjs`
- `g2/README.md`
- `g2/src/controller.ts`
- `g2/src/feedback.ts`
- `g2/src/review/art.ts`
- `g2/src/review/model.ts`
- `g2/src/screens/review.ts`
- `g2/tests/controller.test.mjs`
- `g2/tests/feedback.test.mjs`
- `glasses-integration/CONTRACT.md`
- `mobile/index.html`
- `mobile/src/feedback.ts`
- `mobile/src/phone.css`
- `mobile/src/phone.ts`
- `mobile/src/session.ts`
- `mobile/tests/mobile-boundary.test.mjs`
- `scripts/sync-passages.mjs`
- `server/src/coaching.test.ts`
- `server/src/coaching.ts`
- `server/src/contracts.ts`
- `server/src/http.ts`
- `server/src/validation.ts`
- `shared/contracts.ts`
- `shared/passages.json`
- `shared/passages.ts`
- `spec.md`
- `acceptance/segments.browser.mjs`
- `g2/tests/segments-browser.html`
- `mobile/src/segments.ts`
- `mobile/tests/segment-review.test.mjs`
- `server/src/segments.test.ts`
- `shared/feedback.ts`
- `shared/segments.ts`
