/**
 * Documents handler
 *
 * GET    /documents                         — list all documents for the caller
 * DELETE /documents/{documentId}            — delete a document
 * PATCH  /documents/{documentId}/status     — update document status (internal)
 *
 * Satisfies Requirements 5.1–5.6, 10.4, 11.3–11.4.
 */

import {
  BedrockAgentClient,
  StartIngestionJobCommand,
} from '@aws-sdk/client-bedrock-agent';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  DeleteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  USER_PREFIX,
  DOC_PREFIX,
  USER_CREATED_AT_INDEX,
} from '@docuquery/shared';
import { APIGatewayProxyResult } from 'aws-lambda';

import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors.js';
import { withMiddleware } from '../lib/middleware.js';

const s3 = new S3Client({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrockAgent = new BedrockAgentClient({});

const TABLE_NAME = process.env['TABLE_NAME'] ?? '';
const BUCKET_NAME = process.env['BUCKET_NAME'] ?? '';
const KNOWLEDGE_BASE_ID = process.env['KNOWLEDGE_BASE_ID'] ?? '';
const DATA_SOURCE_ID = process.env['DATA_SOURCE_ID'] ?? '';


/**
 * Retry a Bedrock StartIngestionJob call with exponential backoff.
 * Handles two transient errors:
 * - 429 ThrottlingException / ValidationException("Too many requests")
 * - 409 ConflictException — KB already has a running ingestion job; wait and retry
 */
async function startIngestionWithRetry(
  command: StartIngestionJobCommand,
  maxAttempts = 8,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await bedrockAgent.send(command);
      return;
    } catch (err) {
      const error = err as Error & { name?: string; message?: string };
      const isThrottle =
        error.name === 'ThrottlingException' ||
        (error.name === 'ValidationException' && (error.message ?? '').includes('Too many requests'));
      const isConflict = error.name === 'ConflictException';
      if ((isThrottle || isConflict) && attempt < maxAttempts) {
        const baseDelay = isConflict ? 15000 : 1000;
        const delayMs = Math.min(baseDelay * 2 ** (attempt - 1), 60000);
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw err;
    }
  }
}

export const handler = withMiddleware('documents-fn', async (event, _context, correlationId): Promise<APIGatewayProxyResult> => {
  const claims = event.requestContext?.authorizer?.claims as Record<string, string> | undefined;
  const userId = claims?.['sub'];
  if (!userId) {
    throw new ValidationError('Missing userId in authorizer claims', correlationId);
  }

  const httpMethod = event.httpMethod;

  // ── GET /documents ──────────────────────────────────────────────────────────
  if (httpMethod === 'GET') {
    const result = await dynamo.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: USER_CREATED_AT_INDEX,
        KeyConditionExpression: 'userId = :uid',
        // Filter to only DOC# items — the GSI also returns CHAT# records
        // since both share the same userId attribute.
        FilterExpression: 'begins_with(SK, :docPrefix)',
        ExpressionAttributeValues: {
          ':uid': userId,
          ':docPrefix': DOC_PREFIX,
        },
        ScanIndexForward: false,
      }),
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        data: result.Items ?? [],
        correlationId,
      }),
    };
  }

  // ── DELETE /documents/{documentId} ─────────────────────────────────────────
  if (httpMethod === 'DELETE') {
    const documentId = event.pathParameters?.['documentId'];
    if (!documentId) {
      throw new ValidationError('documentId path parameter is required', correlationId);
    }

    // Fetch document to verify ownership
    const docResult = await dynamo.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `${USER_PREFIX}${userId}`,
          SK: `${DOC_PREFIX}${documentId}`,
        },
      }),
    );

    const doc = docResult.Item;
    if (!doc) {
      throw new NotFoundError(`Document ${documentId} not found`, correlationId);
    }

    // Verify ownership (Req 5.6)
    if (doc['userId'] !== userId) {
      throw new ForbiddenError('Access denied', correlationId);
    }

    const s3Key = doc['s3Key'] as string;

    // 1. Delete from S3
    await s3.send(
      new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
      }),
    );

    // 2. Trigger KB re-sync so chunks for the deleted file are removed
    // (StartIngestionJobCommand picks up S3 deletions on the next sync)
    await startIngestionWithRetry(
      new StartIngestionJobCommand({
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        dataSourceId: DATA_SOURCE_ID,
        description: `Remove document ${documentId} chunks from KB`,
      }),
    );

    // 3. Delete DynamoDB record
    await dynamo.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `${USER_PREFIX}${userId}`,
          SK: `${DOC_PREFIX}${documentId}`,
        },
      }),
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        data: { documentId, deleted: true },
        correlationId,
      }),
    };
  }

  // ── PATCH /documents/{documentId}/status ───────────────────────────────────
  if (httpMethod === 'PATCH') {
    const documentId = event.pathParameters?.['documentId'];
    if (!documentId) {
      throw new ValidationError('documentId path parameter is required', correlationId);
    }

    if (!event.body) {
      throw new ValidationError('Request body is required', correlationId);
    }

    let body: { status?: string };
    try {
      body = JSON.parse(event.body) as { status?: string };
    } catch {
      throw new ValidationError('Request body must be valid JSON', correlationId);
    }

    const { status } = body;
    const validStatuses = ['uploaded', 'processing', 'ready', 'failed'];
    if (!status || !validStatuses.includes(status)) {
      throw new ValidationError(
        `status must be one of: ${validStatuses.join(', ')}`,
        correlationId,
      );
    }

    // Verify the document exists and belongs to this user
    const docResult = await dynamo.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `${USER_PREFIX}${userId}`,
          SK: `${DOC_PREFIX}${documentId}`,
        },
      }),
    );

    if (!docResult.Item) {
      throw new NotFoundError(`Document ${documentId} not found`, correlationId);
    }

    if (docResult.Item['userId'] !== userId) {
      throw new ForbiddenError('Access denied', correlationId);
    }

    await dynamo.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `${USER_PREFIX}${userId}`,
          SK: `${DOC_PREFIX}${documentId}`,
        },
        UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': status,
          ':updatedAt': new Date().toISOString(),
        },
      }),
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        data: { documentId, status },
        correlationId,
      }),
    };
  }

  throw new ValidationError(`Method ${httpMethod} not allowed`, correlationId);
});
