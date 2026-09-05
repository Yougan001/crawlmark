# Crawlmark

A small URL inspection service for technical SEO and content-access reviews. Get evidence, a transparent checklist score and a fix list from one public page — without pretending to know its ranking or citation probability.

**Current stage:** the engine and Node API are available. The browser interface is being tested locally. A public hosted API is not available yet; GitHub Pages cannot run the URL-fetching backend.

## What it inspects

- Final HTTP status and redirect chain.
- Googlebot robots.txt rules, noindex and snippet restrictions in HTML and response headers.
- Canonical hints, title, description, source headings and text availability.
- Existing JSON-LD syntax and image alt attributes.
- Thirteen checks with evidence, a next step and reference links. Unknowns lower coverage, not the score. Blocking restrictions remain visible regardless of score.

This is a **single-response, source-only** inspection. It does not execute scripts, measure Core Web Vitals, check search-index membership, audit backlinks or certify schemas. See [the scoring method](docs/method.md).

## Run the API

Node 22.13+ is required.

```sh
npm ci
npm test
npm run api
```

The default listener is `127.0.0.1:8787`. Send `POST /api/inspect` with `Content-Type: application/json` and a body such as:

```json
{ "url": "https://example.com/" }
```

The response is a versioned JSON report. Errors have `{ "error": { "code", "message" } }`. `GET /health` returns the service name and API version. No inspection history is stored.

## Network boundaries

Only public HTTP/HTTPS on default ports. Private/special-use addresses are rejected, every DNS answer is validated, and the connection is pinned to a checked IP with TLS hostname verification. Each redirect is checked again. Requests, response bodies, parse time and concurrency are bounded.

The API is **local-only by default**. Before exposing it, read [security and deployment notes](docs/security.md): use network isolation, TLS and appropriate authentication/abuse controls. CORS is not authentication. Never submit private links, credentials or signed URLs.

## Development

`core/` contains deterministic report logic. `server/` owns network access, quotas and disposable parser workers. `tests/` includes policy, streaming and API regressions. The UI will be published as a separate stage.

For bug reports, include sanitized HTML/robots examples, expected behavior and the actual finding. Never post secrets or private URLs in issues. [Testing notes](docs/testing.md) distinguish fixtures from real browser checks.

MIT licensed. Dependency licenses remain in their packages; see [third-party notices](THIRD_PARTY_NOTICES.md).
