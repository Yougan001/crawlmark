import { parse } from 'parse5';

const HTML_NS = 'http://www.w3.org/1999/xhtml';
const excluded = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'svg',
  'canvas',
]);
const short = (value, limit = 500) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
const attrs = (node) =>
  Object.fromEntries((node.attrs ?? []).map((attr) => [attr.name, attr.value]));

function textContent(node) {
  const parts = [];
  const stack = [node];
  let size = 0;
  while (stack.length && size < 4000) {
    const current = stack.pop();
    if (current.nodeName === '#text') {
      parts.push(current.value);
      size += current.value.length;
    } else if (!excluded.has(current.tagName))
      stack.push(...(current.childNodes ?? []).toReversed());
  }
  return short(parts.join(''));
}

export function inspectHtml(html) {
  if (
    typeof html !== 'string' ||
    new TextEncoder().encode(html).length > 2 * 1024 * 1024
  )
    throw new Error('HTML exceeds the 2 MiB analysis limit.');
  const document = parse(html, {
    scriptingEnabled: true,
    sourceCodeLocationInfo: true,
  });
  const result = {
    titles: [],
    descriptions: [],
    canonicals: [],
    bases: [],
    robots: [],
    headings: [],
    jsonLd: [],
    images: { total: 0, missingAlt: 0, emptyAlt: 0 },
    language: '',
    viewport: '',
    bodyCharacters: 0,
    scriptCount: 0,
    noSnippetElements: 0,
  };
  const stack = [{ node: document, body: false, excluded: false, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const entry = stack.pop();
    const { node, depth } = entry;
    if (++nodes > 60000 || depth > 256)
      throw new Error(
        'HTML exceeds the 60,000-node or 256-level analysis limit.',
      );
    const tag = node.namespaceURI === HTML_NS ? node.tagName : undefined;
    const attributes = attrs(node);
    const line = node.sourceCodeLocation?.startLine ?? null;
    const body = entry.body || tag === 'body';
    const hidden =
      entry.excluded ||
      excluded.has(node.tagName) ||
      Object.hasOwn(attributes, 'hidden') ||
      attributes['aria-hidden'] === 'true';
    const inHead = node.parentNode?.tagName === 'head';
    if (tag === 'html') result.language = short(attributes.lang, 100);
    if (tag === 'title' && inHead)
      result.titles.push({ value: textContent(node), line });
    if (tag === 'meta') {
      const name = attributes.name?.toLowerCase();
      if (name === 'description' && inHead)
        result.descriptions.push({ value: short(attributes.content), line });
      if (name === 'robots' || name === 'googlebot')
        result.robots.push({
          agent: name,
          value: short(attributes.content, 2000),
          line,
        });
      if (name === 'viewport' && inHead)
        result.viewport = short(attributes.content);
    }
    if (
      tag === 'link' &&
      inHead &&
      attributes.rel?.toLowerCase().split(/\s+/).includes('canonical')
    )
      result.canonicals.push({ value: short(attributes.href, 2048), line });
    if (tag === 'base' && inHead && Object.hasOwn(attributes, 'href'))
      result.bases.push({ value: short(attributes.href, 2048), line });
    if (tag && /^h[1-6]$/.test(tag) && !hidden)
      result.headings.push({
        level: Number(tag[1]),
        value: textContent(node),
        line,
      });
    if (tag === 'img' && !hidden) {
      result.images.total++;
      if (!Object.hasOwn(attributes, 'alt')) result.images.missingAlt++;
      else if (!attributes.alt.trim()) result.images.emptyAlt++;
    }
    if (tag === 'script') {
      result.scriptCount++;
      if (attributes.type?.toLowerCase() === 'application/ld+json') {
        const value = (node.childNodes ?? [])
          .map((child) => child.value ?? '')
          .join('');
        if (result.jsonLd.length >= 40 || value.length > 128 * 1024)
          throw new Error(
            'Structured data exceeds the 40-block or 128 KiB-per-block analysis limit.',
          );
        let valid = true;
        const types = new Set();
        try {
          const parsed = JSON.parse(value);
          const queue = [parsed];
          let seen = 0;
          while (queue.length) {
            const item = queue.pop();
            if (++seen > 10000) throw new Error('Large JSON-LD');
            if (item && typeof item === 'object') {
              for (const type of [item['@type']].flat())
                if (typeof type === 'string') types.add(short(type, 100));
              queue.push(...Object.values(item));
            }
          }
        } catch {
          valid = false;
        }
        result.jsonLd.push({ valid, types: [...types].slice(0, 20), line });
      }
    }
    if (
      tag &&
      ['div', 'span', 'section'].includes(tag) &&
      Object.hasOwn(attributes, 'data-nosnippet')
    )
      result.noSnippetElements++;
    if (node.nodeName === '#text' && body && !hidden)
      result.bodyCharacters += short(node.value, html.length).length;
    const children = node.childNodes ?? [];
    for (let index = children.length - 1; index >= 0; index--)
      stack.push({
        node: children[index],
        body,
        excluded: hidden,
        depth: depth + 1,
      });
  }
  if (
    result.headings.length > 1000 ||
    result.robots.length > 100 ||
    result.canonicals.length > 100 ||
    result.titles.length > 100 ||
    result.descriptions.length > 100
  )
    throw new Error('HTML contains too many metadata or heading entries.');
  return result;
}
