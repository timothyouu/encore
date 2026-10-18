# JSON-driven Paper visualizations

Source: [G2 Glasses Mockup, Mistake animations](https://app.paper.design/file/01M56HDQ3W1XEMMPDXTW7HM2VB/p-2-0). All twelve cards and their replay states were inspected. The source inventory records the board IDs. The renderer uses a 576 x 288 SVG viewport, black/green palette, expected solid and detected hollow markers, and bounded text.

## Data flow

1. Phone captures or imports WAV and saves the attempt identity and passage version.
2. Strands invokes the Basic Pitch analysis tool. Alignment produces measured findings and reference/detected note IDs.
3. `shared/visual-plan.ts` deterministically constructs at most three priority-ordered cards. Unclear audio overrides musical judgments.
4. Gemini chooses an allowed finding/action/component via JSON. Server validation rejects unsupported choices; server code constructs the summary and cue from measured facts. Gemini does not generate SVG, HTML, pitches, timing measurements, or visualization code.
5. `CoachingResult.visualPlan` travels with the response. Phone validates it against a freshly derived plan before storing it. Older saved results without this optional field derive the same view locally.
6. `mobile/src/paper-renderer.ts` renders static, detected, correction, and resolved frames. Replay returns to static; reduced motion remains static. History reads saved analysis and coaching without another model call.

## Files to use with your teammate

- `shared/visual-contract.ts`: TypeScript format.
- `shared/visual-plan.schema.json`: JSON Schema for editors and integrations.
- `shared/visual-examples.json`: complete editable example plans and variants.
- `shared/visual-plan.ts`: runtime validation, priority and evidence-to-card mapping.
- `mobile/src/paper-renderer.ts`: deterministic geometry and replay lifecycle.
- `mobile/visualizations.html`: gallery with example selector, JSON input, validation and reduced motion.

Run `cd mobile && npm run dev`, then open `http://127.0.0.1:5176/visualizations.html`. Select an example, edit its JSON, and apply it to preview. A new Paper design should specify its kind/variant, required measurements, expected/detected states, static frame, three replay frames, and a reduced-motion state. Add its contract, validation, renderer and fixture together. Never use a design example as evidence that a player made that mistake.

The six core live kinds are wrong note, missing note, extra note, timing, duration and unclear audio. Tempo drift, uneven rhythm, unexpected pause, sound during rest, repeated/skipped sections and recurring trouble are renderable fixture examples only. They need validated detectors or history aggregation before live use. Self-correction/swapped-order/noise-specific variants are also examples, not new live detection claims. No fabricated noise meters are shown.

Beat positions in JSON are zero-based; displayed beats are one-based. Durations and timing deltas use beats derived from attempt tempo. Source thresholds remain design proposals; this change does not recalibrate the scorer. The phone is a preview, not a G2 device transport: the teammate-owned g2 bridge and device code remain untouched. Actual glasses rendering and live Gemini calls require separate verification.

## Verification

Run `bash scripts/verify.sh` from the worktree root. It checks server and mobile tests/typechecks/build, Python analysis and acceptance tests, locked Paper acceptance tests, passage synchronization and the g2 ownership boundary. See `verification.md` for the executed results and review corrections.