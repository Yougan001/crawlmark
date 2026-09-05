# Verification

Run `npm ci` then `npm test` on Node 22.13+. Tests need no external website or credentials. The suite has 43 tests for parsing, robots, scoring, transport policy, streamed bounds, concurrency, sample, worker, browser-client errors and loopback API. External DNS and outbound response streams are controlled in transport tests; the API and worker run for real.

Request-body regression tests use real loopback connections with a shortened operation deadline. Two continuously trickling bodies must close and free both inspection slots, for both Content-Length and chunked uploads; a subsequent normal request must succeed. Separate cases cover client disconnection during upload and a structured timeout after a complete body. The inspection function is controlled, so these tests make no outbound requests.

Manual local check: entered `https://yougan001.github.io/rowglass/` through the browser form on 2026-09-05. The real Node API fetched it and displayed its actual title and 13 findings. The source-only report found no headings in that client-rendered page. This is not a rendered-browser audit.

Additional browser checks:

- Private target `http://127.0.0.1/` produces a clear rejection and no stale report.
- Cancelling an actual URL submission restores the controls, displays cancellation and leaves no previous report. The real Cancel button was clicked during the request.
- The sample returns 13 checks, score 81, 100% coverage and a noindex blocker. Needs-attention filtering shows exactly three findings.
- Actual JSON download was compared field-for-field with the core engine using `node scripts/verify-download.mjs`.
- A genuine 390px viewport has a 390px document width, without horizontal overflow. Desktop and mobile PNGs in `docs/images/` were captured and inspected from the real local page.
- Lint, TypeScript and the ordinary Windows static build pass. The Windows Pages-mode build exited 1 during client output without a diagnostic; it is not considered successful. Linux Pages CI is the release gate for the prefixed build.

The public demo now connects to an HTTPS Node API on Render. The static build still disables live inspection when no endpoint is configured, and its local sample remains explicitly labeled. Passing tests do not replace network isolation or deployment review.

Initial sample-only deployment was verified on 2026-09-05 at `144557b`: the public `/crawlmark/` page loaded its sample worker, reported score 81 with a noindex blocker, and filtered to three attention findings. Canonical and favicon paths used the correct project prefix.

Live deployment was verified later the same day at frontend `484be37`, using the Node backend at `4b8b397`. GitHub tests, lint, typecheck, Pages build and deployment passed. The public URL form fetched `https://yougan001.github.io/rowglass/` through Render and displayed its actual title, a live-response label, 13 findings and score 86. One warm browser request took about 4.7 seconds; this is not a performance guarantee. Direct cross-origin health and inspection requests also succeeded, and a loopback target returned `BLOCKED_ADDRESS`.

The desktop and 390px mobile screenshots now show that live report. The mobile document width equals the 390px viewport. Needs-attention filtering reduces the visible list to three findings; the actual downloaded JSON still contains all 13 checks, the live URL, title and score 86.

The deployed form also rejected a loopback target with HTTP 400 and a readable private-address message, with no stale report. An earlier attempt encountered a transient network failure and displayed the retry message; the subsequent health request succeeded. Cancelling a real submission triggered `AbortError`, restored the controls and kept the cancellation message without an old report reappearing.

Client regression tests cover startup HTML instead of JSON, malformed responses, network failures, cancellation and rate limits without automatic POST retries. A full idle-to-cold-start timing measurement has not been performed; startup behavior is described using the hosting provider's documented limits, not a claimed benchmark.
