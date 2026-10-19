import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DocuQueryStack } from '../lib/docuquery-stack';

describe('DocuQueryStack', () => {
  let template: Template;

  beforeEach(() => {
    const app = new cdk.App();
    const stack = new DocuQueryStack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-east-1' },
      allowedOrigins: 'https://test.example.com',
      environment: 'test',
    });
    template = Template.fromStack(stack);
  });

  it('synthesises without errors', () => {
    expect(template).toBeDefined();
  });

  // ── Cognito ────────────────────────────────────────────────────────────────

  it('creates Cognito User Pool with email sign-in', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      UsernameAttributes: ['email'],
      AutoVerifiedAttributes: ['email'],
      Policies: {
        PasswordPolicy: {
          MinimumLength: 8,
          RequireUppercase: true,
          RequireLowercase: true,
          RequireNumbers: true,
          RequireSymbols: true,
        },
      },
    });
  });

  it('creates Cognito User Pool Client with correct token validity', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      AccessTokenValidity: 15,
      RefreshTokenValidity: 10080, // 7 days in minutes (CDK stores in minutes)
      PreventUserExistenceErrors: 'ENABLED',
    });
  });

  it('creates Cognito Identity Pool linked to the User Pool client', () => {
    template.hasResourceProperties('AWS::Cognito::IdentityPool', {
      AllowUnauthenticatedIdentities: false,
    });
    // Exactly one identity pool
    template.resourceCountIs('AWS::Cognito::IdentityPool', 1);
  });

  // ── DynamoDB (task 4.2) ────────────────────────────────────────────────────

  it('creates DynamoDB table with PAY_PER_REQUEST billing', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  it('creates DynamoDB table with SSE enabled (AWS_MANAGED)', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      SSESpecification: {
        SSEEnabled: true,
      },
    });
  });

  it('creates DynamoDB table with userId-createdAt-index GSI', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      GlobalSecondaryIndexes: [
        {
          IndexName: 'userId-createdAt-index',
          KeySchema: [
            { AttributeName: 'userId', KeyType: 'HASH' },
            { AttributeName: 'createdAt', KeyType: 'RANGE' },
          ],
        },
      ],
    });
  });

  // ── S3 (task 5.2) ──────────────────────────────────────────────────────────

  it('creates S3 bucket with S3-managed encryption (AES256)', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'AES256',
            },
          },
        ],
      },
    });
  });

  it('blocks all public access on S3 bucket', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('configures S3 CORS to allow PUT from allowedOrigins', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      CorsConfiguration: {
        CorsRules: [
          {
            AllowedMethods: ['PUT'],
            AllowedOrigins: ['https://test.example.com'],
          },
        ],
      },
    });
  });

  // ── Log Groups (task 21.1) ─────────────────────────────────────────────────

  it('all Lambda log groups have 30-day retention', () => {
    template.resourceCountIs('AWS::Logs::LogGroup', 5); // one per Lambda
    const logGroups = template.findResources('AWS::Logs::LogGroup');
    Object.values(logGroups).forEach((lg: unknown) => {
      const resource = lg as { Properties: { RetentionInDays?: number } };
      expect(resource.Properties.RetentionInDays).toBe(30);
    });
  });

  // ── Cognito Authorizer (task 21.1) ─────────────────────────────────────────

  it('creates Cognito JWT authorizer for API Gateway', () => {
    template.resourceCountIs('AWS::ApiGateway::Authorizer', 1);
    template.hasResourceProperties('AWS::ApiGateway::Authorizer', {
      Type: 'COGNITO_USER_POOLS',
    });
  });

  // ── S3 CORS origins (task 21.2) ────────────────────────────────────────────

  it('S3 CORS allows only the configured origin', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      CorsConfiguration: {
        CorsRules: [
          {
            AllowedMethods: ['PUT'],
            AllowedOrigins: ['https://test.example.com'],
          },
        ],
      },
    });
  });

  // ── Amplify Hosting (task 22.1 + 22.2) ────────────────────────────────────

  it('creates an Amplify app with the correct environment name', () => {
    template.resourceCountIs('AWS::Amplify::App', 1);
    template.hasResourceProperties('AWS::Amplify::App', {
      Name: 'docuquery-test',
    });
  });

  it('Amplify app exposes VITE environment variables', () => {
    template.hasResourceProperties('AWS::Amplify::App', {
      EnvironmentVariables: [
        { Name: 'VITE_USER_POOL_ID' },
        { Name: 'VITE_USER_POOL_CLIENT_ID' },
        { Name: 'VITE_IDENTITY_POOL_ID' },
        { Name: 'VITE_API_URL' },
        { Name: 'VITE_DOCUMENT_BUCKET_NAME' },
      ],
    });
  });

  it('outputs AmplifyAppId', () => {
    template.hasOutput('AmplifyAppId', {});
  });
});
