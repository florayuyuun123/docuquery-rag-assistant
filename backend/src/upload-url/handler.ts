/**
 * upload-url handler
 *
 * POST /documents/upload-url
 *
 * Validates the requested file (MIME type + size), generates a presigned S3
 * PUT URL, and writes an initial DynamoDB document record with status
 * "uploaded".
 *
 * Satisfies Requirements 3.1, 3.2, 3.5, 3.6, 3.10, 10.4.
 */

import { APIGatewayProxyResult } from 'aws-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import {
  USER_PREFIX,
  DOC_PREFIX,
  SUPPORTED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  PRESIGNED_URL_EXPIRY_SECONDS,
} from '@docuquery/shared';
import { ValidationError } from '../lib/errors.js';
import { withMiddleware } from '../lib/middleware.js';

const s3 = new S3Client({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const BUCKET_NAME = process.env['BUCKET_NAME'] ?? '';
const TABLE_NAME = process.env['TABLE_NAME'] ?? '';

interface UploadUrlRequestBody {
  fileName: string;
  contentType: string;
  fileSize: number;
}

export const handler = withMiddleware('upload-url-fn', async (event, _context, correlationId): Promise<APIGatewayProxyResult> => {
  // Extract userId from Cognito authorizer claims
  const userId = event.requestContext?.authorizer?.claims?.sub as string | undefined;
  if (!userId) {
    throw new ValidationError('Missing userId in authorizer claims', correlationId);
  }

  // Parse and validate request body
  if (!event.body) {
    throw new ValidationError('Request body is required', correlationId);
  }

  let body: UploadUrlRequestBody;
  try {
    body = JSON.parse(event.body) as UploadUrlRequestBody;
  } catch {
    throw new ValidationError('Request body must be valid JSON', correlationId);
  }

  const { fileName, contentType, fileSize } = body;

  if (!fileName || typeof fileName !== 'string' || fileName.trim() === '') {
    throw new ValidationError('fileName is required', correlationId);
  }
  if (!contentType || typeof contentType !== 'string') {
    throw new ValidationError('contentType is required', correlationId);
  }
  if (typeof fileSize !== 'number' || fileSize <= 0) {
    throw new ValidationError('fileSize must be a positive number', correlationId);
  }

  // Validate MIME type
  const supportedTypes: readonly string[] = SUPPORTED_MIME_TYPES;
  if (!supportedTypes.includes(contentType)) {
    throw new ValidationError(
      `Unsupported file type "${contentType}". Supported types: PDF, DOCX, TXT`,
      correlationId,
    );
  }

  // Validate file size (max 20 MB)
  if (fileSize > MAX_FILE_SIZE_BYTES) {
    throw new ValidationError(
      `File size ${fileSize} bytes exceeds the maximum allowed size of ${MAX_FILE_SIZE_BYTES} bytes (20 MB)`,
      correlationId,
    );
  }

  const documentId = randomUUID();
  const s3Key = `${USER_PREFIX}${userId}/${DOC_PREFIX}${documentId}/${fileName}`;
  const now = new Date().toISOString();

  // Generate presigned PUT URL
  const putCommand = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
    ContentType: contentType,
    ContentLength: fileSize,
  });

  const presignedUrl = await getSignedUrl(s3, putCommand, {
    expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
  });

  // Write DynamoDB record with status = "uploaded"
  await dynamo.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `${USER_PREFIX}${userId}`,
        SK: `${DOC_PREFIX}${documentId}`,
        userId,
        documentId,
        documentName: fileName,
        s3Key,
        fileSize,
        contentType,
        status: 'uploaded',
        createdAt: now,
        updatedAt: now,
      },
    }),
  );

  return {
    statusCode: 200,
    body: JSON.stringify({
      data: {
        presignedUrl,
        documentId,
        s3Key,
      },
      correlationId,
    }),
  };
});
