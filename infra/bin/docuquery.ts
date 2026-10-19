#!/usr/bin/env node
import 'source-map-support/register';

import * as cdk from 'aws-cdk-lib';

import { DocuQueryStack } from '../lib/docuquery-stack';

const app = new cdk.App();

const env = {
  account: (app.node.tryGetContext('awsAccountId') as string | undefined) ?? process.env.CDK_DEFAULT_ACCOUNT,
  region: (app.node.tryGetContext('awsRegion') as string | undefined) ?? process.env.CDK_DEFAULT_REGION,
};

new DocuQueryStack(app, 'DocuQueryStack', {
  env,
  allowedOrigins: (app.node.tryGetContext('allowedOrigins') as string | undefined) ?? '*',
  environment: (app.node.tryGetContext('environment') as string | undefined) ?? 'dev',
  knowledgeBaseId: app.node.tryGetContext('knowledgeBaseId') as string | undefined,
  repoUrl: app.node.tryGetContext('repoUrl') as string | undefined,
  branch: (app.node.tryGetContext('branch') as string | undefined) ?? 'main',
});
