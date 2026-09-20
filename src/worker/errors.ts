import type { ApiErrorCode } from '../shared/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const invalidRequest = (message: string): ApiError =>
  new ApiError(400, 'invalid_request', message);

export const stateConflict = (message: string): ApiError =>
  new ApiError(409, 'state_conflict', message);
