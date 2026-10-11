/**
 * Lambda handler middleware for DocuQuery.
 *
 * `withMiddleware` wraps an API Gateway Lambda handler with:
 *  - Correlation ID generation (UUID v4 via Node crypto module — no extra dep)
 *  - Structured JSON logging on entry and exit via `createLogger`
 *  - Automatic `x-correlation-id` header on every response
 *  - `try/catch` that maps `AppError` subclasses to their HTTP status codes
 *    and falls back to HTTP 500 for unexpected errors
 *
 * Satisfies Requirements 12.1, 12.2, 11.1–11.6, 13.1.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { createLogger } from './logger.js';
import { AppError } from './errors.js';

/**
 * The handler signature expected by `withMiddleware`.
 *
 * The wrapper injects a `correlationId` (UUID v4) as the third argument so
 * handlers can propagate it to downstream service calls and error objects
 * without having to generate their own.
 */
export type ApiHandler = (
  event: APIGatewayProxyEvent,
  context: Context,
  correlationId: string,
) => Promise<APIGatewayProxyResult>;

/**
 * Wraps a Lambda handler function with structured logging, correlation IDs,
 * and standardised error mapping.
 *
 * @param functionName - Used as the `functionName` field in every log line.
 * @param handler - The inner handler that receives the augmented signature.
 * @returns A standard `(event, context) => Promise<APIGatewayProxyResult>` function
 *          that API Gateway can invoke directly.
 */
export function withMiddleware(functionName: string, handler: ApiHandler) {
  const logger = createLogger(functionName);

  return async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
    const correlationId = randomUUID();
    const startTime = Date.now();
    const userId = event.requestContext?.authorizer?.claims?.sub ?? 'anonymous';

    try {
      const result = await handler(event, context, correlationId);

      logger.emit({
        userId,
        operationType: `${event.httpMethod} ${event.resource}`,
        durationMs: Date.now() - startTime,
        outcome: String(result.statusCode),
        correlationId,
      });

      // Attach correlation ID to all responses so the frontend can include it
      // in bug reports and support tickets.
      return {
        ...result,
        headers: {
          'Content-Type': 'application/json',
          'x-correlation-id': correlationId,
          ...result.headers,
        },
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      logger.error({
        userId,
        operationType: `${event.httpMethod} ${event.resource}`,
        durationMs: Date.now() - startTime,
        outcome: 'error',
        correlationId,
        error,
      });

      if (err instanceof AppError) {
        return {
          statusCode: err.statusCode,
          headers: {
            'Content-Type': 'application/json',
            'x-correlation-id': correlationId,
          },
          body: JSON.stringify({
            error: err.errorCode ?? err.name,
            message: err.message,
            correlationId,
            statusCode: err.statusCode,
          }),
        };
      }

      // Unknown / unexpected error — return HTTP 500 and hide implementation details.
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'x-correlation-id': correlationId,
        },
        body: JSON.stringify({
          error: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
          correlationId,
          statusCode: 500,
        }),
      };
    }
  };
}
