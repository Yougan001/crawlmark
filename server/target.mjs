import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { InspectionError } from './errors.mjs';

const forbiddenSuffixes = [
  'localhost',
  'local',
  'internal',
  'intranet',
  'lan',
  'home',
  'home.arpa',
  'test',
  'invalid',
  'onion',
];
const globalV6 = ipaddr.parseCIDR('2000::/3');
const specialV6 = ['2001::/23', '2002::/16', '3fff::/20'].map((range) =>
  ipaddr.parseCIDR(range),
);

export function isPublicAddress(value) {
  if (!isIP(value)) return false;
  const address = ipaddr.parse(value);
  if (address.range() !== 'unicast' || address.zoneId) return false;
  return (
    address.kind() === 'ipv4' ||
    (address.match(globalV6) &&
      !specialV6.some((range) => address.match(range)))
  );
}

export function normalizeTarget(input) {
  if (
    typeof input !== 'string' ||
    !/^https?:\/\//i.test(input) ||
    input.length > 2048 ||
    Array.from(input).some(
      (char) =>
        char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || char === '\\',
    )
  ) {
    throw new InspectionError(
      'INVALID_URL',
      'Enter a complete HTTP or HTTPS URL without spaces (at most 2,048 characters).',
    );
  }
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new InspectionError(
      'INVALID_URL',
      'Enter a complete HTTP or HTTPS URL.',
    );
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new InspectionError(
      'UNSUPPORTED_URL',
      'Only public HTTP/HTTPS URLs on their default ports, without credentials, are supported.',
    );
  }
  const host = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (isIP(host)) {
    if (!isPublicAddress(host))
      throw new InspectionError(
        'BLOCKED_ADDRESS',
        'Private, local and special-use addresses cannot be inspected.',
      );
  } else if (
    !host.includes('.') ||
    forbiddenSuffixes.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    ) ||
    !/^[a-z0-9.-]+$/.test(host)
  ) {
    throw new InspectionError(
      'BLOCKED_HOST',
      'Use a public, fully qualified hostname. Local and special-use names are not supported.',
    );
  }
  url.hostname = isIP(host) === 6 ? `[${host}]` : host;
  url.hash = '';
  return url;
}

export function withAbort(promise, signal) {
  signal?.throwIfAborted();
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function resolveTarget(url, { resolve = lookup, signal } = {}) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const family = isIP(hostname);
  const records = family
    ? [{ address: hostname, family }]
    : await withAbort(resolve(hostname, { all: true, verbatim: true }), signal);
  signal?.throwIfAborted();
  if (
    !records.length ||
    records.length > 32 ||
    records.some(
      (record) =>
        !isPublicAddress(record.address) ||
        isIP(record.address) !== record.family,
    )
  ) {
    throw new InspectionError(
      'BLOCKED_DNS',
      'The hostname did not resolve exclusively to supported public addresses.',
    );
  }
  return records.find((record) => record.family === 4) ?? records[0];
}

export function pinnedLookup(record) {
  return (_hostname, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    if (options?.all) callback(null, [{ ...record }]);
    else callback(null, record.address, record.family);
  };
}

export function sameAddress(actual, expected) {
  try {
    return (
      ipaddr.process(actual).toString() === ipaddr.process(expected).toString()
    );
  } catch {
    return false;
  }
}
