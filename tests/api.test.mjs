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
    await run({ post, url, server, calls: () => calls });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function slowBody(server, url, chunked = false) {
  const received = new Promise((resolve) => server.once('request', resolve));
  const request = http.request(`${url}/api/inspect`, {
    method: 'POST',
    agent: false,
    headers: {
      Host: 'test.local',
      'Content-Type': 'application/json',
      ...(chunked ? {} : { 'Content-Length': '1000' }),
    },
  });
  let error;
  request.on('error', (value) => {
    error = value;
  });
  request.on('response', (response) => response.resume());
  const closed = new Promise((resolve) => request.once('close', resolve));
  request.write('{');
  const interval = setInterval(() => {
    if (!request.destroyed) request.write(' ');
  }, 25);
  request.once('close', () => clearInterval(interval));
  const incoming = await received;
  const serverClosed = new Promise((resolve) =>
    incoming.once('close', resolve),
  );
  return {
    request,
    incoming,
    closed: Promise.all([closed, serverClosed]),
    error: () => error,
  };
}

async function within(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Request did not close in time')),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

for (const chunked of [false, true]) {
  test(
    `slow request bodies release both slots at the deadline (${chunked ? 'chunked' : 'content-length'})`,
    { timeout: 5000 },
    () =>
      fixture(
        async ({ post, url, server, calls }) => {
          const pending = [];
          try {
            pending.push(await slowBody(server, url, chunked));
            pending.push(await slowBody(server, url, chunked));
            assert.equal((await post()).status, 429);
            await within(
              Promise.all(pending.map(({ closed }) => closed)),
              1500,
            );
            for (const body of pending) {
              assert.equal(body.incoming.destroyed, true);
              assert.equal(body.error()?.code, 'ECONNRESET');
            }
            assert.equal(calls(), 0);
            assert.equal((await post()).status, 200);
            assert.equal(calls(), 1);
          } finally {
            for (const body of pending) body.request.destroy();
          }
        },
        { inspectionTimeoutMs: 250 },
      ),
  );
}

test(
  'disconnecting during the request body releases inspection slots',
  { timeout: 5000 },
  () =>
    fixture(async ({ post, url, server, calls }) => {
      const pending = [];
      try {
        pending.push(await slowBody(server, url));
        pending.push(await slowBody(server, url));
        assert.equal((await post()).status, 429);
        for (const body of pending) body.request.destroy();
        await within(Promise.all(pending.map(({ closed }) => closed)), 1500);
        assert.equal(calls(), 0);
        assert.equal((await post()).status, 200);
        assert.equal(calls(), 1);
      } finally {
        for (const body of pending) body.request.destroy();
      }
    }),
);

test(
  'a timeout after the complete body still returns a structured error',
  { timeout: 5000 },
  async () => {
    let calls = 0;
    await fixture(
      async ({ post }) => {
        const response = await post();
        assert.equal(response.status, 408);
        assert.equal((await response.json()).error.code, 'TIMEOUT');
        assert.equal((await post()).status, 200);
      },
      {
        inspectionTimeoutMs: 250,
        inspect: async (_, { signal }) => {
          if (++calls > 1) return { checks: [] };
          signal.throwIfAborted();
          return new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
          });
        },
      },
    );
  },
);

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
