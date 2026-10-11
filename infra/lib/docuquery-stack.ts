import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface DocuQueryStackProps extends cdk.StackProps {
  /** Amplify hosting domain or '*' for dev — used for S3 CORS and API Gateway CORS */
  allowedOrigins: string;
  /** Deployment environment label: 'dev' | 'prod' */
  environment: string;
}

export class DocuQueryStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DocuQueryStackProps) {
    super(scope, id, props);

    // Tag all resources with environment and project name
    cdk.Tags.of(this).add('Project', 'DocuQuery');
    cdk.Tags.of(this).add('Environment', props.environment);

    // ── Cognito User Pool ─────────────────────────────────────────────────────
    const userPool = new cognito.UserPool(this, 'DocuQueryUserPool', {
      userPoolName: `docuquery-user-pool-${props.environment}`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: false },
      },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(1),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const userPoolClient = userPool.addClient('DocuQueryWebClient', {
      userPoolClientName: `docuquery-web-client-${props.environment}`,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      accessTokenValidity: cdk.Duration.minutes(15),
      refreshTokenValidity: cdk.Duration.days(7),
      idTokenValidity: cdk.Duration.minutes(15),
      preventUserExistenceErrors: true,
    });

    this.userPool = userPool;
    this.userPoolClient = userPoolClient;

    // ── DynamoDB Table ────────────────────────────────────────────────────────
    const table = new dynamodb.Table(this, 'DocuQueryTable', {
      tableName: `docuquery-table-${props.environment}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'userId-createdAt-index',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.table = table;
  }
}
