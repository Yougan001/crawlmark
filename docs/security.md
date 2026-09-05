# Inspection service boundaries

The API retrieves a public page on explicit user request, then the final origin's `/robots.txt`. This is a diagnostic fetch, not a crawler: it reports Googlebot rules but does not impersonate Googlebot. It never follows page links, loads assets, executes scripts or sends browser credentials. Only structured findings leave the API; it is not a raw-response proxy.

## Target and transport policy

- HTTP/HTTPS only, default ports only, no URL credentials, fragments stripped, 2,048-character input limit.
- Reject local/special-use hostnames, private and reserved IPv4 ranges, mapped/translation/tunnel IPv6 and non-global IPv6. The IPv6 policy also conservatively rejects the special-use `2001::/23` block and documentation ranges.
- Resolve all returned A/AAAA addresses. Reject the whole target if any address is not allowed. At most 32 DNS answers.
- Pin the chosen address into native Node HTTP(S) `lookup`, disable pooling and automatic family selection, retain TLS hostname/certificate verification, and compare the connected address to the pin. Resolving a hostname before ordinary `fetch()` would not provide this guarantee.
- Revalidate every redirect; stop after three, on loops, on ambiguous targets, and on HTTPS-to-HTTP downgrade.
- No incoming authorization, cookies, custom headers or environment HTTP proxy are forwarded. Outbound requests use GET.

The operating system and hosting network remain part of the trust boundary. Run without credentials or internal-service access. Use an egress firewall to deny private, metadata and management networks as a second layer. Application checks do not replace isolation, authentication or security review.

## Bounds

| Resource                    | Limit                                                        |
| --------------------------- | ------------------------------------------------------------ |
| API JSON / incoming headers | 4 KiB / 8 KiB                                                |
| HTML / robots response      | 2 MiB / 256 KiB                                              |
| Outbound response headers   | 16 KiB                                                       |
| Page / robots request       | 15 seconds / 5 seconds, including redirects                  |
| Inactive outbound socket    | 5 seconds                                                    |
| Complete API operation      | 25 seconds                                                   |
| HTML worker                 | 3 seconds; 96 MiB old-generation heap; 4 MiB stack           |
| Parsed HTML                 | 60,000 nodes; 256 nesting levels                             |
| JSON-LD                     | 40 blocks; 128 KiB and 10,000 visited values per block       |
| robots.txt                  | 16,000 lines; 4,000 rules; 2,048 characters per pattern      |
| Concurrent inspections      | 2 per process                                                |
| Quotas                      | 6 per connected IP per 10 minutes; 20 per process per minute |

Servers ignoring `Accept-Encoding: identity` are reported as unsupported. Compressed content is not decompressed without a bound. HTML is parsed in a disposable worker, not the HTTP event loop. HTML and URLs are not persisted by the application.

The 25-second operation deadline includes reading the incoming body. If that body is still incomplete, the service closes the connection and releases its inspection slot; the caller may see a connection reset rather than a JSON error. Once the body is complete, inspection timeouts return the structured `TIMEOUT` response.

## Hosting

`npm run api` binds **127.0.0.1:8787** by default. Non-loopback binding requires comma-separated `ALLOWED_HOSTS` (including the port, if present in Host) and `ALLOWED_ORIGINS` (full browser origins). `HOST` and `PORT` select the listener.

CORS and Host checks reduce browser misuse; neither authenticates arbitrary clients. Public instances need TLS, authentication or appropriate abuse controls, request-size limits and global quotas. In-memory rate limits are a small-instance safeguard, not distributed billing control. The API ignores `X-Forwarded-For`; behind a reverse proxy, clients share its IP quota unless an operator implements a separately verified trusted-proxy policy.

Never submit private/signed URLs. Query strings may contain secrets. Reports include inspected URLs, metadata and heading excerpts. Hosting providers and reverse proxies may have logs even though this application does not log URLs.

GitHub Pages cannot host the Node API. A static frontend can call a separately hosted HTTPS API. A Worker port must retain address pinning and TLS verification; ordinary `fetch()` after a DNS check is not equivalent.

The suite covers policy, DNS changes, redirects, native request options, streamed bounds, API routes and the real parser worker. Controlled response-stream tests are not penetration tests. See [testing.md](testing.md).
