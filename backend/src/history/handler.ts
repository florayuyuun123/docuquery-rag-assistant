/**
 * History handler
 *
 * GET /history
 *
 * Returns the most recent 50 chat records for the authenticated user, in
 * reverse-chronological order.
 *
 * Satisfies Requirements 9.1–9.5.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  USER_PREFIX,
  CHAT_PREFIX,
  MAX_CHAT_HISTORY_RECORDS,
} from '@docuquery/shared';
import { APIGatewayProxyResult } from 'aws-lambda';

import { ValidationError } from '../lib/errors.js';
import { withMiddleware } from '../lib/middleware.js';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const TABLE_NAME = process.env['TABLE_NAME'] ?? '';

export const handler = withMiddleware('history-fn', async (event, _context, correlationId): Promise<APIGatewayProxyResult> => {
  const claims = event.requestContext?.authorizer?.claims as Record<string, string> | undefined;
  const userId = claims?.['sub'];
  if (!userId) {
    throw new ValidationError('Missing userId in authorizer claims', correlationId);
  }

  // Query DynamoDB for CHAT# SK prefix, reverse-chronological, capped at 50
  const result = await dynamo.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression:
        'PK = :pk AND begins_with(SK, :chatPrefix)',
      ExpressionAttributeValues: {
        ':pk': `${USER_PREFIX}${userId}`,
        ':chatPrefix': CHAT_PREFIX,
      },
      ScanIndexForward: false,
      Limit: MAX_CHAT_HISTORY_RECORDS,
    }),
  );

  return {
    statusCode: 200,
    body: JSON.stringify({
      data: result.Items ?? [],
      correlationId,
    }),
  };
});
