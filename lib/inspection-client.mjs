/**
 * @param {string} endpoint
 * @param {string} url
 * @param {{ signal?: AbortSignal, fetch?: typeof globalThis.fetch }} [options]
 */
export async function requestInspection(
  endpoint,
  url,
  { signal, fetch = globalThis.fetch } = {},
) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal,
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(
      'The inspection service could not be reached. It may be waking up; try again shortly.',
    );
  }

  if (
    !response.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    throw new Error(
      'The service is starting up or temporarily unavailable. Please try again shortly.',
    );

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(
      'The service returned an unreadable response. Please try again shortly.',
    );
  }
  if (!response.ok)
    throw new Error(
      typeof payload?.error?.message === 'string'
        ? payload.error.message
        : 'The inspection service could not complete this request.',
    );
  if (
    payload?.version !== 1 ||
    !Array.isArray(payload.checks) ||
    !payload.summary
  )
    throw new Error('The service returned an unsupported report.');
  return payload;
}
