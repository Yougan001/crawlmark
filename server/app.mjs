import http from 'node:http';
import { inspectUrl } from './inspect.mjs';
import { InspectionError, publicError } from './errors.mjs';

export function createInspectionServer({
  inspect = inspectUrl,
  origins = ['http://localhost:5184'],
  hosts = ['localhost:8787', '127.0.0.1:8787'],
  now = Date.now,
  inspectionTimeoutMs = 25000,
} = {}) {
  const allowedOrigins = new Set(origins);
  const allowedHosts = new Set(hosts);
  const clients = new Map();
  let active = 0;
  let globalWindow = { started: 0, count: 0 };

  function quota(address) {
    const time = now();
    for (const [key, entry] of clients)
      if (time - entry.started >= 600000) clients.delete(key);
    if (time - globalWindow.started >= 60000)
      globalWindow = { started: time, count: 0 };
    const client = clients.get(address) ?? { started: time, count: 0 };
    if (
      active >= 2 ||
      globalWindow.count >= 20 ||
      client.count >= 6 ||
      (!clients.has(address) && clients.size >= 1024)
    )
      throw new InspectionError(
        'RATE_LIMIT',
        'Inspection capacity reached. Wait before trying again.',
        429,
      );
    client.count++;
    globalWindow.count++;
    clients.set(address, client);
  }

  const server = http.createServer(
    { maxHeaderSize: 8192 },
    async (request, response) => {
      const send = (status, body) => {
        if (response.destroyed) return;
        response.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          ...(status === 429 ? { 'Retry-After': '600' } : {}),
        });
        response.end(JSON.stringify(body));
      };
      let acquired = false;
      const controller = new AbortController();
      const abortBody = () => {
        // Aborting the inspection alone does not interrupt an unfinished upload.
        if (!request.complete && !request.destroyed)
          request.destroy(controller.signal.reason);
      };
      controller.signal.addEventListener('abort', abortBody, { once: true });
      const timer = setTimeout(
        () =>
          controller.abort(
            new DOMException('Inspection timed out', 'TimeoutError'),
          ),
        inspectionTimeoutMs,
      );
      response.on('close', () => {
        if (!response.writableEnded) controller.abort();
      });
      request.on('aborted', () => controller.abort());
      try {
        if (!allowedHosts.has(request.headers.host?.toLowerCase()))
          throw new InspectionError(
            'INVALID_HOST',
            'This API hostname is not allowed.',
            403,
          );
        const origin = request.headers.origin;
        if (origin && !allowedOrigins.has(origin))
          throw new InspectionError(
            'INVALID_ORIGIN',
            'This browser origin is not allowed.',
            403,
          );
        if (origin) {
          response.setHeader('Access-Control-Allow-Origin', origin);
          response.setHeader('Vary', 'Origin');
        }
        if (request.url === '/health' && request.method === 'GET') {
          send(200, { service: 'crawlmark', version: 1 });
          return;
        }
        if (request.url !== '/api/inspect')
          throw new InspectionError('NOT_FOUND', 'Route not found.', 404);
        if (request.method === 'OPTIONS') {
          response.writeHead(204, {
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '300',
            'Cache-Control': 'no-store',
          });
          response.end();
          return;
        }
        if (request.method !== 'POST')
          throw new InspectionError('METHOD', 'Use POST with a JSON URL.', 405);
        if (
          request.headers['content-type']
            ?.split(';')[0]
            .trim()
            .toLowerCase() !== 'application/json'
        )
          throw new InspectionError(
            'CONTENT_TYPE',
            'Use application/json.',
            415,
          );
        if (
          request.headers['content-encoding'] ||
          Number(request.headers['content-length']) > 4096
        )
          throw new InspectionError(
            'REQUEST_SIZE',
            'Use an uncompressed JSON request no larger than 4 KiB.',
            413,
          );
        quota(request.socket.remoteAddress ?? 'unknown');
        active++;
        acquired = true;
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 4096)
            throw new InspectionError(
              'REQUEST_SIZE',
              'The JSON request exceeds 4 KiB.',
              413,
            );
          chunks.push(chunk);
        }
        let input;
        try {
          input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          throw new InspectionError(
            'INVALID_JSON',
            'The request body is not valid JSON.',
          );
        }
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          Object.keys(input).some((key) => key !== 'url')
        )
          throw new InspectionError(
            'INVALID_REQUEST',
            'The request must contain only a URL field.',
          );
        send(200, await inspect(input.url, { signal: controller.signal }));
      } catch (error) {
        const safe = publicError(error);
        send(safe.status, {
          error: { code: safe.code, message: safe.message },
        });
      } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', abortBody);
        if (acquired) active--;
      }
    },
  );
  server.headersTimeout = 5000;
  server.requestTimeout = 10000;
  server.keepAliveTimeout = 1000;
  server.setTimeout(30000, (socket) => socket.destroy());
  server.maxRequestsPerSocket = 10;
  return server;
}
