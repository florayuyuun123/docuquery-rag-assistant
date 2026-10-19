/**
 * Unit tests for the query handler.
 *
 * Validates Requirements 6.1–6.7, 7.1–7.5, 8.1–8.5, 9.1
 */

import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';
import type { KnowledgeBaseRetrievalResult as RetrievalResult } from '@aws-sdk/client-bedrock-agent-runtime';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';

import { handler } from '../../src/query/handler';

// ── AWS SDK mocks ────────────────────────────────────────────────────────────
const dynamoMock = mockClient(DynamoDBDocumentClient);
const bedrockRuntimeMock = mockClient(BedrockAgentRuntimeClient);
const bedrockInvokeMock = mockClient(BedrockRuntimeClient);

// ── Constants ────────────────────────────────────────────────────────────────
const USER_ID = 'query-test-user-uuid';
const DEFAULT_SIMILARITY_THRESHOLD = 0.5;

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildEvent(
  body: Record<string, unknown>,
  userId = USER_ID,
): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    resource: '/query',
    path: '/query',
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
    body: JSON.stringify(body),
  };
}

function buildClaudeResponseBody(text: string): unknown {
  const response = {
    content: [{ type: 'text', text }],
  };
  return new TextEncoder().encode(JSON.stringify(response));
}

function buildRetrievalResult(score: number, index: number): RetrievalResult {
  return {
    score,
    content: { text: `Chunk text ${index}` },
    metadata: {
      documentId: `doc-id-${index}`,
      documentName: `document-${index}.pdf`,
      pageNumber: index + 1,
    },
    location: {
      type: 'S3',
      s3Location: { uri: `s3://bucket/key-${index}` },
    },
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  dynamoMock.reset();
  bedrockRuntimeMock.reset();
  bedrockInvokeMock.reset();

  process.env['TABLE_NAME'] = 'test-table';
  process.env['KNOWLEDGE_BASE_ID'] = 'test-kb-id';
  process.env['SIMILARITY_THRESHOLD'] = String(DEFAULT_SIMILARITY_THRESHOLD);
  process.env['CLAUDE_MODEL_ID'] = 'anthropic.claude-3-haiku-20240307-v1:0';

  // Default: DynamoDB PutCommand resolves
  dynamoMock.on(PutCommand).resolves({});
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /query — no ready documents', () => {
  it('1. no ready documents returns fallback, Bedrock Retrieve is NOT called', async () => {
    // DynamoDB returns 0 ready documents
    dynamoMock.on(QueryCommand).resolves({ Items: [] });

    const event = buildEvent({ question: 'What is the document about?' });
    const result = await handler(event, {} as never);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    const data = body['data'] as Record<string, unknown>;

    expect(data['isFallback']).toBe(true);
    expect(data['citations']).toEqual([]);
    expect(typeof data['answer']).toBe('string');
    expect((data['answer'] as string).length).toBeGreaterThan(0);

    // Bedrock Retrieve should NOT have been called
    expect(bedrockRuntimeMock).not.toHaveReceivedCommand(RetrieveCommand);

    // Chat record IS persisted even for fallback
    expect(dynamoMock).toHaveReceivedCommandTimes(PutCommand, 1);
  });
});

describe('POST /query — zero chunks above threshold', () => {
  it('2. all chunks below threshold returns fallback, Claude is NOT called', async () => {
    // DynamoDB: one ready doc exists
    dynamoMock.on(QueryCommand).resolves({
      Items: [{ documentId: 'doc-1', status: 'ready' }],
    });

    // Bedrock returns chunks but ALL below threshold (0.1 < 0.5)
    bedrockRuntimeMock.on(RetrieveCommand).resolves({
      retrievalResults: [
        buildRetrievalResult(0.1, 0),
        buildRetrievalResult(0.2, 1),
      ],
    });

    const event = buildEvent({ question: 'What is the answer?' });
    const result = await handler(event, {} as never);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    const data = body['data'] as Record<string, unknown>;

    expect(data['isFallback']).toBe(true);
    expect(data['citations']).toEqual([]);

    // Claude InvokeModel should NOT have been called
    expect(bedrockInvokeMock).not.toHaveReceivedCommand(InvokeModelCommand);
  });
});

describe('POST /query — successful answer', () => {
  it('3. successful answer assembles citations correctly, isFallback=false, chat record persisted', async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [{ documentId: 'doc-1', status: 'ready' }],
    });

    const highScoreChunks = [
      buildRetrievalResult(0.9, 0),
      buildRetrievalResult(0.8, 1),
    ];

    bedrockRuntimeMock.on(RetrieveCommand).resolves({
      retrievalResults: highScoreChunks,
    });

    bedrockInvokeMock.on(InvokeModelCommand).resolves({ body: buildClaudeResponseBody('The answer is 42.') } as never);

    const event = buildEvent({ question: 'What is the answer?' });
    const result = await handler(event, {} as never);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    const data = body['data'] as Record<string, unknown>;

    expect(data['isFallback']).toBe(false);
    expect(data['answer']).toBe('The answer is 42.');

    const citations = data['citations'] as Array<Record<string, unknown>>;
    expect(citations).toHaveLength(2);
    expect(citations[0]['documentId']).toBe('doc-id-0');
    expect(citations[0]['documentName']).toBe('document-0.pdf');
    expect(citations[0]['pageNumber']).toBe(1);
    expect(citations[0]['chunkText']).toBe('Chunk text 0');
    expect(citations[0]['relevanceScore']).toBe(0.9);

    // Chat record persisted
    expect(dynamoMock).toHaveReceivedCommandTimes(PutCommand, 1);
    const putCall = dynamoMock.commandCalls(PutCommand)[0];
    const item = putCall?.args[0]?.input?.Item as Record<string, unknown> | undefined;
    expect(item!['isFallback']).toBe(false);
    expect(item!['answer']).toBe('The answer is 42.');
    expect(item!['userId']).toBe(USER_ID);
  });
});

describe('POST /query — Bedrock Claude error', () => {
  it('4. Bedrock Claude error returns 502', async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [{ documentId: 'doc-1', status: 'ready' }],
    });

    bedrockRuntimeMock.on(RetrieveCommand).resolves({
      retrievalResults: [buildRetrievalResult(0.9, 0)],
    });

    bedrockInvokeMock.on(InvokeModelCommand).rejects(new Error('Bedrock service error'));

    const event = buildEvent({ question: 'What is the meaning of life?' });
    const result = await handler(event, {} as never);

    expect(result.statusCode).toBe(502);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(body['error']).toBe('SERVICE_ERROR');
  });
});

describe('POST /query — threshold filtering', () => {
  it('5. chunks with score 0.1 all below SIMILARITY_THRESHOLD=0.5 trigger fallback', async () => {
    // Explicitly set threshold via env
    process.env['SIMILARITY_THRESHOLD'] = '0.5';

    dynamoMock.on(QueryCommand).resolves({
      Items: [{ documentId: 'doc-1', status: 'ready' }],
    });

    bedrockRuntimeMock.on(RetrieveCommand).resolves({
      retrievalResults: [
        buildRetrievalResult(0.1, 0),
        buildRetrievalResult(0.1, 1),
        buildRetrievalResult(0.1, 2),
      ],
    });

    const event = buildEvent({ question: 'Tell me about the topic.' });
    const result = await handler(event, {} as never);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    const data = body['data'] as Record<string, unknown>;
    expect(data['isFallback']).toBe(true);
    expect(bedrockInvokeMock).not.toHaveReceivedCommand(InvokeModelCommand);
  });
});

describe('POST /query — validation', () => {
  it('6. missing question returns 400', async () => {
    const event = buildEvent({ question: '' });
    const result = await handler(event, {} as never);
    expect(result.statusCode).toBe(400);
  });

  it('7. missing request body returns 400', async () => {
    const event = buildEvent({ question: 'Valid question' });
    (event as unknown as Record<string, unknown>)['body'] = null;
    const result = await handler(event, {} as never);
    expect(result.statusCode).toBe(400);
  });

  it('8. sessionId from request is reused in chat record', async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [] });

    const event = buildEvent({
      question: 'What is this?',
      sessionId: 'my-existing-session',
    });

    const result = await handler(event, {} as never);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    const data = body['data'] as Record<string, unknown>;
    expect(data['sessionId']).toBe('my-existing-session');
  });
});



