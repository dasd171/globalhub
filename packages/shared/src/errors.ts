export type ErrorCode =
  | 'BAD_REQUEST' | 'VALIDATION_FAILED' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT'
  | 'RATE_LIMITED' | 'INVALID_STATE_TRANSITION' | 'INSUFFICIENT_STOCK' | 'MOQ_NOT_MET' | 'NOT_SUPPORTED'
  | 'PAYMENT_ERROR' | 'FEDERATION_ERROR' | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400, VALIDATION_FAILED: 422, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409,
  RATE_LIMITED: 429, INVALID_STATE_TRANSITION: 409, INSUFFICIENT_STOCK: 409, MOQ_NOT_MET: 422, NOT_SUPPORTED: 501,
  PAYMENT_ERROR: 402, FEDERATION_ERROR: 502, INTERNAL: 500,
};

/** Domain error carried from services up to the HTTP layer with a stable code. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} not found`);
export const forbidden = (msg = 'You do not have permission to perform this action') => new AppError('FORBIDDEN', msg);

/** Uniform error body returned by every API endpoint. */
export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown; requestId?: string };
}
