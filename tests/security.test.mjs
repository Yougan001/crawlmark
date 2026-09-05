import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTarget,
  resolveTarget,
  isPublicAddress,
  sameAddress,
} from '../server/target.mjs';
import {
  fetchPublic,
  requestOptions,
  decodeResponse,
} from '../server/fetch.mjs';

const publicDns = async () => [{ address: '8.8.8.8', family: 4 }];
const response = (status = 200, headers = {}) => ({
  status,
  headers,
  body: Buffer.from('<html></html>'),
});

test('blocks private, special-use, translated and encoded addresses', () => {
  for (const address of [
    '0.0.0.0',
    '10.0.0.1',
    '100.64.1.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '192.0.2.1',
    '198.18.1.1',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
    'fe80::1',
    'fc00::1',
    '2001:db8::1',
    '2002:808:808::1',
    '3fff::1',
  ])
    assert.equal(isPublicAddress(address), false, address);
  for (const value of [
    'http://2130706433',
    'http://0177.0.0.1',
    'http://0x7f000001',
    'http://[::ffff:127.0.0.1]',
  ])
    assert.throws(() => normalizeTarget(value));
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])
    assert.equal(isPublicAddress(address), true);
});

test('URL policy rejects credentials, ports and local hostnames', () => {
  for (const value of [
    'ftp://example.com',
    'file:///etc/passwd',
    'https://user:secret@example.com',
    'https://example.com:8080',
    'http://localhost.',
    'http://foo.local',
    'http://foo.home.arpa',
    'http://foo',
    'http://foo.test',
    'http://example.com\\@localhost',
    'https://example.com/\n',
  ])
    assert.throws(() => normalizeTarget(value), value);
  assert.equal(
    normalizeTarget('HTTPS://EXAMPLE.COM.:443/a?q=1#part').href,
    'https://example.com/a?q=1',
  );
});

test('every DNS answer must be public, not just the chosen family', async () => {
  const url = normalizeTarget('https://example.com');
  await assert.rejects(
    resolveTarget(url, {
      resolve: async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '::1', family: 6 },
      ],
    }),
    { code: 'BLOCKED_DNS' },
  );
  await assert.rejects(resolveTarget(url, { resolve: async () => [] }), {
    code: 'BLOCKED_DNS',
  });
  await assert.rejects(
    resolveTarget(url, {
      resolve: async () => [{ address: '8.8.8.8', family: 6 }],
    }),
    { code: 'BLOCKED_DNS' },
  );
});

test('native HTTP options pin lookup while preserving TLS hostname verification', async () => {
  const signal = new AbortController().signal;
  const options = requestOptions(
    new URL('https://example.com/path?x=1'),
    { address: '8.8.8.8', family: 4 },
    signal,
  );
  assert.equal(options.hostname, 'example.com');
  assert.equal(options.servername, 'example.com');
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.agent, false);
  assert.equal(options.autoSelectFamily, false);
  assert.equal(options.path, '/path?x=1');
  assert.equal(options.headers.Cookie, undefined);
  assert.equal(options.headers.Authorization, undefined);
  assert.equal(options.headers['Accept-Encoding'], 'identity');
  const actual = await new Promise((resolve, reject) =>
    options.lookup('changed.example', { all: true }, (error, values) =>
      error ? reject(error) : resolve(values),
    ),
  );
  assert.deepEqual(actual, [{ address: '8.8.8.8', family: 4 }]);
  assert.equal(sameAddress('::ffff:8.8.8.8', '8.8.8.8'), true);
  assert.equal(sameAddress('127.0.0.1', '8.8.8.8'), false);
});

test('redirects are validated before making the next connection', async () => {
  let calls = 0;
  await assert.rejects(
    fetchPublic('https://example.com', {
      resolve: publicDns,
      transport: async () => {
        calls++;
        return response(302, { location: ['https://127.0.0.1/private'] });
      },
    }),
    { code: 'BLOCKED_ADDRESS' },
  );
  assert.equal(calls, 1);
  await assert.rejects(
    fetchPublic('https://example.com', {
      resolve: publicDns,
      transport: async () =>
        response(302, { location: ['http://example.com'] }),
    }),
    { code: 'INSECURE_REDIRECT' },
  );
});

test('a DNS change on a same-host redirect cannot rebind to an internal address', async () => {
  let lookups = 0;
  let calls = 0;
  await assert.rejects(
    fetchPublic('https://example.com', {
      resolve: async () => [
        { address: ++lookups === 1 ? '8.8.8.8' : '10.0.0.1', family: 4 },
      ],
      transport: async () => {
        calls++;
        return response(302, { location: ['/next'] });
      },
    }),
    { code: 'BLOCKED_DNS' },
  );
  assert.equal(calls, 1);
});

test('redirect loops, ambiguous locations and long chains stop', async () => {
  await assert.rejects(
    fetchPublic('https://example.com', {
      resolve: publicDns,
      transport: async () => response(302, { location: ['/'] }),
    }),
    { code: 'REDIRECT_LOOP' },
  );
  await assert.rejects(
    fetchPublic('https://example.com', {
      resolve: publicDns,
      transport: async () => response(302, { location: ['/', '/other'] }),
    }),
    { code: 'INVALID_REDIRECT' },
  );
  let count = 0;
  await assert.rejects(
    fetchPublic('https://example.com', {
      resolve: publicDns,
      transport: async () => response(302, { location: [`/hop${++count}`] }),
    }),
    { code: 'TOO_MANY_REDIRECTS' },
  );
  assert.equal(count, 4);
});

test('cancelled DNS never proceeds to a connection', async () => {
  const controller = new AbortController();
  let connected = false;
  const promise = fetchPublic('https://example.com', {
    signal: controller.signal,
    resolve: () => new Promise(() => {}),
    transport: async () => {
      connected = true;
      return response();
    },
  });
  controller.abort();
  await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(connected, false);
});

test('character decoding is explicit and rejects undecodable content', () => {
  assert.equal(
    decodeResponse(Buffer.from([0x63, 0x61, 0x66, 0xe9]), {
      'content-type': ['text/html;charset=windows-1252'],
    }),
    'café',
  );
  assert.throws(() => decodeResponse(Buffer.from([0xff]), {}), {
    code: 'UNSUPPORTED_ENCODING',
  });
});
