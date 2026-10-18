# Encore feedback and audio release

## Behavior

- Save every supported finding in phone History. Review includes a scrollable **All mistakes** list with direct selection.
- Glasses Review/Guide show at most ten distinct mistakes, retaining their affected bars. The glasses map navigation to the full phone list and stop at their selected set.
- Rank missing notes, extra notes, wrong pitches, timing and duration in that order. Larger absolute timing/duration deviations come first. Keep severity ahead of bar grouping.
- Infer note correspondence, then use the first matched played note as the fixed timing anchor. Preserve original WAV timestamps, missed opening notes and leading unmatched extras.
- Basic Pitch uses `piano-sensitive-v1`: onset 0.35, frame 0.20, minimum note length 90 ms and the piano frequency range. Quiet playing is checked in 100 ms windows. Brief clipping warns; severe clipping, capture gaps and invalid audio still block grading.
- Allow aligned performances with several wrong notes to receive feedback. Require 60% pair coverage, at least 35% correct-pitch anchors (minimum two), and unambiguous alignment. Preserve weak unmatched detections in raw evidence without accusing the player of extra notes.

## Package identity

Even Hub version **0.1.3** replaces **0.1.2**. This client update anchors wrong-note Xs to the affected written notehead, retains the score in Review/replay, removes the marker in Guide, and increases staff/ledger visibility. The manifest, npm package and lockfile agree. `npm run pack -- https://timothylggram.tail51e140.ts.net` builds the package using the existing installed CLI and writes `g2/out.ehpk`. The adjacent `package-build.json` records package version, source revision, build ID, service origin, byte count and SHA-256. Generated packages and real configuration remain outside Git.

The EHPK contains the phone/glasses client. Python tuning runs in the analysis backend and is identified by its `/health` detector version. Update that backend when applying this release to another machine.

## Verification

Run from the repository root using existing dependencies:

```bash
bash scripts/verify-storage.sh --include-g2
analysis/.venv/bin/python -m analysis.calibration_smoke
node acceptance/mistake-limit.browser.mjs
node acceptance/glasses-note-markers.browser.mjs
```

The detector acceptance covers clean, quiet, noisy, hum, wrong-note, noise-only and silent synthetic inputs. The browser acceptance covers all twenty fixture findings, scrolling, last-item selection and History reload. Both are reproducible local checks, not evidence of physical microphone or glasses behavior. Duration measurements and the new sensitivity thresholds remain provisional pending labeled acoustic recordings.
