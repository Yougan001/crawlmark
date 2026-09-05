import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createInspectionServer } from '../server/app.mjs';

test('only two inspections may run concurrently', async () => {
  const pending = [];
  let ready;
  const started = new Promise((resolve) => {
    ready = resolve;
  });
  await fixture(
    async ({ post }) => {
      const first = post();
      const second = post();
      await started;
      try {
        assert.equal((await post()).status, 429);
      } finally {
        for (const resolve of pending) resolve({ checks: [] });
      }
      assert.equal((await first).status, 200);
      assert.equal((await second).status, 200);
    },
    {
      inspect: () =>
        new Promise((resolve) => {
          pending.push(resolve);
          if (pending.length === 2) ready();
        }),
    },
  );
});

async function fixture(run, options = {}) {
  let calls = 0;
  const server = createInspectionServer({
    hosts: ['test.local'],
    origins: ['https://frontend.example'],
    inspect: async (url) => {
      calls++;
      return { url, checks: [] };
    },
    ...options,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (body = { url: 'https://example.com' }, headers = {}) =>
    new Promise((resolve, reject) => {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      const request = http.request(
        `${url}/api/inspect`,
        {
          method: 'POST',
          headers: {
            Host: 'test.local',
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            ...headers,
          },
        },
        (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('error', reject);
          response.on('end', () =>
            resolve({
              status: response.statusCode,
              headers: new Headers(response.headers),
              json: async () => JSON.parse(Buffer.concat(chunks).toString()),
            }),
          );
        },
      );
      request.on('error', reject);
      request.end(payload);
    });
  try {
    await run({ post, url, calls: () => calls });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('API returns structured reports and no-store CORS responses', () =>
  fixture(async ({ post, calls }) => {
    const response = await post(undefined, {
      Origin: 'https://frontend.example',
    });
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get('access-control-allow-origin'),
      'https://frontend.example',
    );
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      url: 'https://example.com',
      checks: [],
    });
    assert.equal(calls(), 1);
  }));

test('host and origin rejection happen before inspection', () =>
  fixture(async ({ post, calls }) => {
    assert.equal((await post(undefined, { Host: 'evil.example' })).status, 403);
    assert.equal(
      (await post(undefined, { Origin: 'https://evil.example' })).status,
      403,
    );
    assert.equal(calls(), 0);
  }));

test('API rejects arbitrary proxy headers, bad JSON and oversized bodies', () =>
  fixture(async ({ post, calls }) => {
    assert.equal(
      (
        await post({
          url: 'https://example.com',
          headers: { Cookie: 'secret' },
        })
      ).status,
      400,
    );
    assert.equal((await post('{bad')).status, 400);
    assert.equal(
      (await post(undefined, { 'Content-Type': 'text/plain' })).status,
      415,
    );
    assert.equal((await post('x'.repeat(4097))).status, 413);
    assert.equal(calls(), 0);
  }));

test('per-address quotas ignore spoofed forwarded IPs', () =>
  fixture(async ({ post, calls }) => {
    for (let index = 0; index < 6; index++)
      assert.equal(
        (await post(undefined, { 'X-Forwarded-For': `8.8.8.${index}` })).status,
        200,
      );
    const response = await post(undefined, { 'X-Forwarded-For': '1.1.1.1' });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '600');
    assert.equal(calls(), 6);
  }));

test('internal error text is not leaked to the caller', () =>
  fixture(
    async ({ post }) => {
      const response = await post();
      assert.equal(response.status, 502);
      assert.doesNotMatch(
        JSON.stringify(await response.json()),
        /private-token/,
      );
    },
    {
      inspect: async () => {
        throw new Error('private-token');
      },
    },
  ));
