/**
 * Documents handler
 *
 * GET    /documents                         — list all documents for the caller
 * DELETE /documents/{documentId}            — delete a document
 * PATCH  /documents/{documentId}/status     — update document status (internal)
 *
 * Satisfies Requirements 5.1–5.6, 10.4, 11.3–11.4.
 */

import { APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  DeleteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  BedrockAgentClient,
  StartIngestionJobCommand,
} from '@aws-sdk/client-bedrock-agent';
import {
  USER_PREFIX,
  DOC_PREFIX,
  USER_CREATED_AT_INDEX,
} from '@docuquery/shared';
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors.js';
import { withMiddleware } from '../lib/middleware.js';

const s3 = new S3Client({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrockAgent = new BedrockAgentClient({});

const TABLE_NAME = process.env['TABLE_NAME'] ?? '';
const BUCKET_NAME = process.env['BUCKET_NAME'] ?? '';
const KNOWLEDGE_BASE_ID = process.env['KNOWLEDGE_BASE_ID'] ?? '';

export const handler = withMiddleware('documents-fn', async (event, _context, correlationId): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext?.authorizer?.claims?.sub as string | undefined;
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
        ExpressionAttributeValues: { ':uid': userId },
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
    await bedrockAgent.send(
      new StartIngestionJobCommand({
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        dataSourceId: KNOWLEDGE_BASE_ID,
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
