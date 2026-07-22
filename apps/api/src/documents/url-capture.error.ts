export class UrlCaptureError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'UrlCaptureError';
  }
}
