/**
 * Unit tests for the upload-url handler.
 *
 * Validates Requirements 3.1, 3.2, 3.5, 3.6, 3.10, 10.4
 */

import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

// Mock the presigner before importing the handler (it pulls getSignedUrl at module load)
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://mock-presigned-url'),
}));

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { handler } from '../../src/upload-url/handler';
import { APIGatewayProxyEvent } from 'aws-lambda';

// ── AWS SDK mocks ────────────────────────────────────────────────────────────
const s3Mock = mockClient(S3Client);
const dynamoMock = mockClient(DynamoDBDocumentClient);

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    resource: '/documents/upload-url',
    path: '/documents/upload-url',
    headers: { 'Content-Type': 'application/json' },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    isBase64Encoded: false,
    requestContext: {
      authorizer: {
        claims: {
          sub: 'user-abc-123',
        },
      },
    } as unknown as APIGatewayProxyEvent['requestContext'],
    body: JSON.stringify({
      fileName: 'test.pdf',
      contentType: 'application/pdf',
      fileSize: 1_000_000,
    }),
    ...overrides,
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  s3Mock.reset();
  dynamoMock.reset();
  // S3 PutObjectCommand — the presigner calls it internally but we just need it resolved
  s3Mock.on(PutObjectCommand).resolves({});
  // DynamoDB PutCommand
  dynamoMock.on(PutCommand).resolves({});
  // Reset the signed-URL mock to default each time
  (getSignedUrl as jest.Mock).mockResolvedValue('https://mock-presigned-url');

  process.env['BUCKET_NAME'] = 'test-bucket';
  process.env['TABLE_NAME'] = 'test-table';
});

afterEach(() => {
  jest.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /documents/upload-url', () => {
  it('1. valid PDF upload returns 200 with presignedUrl and documentId', async () => {
    const event = buildEvent();
    const result = await handler(event, {} as never);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    const data = body['data'] as Record<string, unknown>;
    expect(data['presignedUrl']).toBe('https://mock-presigned-url');
    expect(typeof data['documentId']).toBe('string');
    expect((data['documentId'] as string).length).toBeGreaterThan(0);
    expect(typeof data['s3Key']).toBe('string');
  });

  it('2. unsupported MIME type (image/jpeg) returns 400', async () => {
    const event = buildEvent({
      body: JSON.stringify({
        fileName: 'photo.jpg',
        contentType: 'image/jpeg',
        fileSize: 500_000,
      }),
    });

    const result = await handler(event, {} as never);
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(body['error']).toBe('VALIDATION_ERROR');
  });

  it('3. file exceeding 20 MB returns 400', async () => {
    const event = buildEvent({
      body: JSON.stringify({
        fileName: 'big-file.pdf',
        contentType: 'application/pdf',
        fileSize: 21_000_000, // > 20 971 520
      }),
    });

    const result = await handler(event, {} as never);
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(body['error']).toBe('VALIDATION_ERROR');
    expect(body['message'] as string).toMatch(/exceed/i);
  });

  it('4. missing fileName returns 400', async () => {
    const event = buildEvent({
      body: JSON.stringify({
        contentType: 'application/pdf',
        fileSize: 1_000_000,
      }),
    });

    const result = await handler(event, {} as never);
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(body['error']).toBe('VALIDATION_ERROR');
  });

  it('5. DynamoDB PutCommand called with status=uploaded and correct PK/SK format', async () => {
    const event = buildEvent();
    await handler(event, {} as never);

    // Check PutCommand was called once
    expect(dynamoMock).toHaveReceivedCommandTimes(PutCommand, 1);

    const call = dynamoMock.commandCalls(PutCommand)[0];
    const item = call?.args[0]?.input?.Item as Record<string, unknown> | undefined;

    expect(item).toBeDefined();
    expect(item!['status']).toBe('uploaded');
    expect(item!['PK']).toMatch(/^USER#/);
    expect(item!['SK']).toMatch(/^DOC#/);
    expect(item!['userId']).toBe('user-abc-123');
    expect(item!['contentType']).toBe('application/pdf');
  });

  it('6. DOCX upload is accepted (returns 200)', async () => {
    const event = buildEvent({
      body: JSON.stringify({
        fileName: 'report.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileSize: 2_000_000,
      }),
    });

    const result = await handler(event, {} as never);
    expect(result.statusCode).toBe(200);
  });

  it('7. TXT upload is accepted (returns 200)', async () => {
    const event = buildEvent({
      body: JSON.stringify({
        fileName: 'notes.txt',
        contentType: 'text/plain',
        fileSize: 50_000,
      }),
    });

    const result = await handler(event, {} as never);
    expect(result.statusCode).toBe(200);
  });

  it('8. missing userId in claims returns 400', async () => {
    const event = buildEvent({
      requestContext: {
        authorizer: { claims: {} },
      } as unknown as APIGatewayProxyEvent['requestContext'],
    });

    const result = await handler(event, {} as never);
    expect(result.statusCode).toBe(400);
  });

  it('9. response always includes x-correlation-id header', async () => {
    const event = buildEvent();
    const result = await handler(event, {} as never);
    expect(result.headers?.['x-correlation-id']).toBeDefined();
  });

  it('10. file at exactly 20 MB boundary (20971520) is accepted', async () => {
    const event = buildEvent({
      body: JSON.stringify({
        fileName: 'maxsize.pdf',
        contentType: 'application/pdf',
        fileSize: 20_971_520, // exactly MAX_FILE_SIZE_BYTES
      }),
    });

    const result = await handler(event, {} as never);
    expect(result.statusCode).toBe(200);
  });
});
