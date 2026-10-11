/**
 * Structured JSON logger for DocuQuery Lambda functions.
 *
 * Emits a single JSON log line to stdout per call — CloudWatch picks this up
 * automatically from Lambda execution environments.
 *
 * The `userId` field carries the Cognito sub (a UUID), never a raw email
 * address, so it does not constitute PII in the log output.
 *
 * Satisfies Requirements 12.1 and 12.2.
 */

export interface LogEntry {
  /** ISO-8601 UTC timestamp added automatically by the logger. */
  timestamp: string;
  /** Name of the Lambda function emitting the log line. */
  functionName: string;
  /** Cognito sub UUID of the user — not an email address. */
  userId: string;
  /** A short description of the operation, e.g. "POST /documents/upload-url". */
  operationType: string;
  /** Wall-clock duration of the operation in milliseconds. */
  durationMs: number;
  /** Outcome string — HTTP status code as string, "success", or error code. */
  outcome: string;
  /** UUID v4 correlation ID for cross-service tracing. Optional on entry log. */
  correlationId?: string;
  /** Human-readable error message. Present only when an error occurred. */
  errorMessage?: string;
  /** Full stack trace. Present only when an error occurred. */
  errorStack?: string;
  /** Additional structured fields — callers may attach arbitrary metadata. */
  [key: string]: unknown;
}

/**
 * Creates a logger scoped to a specific Lambda function name.
 *
 * @param functionName - The name of the Lambda function (e.g. "upload-url-fn").
 * @returns An object with `emit` and `error` methods.
 */
export function createLogger(functionName: string) {
  return {
    /**
     * Emit a structured log entry to stdout.
     *
     * @param entry - All LogEntry fields except `timestamp` and `functionName`,
     *                which are added automatically.
     */
    emit(entry: Omit<LogEntry, 'timestamp' | 'functionName'>): void {
      // The spread is safe: `entry` carries all required LogEntry fields except
      // `timestamp` and `functionName`, which we supply here. The cast is
      // necessary because TypeScript cannot narrow through the index signature.
      const logLine = {
        timestamp: new Date().toISOString(),
        functionName,
        ...entry,
      } as LogEntry;
      // Write to stdout — CloudWatch picks this up automatically from Lambda
      process.stdout.write(JSON.stringify(logLine) + '\n');
    },

    /**
     * Emit a structured error log entry.
     * Automatically extracts `errorMessage` and `errorStack` from the Error
     * object and sets `outcome` to the error name (e.g. "ValidationError").
     *
     * @param entry - Log fields plus a mandatory `error` property.
     */
    error(entry: Omit<LogEntry, 'timestamp' | 'functionName'> & { error: Error }): void {
      this.emit({
        ...entry,
        outcome: entry.error.name || 'error',
        errorMessage: entry.error.message,
        errorStack: entry.error.stack,
      });
    },
  };
}
