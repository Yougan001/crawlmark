const encoder = new TextEncoder();

function normalizePath(value) {
  return Array.from(value, (char) =>
    char.codePointAt(0) > 127 ? encodeURIComponent(char) : char,
  )
    .join('')
    .replace(/%[0-9a-f]{2}/gi, (escape) => {
      const char = String.fromCharCode(parseInt(escape.slice(1), 16));
      return /^[a-z0-9._~-]$/i.test(char) ? char : escape.toUpperCase();
    });
}

function matches(pattern, path) {
  const anchored = pattern.endsWith('$');
  const parts = (anchored ? pattern.slice(0, -1) : pattern).split('*');
  if (!path.startsWith(parts[0])) return false;
  let position = parts[0].length;
  for (let index = 1; index < parts.length; index++) {
    const part = parts[index];
    if (anchored && index === parts.length - 1)
      return path.endsWith(part) && path.length - part.length >= position;
    const found = path.indexOf(part, position);
    if (found < 0) return false;
    position = found + part.length;
  }
  return !anchored || position === path.length;
}

export function evaluateRobots(text, input, agent = 'googlebot') {
  if (typeof text !== 'string' || encoder.encode(text).length > 256 * 1024)
    return {
      state: 'unknown',
      reason: 'robots.txt exceeds the 256 KiB analysis limit.',
    };
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  if (lines.length > 16000)
    return {
      state: 'unknown',
      reason: 'robots.txt exceeds the 16,000-line analysis limit.',
    };
  const groups = [];
  let group;
  let rules = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].split('#')[0].trim();
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (!group || group.hasRules) {
        group = { agents: [], rules: [], hasRules: false };
        groups.push(group);
      }
      group.agents.push(
        value.toLowerCase().split(/[/*]/)[0] || (value === '*' ? '*' : ''),
      );
    } else if (key === 'allow' || key === 'disallow') {
      if (!group) continue;
      group.hasRules = true;
      if (!value || !value.startsWith('/')) continue;
      if (
        ++rules > 4000 ||
        value.length > 2048 ||
        /%(?![a-f0-9]{2})/i.test(value)
      )
        return {
          state: 'unknown',
          reason:
            'robots.txt has rules outside the supported size or URL-encoding limits.',
        };
      const pattern = normalizePath(value);
      group.rules.push({
        allow: key === 'allow',
        pattern,
        line: index + 1,
        length: pattern.replace(/\$$/, '').replace(/%[A-F0-9]{2}/g, 'x').length,
      });
    }
  }
  const specific = groups.filter((item) =>
    item.agents.includes(agent.toLowerCase()),
  );
  const applicable = specific.length
    ? specific
    : groups.filter((item) => item.agents.includes('*'));
  const url = new URL(input);
  const path = normalizePath(url.pathname + url.search);
  let winner;
  for (const rule of applicable.flatMap((item) => item.rules)) {
    if (
      matches(rule.pattern, path) &&
      (!winner ||
        rule.length > winner.length ||
        (rule.length === winner.length && rule.allow))
    )
      winner = rule;
  }
  return {
    state: winner && !winner.allow ? 'blocked' : 'allowed',
    group: specific.length ? agent.toLowerCase() : '*',
    rule: winner
      ? `${winner.allow ? 'Allow' : 'Disallow'}: ${winner.pattern}`
      : null,
    line: winner?.line ?? null,
    reason: winner
      ? 'The longest matching rule wins; Allow wins a tie.'
      : 'No matching disallow rule was found in the selected group.',
  };
}

export function robotsResult(response, url) {
  if (!response || response.error)
    return {
      state: 'unknown',
      reason: response?.error ?? 'robots.txt was not retrieved.',
    };
  if (
    response.status >= 400 &&
    response.status < 500 &&
    response.status !== 429
  )
    return {
      state: 'allowed',
      rule: null,
      line: null,
      reason: `robots.txt returned HTTP ${response.status}. Google treats this response as no crawl restrictions.`,
    };
  if (response.status < 200 || response.status >= 300)
    return {
      state: 'unknown',
      reason: `robots.txt returned HTTP ${response.status}; cached crawler behavior cannot be inferred.`,
    };
  if (typeof response.text !== 'string')
    return {
      state: 'unknown',
      reason: 'robots.txt was not a readable plain-text response.',
    };
  return evaluateRobots(response.text, url);
}
