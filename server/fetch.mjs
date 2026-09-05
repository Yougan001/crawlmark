import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { InspectionError } from './errors.mjs';
import {
  normalizeTarget,
  resolveTarget,
  pinnedLookup,
  sameAddress,
} from './target.mjs';

export const HTML_LIMIT = 2 * 1024 * 1024;
export const ROBOTS_LIMIT = 256 * 1024;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export function requestOptions(url, address, signal) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  return {
    protocol: url.protocol,
    hostname,
    port: url.protocol === 'https:' ? 443 : 80,
    path: url.pathname + url.search,
    method: 'GET',
    agent: false,
    lookup: pinnedLookup(address),
    family: address.family,
    autoSelectFamily: false,
    servername: isIP(hostname) ? '' : hostname,
    rejectUnauthorized: true,
    maxHeaderSize: 16 * 1024,
    signal,
    headers: {
      'User-Agent': 'Crawlmark/0.1 (+https://github.com/Yougan001/crawlmark)',
      Accept: 'text/html,text/plain;q=0.9',
      'Accept-Encoding': 'identity',
      Connection: 'close',
    },
  };
}

export function requestPinned(
  url,
  address,
  { signal, limit = HTML_LIMIT } = {},
) {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request(
      requestOptions(url, address, signal),
      (response) => {
        response.on('error', reject);
        if (!sameAddress(response.socket.remoteAddress, address.address)) {
          response.destroy(
            new InspectionError(
              'ADDRESS_CHANGED',
              'The connection did not reach the validated address.',
              502,
            ),
          );
          return;
        }
        const headers = response.headersDistinct;
        const status = response.statusCode;
        if (redirectStatuses.has(status)) {
          resolve({ status, headers, body: Buffer.alloc(0) });
          response.destroy();
          return;
        }
        const encoding = headers['content-encoding']
          ?.join(',')
          .trim()
          .toLowerCase();
        if (encoding && encoding !== 'identity') {
          response.destroy(
            new InspectionError(
              'ENCODED_RESPONSE',
              'This server ignored the uncompressed-response request. Compressed responses are not inspected.',
              422,
            ),
          );
          return;
        }
        const declared = Number(headers['content-length']?.[0]);
        if (declared > limit) {
          response.destroy(
            new InspectionError(
              'PAGE_TOO_LARGE',
              `The response exceeds the ${limit / 1024} KiB inspection limit.`,
              413,
            ),
          );
          return;
        }
        let length = 0;
        const chunks = [];
        response.on('data', (chunk) => {
          length += chunk.length;
          if (length > limit)
            response.destroy(
              new InspectionError(
                'PAGE_TOO_LARGE',
                `The response exceeds the ${limit / 1024} KiB inspection limit.`,
                413,
              ),
            );
          else chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({ status, headers, body: Buffer.concat(chunks, length) }),
        );
      },
    );
    request.on('error', reject);
    request.setTimeout(5000, () =>
      request.destroy(
        new InspectionError(
          'IDLE_TIMEOUT',
          'The server stopped responding for five seconds.',
          408,
        ),
      ),
    );
    request.end();
  });
}

export async function fetchPublic(
  input,
  {
    resolve,
    transport = requestPinned,
    signal: parentSignal,
    limit = HTML_LIMIT,
    timeout = 15000,
  } = {},
) {
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, AbortSignal.timeout(timeout)])
    : AbortSignal.timeout(timeout);
  let url = normalizeTarget(input);
  const visited = new Set();
  const redirects = [];
  for (let hop = 0; hop <= 3; hop++) {
    signal.throwIfAborted();
    if (visited.has(url.href))
      throw new InspectionError(
        'REDIRECT_LOOP',
        'The page redirects in a loop.',
        422,
      );
    visited.add(url.href);
    const address = await resolveTarget(url, { resolve, signal });
    const result = await transport(url, address, { signal, limit });
    signal.throwIfAborted();
    if (!redirectStatuses.has(result.status))
      return { ...result, url: url.href, redirects };
    const location = result.headers.location;
    if (location?.length !== 1 || !location[0])
      throw new InspectionError(
        'INVALID_REDIRECT',
        'The server returned a missing or ambiguous redirect target.',
        422,
      );
    let target;
    try {
      target = normalizeTarget(new URL(location[0], url).href);
    } catch (error) {
      if (error instanceof InspectionError) throw error;
      throw new InspectionError(
        'INVALID_REDIRECT',
        'The redirect target is not a valid public URL.',
        422,
      );
    }
    if (url.protocol === 'https:' && target.protocol !== 'https:')
      throw new InspectionError(
        'INSECURE_REDIRECT',
        'An HTTPS page redirected to unencrypted HTTP. Inspection stopped.',
        422,
      );
    redirects.push({
      url: url.href,
      status: result.status,
      target: target.href,
    });
    url = target;
  }
  throw new InspectionError(
    'TOO_MANY_REDIRECTS',
    'The page exceeded three redirects.',
    422,
  );
}

export function decodeResponse(body, headers) {
  const contentType = headers['content-type']?.[0] ?? '';
  const declared = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1];
  const earlyHtml = body.subarray(0, 1024).toString('latin1');
  const inHtml = /<meta\s[^>]*charset\s*=\s*["']?([\w-]+)/i.exec(
    earlyHtml,
  )?.[1];
  try {
    return new TextDecoder(declared ?? inHtml ?? 'utf-8', {
      fatal: true,
    }).decode(body);
  } catch {
    throw new InspectionError(
      'UNSUPPORTED_ENCODING',
      'The response could not be decoded using its declared character encoding.',
      422,
    );
  }
}
