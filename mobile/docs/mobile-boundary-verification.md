# Mobile-only boundary verification

October 17, 2026 (Pacific time).

## Intended outcome and consensus

Mobile work must render only the phone UI and must not control the glasses indirectly. Coordinator inspection and an independent Luna max audit agreed that the old `main.ts → connectDisplay` path violated this boundary: startup containers, text upgrades, shutdown, and gesture-driven capture were all implemented in `mobile/src/display.ts`. Mobile packaging also reused the glasses package ID. No evidence establishes that these calls actually reached physical hardware.

The audit covered first-party source, entrypoints, configuration, tests, and documentation in the nested Encore repository and outer workspace. Dependencies, secret files, images, and Git internals were excluded. The outer handoffs describe separate WSL implementations; those separate worktrees were not modified by this fix.

## Changes

- Removed mobile `display.ts`, its obsolete glasses tests, SDK/CLI/simulator dependencies and scripts, and the G2 app manifest. Pruned the lockfile to the remaining build dependency graph.
- Removed bridge boot, shutdown, gesture and connection-status wiring from `main.ts` and `phone.ts`, plus unused status CSS. Phone capture lifecycle cleanup remains.
- New captures accept only phone/demo sources. Existing historical G2 source labels remain readable as provenance.
- Added boundary tests covering source/imports, entrypoint/build configuration, known SDK/native bridge APIs, negative violation fixtures, package metadata and lockfile reachability.
- Added repository `AGENTS.md` and spec section 9 rules; corrected README/LOOP guidance and marked the earlier handoff's glasses adapter verification as historical. Preserved the user's pre-existing Settings specification edits.
- No changes under `g2/`, commits, pushes, installs, or deployments.

## Checks actually run

- Windows Node 22.16: `npm test`, **62 passed, 0 failed**.
- WSL Node 22.14: copied the final mobile source/config/tests to `/tmp/encore-mobile-boundary-20261018`, reused existing `/home/tim/projects/encore-mobile-ui/mobile/node_modules` via symlink, and ran `npm test`: **62 passed, 0 failed**.
- WSL `npm run build`: strict TypeScript and Vite production build passed. Rebuilt after the final unused-CSS removal.
- Built JavaScript scan found no known Even SDK/bridge/write markers. This and the source guard prevent known regressions; they are not a security proof against arbitrary future code.
- Chrome on isolated production preview port 5184: Library → First Steps preview → explicit demo start → stop → results → History → saved result → History. Saved result labeled read-only, completed count stayed at one. No captured console warnings/errors. Demo uses no microphone or service calls.
- `git diff --check` passed; `git diff -- g2` was empty.

Windows build initially could not run without local `node_modules`; WSL reuse resolved verification without installation. A clean dependency install was not performed. Physical G2, live phone microphone, and remote analysis/coaching services were not exercised. No remaining code decision blocks this mobile-only correction; any future device integration needs explicit scope and owner agreement.

## Orchestration record

Used astra-orchestration with Luna max for independent audit and Sol high for implementation; coordinator reviewed the actual diff and verified integration. Accepted three units: audit, mobile boundary removal/regression checks, and durable guidance. One focused review correction strengthened native-bridge and negative-fixture guards. Measurement interval 05:05:25–05:09:06 UTC excludes initial discovery and final handoff. Account-wide weekly usage moved 16% to 18% in the same 10080-minute window; other account activity is unknown, so the two-point change is not task-specific cost. No efficiency comparison is claimed.
