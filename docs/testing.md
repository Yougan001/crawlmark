# Verification

Run `npm ci` then `npm test` on Node 22.13+. Tests need no external website or credentials. The initial suite has 31 tests for parsing, robots, scoring, transport policy, streamed bounds, worker and loopback API. External DNS and outbound response streams are controlled in transport tests; the API and worker run for real.

Manual local check: entered `https://yougan001.github.io/rowglass/` through the browser form on 2026-09-05. The real Node API fetched it and displayed its actual title and 13 findings. The source-only report found no headings in that client-rendered page. This is not a rendered-browser audit.

Public API hosting is not configured yet. The interface is being verified for a separate source/deployment stage. Passing tests do not replace network isolation or deployment review.
