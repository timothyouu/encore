# Glasses score cleanup

October 18, 2026. Glasses rendering, 0.1.4 packaging, and backend service handoff.

The glasses replay drew every detected context note as an X, and generated ledger lines at detected pitches. Correct notes and extreme transcription pitches therefore cluttered the score.

All staff phases now retain the written score. Wrong-note Xs remain on the affected authored notehead. Missing notes retain a dashed slot. Extra-note Xs use an EXTRA lane at the detected beat, without detected-pitch ledger lines. Guide removes Xs. Normal ledger lines required by authored score pitches remain. Exact detected pitch is still available in the legend/keyboard.

Analysis visual JSON now accepts exactly one finding and at most one reference/detected evidence ID per card. Missing-note evidence cannot identify a detected note; extra-note evidence cannot identify a reference note. Surrounding sequence notes remain context. Both the JSON schema and runtime validator enforce this.

Changed files: `g2/src/review/art.ts`, `shared/visual-plan.ts`, `shared/visual-plan.schema.json`, `server/src/visual-plan.test.ts`, `acceptance/glasses-note-markers.browser.mjs`, and durable `AGENTS.md` guidance.

Verification:
- `bash scripts/verify-storage.sh --include-g2`: passed server/mobile/G2 tests, typechecks, builds, Python analysis/acceptance, contract and shipping/storage gates.
- `node acceptance/glasses-note-markers.browser.mjs`: 18 targeted frames and 122 gallery frames; zero browser errors. Extreme detected pitches (MIDI 21 and 108) produce identical score rasters; correct context gets no extra Xs; wrong X remains on its reference note; Guide removes Xs. Rendered PNG inspected.
- `npm --prefix g2 run pack -- https://timothylggram.tail51e140.ts.net`: passed. Local package includes uncommitted changes; build metadata marks the working tree dirty.
- `git diff --check`: passed.

The builds retain the existing Vite bundle-size warning. Physical-device verification is still required.

Device acceptance still needed: install the local package and compare wrong, missing, and extra-note Review/Guide pages, including replay. Check readability and retained score/ledger lines on the physical display.


## Version 0.1.4 package

App manifest, package metadata, and lockfile root version advanced to 0.1.4. App ID `com.encore.g2`, edition `202601`, SDK 0.0.16, minimum app 2.2.10, microphone permission and the single exact HTTPS whitelist origin are preserved.

Rebuilt using `npm --prefix g2 run pack -- https://timothylggram.tail51e140.ts.net`; typecheck, production build and packaging passed. Existing bundle-size warning remains. Compared existing service-token fingerprints before/after packaging; unchanged. The existing token was accepted through public HTTPS for WAV upload, duplicate-upload idempotency, Basic Pitch analysis (8/8 matched notes) and fallback coaching. Missing/wrong tokens return 401. Allowed local app origin preflight returns 204 with matching CORS allowance; unapproved origin receives no allowance. At packaging time the backend used fallback coaching. The Gemini enablement below is the current backend state.

Compiled assets contain the approved HTTPS origin and exact build ID, and do not embed the session token. The app still requires its existing token in the session field; reopening/reinstalling may require re-entry. The package does not restore an in-memory session token. Physical-device reconnection remains unverified.


## Gemini and managed services

The device runtime now loads the explicit server-side Gemini configuration and constructs the existing Gemini chooser. With the approved existing configuration, public HTTPS health reports modelConfigured=true. The credential file remains ignored by Git with mode 600; no credential or session-token value is committed. Offline mode remains available through ENCORE_OFFLINE=true.

The detached supervisor in scripts/device-services.py manages proxy 5198, authenticated backend 8799, and Basic Pitch 8012. Existing HTTPS port 443 and Funnel mapping to 5198 are unchanged. The existing token file and WebView-origin policy are preserved. The supervisor bounds crash retries, refuses to replace occupied ports, and was checked for idempotent startup and proxy recovery. It survives shell exit; after Windows or WSL shutdown, run python3 scripts/device-services.py start from the repository root. Inspect with python3 scripts/device-services.py status. This is a session supervisor, not a boot-enabled systemd service.

One authorized synthetic WAV test passed through public HTTPS upload, duplicate handling, real Basic Pitch, and Gemini coaching. The response reported coachingSource=gemini, evidence-bound visual cards, and about 3.7 seconds for coaching. The original 0.1.4 package checksum and packaged backend origin are unchanged; no reinstall is required for this server-side change. This verifies the API flow, not physical glasses capture.

After enablement, bash scripts/verify-storage.sh --include-g2 passed all 430 automated checks plus production builds/typechecks. The served preview was rebuilt with the original 0.1.4 service origin and build ID after verification.
