import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectHtml } from '../core/html.mjs';
import { evaluateRobots, robotsResult } from '../core/robots.mjs';
import { auditPage, extractDirectives, summarize } from '../core/audit.mjs';
import { inspectUrl, runAudit } from '../server/inspect.mjs';

export const cleanHtml =
  '<!doctype html><html lang="en"><head><title>A useful guide</title><meta name="description" content="A concise description."><link rel="canonical" href="https://example.com/guide"></head><body><h1>A useful guide</h1><h2>Start here</h2><p>Read this before making changes.</p></body></html>';
const check = (report, id) => report.checks.find((item) => item.id === id);

test('robots chooses matching agent groups without merging the wildcard group', () => {
  const text =
    'User-agent: *\nDisallow: /\nUser-agent: Googlebot\nDisallow: /private\nUser-agent: googlebot/2.1\nAllow: /private/public';
  assert.equal(
    evaluateRobots(text, 'https://example.com/hello').state,
    'allowed',
  );
  assert.equal(
    evaluateRobots(text, 'https://example.com/private').state,
    'blocked',
  );
  const result = evaluateRobots(text, 'https://example.com/private/public');
  assert.equal(result.state, 'allowed');
  assert.equal(result.line, 6);
});

test('robots ties allow, supports anchors and treats queries as part of the path', () => {
  const text =
    'User-agent: *\nDisallow: /*.php$\nDisallow: /fish\nAllow: /fish';
  assert.equal(
    evaluateRobots(text, 'https://example.com/a.php').state,
    'blocked',
  );
  assert.equal(
    evaluateRobots(text, 'https://example.com/a.php?x=1').state,
    'allowed',
  );
  assert.equal(
    evaluateRobots(text, 'https://example.com/fish').state,
    'allowed',
  );
  assert.equal(
    evaluateRobots(
      'User-agent: *\nDisallow: /a*b$c',
      'https://example.com/a/b$c',
    ).state,
    'blocked',
  );
});

test('robots handles percent-encoded UTF-8, unreserved escapes and reserved slashes', () => {
  const text =
    'User-agent: *\nDisallow: /中文\nDisallow: /path/~me\nDisallow: /a%2Fb';
  for (const path of ['/%E4%B8%AD%E6%96%87', '/path/%7eme', '/a%2fb'])
    assert.equal(
      evaluateRobots(text, `https://example.com${path}`).state,
      'blocked',
    );
  assert.equal(
    evaluateRobots(text, 'https://example.com/a/b').state,
    'allowed',
  );
});

test('empty rules still separate groups and sitemap lines do not', () => {
  const text =
    'User-agent: googlebot\nDisallow:\nUser-agent: otherbot\nDisallow: /';
  assert.equal(evaluateRobots(text, 'https://example.com/').state, 'allowed');
  assert.equal(
    evaluateRobots(
      'User-agent: googlebot\nSitemap: https://example.com/map.xml\nUser-agent: otherbot\nDisallow: /',
      'https://example.com/',
    ).state,
    'blocked',
  );
});

test('robots unavailable and throttled responses are unknown, ordinary 4xx permit crawling', () => {
  assert.equal(
    robotsResult({ status: 404 }, 'https://example.com').state,
    'allowed',
  );
  assert.equal(
    robotsResult({ status: 403 }, 'https://example.com').state,
    'allowed',
  );
  assert.equal(
    robotsResult({ status: 429 }, 'https://example.com').state,
    'unknown',
  );
  assert.equal(
    robotsResult({ status: 503 }, 'https://example.com').state,
    'unknown',
  );
  assert.equal(
    evaluateRobots('User-agent: *\nDisallow: /bad%xx', 'https://example.com')
      .state,
    'unknown',
  );
});

test('source extraction does not execute scripts or count hidden/template text', () => {
  const page = inspectHtml(
    '<title>Fish &amp; chips</title><body><h1>Hello <em>world</em></h1><p hidden>secret</p><p aria-hidden="true">hidden</p><script>globalThis.hacked = true</script><template><h1>Fake</h1></template><noscript>fallback</noscript><svg><text>vector</text></svg><img alt=""><img></body>',
  );
  assert.equal(page.titles[0].value, 'Fish & chips');
  assert.deepEqual(
    page.headings.map((heading) => heading.value),
    ['Hello world'],
  );
  assert.equal(page.bodyCharacters, 10);
  assert.equal(globalThis.hacked, undefined);
  assert.deepEqual(page.images, { total: 2, missingAlt: 1, emptyAlt: 1 });
});

test('JSON-LD is parsed but never treated as schema validation', () => {
  const page = inspectHtml(
    '<script type="application/ld+json">{"@graph":[{"@type":"Article"}]}</script><script type="application/ld+json">{broken}</script>',
  );
  assert.equal(page.jsonLd[0].valid, true);
  assert.deepEqual(page.jsonLd[0].types, ['Article']);
  assert.equal(page.jsonLd[1].valid, false);
  assert.throws(() => inspectHtml('<div>'.repeat(260)), /256-level/);
  assert.throws(() => inspectHtml('x'.repeat(2 * 1024 * 1024 + 1)), /2 MiB/);
});

test('other-bot X-Robots-Tag restrictions do not leak into Googlebot directives', () => {
  const directives = extractDirectives(
    [],
    [
      'otherbot: noindex, nofollow',
      'googlebot: max-snippet: 0, noindex',
      'index',
    ],
  );
  assert.deepEqual(directives, ['max-snippet: 0', 'noindex', 'index']);
  const report = auditPage({
    url: 'https://example.com/guide',
    html: cleanHtml,
    headers: { 'x-robots-tag': ['otherbot: noindex'] },
  });
  assert.equal(check(report, 'index').state, 'pass');
});

test('restrictive metadata wins over index and catches snippet restrictions', () => {
  const report = auditPage({
    url: 'https://example.com/guide',
    status: 200,
    html: cleanHtml.replace(
      '</head>',
      '<meta name="robots" content="index"><meta name="googlebot" content="NONE, nosnippet"></head>',
    ),
  });
  assert.equal(check(report, 'index').state, 'fail');
  assert.equal(check(report, 'snippet').state, 'fail');
  assert.deepEqual(report.summary.blockers, ['index']);
});

test('a complete clean fixture scores only eligible checks and is not penalized for absent JSON-LD', () => {
  const report = auditPage({
    url: 'https://example.com/guide',
    status: 200,
    html: cleanHtml,
    robots: { status: 404 },
    checkedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(report.summary.score, 100);
  assert.equal(report.summary.coverage, 100);
  assert.equal(check(report, 'jsonld').state, 'not-applicable');
  assert.equal(report.page.title, 'A useful guide');
  assert.match(report.limits.join(' '), /not a universal GEO score/);
});

test('unknown findings never become passes or get a fabricated zero score', () => {
  assert.deepEqual(
    summarize([{ id: 'unknown', weight: 5, state: 'unknown' }]),
    { score: null, coverage: 0, assessed: 0, eligible: 1, blockers: [] },
  );
  const report = auditPage({
    url: 'https://example.com/guide',
    html: cleanHtml,
  });
  assert.equal(check(report, 'http').state, 'unknown');
  assert.equal(check(report, 'robots').state, 'unknown');
  assert.ok(report.summary.coverage < 100);
});

test('relative canonical respects base URLs and HTTP Link conflicts remain unknown', () => {
  const html =
    '<head><base href="https://example.com/docs/"><link rel="canonical" href="guide"></head>';
  assert.equal(
    check(
      auditPage({ url: 'https://example.com/docs/guide', html }),
      'canonical',
    ).state,
    'pass',
  );
  assert.equal(
    check(
      auditPage({
        url: 'https://example.com/docs/guide',
        html,
        headers: { link: ['<https://example.org>; rel=canonical'] },
      }),
      'canonical',
    ).state,
    'unknown',
  );
  assert.equal(
    check(
      auditPage({
        url: 'https://example.com',
        html: '<link rel="canonical" href="javascript:alert(1)">',
      }),
      'canonical',
    ).state,
    'fail',
  );
});

test('the real isolated worker returns a report and accepts cancellation', async () => {
  const result = await runAudit({
    url: 'https://example.com/guide',
    html: cleanHtml,
  });
  assert.equal(result.page.title, 'A useful guide');
  const controller = new AbortController();
  controller.abort();
  assert.throws(
    () => runAudit({ url: 'https://example.com', html: '' }, controller.signal),
    { name: 'AbortError' },
  );
});

test('inspection combines response, final-origin robots and worker analysis', async () => {
  const calls = [];
  const result = await inspectUrl('https://example.com/old', {
    fetch: async (url) => {
      calls.push(url);
      if (url.endsWith('/robots.txt'))
        return { status: 404, body: Buffer.from('Missing'), headers: {} };
      return {
        status: 200,
        url: 'https://example.com/guide',
        body: Buffer.from(cleanHtml),
        headers: { 'content-type': ['text/html; charset=utf-8'] },
        redirects: [{ status: 301, url, target: 'https://example.com/guide' }],
      };
    },
  });
  assert.deepEqual(calls, [
    'https://example.com/old',
    'https://example.com/robots.txt',
  ]);
  assert.equal(result.summary.score, 100);
  assert.equal(result.redirects.length, 1);
});
