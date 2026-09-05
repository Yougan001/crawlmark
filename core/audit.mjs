import { inspectHtml } from './html.mjs';
import { robotsResult } from './robots.mjs';

const sources = {
  robots:
    'https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec',
  directives:
    'https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag',
  canonical:
    'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
  content:
    'https://developers.google.com/search/docs/fundamentals/seo-starter-guide',
  structured:
    'https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data',
};

export function extractDirectives(metadata, headerLines = []) {
  const directives = [];
  const parameterNames = new Set([
    'max-snippet',
    'max-image-preview',
    'max-video-preview',
    'unavailable_after',
  ]);
  for (const line of headerLines) {
    let applies = true;
    for (const piece of line.toLowerCase().split(',')) {
      let token = piece.trim();
      const prefix = /^([\w-]+)\s*:\s*(.*)$/.exec(token);
      if (prefix && !parameterNames.has(prefix[1])) {
        applies = prefix[1] === 'googlebot';
        token = prefix[2];
      }
      if (applies) directives.push(token);
    }
  }
  for (const item of metadata)
    directives.push(
      ...item.value
        .toLowerCase()
        .split(/[,;]/)
        .map((value) => value.trim()),
    );
  return directives;
}

export function summarize(checks) {
  const weighted = checks.filter(
    (check) => check.weight > 0 && check.state !== 'not-applicable',
  );
  const known = weighted.filter((check) => check.state !== 'unknown');
  const totalWeight = weighted.reduce((sum, check) => sum + check.weight, 0);
  const knownWeight = known.reduce((sum, check) => sum + check.weight, 0);
  const earned = known.reduce(
    (sum, check) =>
      sum +
      check.weight *
        (check.state === 'pass' ? 1 : check.state === 'review' ? 0.5 : 0),
    0,
  );
  return {
    score: knownWeight ? Math.round((100 * earned) / knownWeight) : null,
    coverage: totalWeight ? Math.round((100 * knownWeight) / totalWeight) : 0,
    assessed: known.length,
    eligible: weighted.length,
    blockers: checks
      .filter((check) => check.blocking && check.state === 'fail')
      .map((check) => check.id),
  };
}

/** @param {import('./report').AuditInput} input */
export function auditPage({
  url,
  status = null,
  headers = {},
  html = null,
  robots = null,
  redirects = [],
  checkedAt = new Date().toISOString(),
  mode = 'live',
}) {
  const page = html === null ? null : inspectHtml(html);
  const checks = [];
  const add = (
    id,
    group,
    title,
    state,
    weight,
    evidence,
    action,
    source = sources.content,
    blocking = false,
  ) =>
    checks.push({
      id,
      group,
      title,
      state,
      weight,
      evidence,
      action,
      source,
      blocking,
    });
  const inaccessible = 'The HTML was not available for this check.';
  const directives = page
    ? extractDirectives(page.robots, headers['x-robots-tag'])
    : extractDirectives([], headers['x-robots-tag']);
  const noindex = directives.some(
    (value) => value === 'noindex' || value === 'none',
  );
  const expires = directives.some((value) =>
    value.startsWith('unavailable_after:'),
  );
  const snippetBlocked = directives.some(
    (value) => value === 'nosnippet' || /^max-snippet\s*:\s*0$/.test(value),
  );
  const robotsCheck = robotsResult(robots, url);

  add(
    'http',
    'access',
    'Successful HTML response',
    status === null
      ? 'unknown'
      : status >= 200 && status < 300
        ? 'pass'
        : 'fail',
    20,
    status === null
      ? 'No HTTP response was checked.'
      : `The final response was HTTP ${status}. This is not a soft-404 check.`,
    'Serve the intended public page with a successful response. Review error, login and challenge pages separately.',
    sources.content,
    true,
  );
  add(
    'https',
    'access',
    'Encrypted final URL',
    new URL(url).protocol === 'https:' ? 'pass' : 'review',
    5,
    `The final URL uses ${new URL(url).protocol.slice(0, -1).toUpperCase()}.`,
    'Serve the public version over HTTPS and redirect HTTP to it.',
  );
  add(
    'robots',
    'access',
    'Googlebot robots.txt access',
    robotsCheck.state === 'allowed'
      ? 'pass'
      : robotsCheck.state === 'blocked'
        ? 'fail'
        : 'unknown',
    15,
    robotsCheck.rule
      ? `${robotsCheck.rule} (line ${String(robotsCheck.line)}, group ${String(robotsCheck.group)}). ${robotsCheck.reason}`
      : robotsCheck.reason,
    'If the page should be crawled, review the matching robots.txt rule. Crawl permission does not guarantee indexing.',
    sources.robots,
    true,
  );
  add(
    'index',
    'access',
    'No explicit noindex restriction',
    noindex ? 'fail' : !page || expires ? 'unknown' : 'pass',
    20,
    noindex
      ? 'A robots meta tag or applicable X-Robots-Tag contains noindex/none.'
      : expires
        ? 'An unavailable_after rule needs a date-aware manual review.'
        : page
          ? 'No noindex/none was found in the fetched HTML or applicable response headers.'
          : inaccessible,
    'Remove noindex only if this page is meant to be public in search. Keep intentional privacy and staging restrictions.',
    sources.directives,
    true,
  );
  add(
    'snippet',
    'content',
    'No explicit full-snippet restriction',
    snippetBlocked ? 'fail' : page ? 'pass' : 'unknown',
    10,
    snippetBlocked
      ? 'An applicable nosnippet or max-snippet:0 directive was found.'
      : page
        ? `No full-snippet prohibition found. ${page.noSnippetElements} data-nosnippet element(s); partial limits and licenses still apply.`
        : inaccessible,
    'Review preview restrictions only when they conflict with your publishing intent. Snippet availability does not predict citations.',
    sources.directives,
  );

  let canonicalState = page ? 'review' : 'unknown';
  let canonicalEvidence = page
    ? 'No canonical link was found in the document head.'
    : inaccessible;
  let resolvedCanonical = null;
  if (page?.canonicals.length) {
    if (page.canonicals.length > 1)
      canonicalEvidence = `${page.canonicals.length} canonical links were found; review competing signals.`;
    else {
      try {
        const base = page.bases.length
          ? new URL(page.bases[0].value, url)
          : new URL(url);
        const target = new URL(page.canonicals[0].value, base);
        if (
          !page.canonicals[0].value ||
          !['http:', 'https:'].includes(target.protocol) ||
          target.username ||
          target.password
        )
          throw new Error('Invalid canonical');
        resolvedCanonical = target.href;
        canonicalState = target.href === new URL(url).href ? 'pass' : 'review';
        canonicalEvidence = `${target.href.slice(0, 2048)}${target.hash ? ' — contains a fragment' : ''}. The target was not fetched.`;
      } catch {
        canonicalState = 'fail';
        canonicalEvidence =
          'The canonical or base URL could not be resolved to an HTTP/HTTPS URL without credentials.';
      }
    }
  }
  if (headers.link?.some((line) => /\bcanonical\b/i.test(line))) {
    canonicalState = 'unknown';
    canonicalEvidence +=
      ' A canonical signal also occurs in an HTTP Link header; header conflict resolution is not implemented.';
  }
  add(
    'canonical',
    'access',
    'Clear HTML canonical signal',
    canonicalState,
    10,
    canonicalEvidence,
    'Use one preferred absolute URL when duplicate versions exist. A different canonical can be intentional; this is a hint, not an indexing directive.',
    sources.canonical,
  );

  const title = page?.titles[0]?.value ?? '';
  add(
    'title',
    'content',
    'One descriptive page title',
    !page ? 'unknown' : page.titles.length === 1 && title ? 'pass' : 'review',
    15,
    page
      ? `${page.titles.length} title element(s).${title ? ` First: “${title}”` : ' No non-empty title found.'}`
      : inaccessible,
    'Give this page one specific title in the head. Human review is still needed for relevance; there is no enforced character-count target.',
  );
  add(
    'description',
    'content',
    'Page description',
    !page
      ? 'unknown'
      : page.descriptions.length === 1 && page.descriptions[0].value
        ? 'pass'
        : 'review',
    5,
    page
      ? `${page.descriptions.length} description meta tag(s).${page.descriptions[0]?.value ? ` First: “${page.descriptions[0].value}”` : ''}`
      : inaccessible,
    'Add a useful, page-specific summary where appropriate. Search engines may choose a different snippet.',
  );
  const h1s = page?.headings.filter((heading) => heading.level === 1) ?? [];
  add(
    'h1',
    'content',
    'A readable primary heading',
    !page
      ? 'unknown'
      : h1s.some((heading) => heading.value)
        ? 'pass'
        : 'review',
    10,
    page
      ? `${h1s.length} visible-in-source H1 heading(s). Multiple H1s are not automatically an error.`
      : inaccessible,
    'Make the main topic clear with a meaningful heading. Check the rendered outline; hidden styles are not computed.',
  );
  add(
    'text',
    'content',
    'Text available in the initial HTML',
    !page ? 'unknown' : page.bodyCharacters > 0 ? 'pass' : 'review',
    15,
    page
      ? `${page.bodyCharacters.toLocaleString('en-US')} text characters after per-node whitespace normalization, excluding scripts, styles, templates and explicit hidden nodes. CSS visibility and JavaScript rendering were not evaluated.`
      : inaccessible,
    'Ensure useful content is available to your intended crawlers. A text count measures availability, not quality or ranking potential.',
  );
  const emptyHeadings =
    page?.headings.filter((heading) => !heading.value).length ?? 0;
  const skips =
    page?.headings.filter(
      (heading, index, all) =>
        index > 0 && heading.level > all[index - 1].level + 1,
    ).length ?? 0;
  add(
    'outline',
    'content',
    'Heading outline worth reading',
    !page
      ? 'unknown'
      : !page.headings.length
        ? 'not-applicable'
        : skips || emptyHeadings
          ? 'review'
          : 'pass',
    5,
    page
      ? `${page.headings.length} heading(s); ${skips} skipped level(s); ${emptyHeadings} empty heading(s).`
      : inaccessible,
    'Check that headings describe their sections in a useful order. These are editorial review hints, not search-engine requirements.',
  );
  const invalidJson = page?.jsonLd.filter((block) => !block.valid).length ?? 0;
  add(
    'jsonld',
    'content',
    'Parseable existing JSON-LD',
    !page
      ? 'unknown'
      : !page.jsonLd.length
        ? 'not-applicable'
        : invalidJson
          ? 'review'
          : 'pass',
    5,
    page
      ? `${page.jsonLd.length} JSON-LD block(s); ${invalidJson} invalid or beyond analysis limits. No schema, eligibility, factual or rendered-content validation is performed.`
      : inaccessible,
    'Fix malformed JSON if you use structured data, then check the appropriate schema and eligibility rules. Missing JSON-LD is not penalized.',
    sources.structured,
  );
  add(
    'alt',
    'content',
    'Image alternative-text attributes',
    !page
      ? 'unknown'
      : !page.images.total
        ? 'not-applicable'
        : page.images.missingAlt
          ? 'review'
          : 'pass',
    5,
    page
      ? `${page.images.total} image(s); ${page.images.missingAlt} without alt; ${page.images.emptyAlt} with empty alt. Empty alt can be correct for decorative images.`
      : inaccessible,
    'Describe meaningful images and use empty alt for purely decorative ones. Attribute presence does not prove accessibility.',
  );

  const report = {
    version: 1,
    mode,
    checkedAt,
    url,
    status,
    redirects,
    summary: summarize(checks),
    groups: Object.fromEntries(
      ['access', 'content'].map((group) => [
        group,
        summarize(checks.filter((check) => check.group === group)),
      ]),
    ),
    checks,
    page: page
      ? {
          title,
          canonical: resolvedCanonical,
          headings: page.headings.slice(0, 200),
          headingCount: page.headings.length,
          bodyCharacters: page.bodyCharacters,
          jsonLd: page.jsonLd,
          robots: page.robots,
        }
      : null,
    limits: [
      'One initial HTML response, not a JavaScript-rendered browser or full-site crawl.',
      'No search-index lookup, rank prediction, backlink audit, Core Web Vitals measurement or citation-probability estimate.',
      'The checklist weights are project-defined. Unknown checks are excluded from the score and lower coverage.',
      'No special GEO file is required or scored. Content access and structure are reported as evidence, not a universal GEO score.',
    ],
  };
  return report;
}
