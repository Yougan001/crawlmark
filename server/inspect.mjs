import { Worker } from 'node:worker_threads';
import { fetchPublic, decodeResponse, ROBOTS_LIMIT } from './fetch.mjs';
import { normalizeTarget } from './target.mjs';
import { InspectionError, publicError } from './errors.mjs';

export function runAudit(input, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./audit-worker.mjs', import.meta.url), {
      workerData: input,
      resourceLimits: { maxOldGenerationSizeMb: 96, stackSizeMb: 4 },
    });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      void worker.terminate();
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => finish(signal.reason);
    const timer = setTimeout(
      () =>
        finish(
          new InspectionError(
            'ANALYSIS_LIMIT',
            'HTML analysis exceeded three seconds.',
            422,
          ),
        ),
      3000,
    );
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('error', () =>
      finish(
        new InspectionError(
          'ANALYSIS_LIMIT',
          'HTML analysis exceeded its memory limit or failed.',
          422,
        ),
      ),
    );
    worker.once('exit', () => {
      if (!settled)
        finish(
          new InspectionError(
            'ANALYSIS_FAILED',
            'HTML analysis ended without a report.',
            422,
          ),
        );
    });
    worker.once('message', (message) =>
      message.error
        ? finish(new InspectionError('ANALYSIS_LIMIT', message.error, 422))
        : finish(null, message.report),
    );
  });
}

export async function inspectUrl(
  input,
  { signal, fetch = fetchPublic, analyze = runAudit } = {},
) {
  const url = normalizeTarget(input);
  const response = await fetch(url.href, { signal });
  const contentType = response.headers['content-type']?.[0]
    ?.split(';')[0]
    .trim()
    .toLowerCase();
  if (contentType !== 'text/html')
    throw new InspectionError(
      'NOT_HTML',
      'The final response is not text/html. PDFs, XML and downloads are not inspected.',
      422,
    );
  const html = decodeResponse(response.body, response.headers);
  let robots;
  try {
    const result = await fetch(new URL('/robots.txt', response.url).href, {
      signal,
      limit: ROBOTS_LIMIT,
      timeout: 5000,
    });
    const type = result.headers['content-type']?.[0]
      ?.split(';')[0]
      .trim()
      .toLowerCase();
    robots = {
      status: result.status,
      text:
        !type || type === 'text/plain'
          ? new TextDecoder('utf-8', { fatal: true }).decode(result.body)
          : undefined,
    };
  } catch (error) {
    signal?.throwIfAborted();
    robots = { error: publicError(error).message };
  }
  signal?.throwIfAborted();
  return analyze(
    {
      url: response.url,
      status: response.status,
      headers: {
        'x-robots-tag': response.headers['x-robots-tag'],
        link: response.headers.link,
      },
      html,
      robots,
      redirects: response.redirects,
    },
    signal,
  );
}
