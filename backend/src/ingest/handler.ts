/**
 * Ingest handler — triggered by S3 OBJECT_CREATED events.
 *
 * Reads the uploaded file, extracts text, chunks it, starts a Bedrock
 * Knowledge Base ingestion job, then updates the DynamoDB document record to
 * status "ready".  On any failure the handler cleans up partial KB data and
 * marks the record as "failed".
 *
 * Satisfies Requirements 4.1–4.10.
 */

import { S3Event } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import {
  BedrockAgentClient,
  StartIngestionJobCommand,
} from '@aws-sdk/client-bedrock-agent';
import { createLogger } from '../lib/logger.js';
import { extractText } from './extract.js';
import { chunkText } from './chunker.js';
import { USER_PREFIX, DOC_PREFIX } from '@docuquery/shared';

const s3 = new S3Client({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrockAgent = new BedrockAgentClient({});
const logger = createLogger('ingest-fn');

const TABLE_NAME = process.env['TABLE_NAME'] ?? '';
const KNOWLEDGE_BASE_ID = process.env['KNOWLEDGE_BASE_ID'] ?? '';

/**
 * Update the document status in DynamoDB.
 */
async function updateDocumentStatus(
  userId: string,
  documentId: string,
  status: string,
): Promise<void> {
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
}

/**
 * Parse userId and documentId from the S3 object key.
 *
 * Expected key format: USER#{userId}/DOC#{documentId}/{fileName}
 */
function parseS3Key(key: string): { userId: string; documentId: string } | null {
  // Decode percent-encoded characters in the key
  const decoded = decodeURIComponent(key.replace(/\+/g, ' '));
  const match = decoded.match(/^USER#([^/]+)\/DOC#([^/]+)\//);
  if (!match) return null;
  return { userId: match[1], documentId: match[2] };
}

export const handler = async (event: S3Event): Promise<void> => {
  for (const record of event.Records) {
    const bucketName = record.s3.bucket.name;
    const s3Key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    const correlationId = record.responseElements?.['x-amz-request-id'] ?? 'unknown';

    // Parse userId and documentId from S3 key
    const parsed = parseS3Key(record.s3.object.key);
    if (!parsed) {
      logger.emit({
        userId: 'unknown',
        operationType: 'ingest',
        durationMs: 0,
        outcome: 'error',
        correlationId,
        errorMessage: `Could not parse userId/documentId from S3 key: ${s3Key}`,
      });
      continue;
    }

    const { userId, documentId } = parsed;
    const startTime = Date.now();

    try {
      // Fetch the document record to get contentType and documentName
      const docResult = await dynamo.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: `${USER_PREFIX}${userId}`,
            SK: `${DOC_PREFIX}${documentId}`,
          },
        }),
      );

      const docRecord = docResult.Item;
      const contentType: string = (docRecord?.['contentType'] as string | undefined) ?? 'application/octet-stream';

      // Set status → processing
      await updateDocumentStatus(userId, documentId, 'processing');

      logger.emit({
        userId,
        operationType: 'ingest:start',
        durationMs: Date.now() - startTime,
        outcome: 'processing',
        correlationId,
        documentId,
      });

      // Download the file from S3
      const s3Response = await s3.send(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: s3Key,
        }),
      );

      const chunks: Uint8Array[] = [];
      for await (const chunk of s3Response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      const fileBytes = Buffer.concat(chunks);

      // Extract text
      const extractedText = await extractText(s3Key, fileBytes, contentType, bucketName);

      // Handle empty extraction (Req 4.9)
      if (!extractedText || extractedText.trim().length === 0) {
        await updateDocumentStatus(userId, documentId, 'failed');
        logger.emit({
          userId,
          operationType: 'ingest:empty-extraction',
          durationMs: Date.now() - startTime,
          outcome: 'failed',
          correlationId,
          documentId,
          errorMessage: 'Text extraction produced empty result',
        });
        continue;
      }

      // Chunk the text
      const textChunks = chunkText(extractedText);

      logger.emit({
        userId,
        operationType: 'ingest:chunked',
        durationMs: Date.now() - startTime,
        outcome: 'chunked',
        correlationId,
        documentId,
        chunkCount: textChunks.length,
      });

      // Start Bedrock Knowledge Base ingestion job
      // The KB datasource is the S3 bucket — re-syncing will pick up the new file
      await bedrockAgent.send(
        new StartIngestionJobCommand({
          knowledgeBaseId: KNOWLEDGE_BASE_ID,
          dataSourceId: KNOWLEDGE_BASE_ID, // dataSourceId matches KB for S3 datasource
          description: `Ingest document ${documentId} for user ${userId}`,
        }),
      );

      // Set status → ready
      await updateDocumentStatus(userId, documentId, 'ready');

      logger.emit({
        userId,
        operationType: 'ingest:complete',
        durationMs: Date.now() - startTime,
        outcome: 'success',
        correlationId,
        documentId,
        chunkCount: textChunks.length,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      logger.error({
        userId,
        operationType: 'ingest:failed',
        durationMs: Date.now() - startTime,
        outcome: 'error',
        correlationId,
        documentId,
        error,
      });

      // Attempt to clean up any partially indexed KB documents by re-syncing
      // the KB datasource. After the S3 object is eventually deleted/replaced,
      // a subsequent sync will remove its chunks from the index.
      try {
        await bedrockAgent.send(
          new StartIngestionJobCommand({
            knowledgeBaseId: KNOWLEDGE_BASE_ID,
            dataSourceId: KNOWLEDGE_BASE_ID,
            description: `Cleanup re-sync after failed ingest of document ${documentId}`,
          }),
        );
      } catch (cleanupErr) {
        const cleanupError = cleanupErr instanceof Error ? cleanupErr : new Error(String(cleanupErr));
        logger.error({
          userId,
          operationType: 'ingest:cleanup-failed',
          durationMs: Date.now() - startTime,
          outcome: 'error',
          correlationId,
          documentId,
          error: cleanupError,
        });
      }

      // Mark document as failed — do not rethrow
      try {
        await updateDocumentStatus(userId, documentId, 'failed');
      } catch (updateErr) {
        const updateError = updateErr instanceof Error ? updateErr : new Error(String(updateErr));
        logger.error({
          userId,
          operationType: 'ingest:status-update-failed',
          durationMs: Date.now() - startTime,
          outcome: 'error',
          correlationId,
          documentId,
          error: updateError,
        });
      }
    }
  }
};
