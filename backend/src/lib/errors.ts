/**
 * Application error hierarchy for DocuQuery Lambda handlers.
 *
 * Each error class carries an HTTP status code and a correlation ID so that
 * the middleware layer can map it directly to an API Gateway response without
 * any additional branching logic in the handler.
 *
 * Satisfies Requirements 11.1–11.6.
 */

/**
 * Base class for all application errors.
 * Extends the built-in Error so instanceof checks work correctly across the
 * middleware boundary.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly correlationId: string,
    public readonly errorCode?: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Raised when a request body or parameter fails schema validation.
 * Maps to HTTP 400 Bad Request.
 */
export class ValidationError extends AppError {
  constructor(message: string, correlationId: string) {
    super(message, 400, correlationId, 'VALIDATION_ERROR');
  }
}

/**
 * Raised when a requested resource does not exist in the system.
 * Maps to HTTP 404 Not Found.
 */
export class NotFoundError extends AppError {
  constructor(message: string, correlationId: string) {
    super(message, 404, correlationId, 'NOT_FOUND');
  }
}

/**
 * Raised when the authenticated caller attempts to access a resource that
 * belongs to a different user.
 * Maps to HTTP 403 Forbidden.
 */
export class ForbiddenError extends AppError {
  constructor(message: string, correlationId: string) {
    super(message, 403, correlationId, 'FORBIDDEN');
  }
}

/**
 * Raised when a downstream service (e.g. Amazon Bedrock) does not respond
 * within the configured time limit.
 * Maps to HTTP 504 Gateway Timeout.
 */
export class TimeoutError extends AppError {
  constructor(message: string, correlationId: string) {
    super(message, 504, correlationId, 'TIMEOUT');
  }
}

/**
 * Raised when a downstream service returns an error response.
 * Maps to HTTP 502 Bad Gateway.
 */
export class ServiceError extends AppError {
  constructor(message: string, correlationId: string) {
    super(message, 502, correlationId, 'SERVICE_ERROR');
  }
}
