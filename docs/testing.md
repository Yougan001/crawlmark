# Verification

Run `npm ci` then `npm test` on Node 22.13+. Tests need no external website or credentials. The suite has 33 tests for parsing, robots, scoring, transport policy, streamed bounds, concurrency, sample, worker and loopback API. External DNS and outbound response streams are controlled in transport tests; the API and worker run for real.

Manual local check: entered `https://yougan001.github.io/rowglass/` through the browser form on 2026-09-05. The real Node API fetched it and displayed its actual title and 13 findings. The source-only report found no headings in that client-rendered page. This is not a rendered-browser audit.

Additional browser checks:

- Private target `http://127.0.0.1/` produces a clear rejection and no stale report.
- Cancelling an actual URL submission restores the controls, displays cancellation and leaves no previous report. The real Cancel button was clicked during the request.
- The sample returns 13 checks, score 81, 100% coverage and a noindex blocker. Needs-attention filtering shows exactly three findings.
- Actual JSON download was compared field-for-field with the core engine using `node scripts/verify-download.mjs`.
- A genuine 390px viewport has a 390px document width, without horizontal overflow. Desktop and mobile PNGs in `docs/images/` were captured and inspected from the real local page.
- Lint, TypeScript and the ordinary Windows static build pass. The Windows Pages-mode build exited 1 during client output without a diagnostic; it is not considered successful. Linux Pages CI is the release gate for the prefixed build.

Public API hosting is not configured yet. The static preview explicitly labels its sample and disables live inspection without an endpoint. Passing tests do not replace network isolation or deployment review.

Public deployment verified on 2026-09-05: Linux inspection tests and Pages build/deployment passed for `144557b`. The public `/crawlmark/` page loads its sample worker, reports score 81 with a noindex blocker, and filters to three attention findings. Canonical and favicon paths use the correct project prefix. Screenshots were then refreshed from this public preview. The real-URL control is visibly disabled with an explanation while no hosted API is configured.
