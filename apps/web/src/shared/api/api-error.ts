export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly requestId: string,
    public readonly code: string,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}
