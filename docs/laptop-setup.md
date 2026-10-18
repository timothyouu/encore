# Encore laptop setup

Prepared October 18, 2026 on TIMOTHY_LG_GRAM (Windows PowerShell, Ubuntu-22.04 WSL).

## Running now

- Live phone/glasses simulator monitor: http://localhost:5260
- Shared phone + glasses development host: http://localhost:5173
- Local coaching backend: http://localhost:8788/health
- Local Basic Pitch service: http://localhost:8002/health
- Existing physical-device HTTPS service: https://timothylggram.tail51e140.ts.net

The monitor shows the actual official simulator framebuffer and its own phone WebView, with tap/swipe controls. It does not mirror a physical G2. Use the native simulator window for direct phone interaction. Ordinary Chrome does not supply the Even bridge.

The laptop backend on 8788 now enables Gemini by default using the authorized existing configuration, referenced by an ignored server/.env symlink to encore-audio-driven/server/.env. Real Basic Pitch is loaded. The monitor reads modelConfigured from backend health; configured status alone does not prove a particular attempt used Gemini. The separate existing backend on 8830 and physical-device service were preserved. Physical G2 microphone, Review/Guide, and persistence remain device acceptance steps; use the existing session token only in the session token field of the device app, never a URL. The device backend retains its existing exact WebView Origin (http://127.0.0.1:51684); a newly installed package may report a different Origin and need an explicit update.

## Restart after shutdown

Run these in two PowerShell terminals, keeping both open:

```powershell
wsl -d Ubuntu-22.04 -e bash -lc 'cd /home/tim/projects/encore-base && bash scripts/start-laptop.sh'
```

```powershell
wsl -d Ubuntu-22.04 -e bash -lc 'cd /home/tim/projects/encore-base && bash scripts/start-simulator.sh'
```

Open http://localhost:5260. Ctrl-C stops only the processes started by each launcher. Launchers refuse occupied ports and do not terminate unrelated services. They reuse existing approved Node dependencies and Python virtualenvs via symlinks; they do not install packages. The simulator launcher uses software rendering for this laptop's WSLg graphics. Its Ubuntu WebKit dependencies were installed with user approval.

Normal startup uses Gemini when configured. Add --fallback to start-laptop.sh only for an explicitly offline demo. Ordinary model failures retain the deterministic fallback; quota errors retain the existing stop behavior. Provider credentials stay backend-only. No model or billing configuration was changed.

These launchers cover the local stack. The preserved physical-device service on 5198/8799 and its existing Tailscale Funnel are separate; they were not replaced by the local simulator stack.

## Changes and preservation

Clean WSL encore-base was fast-forwarded from 80e2f51 to bcf2ebc, then switched to local branch codex/laptop-runtime. No commit or push.

- g2/vite.config.ts: loopback development, strict port, local API/health proxies; preview uses the existing authenticated device backend.
- mobile/src/capture.ts: allow null in the cached digest type, matching sha256's existing behavior when WebCrypto is absent. This fixes two upstream strict TypeScript build errors without changing hashing behavior.
- scripts/start-laptop.sh: local frontend, backend and Basic Pitch launcher, Gemini enabled by default with explicit --fallback support.
- scripts/start-simulator.sh and scripts/laptop-monitor.mjs: official simulator and live monitor launcher.
- Existing encore-device-verify/g2/vite.config.ts: added only /health to its existing API proxy; saved prior config in encore-local/device-vite-before-laptop-setup.txt and restarted the existing preview. The served package/dist and exact backend auth/CORS configuration were preserved.

The original Windows checkout, visualization files, historical WSL worktrees and running earlier audio previews were preserved. All 125 files in encore-local/laptop-preservation-before.json retained identical SHA-256 hashes after setup.

## Verification

- bash scripts/verify-storage.sh --include-g2: passed, 394 automated tests (38 server, 180 mobile, 17 analysis, 4 duration, 8 Paper, 134 G2, 8 shipping, 5 storage), required typechecks, builds and passage sync.
- git diff --check: passed after normalizing new files to LF.
- Synthetic 16 kHz G2-format PCM through local 8788 and existing HTTPS service: both passed normalization to 22,050 Hz PCM16 WAV, upload, duplicate artifact reuse, actual Basic Pitch 8/8 matched notes and fallback coaching. This is synthetic input, not physical recording.
- Simulator bridge, readable selection/Ready sheet display and back navigation: observed. Framebuffer PNGs require their alpha channel over a black background; the monitor preserves it.
- Existing HTTPS /health now returns JSON instead of the frontend HTML fallback. Unauthorized API requests still require the existing token; no CORS wildcard was added.

Logs and screenshots: /home/tim/projects/encore-base/.run/laptop-*. The complete automated log is .run/laptop-checks.log.

Official simulator reference: https://hub.evenrealities.com/docs/test/simulator

## Gemini activation verification

October 18: restarted the laptop stack and simulator with Gemini enabled. Backend and monitor health both returned modelConfigured=true. The existing live-model acceptance sent a synthetic P01 WAV with E4 changed to F4 through upload, real Basic Pitch, and real Gemini. It returned coachingSource=gemini in 4.5 seconds; phone result validation, Review/Guide transitions and History replay passed. This is generated audio, not physical piano or G2 capture. Evidence: .run/live-model-report.json and .run/live-model-response.json.

Server tests: 38 passed; server TypeScript checking, launcher Bash syntax, monitor JavaScript syntax and git diff --check passed. The earlier full-suite results above describe the original laptop setup; this provider activation changed launcher/monitor behavior only. No packages installed, commits, pushes or deployments.

## Phone QR retry, October 18

The user reported that scanning reached Even Hub but remained on a prototype screen. Restarted the existing frontend, verified its HTML/JS/CSS, then replaced the old 5eec25e packaged preview with the latest verified encore-base build (bcf2ebc-laptop-20261018) on the same existing port 5198 and HTTPS Funnel. Built with the approved HTTPS API origin. Source and old dist in encore-device-verify remain preserved. Backend 8799 and exact CORS/auth were unchanged and remain offline.

Current public preview command: cd /home/tim/projects/encore-base/g2 && node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5198 --strictPort

Fresh QR: https://timothylggram.tail51e140.ts.net/?launch=bcf2ebc-20261018 (encore-local/encore-phone-qr-restarted.png). Browser verified the displayed build identity and passage library. Actual phone/glasses launch remains pending user retry; desktop bridge errors are not evidence of a phone failure. A successful desktop fetch does not establish phone reachability.
