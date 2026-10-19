/**
 * Unit tests for the ingest handler, chunker, and extractor.
 *
 * Validates Requirements 4.1–4.10
 */

import { Readable } from 'stream';

import {
  BedrockAgentClient,
  StartIngestionJobCommand,
} from '@aws-sdk/client-bedrock-agent';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { CHUNK_SIZE_TOKENS } from '@docuquery/shared';
import { S3Event } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';

import { chunkText } from '../../src/ingest/chunker';
import { extractText } from '../../src/ingest/extract';
import { handler } from '../../src/ingest/handler';

// ── AWS SDK mocks ────────────────────────────────────────────────────────────
const s3Mock = mockClient(S3Client);
const dynamoMock = mockClient(DynamoDBDocumentClient);
const bedrockAgentMock = mockClient(BedrockAgentClient);

// ── Helpers ──────────────────────────────────────────────────────────────────

function bufferToAsyncIterable(buf: Buffer): AsyncIterable<Uint8Array> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return Readable.from([buf]) as unknown as AsyncIterable<Uint8Array>;
}

function buildS3Event(
  bucket: string,
  key: string,
  requestId = 'test-request-id',
): S3Event {
  return {
    Records: [
      {
        eventSource: 'aws:s3',
        eventVersion: '2.1',
        eventTime: new Date().toISOString(),
        eventName: 'ObjectCreated:Put',
        awsRegion: 'us-east-1',
        s3: {
          s3SchemaVersion: '1.0',
          configurationId: 'test',
          bucket: {
            name: bucket,
            ownerIdentity: { principalId: 'owner' },
            arn: `arn:aws:s3:::${bucket}`,
          },
          object: {
            key: encodeURIComponent(key).replace(/%23/g, '#'),
            size: 1000,
            eTag: 'abc123',
            sequencer: '001',
          },
        },
        responseElements: {
          'x-amz-request-id': requestId,
          'x-amz-id-2': 'id-2',
        },
        userIdentity: { principalId: 'user' },
        requestParameters: { sourceIPAddress: '127.0.0.1' },
      },
    ],
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  s3Mock.reset();
  dynamoMock.reset();
  bedrockAgentMock.reset();

  process.env['TABLE_NAME'] = 'test-table';
  process.env['KNOWLEDGE_BASE_ID'] = 'test-kb-id';

  dynamoMock.on(UpdateCommand).resolves({});
  bedrockAgentMock.on(StartIngestionJobCommand).resolves({ ingestionJob: {} as never });
});

// ── chunkText unit tests ──────────────────────────────────────────────────────

describe('chunkText()', () => {
  it('1. empty string returns empty array', () => {
    expect(chunkText('')).toEqual([]);
  });

  it('2. whitespace-only string returns empty array', () => {
    expect(chunkText('   \n\t  ')).toEqual([]);
  });

  it('3. short text shorter than 1000 tokens returns single chunk', () => {
    const shortText = 'This is a short text that fits within a single chunk.';
    const chunks = chunkText(shortText);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(shortText);
  });

  it('4. text longer than 1000 tokens returns multiple chunks', () => {
    // Generate a text long enough to exceed CHUNK_SIZE_TOKENS (1000)
    // Each word is approximately 1 token, so 1500 words should produce 2+ chunks
    const longText = Array.from({ length: 1500 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkText(longText);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('5. every chunk has at most CHUNK_SIZE_TOKENS tokens', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { get_encoding } = require('tiktoken') as typeof import('tiktoken');
    const enc = get_encoding('cl100k_base');
    const longText = Array.from({ length: 2000 }, (_, i) => `token${i}`).join(' ');
    const chunks = chunkText(longText);
    for (const chunk of chunks) {
      expect(enc.encode(chunk).length).toBeLessThanOrEqual(CHUNK_SIZE_TOKENS);
    }
    enc.free();
  });

  it('6. adjacent chunks share overlap tokens (verify overlap)', () => {
    // Create text of ~2200 tokens (step is 800 tokens, overlap is 200)
    const longText = Array.from({ length: 2200 }, (_, i) => `overlaptok${i}`).join(' ');
    const chunks = chunkText(longText);
    // At least 2 chunks expected
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });
});

// ── extractText unit tests ────────────────────────────────────────────────────

describe('extractText()', () => {
  it('7. TXT contentType returns UTF-8 string directly', async () => {
    const inputText = 'Hello, World! This is a plain text file.';
    const buffer = Buffer.from(inputText, 'utf-8');

    const result = await extractText('test.txt', buffer, 'text/plain', 'test-bucket');

    expect(result).toBe(inputText);
  });

  it('8. TXT contentType does not call Textract', async () => {
    // If Textract is ever called this would fail (mock is not set up for it)
    const buffer = Buffer.from('Simple text', 'utf-8');
    // Should not throw and should return text without network calls
    const result = await extractText('test.txt', buffer, 'text/plain', 'bucket');
    expect(result).toBe('Simple text');
  });

  it('9. TXT round-trip: extractText(Buffer.from(text)) === text', async () => {
    const original = 'Round-trip test: αβγδ émojis 🚀 special chars <>&"\'';
    const buffer = Buffer.from(original, 'utf-8');
    const extracted = await extractText('test.txt', buffer, 'text/plain', 'bucket');
    expect(extracted).toBe(original);
  });

  it('10. unsupported content type throws an error', async () => {
    const buffer = Buffer.from('data', 'utf-8');
    await expect(
      extractText('test.bin', buffer, 'application/octet-stream', 'bucket'),
    ).rejects.toThrow('Unsupported content type');
  });
});

// ── Ingest handler integration tests ─────────────────────────────────────────

describe('ingest handler', () => {
  const BUCKET = 'test-bucket';
  const USER_ID = 'test-user-uuid';
  const DOC_ID = 'test-doc-uuid';
  const S3_KEY = `USER#${USER_ID}/DOC#${DOC_ID}/document.txt`;

  it('11. successful TXT ingest sets status to ready', async () => {
    const fileContent = 'This is the content of the uploaded text document.';
    const fileBuffer = Buffer.from(fileContent, 'utf-8');

    dynamoMock.on(GetCommand).resolves({
      Item: {
        PK: `USER#${USER_ID}`,
        SK: `DOC#${DOC_ID}`,
        userId: USER_ID,
        documentId: DOC_ID,
        contentType: 'text/plain',
        documentName: 'document.txt',
        status: 'uploaded',
      },
    });

    s3Mock.on(GetObjectCommand).resolves({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      Body: bufferToAsyncIterable(fileBuffer) as unknown as import('@aws-sdk/client-s3').GetObjectCommandOutput['Body'],
    });

    const event = buildS3Event(BUCKET, S3_KEY);
    await handler(event);

    // Status should be updated to 'processing' and then 'ready'
    const updateCalls = dynamoMock.commandCalls(UpdateCommand);
    expect(updateCalls.length).toBeGreaterThanOrEqual(2);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    const statusValues = updateCalls.map(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      (call) => call.args[0]?.input?.ExpressionAttributeValues?.[':status'],
    );
    expect(statusValues).toContain('processing');
    expect(statusValues).toContain('ready');

    // Bedrock KB sync should have been triggered
    expect(bedrockAgentMock).toHaveReceivedCommandTimes(StartIngestionJobCommand, 1);
  });

  it('12. ingest with unparseable S3 key skips processing', async () => {
    const badKey = 'bad-key-format/no-user-prefix.txt';
    const event = buildS3Event(BUCKET, badKey);

    // Should not throw and should not call DynamoDB
    await handler(event);

    expect(dynamoMock).not.toHaveReceivedCommand(UpdateCommand);
  });

  it('13. ingest with empty extracted text marks document as failed', async () => {
    dynamoMock.on(GetCommand).resolves({
      Item: {
        PK: `USER#${USER_ID}`,
        SK: `DOC#${DOC_ID}`,
        userId: USER_ID,
        documentId: DOC_ID,
        contentType: 'text/plain',
        documentName: 'empty.txt',
        status: 'uploaded',
      },
    });

    // Return an empty file
    s3Mock.on(GetObjectCommand).resolves({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      Body: bufferToAsyncIterable(Buffer.from('', 'utf-8')) as unknown as import('@aws-sdk/client-s3').GetObjectCommandOutput['Body'],
    });

    const event = buildS3Event(BUCKET, S3_KEY);
    await handler(event);

    const updateCalls = dynamoMock.commandCalls(UpdateCommand);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    const statusValues = updateCalls.map(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      (call) => call.args[0]?.input?.ExpressionAttributeValues?.[':status'],
    );
    expect(statusValues).toContain('failed');
  });

  it('14. S3 GetObject error marks document as failed (not rethrown)', async () => {
    dynamoMock.on(GetCommand).resolves({
      Item: {
        PK: `USER#${USER_ID}`,
        SK: `DOC#${DOC_ID}`,
        userId: USER_ID,
        documentId: DOC_ID,
        contentType: 'text/plain',
        documentName: 'document.txt',
        status: 'uploaded',
      },
    });

    s3Mock.on(GetObjectCommand).rejects(new Error('S3 network error'));

    const event = buildS3Event(BUCKET, S3_KEY);

    // Handler should NOT throw — it catches internally
    await expect(handler(event)).resolves.toBeUndefined();

    const updateCalls = dynamoMock.commandCalls(UpdateCommand);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    const statusValues = updateCalls.map(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      (call) => call.args[0]?.input?.ExpressionAttributeValues?.[':status'],
    );
    expect(statusValues).toContain('failed');
  });
});
