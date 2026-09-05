import test from 'node:test';
import assert from 'node:assert/strict';
import { requestInspection } from '../lib/inspection-client.mjs';

const report = { version: 1, checks: [], summary: { score: 100 } };
const endpoint = 'https://inspection.example/api/inspect';

test('the browser client sends only the URL and leaves credentials out', async () => {
  const controller = new AbortController();
  let calls = 0;
  const actual = await requestInspection(endpoint, 'https://example.com/', {
    signal: controller.signal,
    fetch: async (address, options) => {
      calls++;
      assert.equal(address, endpoint);
      assert.equal(options.method, 'POST');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.signal, controller.signal);
      assert.deepEqual(JSON.parse(options.body), {
        url: 'https://example.com/',
      });
      return Response.json(report);
    },
  });
  assert.deepEqual(actual, report);
  assert.equal(calls, 1);
});

test('rate limits are shown without silently retrying an inspection', async () => {
  let calls = 0;
  await assert.rejects(
    requestInspection(endpoint, 'https://example.com/', {
      fetch: async () => {
        calls++;
        return Response.json(
          { error: { message: 'Wait before trying again.' } },
          { status: 429 },
        );
      },
    }),
    /Wait before trying again/,
  );
  assert.equal(calls, 1);
});

test('a host startup page becomes a readable error, not an HTML parse error', async () => {
  await assert.rejects(
    requestInspection(endpoint, 'https://example.com/', {
      fetch: async () =>
        new Response('<h1>Starting</h1>', {
          status: 503,
          headers: { 'Content-Type': 'text/html' },
        }),
    }),
    /starting up or temporarily unavailable/,
  );
});

test('malformed JSON and unsupported reports are rejected', async () => {
  await assert.rejects(
    requestInspection(endpoint, 'https://example.com/', {
      fetch: async () =>
        new Response('{bad', {
          headers: { 'Content-Type': 'application/json' },
        }),
    }),
    /unreadable response/,
  );
  for (const payload of [null, {}, { ...report, version: 2 }]) {
    await assert.rejects(
      requestInspection(endpoint, 'https://example.com/', {
        fetch: async () => Response.json(payload),
      }),
      /unsupported report/,
    );
  }
});

test('network failures explain that the service may be waking up', async () => {
  await assert.rejects(
    requestInspection(endpoint, 'https://example.com/', {
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      },
    }),
    /may be waking up/,
  );
});

test('cancellation is preserved during both fetch and response reading', async () => {
  for (const phase of ['fetch', 'body']) {
    const controller = new AbortController();
    const failure = new DOMException('Cancelled', 'AbortError');
    await assert.rejects(
      requestInspection(endpoint, 'https://example.com/', {
        signal: controller.signal,
        fetch: async () => {
          const cancel = () => {
            controller.abort();
            throw failure;
          };
          if (phase === 'fetch') cancel();
          return {
            headers: new Headers({ 'Content-Type': 'application/json' }),
            json: cancel,
          };
        },
      }),
      (error) => error === failure,
    );
  }
});
