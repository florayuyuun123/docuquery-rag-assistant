#!/usr/bin/env node
import 'source-map-support/register.js';
import * as cdk from 'aws-cdk-lib';

import { DocuQueryStack } from '../lib/docuquery-stack.js';

const app = new cdk.App();

// Read required CDK context values
const awsRegion = app.node.tryGetContext('awsRegion') as string | undefined;
const awsAccountId = app.node.tryGetContext('awsAccountId') as string | undefined;
const allowedOrigins = app.node.tryGetContext('allowedOrigins') as string | undefined;
const environment = (app.node.tryGetContext('environment') as string | undefined) ?? 'dev';

if (!awsRegion || !awsAccountId || !allowedOrigins) {
  throw new Error(
    'Missing required CDK context values. Provide awsRegion, awsAccountId, and allowedOrigins via -c flags or cdk.context.json.',
  );
}

new DocuQueryStack(app, `DocuQueryStack-${environment}`, {
  env: {
    account: awsAccountId,
    region: awsRegion,
  },
  awsRegion,
  awsAccountId,
  allowedOrigins,
  environment,
  stackName: `docuquery-${environment}`,
  description: `DocuQuery RAG Assistant — ${environment} environment`,
});
