/**
 * Unit tests for the documents handler.
 *
 * Validates Requirements 5.1–5.6, 10.4, 11.3–11.4
 */

import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
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

import { handler } from '../../src/documents/handler';
import { APIGatewayProxyEvent } from 'aws-lambda';

// ── AWS SDK mocks ────────────────────────────────────────────────────────────
const s3Mock = mockClient(S3Client);
const dynamoMock = mockClient(DynamoDBDocumentClient);
const bedrockAgentMock = mockClient(BedrockAgentClient);

// ── Constants ────────────────────────────────────────────────────────────────
const OWNER_USER_ID = 'owner-user-uuid-123';
const CALLER_USER_ID = 'caller-user-uuid-456';
const DOCUMENT_ID = 'doc-uuid-789';

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildEvent(
  method: string,
  overrides: Partial<APIGatewayProxyEvent> = {},
  userId = OWNER_USER_ID,
): APIGatewayProxyEvent {
  return {
    httpMethod: method,
    resource: '/documents',
    path: '/documents',
    headers: { 'Content-Type': 'application/json' },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    isBase64Encoded: false,
    requestContext: {
      authorizer: {
        claims: { sub: userId },
      },
    } as unknown as APIGatewayProxyEvent['requestContext'],
    body: null,
    ...overrides,
  };
}

function buildDocRecord(userId = OWNER_USER_ID) {
  return {
    PK: `USER#${userId}`,
    SK: `DOC#${DOCUMENT_ID}`,
    userId,
    documentId: DOCUMENT_ID,
    documentName: 'test-file.pdf',
    s3Key: `USER#${userId}/DOC#${DOCUMENT_ID}/test-file.pdf`,
    fileSize: 1_000_000,
    contentType: 'application/pdf',
    status: 'ready',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  s3Mock.reset();
  dynamoMock.reset();
  bedrockAgentMock.reset();

  process.env['TABLE_NAME'] = 'test-table';
  process.env['BUCKET_NAME'] = 'test-bucket';
  process.env['KNOWLEDGE_BASE_ID'] = 'test-kb-id';

  s3Mock.on(DeleteObjectCommand).resolves({});
  bedrockAgentMock.on(StartIngestionJobCommand).resolves({ ingestionJob: {} as never });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /documents', () => {
  it('1. returns only the caller\'s documents (PK scoped to userId)', async () => {
    const docs = [buildDocRecord(OWNER_USER_ID), buildDocRecord(OWNER_USER_ID)];
    dynamoMock.on(QueryCommand).resolves({ Items: docs });

    const event = buildEvent('GET', {}, OWNER_USER_ID);
    const result = await handler(event, {} as never);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    const data = body['data'] as unknown[];
    expect(data).toHaveLength(2);

    // Verify the QueryCommand was scoped to the correct userId
    expect(dynamoMock).toHaveReceivedCommandTimes(QueryCommand, 1);
    const queryCall = dynamoMock.commandCalls(QueryCommand)[0];
    const input = queryCall?.args[0]?.input;
    expect(input?.ExpressionAttributeValues?.[':uid']).toBe(OWNER_USER_ID);
  });

  it('2. returns empty array when user has no documents', async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [] });

    const event = buildEvent('GET', {}, OWNER_USER_ID);
    const result = await handler(event, {} as never);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(body['data']).toEqual([]);
  });
});

describe('DELETE /documents/{documentId}', () => {
  it('3. DELETE by different userId (not the owner) returns 403', async () => {
    // The GET lookup uses PK = USER#{callerUserId} so the doc is not found
    // (because the actual doc lives under PK = USER#{ownerUserId})
    // The handler throws NotFoundError, not ForbiddenError in this case.
    // But if the doc IS returned with a different userId field, it throws 403.
    dynamoMock.on(GetCommand).resolves({
      Item: buildDocRecord(OWNER_USER_ID), // doc owned by ownerUserId
    });

    const event = buildEvent(
      'DELETE',
      { pathParameters: { documentId: DOCUMENT_ID } },
      CALLER_USER_ID, // different caller
    );

    const result = await handler(event, {} as never);
    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(body['error']).toBe('FORBIDDEN');
  });

  it('4. DELETE by owner calls S3 delete, KB sync, DDB delete, returns 200', async () => {
    dynamoMock.on(GetCommand).resolves({ Item: buildDocRecord(OWNER_USER_ID) });
    dynamoMock.on(DeleteCommand).resolves({});

    const event = buildEvent(
      'DELETE',
      { pathParameters: { documentId: DOCUMENT_ID } },
      OWNER_USER_ID,
    );

    const result = await handler(event, {} as never);

    expect(result.statusCode).toBe(200);
    expect(s3Mock).toHaveReceivedCommandTimes(DeleteObjectCommand, 1);
    expect(bedrockAgentMock).toHaveReceivedCommandTimes(StartIngestionJobCommand, 1);
    expect(dynamoMock).toHaveReceivedCommandTimes(DeleteCommand, 1);

    const body = JSON.parse(result.body) as Record<string, unknown>;
    const data = body['data'] as Record<string, unknown>;
    expect(data['deleted']).toBe(true);
    expect(data['documentId']).toBe(DOCUMENT_ID);
  });

  it('5. DELETE non-existent document returns 404', async () => {
    dynamoMock.on(GetCommand).resolves({ Item: undefined });

    const event = buildEvent(
      'DELETE',
      { pathParameters: { documentId: 'nonexistent-doc-id' } },
      OWNER_USER_ID,
    );

    const result = await handler(event, {} as never);
    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(body['error']).toBe('NOT_FOUND');
  });

  it('6. DELETE without documentId path parameter returns 400', async () => {
    const event = buildEvent('DELETE', { pathParameters: null }, OWNER_USER_ID);
    const result = await handler(event, {} as never);
    expect(result.statusCode).toBe(400);
  });
});

describe('PATCH /documents/{documentId}/status', () => {
  it('7. PATCH with valid status calls UpdateCommand and returns 200', async () => {
    dynamoMock.on(GetCommand).resolves({ Item: buildDocRecord(OWNER_USER_ID) });
    dynamoMock.on(UpdateCommand).resolves({});

    const event = buildEvent(
      'PATCH',
      {
        pathParameters: { documentId: DOCUMENT_ID },
        body: JSON.stringify({ status: 'ready' }),
      },
      OWNER_USER_ID,
    );

    const result = await handler(event, {} as never);

    expect(result.statusCode).toBe(200);
    expect(dynamoMock).toHaveReceivedCommandTimes(UpdateCommand, 1);

    const updateCall = dynamoMock.commandCalls(UpdateCommand)[0];
    const values = updateCall?.args[0]?.input?.ExpressionAttributeValues;
    expect(values?.[':status']).toBe('ready');

    const body = JSON.parse(result.body) as Record<string, unknown>;
    const data = body['data'] as Record<string, unknown>;
    expect(data['status']).toBe('ready');
    expect(data['documentId']).toBe(DOCUMENT_ID);
  });

  it('8. PATCH with invalid status returns 400', async () => {
    const event = buildEvent(
      'PATCH',
      {
        pathParameters: { documentId: DOCUMENT_ID },
        body: JSON.stringify({ status: 'invalid-status' }),
      },
      OWNER_USER_ID,
    );

    const result = await handler(event, {} as never);
    expect(result.statusCode).toBe(400);
  });

  it('9. PATCH without documentId returns 400', async () => {
    const event = buildEvent(
      'PATCH',
      {
        pathParameters: null,
        body: JSON.stringify({ status: 'ready' }),
      },
      OWNER_USER_ID,
    );

    const result = await handler(event, {} as never);
    expect(result.statusCode).toBe(400);
  });

  it('10. PATCH on non-existent document returns 404', async () => {
    dynamoMock.on(GetCommand).resolves({ Item: undefined });

    const event = buildEvent(
      'PATCH',
      {
        pathParameters: { documentId: 'nonexistent' },
        body: JSON.stringify({ status: 'ready' }),
      },
      OWNER_USER_ID,
    );

    const result = await handler(event, {} as never);
    expect(result.statusCode).toBe(404);
  });

  it('11. PATCH on document owned by another user returns 403', async () => {
    // Doc record has userId=OWNER, but caller is CALLER
    dynamoMock.on(GetCommand).resolves({ Item: buildDocRecord(OWNER_USER_ID) });

    const event = buildEvent(
      'PATCH',
      {
        pathParameters: { documentId: DOCUMENT_ID },
        body: JSON.stringify({ status: 'ready' }),
      },
      CALLER_USER_ID, // different caller
    );

    const result = await handler(event, {} as never);
    expect(result.statusCode).toBe(403);
  });

  it('12. PATCH accepts all valid status values', async () => {
    const validStatuses = ['uploaded', 'processing', 'ready', 'failed'];

    for (const status of validStatuses) {
      dynamoMock.reset();
      dynamoMock.on(GetCommand).resolves({ Item: buildDocRecord(OWNER_USER_ID) });
      dynamoMock.on(UpdateCommand).resolves({});

      const event = buildEvent(
        'PATCH',
        {
          pathParameters: { documentId: DOCUMENT_ID },
          body: JSON.stringify({ status }),
        },
        OWNER_USER_ID,
      );

      const result = await handler(event, {} as never);
      expect(result.statusCode).toBe(200);
    }
  });
});

describe('Unsupported methods', () => {
  it('13. PUT method returns 400', async () => {
    const event = buildEvent('PUT', {}, OWNER_USER_ID);
    const result = await handler(event, {} as never);
    expect(result.statusCode).toBe(400);
  });
});
