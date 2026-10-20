import * as path from 'path';

import * as cdk from 'aws-cdk-lib';
import * as amplify from 'aws-cdk-lib/aws-amplify';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import { Construct } from 'constructs';

export interface DocuQueryStackProps extends cdk.StackProps {
  allowedOrigins: string;
  environment: string;
  knowledgeBaseId?: string;
  /** GitHub repo URL e.g. https://github.com/org/repo */
  repoUrl?: string;
  /** Git branch to deploy via Amplify e.g. main */
  branch?: string;
}

export class DocuQueryStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly identityPool: cognito.CfnIdentityPool;
  public readonly table: dynamodb.Table;
  public readonly bucket: s3.Bucket;
  public readonly api: apigw.RestApi;

  constructor(scope: Construct, id: string, props: DocuQueryStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('Project', 'DocuQuery');
    cdk.Tags.of(this).add('Environment', props.environment);

    // When no KB ID is provided (first deploy), use a wildcard ARN so IAM policies
    // are valid. Re-deploy with --context knowledgeBaseId=XXX after creating the KB.
    const kbArn = props.knowledgeBaseId
      ? `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/${props.knowledgeBaseId}`
      : `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/*`;

    // Stateful resources use DESTROY in dev so cdk destroy cleans up everything.
    // In prod, RETAIN protects data against accidental stack deletion.
    const removalPolicy = props.environment === 'prod'
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    // ── Cognito ───────────────────────────────────────────────────────────────
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `docuquery-${props.environment}`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy,
    });

    const userPoolClient = userPool.addClient('WebClient', {
      authFlows: { userPassword: true, userSrp: true },
      accessTokenValidity: cdk.Duration.minutes(15),
      refreshTokenValidity: cdk.Duration.days(7),
      idTokenValidity: cdk.Duration.minutes(15),
      preventUserExistenceErrors: true,
    });

    const identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
      identityPoolName: `docuquery_${props.environment}`,
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [{
        clientId: userPoolClient.userPoolClientId,
        providerName: userPool.userPoolProviderName,
      }],
    });

    this.userPool = userPool;
    this.userPoolClient = userPoolClient;
    this.identityPool = identityPool;

    // ── DynamoDB ──────────────────────────────────────────────────────────────
    const table = new dynamodb.Table(this, 'Table', {
      tableName: `docuquery-${props.environment}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'userId-createdAt-index',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.table = table;

    // ── S3 ────────────────────────────────────────────────────────────────────
    const bucket = new s3.Bucket(this, 'DocumentBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: false,
      removalPolicy,
      cors: [{
        allowedMethods: [s3.HttpMethods.PUT],
        allowedOrigins: [props.allowedOrigins],
        allowedHeaders: ['*'],
        maxAge: 3000,
      }],
    });

    this.bucket = bucket;

    // ── Shared Lambda config ──────────────────────────────────────────────────
    const backendDir = path.join(__dirname, '..', '..', 'backend');

    const env = {
      TABLE_NAME: table.tableName,
      BUCKET_NAME: bucket.bucketName,
      DOCUMENT_BUCKET_NAME: bucket.bucketName,
      KNOWLEDGE_BASE_ID: props.knowledgeBaseId ?? '',
      SIMILARITY_THRESHOLD: '0.5',
      NODE_OPTIONS: '--enable-source-maps',
    };

    const fnBase: Partial<lambdaNodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(29),
      memorySize: 512,
      environment: env,
      bundling: { externalModules: ['@aws-sdk/*'], sourceMap: true },
    };

    // ── upload-url-fn ─────────────────────────────────────────────────────────
    const uploadRole = new iam.Role(this, 'UploadRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
    });
    uploadRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject'],
      resources: [`${bucket.bucketArn}/USER#*`],
    }));
    uploadRole.addToPolicy(new iam.PolicyStatement({
      actions: ['dynamodb:PutItem'],
      resources: [table.tableArn],
    }));

    const uploadFn = new lambdaNodejs.NodejsFunction(this, 'UploadUrlFn', {
      ...fnBase,
      functionName: `docuquery-upload-url-${props.environment}`,
      entry: path.join(backendDir, 'src', 'upload-url', 'handler.ts'),
      role: uploadRole,
      logGroup: new logs.LogGroup(this, 'UploadUrlLogGroup', {
        logGroupName: `/aws/lambda/docuquery-upload-url-${props.environment}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy,
      }),
    });

    // ── ingest-fn ─────────────────────────────────────────────────────────────
    const ingestRole = new iam.Role(this, 'IngestRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
    });
    ingestRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [`${bucket.bucketArn}/*`],
    }));
    ingestRole.addToPolicy(new iam.PolicyStatement({
      actions: ['dynamodb:UpdateItem', 'dynamodb:GetItem'],
      resources: [table.tableArn],
    }));
    ingestRole.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [`arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`],
    }));
    ingestRole.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock:StartIngestionJob', 'bedrock:DeleteDocument', 'bedrock:GetIngestionJob'],
      resources: [kbArn],
    }));
    ingestRole.addToPolicy(new iam.PolicyStatement({
      actions: ['textract:StartDocumentTextDetection', 'textract:GetDocumentTextDetection'],
      resources: ['*'],
    }));

    const ingestFn = new lambdaNodejs.NodejsFunction(this, 'IngestFn', {
      ...fnBase,
      functionName: `docuquery-ingest-${props.environment}`,
      entry: path.join(backendDir, 'src', 'ingest', 'handler.ts'),
      role: ingestRole,
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      bundling: {
        externalModules: ['@aws-sdk/*', 'pdf-parse', 'tiktoken', 'mammoth'],
        sourceMap: true,
      },
      logGroup: new logs.LogGroup(this, 'IngestLogGroup', {
        logGroupName: `/aws/lambda/docuquery-ingest-${props.environment}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy,
      }),
    });

    // S3 → ingest-fn: use CfnBucketNotification directly to avoid the
    // Custom::S3BucketNotifications resource that triggers EarlyValidation.

    // Wire S3 ObjectCreated → ingest-fn via addEventNotification.
    // The Custom::S3BucketNotifications resource checks Lambda existence at
    // ChangeSet creation time; override SkipDestinationValidation to bypass this.
    bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(ingestFn),
    );
    (bucket.node.findChild('Notifications').node.defaultChild as cdk.CfnResource)
      .addPropertyOverride('SkipDestinationValidation', true);

    // ── documents-fn ──────────────────────────────────────────────────────────
    const docsRole = new iam.Role(this, 'DocsRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
    });
    docsRole.addToPolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query', 'dynamodb:DeleteItem', 'dynamodb:UpdateItem', 'dynamodb:GetItem'],
      resources: [table.tableArn, `${table.tableArn}/index/*`],
    }));
    docsRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:DeleteObject'],
      resources: [`${bucket.bucketArn}/*`],
    }));
    docsRole.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock:StartIngestionJob', 'bedrock:DeleteDocument'],
      resources: [kbArn],
    }));

    const docsFn = new lambdaNodejs.NodejsFunction(this, 'DocumentsFn', {
      ...fnBase,
      functionName: `docuquery-documents-${props.environment}`,
      entry: path.join(backendDir, 'src', 'documents', 'handler.ts'),
      role: docsRole,
      logGroup: new logs.LogGroup(this, 'DocumentsLogGroup', {
        logGroupName: `/aws/lambda/docuquery-documents-${props.environment}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy,
      }),
    });

    // ── query-fn ──────────────────────────────────────────────────────────────
    const queryRole = new iam.Role(this, 'QueryRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
    });
    queryRole.addToPolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query', 'dynamodb:PutItem'],
      resources: [table.tableArn, `${table.tableArn}/index/*`],
    }));
    queryRole.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
        `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-haiku-20240307-v1:0`,
      ],
    }));
    queryRole.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock:Retrieve'],
      resources: [kbArn],
    }));

    const queryFn = new lambdaNodejs.NodejsFunction(this, 'QueryFn', {
      ...fnBase,
      functionName: `docuquery-query-${props.environment}`,
      entry: path.join(backendDir, 'src', 'query', 'handler.ts'),
      role: queryRole,
      logGroup: new logs.LogGroup(this, 'QueryLogGroup', {
        logGroupName: `/aws/lambda/docuquery-query-${props.environment}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy,
      }),
    });

    // ── history-fn ────────────────────────────────────────────────────────────
    const historyRole = new iam.Role(this, 'HistoryRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
    });
    historyRole.addToPolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: [table.tableArn],
    }));

    const historyFn = new lambdaNodejs.NodejsFunction(this, 'HistoryFn', {
      ...fnBase,
      functionName: `docuquery-history-${props.environment}`,
      entry: path.join(backendDir, 'src', 'history', 'handler.ts'),
      role: historyRole,
      logGroup: new logs.LogGroup(this, 'HistoryLogGroup', {
        logGroupName: `/aws/lambda/docuquery-history-${props.environment}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy,
      }),
    });

    // ── API Gateway ───────────────────────────────────────────────────────────
    const api = new apigw.RestApi(this, 'Api', {
      restApiName: `docuquery-${props.environment}`,
      defaultCorsPreflightOptions: {
        allowOrigins: [props.allowedOrigins],
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'x-correlation-id'],
        // allowCredentials is NOT needed — the Authorization header is a custom
        // request header, not a CORS credential (cookies/HTTP auth). Setting it
        // to true with allowOrigins: ['*'] is invalid per the CORS spec.
      },
      deployOptions: { stageName: props.environment },
    });

    this.api = api;

    // ── Gateway Responses (CORS on error responses) ────────────────────────
    // Without these, 401/403/500 responses from the Cognito authorizer have no
    // CORS headers, and the browser blocks them as CORS errors instead of
    // letting the frontend see the status code and redirect to sign-in.
    // Gateway Response header values must be wrapped in single quotes
    // for literal strings — API Gateway treats unquoted values as mapping
    // expressions and rejects them.
    const corsHeaders = {
      'Access-Control-Allow-Origin': `'${props.allowedOrigins}'`,
      'Access-Control-Allow-Headers': "'Content-Type,Authorization,x-correlation-id'",
    };

    api.addGatewayResponse('UnauthorizedResponse', {
      type: apigw.ResponseType.UNAUTHORIZED,
      responseHeaders: corsHeaders,
    });
    api.addGatewayResponse('AccessDeniedResponse', {
      type: apigw.ResponseType.ACCESS_DENIED,
      responseHeaders: corsHeaders,
    });
    api.addGatewayResponse('Default4xxResponse', {
      type: apigw.ResponseType.DEFAULT_4XX,
      responseHeaders: corsHeaders,
    });
    api.addGatewayResponse('Default5xxResponse', {
      type: apigw.ResponseType.DEFAULT_5XX,
      responseHeaders: corsHeaders,
    });

    const auth: apigw.MethodOptions = {
      authorizer: new apigw.CognitoUserPoolsAuthorizer(this, 'Authorizer', {
        cognitoUserPools: [userPool],
      }),
      authorizationType: apigw.AuthorizationType.COGNITO,
    };

    const docs = api.root.addResource('documents');
    docs.addResource('upload-url').addMethod('POST', new apigw.LambdaIntegration(uploadFn), auth);
    docs.addMethod('GET', new apigw.LambdaIntegration(docsFn), auth);
    const docById = docs.addResource('{documentId}');
    docById.addMethod('DELETE', new apigw.LambdaIntegration(docsFn), auth);
    docById.addResource('status').addMethod('PATCH', new apigw.LambdaIntegration(docsFn), auth);
    api.root.addResource('query').addMethod('POST', new apigw.LambdaIntegration(queryFn), auth);
    api.root.addResource('history').addMethod('GET', new apigw.LambdaIntegration(historyFn), auth);

    // ── Amplify Hosting ───────────────────────────────────────────────────────
    const amplifyApp = new amplify.CfnApp(this, 'AmplifyApp', {
      name: `docuquery-${props.environment}`,
      ...(props.repoUrl && { repository: props.repoUrl }),
      // SPA rewrite rule — serve index.html for all client-side routes
      // so React Router handles /signin, /documents, /chat, etc.
      customRules: [
        {
          source: '/<*>',
          target: '/index.html',
          status: '200',
        },
      ],
      buildSpec: JSON.stringify({
        version: 1,
        frontend: {
          phases: {
            preBuild: { commands: ['npm ci'] },
            build: { commands: ['npm run build --workspace=frontend'] },
          },
          artifacts: { baseDirectory: 'frontend/dist', files: ['**/*'] },
          cache: { paths: ['node_modules/**/*'] },
        },
      }),
      environmentVariables: [
        { name: 'VITE_USER_POOL_ID', value: userPool.userPoolId },
        { name: 'VITE_USER_POOL_CLIENT_ID', value: userPoolClient.userPoolClientId },
        { name: 'VITE_IDENTITY_POOL_ID', value: identityPool.ref },
        { name: 'VITE_API_URL', value: api.url },
        { name: 'VITE_DOCUMENT_BUCKET_NAME', value: bucket.bucketName },
      ],
    });

    // ── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'IdentityPoolId', { value: identityPool.ref });
    new cdk.CfnOutput(this, 'ApiGatewayUrl', { value: api.url });
    new cdk.CfnOutput(this, 'DocumentBucketName', { value: bucket.bucketName });
    new cdk.CfnOutput(this, 'AmplifyAppId', { value: amplifyApp.attrAppId });
  }
}
