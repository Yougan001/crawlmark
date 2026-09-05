import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { requestPinned } from '../server/fetch.mjs';

async function responseFixture(
  { headers = {}, chunks = [], address = '8.8.8.8', status = 200 },
  run,
) {
  const stream = new PassThrough();
  stream.headersDistinct = headers;
  stream.socket = { remoteAddress: address };
  stream.statusCode = status;
  const replacement = mock.method(http, 'request', (_options, callback) => {
    const request = new EventEmitter();
    request.setTimeout = () => request;
    request.end = () =>
      queueMicrotask(() => {
        callback(stream);
        for (const chunk of chunks)
          if (!stream.destroyed) stream.write(Buffer.from(chunk));
        if (!stream.destroyed) stream.end();
      });
    return request;
  });
  try {
    await run(() =>
      requestPinned(
        new URL('http://example.com'),
        { address: '8.8.8.8', family: 4 },
        { limit: 8 },
      ),
    );
  } finally {
    replacement.mock.restore();
    stream.destroy();
  }
}

test('streamed and declared size limits reject before assembling oversized bodies', async () => {
  await responseFixture({ chunks: ['12345', '6789'] }, async (fetch) =>
    assert.rejects(fetch(), { code: 'PAGE_TOO_LARGE' }),
  );
  await responseFixture(
    { headers: { 'content-length': ['9000'] } },
    async (fetch) => assert.rejects(fetch(), { code: 'PAGE_TOO_LARGE' }),
  );
  await responseFixture({ chunks: ['1234', '5678'] }, async (fetch) =>
    assert.equal((await fetch()).body.toString(), '12345678'),
  );
});

test('compressed responses and mismatched socket addresses are rejected', async () => {
  await responseFixture(
    { headers: { 'content-encoding': ['gzip'] } },
    async (fetch) => assert.rejects(fetch(), { code: 'ENCODED_RESPONSE' }),
  );
  await responseFixture({ address: '127.0.0.1' }, async (fetch) =>
    assert.rejects(fetch(), { code: 'ADDRESS_CHANGED' }),
  );
});

test('redirect response bodies are discarded without buffering', async () => {
  await responseFixture(
    {
      status: 302,
      headers: { location: ['/next'], 'content-length': ['9000000'] },
      chunks: ['ignored'],
    },
    async (fetch) => {
      const response = await fetch();
      assert.equal(response.status, 302);
      assert.equal(response.body.length, 0);
    },
  );
});
