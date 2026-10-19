/**
 * Query handler
 *
 * POST /query
 *
 * Retrieves relevant chunks from the Bedrock Knowledge Base scoped to the
 * caller's documents, invokes Claude to generate a grounded answer, assembles
 * citations, persists the chat record, and returns the response.
 *
 * Satisfies Requirements 6.1–6.7, 7.1–7.5, 8.1–8.5, 9.1.
 */

import { APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { randomUUID } from 'crypto';
import {
  USER_PREFIX,
  CHAT_PREFIX,
  USER_CREATED_AT_INDEX,
  DEFAULT_SIMILARITY_THRESHOLD,
  DEFAULT_CLAUDE_MODEL_ID,
} from '@docuquery/shared';
import type { Citation, ChatRecord } from '@docuquery/shared';
import { ValidationError, ServiceError, TimeoutError } from '../lib/errors.js';
import { withMiddleware } from '../lib/middleware.js';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrockRuntime = new BedrockAgentRuntimeClient({});
const bedrockInvoke = new BedrockRuntimeClient({});

const TABLE_NAME = process.env['TABLE_NAME'] ?? '';
const KNOWLEDGE_BASE_ID = process.env['KNOWLEDGE_BASE_ID'] ?? '';
const SIMILARITY_THRESHOLD = parseFloat(
  process.env['SIMILARITY_THRESHOLD'] ?? String(DEFAULT_SIMILARITY_THRESHOLD),
);
const CLAUDE_MODEL_ID = process.env['CLAUDE_MODEL_ID'] ?? DEFAULT_CLAUDE_MODEL_ID;

const SYSTEM_PROMPT = `You are a document question-answering assistant. Answer the user's question using ONLY the document excerpts provided below. Do not use any knowledge from outside these excerpts. If the excerpts do not contain enough information to answer the question, respond only with: "I could not find an answer to your question in the provided documents." Do not add supplemental information, speculation, or context from outside the provided excerpts.`;

const FALLBACK_NO_DOCS =
  'No documents are currently available to query. Please upload a document first and wait for it to finish processing.';

const FALLBACK_NO_CHUNKS =
  'I could not find an answer to your question in the provided documents.';

interface QueryRequestBody {
  question: string;
  sessionId?: string;
}

interface ClaudeMessage {
  role: string;
  content: string;
}

interface ClaudeRequest {
  anthropic_version: string;
  system: string;
  messages: ClaudeMessage[];
  max_tokens: number;
}

interface ClaudeResponse {
  content: Array<{ type: string; text: string }>;
}

export const handler = withMiddleware('query-fn', async (event, _context, correlationId): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext?.authorizer?.claims?.sub as string | undefined;
  if (!userId) {
    throw new ValidationError('Missing userId in authorizer claims', correlationId);
  }

  if (!event.body) {
    throw new ValidationError('Request body is required', correlationId);
  }

  let body: QueryRequestBody;
  try {
    body = JSON.parse(event.body) as QueryRequestBody;
  } catch {
    throw new ValidationError('Request body must be valid JSON', correlationId);
  }

  const { question, sessionId: incomingSessionId } = body;

  if (!question || typeof question !== 'string' || question.trim() === '') {
    throw new ValidationError('question is required', correlationId);
  }

  const sessionId = incomingSessionId ?? randomUUID();
  const now = new Date().toISOString();

  // Check if the user has any "ready" documents (Req 7.5)
  const docsResult = await dynamo.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: USER_CREATED_AT_INDEX,
      KeyConditionExpression: 'userId = :uid',
      FilterExpression: '#status = :ready',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':uid': userId, ':ready': 'ready' },
      // We only need to know if at least one exists
      Limit: 1,
    }),
  );

  if (!docsResult.Items || docsResult.Items.length === 0) {
    // No ready documents — return friendly message without invoking Bedrock
    const chatRecord: ChatRecord = {
      PK: `${USER_PREFIX}${userId}`,
      SK: `${CHAT_PREFIX}${sessionId}#${now}`,
      userId,
      sessionId,
      question,
      answer: FALLBACK_NO_DOCS,
      citations: [],
      isFallback: true,
      createdAt: now,
    };

    await dynamo.send(new PutCommand({ TableName: TABLE_NAME, Item: chatRecord }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        data: {
          answer: FALLBACK_NO_DOCS,
          citations: [],
          sessionId,
          isFallback: true,
        },
        correlationId,
      }),
    };
  }

  // Retrieve top-5 relevant chunks from KB, scoped to userId (Req 6.1)
  const retrieveResult = await bedrockRuntime.send(
    new RetrieveCommand({
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      retrievalQuery: { text: question },
      retrievalConfiguration: {
        vectorSearchConfiguration: {
          numberOfResults: 5,
          filter: {
            equals: {
              key: 'userId',
              value: userId,
            },
          },
        },
      },
    }),
  );

  const retrievedResults = retrieveResult.retrievalResults ?? [];

  // Filter chunks by similarity threshold (Req 7.1)
  const relevantResults = retrievedResults.filter((r) => {
    const score = r.score ?? 0;
    return score >= SIMILARITY_THRESHOLD;
  });

  if (relevantResults.length === 0) {
    // Fallback — no chunks above threshold
    const chatRecord: ChatRecord = {
      PK: `${USER_PREFIX}${userId}`,
      SK: `${CHAT_PREFIX}${sessionId}#${now}`,
      userId,
      sessionId,
      question,
      answer: FALLBACK_NO_CHUNKS,
      citations: [],
      isFallback: true,
      createdAt: now,
    };

    await dynamo.send(new PutCommand({ TableName: TABLE_NAME, Item: chatRecord }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        data: {
          answer: FALLBACK_NO_CHUNKS,
          citations: [],
          sessionId,
          isFallback: true,
        },
        correlationId,
      }),
    };
  }

  // Assemble citations from the retrieved chunks (Req 8.1–8.2)
  const citations: Citation[] = relevantResults.map((r) => {
    const meta = r.metadata ?? {};
    return {
      documentId: (meta['documentId'] as string | undefined) ?? '',
      documentName: (meta['documentName'] as string | undefined) ?? 'Unknown document',
      pageNumber: (meta['pageNumber'] as number | null | undefined) ?? null,
      chunkText: r.content?.text ?? '',
      relevanceScore: r.score ?? 0,
    };
  });

  // Build the user message with document excerpts (Req 6.2, 6.4)
  const excerpts = relevantResults
    .map((r, i) => {
      const meta = r.metadata ?? {};
      const docName = (meta['documentName'] as string | undefined) ?? 'Unknown document';
      const pageNum = (meta['pageNumber'] as number | null | undefined);
      const pageRef = pageNum != null ? ` (page ${pageNum})` : '';
      return `[Excerpt ${i + 1} — ${docName}${pageRef}]\n${r.content?.text ?? ''}`;
    })
    .join('\n\n');

  const userMessage = `Document excerpts:\n\n${excerpts}\n\nQuestion: ${question}`;

  const claudeRequest: ClaudeRequest = {
    anthropic_version: 'bedrock-2023-05-31',
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    max_tokens: 2048,
  };

  // Invoke Claude with a 10-second AbortController timeout (Req 6.3, 6.7)
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), 10_000);

  let answerText: string;

  try {
    const invokeResponse = await bedrockInvoke.send(
      new InvokeModelCommand({
        modelId: CLAUDE_MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(claudeRequest),
      }),
      { abortSignal: abortController.signal },
    );

    clearTimeout(timeoutHandle);

    const responseBody = JSON.parse(
      new TextDecoder().decode(invokeResponse.body),
    ) as ClaudeResponse;

    answerText =
      responseBody.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('') || FALLBACK_NO_CHUNKS;
  } catch (err) {
    clearTimeout(timeoutHandle);

    if (err instanceof Error && err.name === 'AbortError') {
      throw new TimeoutError(
        'Amazon Bedrock did not respond within 10 seconds. Please retry.',
        correlationId,
      );
    }

    throw new ServiceError(
      `Amazon Bedrock returned an error: ${err instanceof Error ? err.message : String(err)}`,
      correlationId,
    );
  }

  // Persist chat record (Req 9.1, 8.5)
  const chatRecord: ChatRecord = {
    PK: `${USER_PREFIX}${userId}`,
    SK: `${CHAT_PREFIX}${sessionId}#${now}`,
    userId,
    sessionId,
    question,
    answer: answerText,
    citations,
    isFallback: false,
    createdAt: now,
  };

  await dynamo.send(new PutCommand({ TableName: TABLE_NAME, Item: chatRecord }));

  return {
    statusCode: 200,
    body: JSON.stringify({
      data: {
        answer: answerText,
        citations,
        sessionId,
        isFallback: false,
      },
      correlationId,
    }),
  };
});

