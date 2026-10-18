# Mobile UI verification loop

Trigger: this supervised implementation request. No recurring automation.

Scope: `mobile/` phone UI, session state, phone capture controller and associated documentation. No glasses rendering, transport, gesture handling, SDK imports, or edits under `g2/`. File location does not authorize device side effects. Repository `AGENTS.md` and spec section 9 govern this boundary.

Acceptance units (fixed):
1. Paper-derived mobile library, preview, quiet capture, result carousel, correction and notation screens.
2. Persistent recording/history semantics, idempotence, cancellation, uncertainty, stale-response isolation and validation.
3. Browser-verified mobile navigation and recoveries, build/typecheck and independent regression tests.

Verifier: Node test runner for mobile/tests/*.test.mjs, TypeScript strict check and Vite build, followed by coordinator browser acceptance at 320/390/430 widths. After initial test submission, implementation workers may not edit tests or this methodology to make failures pass. Coordinator adds independently justified regressions; never weakens assertions to accept code.

Budget: three fix iterations after initial implementation. Stop on all gates passing, two identical failures without progress, or a dependency/access blocker. Report incomplete gates honestly. Do not claim live analysis, microphone capture or G2 hardware verification from demo fixtures.

Append iteration outcomes to docs/mobile-verification.md. No package installs until Tim approves the named existing locked dependency set. No credentials, deployment, commit or push.
