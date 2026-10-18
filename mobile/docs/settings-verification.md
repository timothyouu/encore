# Paper settings update verification

## Current merge reconciliation

The sections below describe historical pre-reconciliation implementation evidence. The final PR removes the mobile display adapter, score-image renderer, and associated glasses tests to preserve main's ownership boundary. Their historical tests are not part of the final phone suite. Future integration is documented separately in `glasses-integration/README.md`; `g2/` remains unchanged. Settings clearly states preferences are phone-local and not applied to glasses.

Final combined verification: 98/98 mobile tests pass (session, capture, Settings, and mobile-boundary), strict TypeScript/Vite build passes, and staged diff whitespace check passes. Existing boundary tests were retained unchanged. Browser verification covers Settings toggles/return, Library, preview, demo recording, processing, results, and History. Real hardware and service capture remain deferred.

Outcome: implement the latest G2 Mobile App Paper gears, Settings artboard and recording layout within `mobile/`. Branch: `codex/mobile-settings`, based on main `af94bc3`. No `g2/` files changed.

## Implementation

- `src/phone.ts`, `phone.css`: exact Paper gear SVG, Settings layout, accessible switches and size radios, keyboard navigation/focus restoration, precise return to prior page and finding, revised recording layout, truthful connection/demo labels.
- `src/settings.ts`: validated independent local preferences, defaults and migration, corrupt/unavailable storage handling; no changes to attempts or recording counts.
- `src/main.ts`, `connection.ts`: shared settings instance, microphone-busy guard, hide deployment controls while Settings is open.
- `src/display.ts`, `score-image.ts`: long press/release handling, preloaded static notation, size/names preferences, failed/pending upload fallback and latest-text reconciliation.
- `docs/paper/settings-update/`: source exports from Paper file 01M56HHCC29GHEHZ2V9FPV5FTR, including Settings 14Y-1.

## Loop evidence

Baseline: 81 tests. Existing tests remained unchanged. Coordinator added 36 settings cases; display worker added 11 targeted cases. Submitted assertions were retained during corrections.

1. Initial implementation: 117 tests and strict build passed. Browser found switch naming; explicit label associations added.
2. Independent review/browser: fixed focus restoration, missing C4 ledger, radio arrow navigation and Large notation scaling. Added score geometry and all-six-passage cases.
3. Deferred image review: recording/processing text was blocked by image upload. Added a priority text queue and regression before image resolution.
4. Cancellation review: Library text could remain stale during upload. Extended priority updates to all states and added cancel regression.
5. Completion-order review: delayed priority text could overwrite a newer page. Drain priority writes before normal reconciliation; exact delayed Recording/Analyzing/Library regression added. Independent reviewer reran both races and confirmed the correct final page.

Final coordinator run: `npm test`: 128 tests, 128 pass, 0 fail/cancelled/skipped. `npm run build`: strict TypeScript and Vite production build pass. `git diff --check` passes.

## Browser checks

Chrome at localhost:5174: switch off disables size/names; preferences survive reload; Space toggles and preserves focus; arrow selection updates radio state and roving tab order. Settings returns to the exact filtered Library query and saved finding 2 of 3. Demo recording and processing disable Settings, then a completed demo appears in History. Settings interactions do not increment its count. Settings document widths match 320, 390 and 430 pixel viewports without horizontal overflow. Screenshot visually checked at normal viewport; temporary viewport override reset. No captured error-level console messages in final check.

## Remaining hardware verification

Actual G2 image decoding, readability and BLE timing are not verified. Renderer uses 288x144 raw grayscale values 0/15, based on the installed SDK README grayscale-byte contract and the Even Realities glasses UI reference. An already-started image call cannot be canceled; no new image call starts during recording, and its container is cleared/replaced after settlement. Recording status can update while an image is pending. Real microphone/service capture was not exercised in this change; its mocked regression tests pass.

Reference: https://github.com/even-realities/everything-evenhub/blob/main/plugins/everything-evenhub/skills/glasses-ui/SKILL.md

Orchestration: two bounded Sol implementation workers and independent Astra review. Four acceptance units satisfied locally; hardware limitation above remains explicit. Measured interval began 05:04:09 UTC on 2026-10-18; at 05:11:27 weekly account usage moved from 15% to 19%. This is account-wide, not attributable cost or a workflow benchmark.
