#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DocuQueryStack } from '../lib/docuquery-stack';

const app = new cdk.App();

const env = {
  account: app.node.tryGetContext('awsAccountId') || process.env.CDK_DEFAULT_ACCOUNT,
  region: app.node.tryGetContext('awsRegion') || process.env.CDK_DEFAULT_REGION,
};

new DocuQueryStack(app, 'DocuQueryStack', {
  env,
  allowedOrigins: app.node.tryGetContext('allowedOrigins') || '*',
  environment: app.node.tryGetContext('environment') || 'dev',
  knowledgeBaseId: app.node.tryGetContext('knowledgeBaseId'),
  repoUrl: app.node.tryGetContext('repoUrl'),
  branch: app.node.tryGetContext('branch') || 'main',
});
