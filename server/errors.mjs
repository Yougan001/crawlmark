export class InspectionError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'InspectionError';
    this.code = code;
    this.status = status;
  }
}

export function publicError(error) {
  if (error instanceof InspectionError) return error;
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
    return new InspectionError(
      'TIMEOUT',
      'The inspection was cancelled or exceeded its time limit.',
      408,
    );
  }
  return new InspectionError(
    'FETCH_FAILED',
    'The public page could not be retrieved. Check the URL, certificate and server availability.',
    502,
  );
}
