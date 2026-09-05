# How a report is scored

Crawlmark examines one initial HTML response and a fresh robots.txt response. It is not a rendered browser, search-index lookup or full-site crawl. A challenge page or soft 404 can return HTTP 200; the report does not certify it as the intended content.

Each finding has evidence, a next step, reference and state:

- Pass: the specific observation met this rule; full weight.
- Review: a person should check it; half weight.
- Issue: an explicit restriction or invalid value; zero weight.
- Unknown: unavailable or unsupported evidence; excluded from the score, counted against coverage.
- Not applicable: an absent optional feature; excluded from both denominators.

Score is `round(100 × earned weight / assessed weight)`, absent if nothing was assessed. Coverage is `round(100 × assessed weight / eligible weight)`. HTTP failures, robots disallow and noindex are independently flagged as blockers. A high partial score cannot cancel a blocker.

| Category | Check                           | Weight |
| -------- | ------------------------------- | -----: |
| Access   | Successful response             |     20 |
| Access   | HTTPS                           |      5 |
| Access   | Googlebot robots.txt permission |     15 |
| Access   | No noindex restriction          |     20 |
| Access   | HTML canonical                  |     10 |
| Content  | No full-snippet prohibition     |     10 |
| Content  | Title                           |     15 |
| Content  | Description                     |      5 |
| Content  | Main heading                    |     10 |
| Content  | Source text availability        |     15 |
| Content  | Heading outline                 |      5 |
| Content  | Existing JSON-LD parseability   |      5 |
| Content  | Image alt attributes            |      5 |

Weights are project-defined review priorities, not search-engine weights. Missing descriptions/canonical hints are suggestions, not mandatory indexing requirements. Multiple H1s, short titles, low word counts, decorative empty alt text and absent JSON-LD are not automatically errors.

## Interpretation limits

- robots.txt uses fresh responses, not Google's cache. Supported matching includes selected Googlebot groups, wildcard fallback, merged matching groups, case-sensitive paths, `*`, trailing `$`, percent-encoded UTF-8, longest matches and Allow ties. Oversized/unsupported encodings remain unknown. Ordinary 4xx except 429 mean no restrictions under Google's rules; transient/network failures remain unknown here.
- The request identifies itself as Crawlmark. A website may send different content to another agent, location or logged-in user.
- Meta robots and applicable X-Robots-Tag restrictions are combined. `unavailable_after` needs manual review. Standalone-page noindex remains a restriction with `indexifembedded`.
- Canonicals resolve against the first HTML base but are not fetched. Multiple canonicals need review. Canonical HTTP Link headers make the check unknown because header conflict resolution is not implemented.
- Text excludes scripts, styles, templates, noscript, SVG/canvas and explicit hidden/aria-hidden nodes. CSS visibility, quality and JavaScript rendering are not assessed. It is an availability count, not a content-length target.
- JSON-LD checks parsing/size, not schema, factual accuracy, rendered-content correspondence, eligibility or rich-result approval.
- Content/extractability can inform a GEO review, but does not predict citations. No `llms.txt` or special file is required or scored. [Google's guidance](https://developers.google.com/search/docs/appearance/ai-features) says existing SEO fundamentals apply and no special machine-readable files or schema are needed for its relevant search features.

References: [robots.txt interpretation](https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec), [robots metadata](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag), [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html), [Node HTTP custom lookup](https://nodejs.org/docs/latest-v22.x/api/http.html#httprequestoptions-callback).
