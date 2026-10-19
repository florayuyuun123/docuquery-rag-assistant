/**
 * Unit tests for the history handler.
 *
 * Validates Requirements 9.1–9.5
 */

import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';

import { handler } from '../../src/history/handler';

// ── AWS SDK mocks ────────────────────────────────────────────────────────────
const dynamoMock = mockClient(DynamoDBDocumentClient);

// ── Constants ────────────────────────────────────────────────────────────────
const USER_ID = 'history-test-user-uuid';

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildEvent(userId = USER_ID): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    resource: '/history',
    path: '/history',
    headers: {},
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
  };
}

function buildChatRecord(index: number, userId = USER_ID) {
  const ts = new Date(Date.now() - index * 60_000).toISOString();
  return {
    PK: `USER#${userId}`,
    SK: `CHAT#session-${index}#${ts}`,
    userId,
    sessionId: `session-${index}`,
    question: `Question ${index}`,
    answer: `Answer ${index}`,
    citations: [],
    isFallback: false,
    createdAt: ts,
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  dynamoMock.reset();
  process.env['TABLE_NAME'] = 'test-table';
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /history', () => {
  it('1. returns chat records in DynamoDB response order', async () => {
    const records = [
      buildChatRecord(0), // most recent
      buildChatRecord(1),
      buildChatRecord(2), // oldest
    ];
    dynamoMock.on(QueryCommand).resolves({ Items: records });

    const event = buildEvent();
    const result = await handler(event, {} as never);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    const data = body['data'] as Array<Record<string, unknown>>;

    expect(data).toHaveLength(3);
    // Order is preserved exactly as returned by DynamoDB
    expect(data[0]['SK']).toBe(records[0]['SK']);
    expect(data[1]['SK']).toBe(records[1]['SK']);
    expect(data[2]['SK']).toBe(records[2]['SK']);
  });

  it('2. QueryCommand is called with Limit=50', async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [] });

    const event = buildEvent();
    await handler(event, {} as never);

    expect(dynamoMock).toHaveReceivedCommandTimes(QueryCommand, 1);
    const queryCall = dynamoMock.commandCalls(QueryCommand)[0];
    const input = queryCall?.args[0]?.input;
    expect(input?.Limit).toBe(50);
  });

  it('3. QueryCommand is called with ScanIndexForward=false', async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [] });

    const event = buildEvent();
    await handler(event, {} as never);

    const queryCall = dynamoMock.commandCalls(QueryCommand)[0];
    const input = queryCall?.args[0]?.input;
    expect(input?.ScanIndexForward).toBe(false);
  });

  it('4. DynamoDB error propagates as 500', async () => {
    dynamoMock.on(QueryCommand).rejects(new Error('DynamoDB connection error'));

    const event = buildEvent();
    const result = await handler(event, {} as never);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(body['error']).toBe('INTERNAL_ERROR');
  });

  it('5. returns empty array when no chat history exists', async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: undefined });

    const event = buildEvent();
    const result = await handler(event, {} as never);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(body['data']).toEqual([]);
  });

  it('6. QueryCommand scoped to correct PK for the caller', async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [] });

    const event = buildEvent('specific-user-uuid');
    await handler(event, {} as never);

    const queryCall = dynamoMock.commandCalls(QueryCommand)[0];
    const input = queryCall?.args[0]?.input;
    expect(input?.ExpressionAttributeValues?.[':pk']).toBe('USER#specific-user-uuid');
  });

  it('7. QueryCommand filters by CHAT# SK prefix', async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [] });

    const event = buildEvent();
    await handler(event, {} as never);

    const queryCall = dynamoMock.commandCalls(QueryCommand)[0];
    const input = queryCall?.args[0]?.input;
    expect(input?.ExpressionAttributeValues?.[':chatPrefix']).toBe('CHAT#');
  });

  it('8. missing userId in claims returns 400', async () => {
    const event = buildEvent();
    (event as unknown as Record<string, unknown>)['requestContext'] = { authorizer: { claims: {} } };

    const result = await handler(event, {} as never);
    expect(result.statusCode).toBe(400);
  });

  it('9. response always includes correlationId', async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [] });

    const event = buildEvent();
    const result = await handler(event, {} as never);

    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(typeof body['correlationId']).toBe('string');
    expect((body['correlationId'] as string).length).toBeGreaterThan(0);
  });
});

