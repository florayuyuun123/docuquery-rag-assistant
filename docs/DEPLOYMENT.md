# Deployment Guide

> Complete step-by-step guide for deploying DocuQuery RAG Assistant on AWS.
> Covers CDK stack, Bedrock Knowledge Base, OpenSearch Serverless, and Amplify frontend.

---

## Prerequisites

Before you start, make sure you have:

- **AWS CLI** configured with your target account
- **Node.js 20+** and **npm 10+**
- **Python 3.9+** with `boto3` installed (`pip install boto3`)
- **AWS CDK v2** installed globally (`npm install -g aws-cdk`)

```bash
# Verify versions
node --version        # >= 20
npm --version         # >= 10
python --version      # >= 3.9
cdk --version         # >= 2.x
aws sts get-caller-identity --profile YOUR_PROFILE
```

---

## Step 1 - Install Dependencies

```bash
# From the repo root
npm install
```

---

## Step 2 - Build the Shared Package

```bash
npm run build --workspace=shared
```

---

## Step 3 - Bootstrap CDK (one-time per account/region)

```bash
cd infra
npx cdk bootstrap aws://YOUR_ACCOUNT_ID/us-east-1 --profile YOUR_PROFILE
```

> **Note:** If bootstrap fails with `AWS::EarlyValidation::ResourceExistenceCheck`,
> an orphaned staging bucket likely exists from a prior attempt.
> Empty and delete `cdk-hnb659fds-assets-{account}-{region}`, delete the stuck
> `CDKToolkit` stack in `REVIEW_IN_PROGRESS` state, then re-run bootstrap.

---

## Step 4 - Initial CDK Deploy (no KB ID yet)

```bash
cd infra
npx cdk deploy \
  --profile YOUR_PROFILE \
  --require-approval never \
  --context environment=dev \
  --context awsRegion=us-east-1 \
  --context awsAccountId=YOUR_ACCOUNT_ID
```

Save the CDK outputs - you will need them in later steps:

```
DocuQueryStack.UserPoolId         = us-east-1_XXXXXXXXX
DocuQueryStack.UserPoolClientId   = XXXXXXXXXXXXXXXXXXXXXXXXXX
DocuQueryStack.IdentityPoolId     = us-east-1:XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
DocuQueryStack.ApiGatewayUrl      = https://XXXXXXXXXX.execute-api.us-east-1.amazonaws.com/dev/
DocuQueryStack.DocumentBucketName = docuquerystack-documentbucketXXXXXXXX-XXXXXXXXXXXX
DocuQueryStack.AmplifyAppId       = XXXXXXXXXX
```

---

## Step 5 - Create the Bedrock Knowledge Base

This requires several sub-steps. Run them in order.

### Step 5a - Create IAM Role for the Knowledge Base

```bash
ACCOUNT_ID=YOUR_ACCOUNT_ID
BUCKET_NAME=YOUR_BUCKET_NAME_FROM_STEP_4
PROFILE=YOUR_PROFILE

# Create the role
aws iam create-role \
  --role-name docuquery-kb-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": { "Service": "bedrock.amazonaws.com" },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": { "aws:SourceAccount": "'"$ACCOUNT_ID"'" },
        "ArnLike": {
          "aws:SourceArn": "arn:aws:bedrock:us-east-1:'"$ACCOUNT_ID"':knowledge-base/*"
        }
      }
    }]
  }' \
  --profile $PROFILE

# Attach S3 read permission
aws iam put-role-policy \
  --role-name docuquery-kb-role \
  --policy-name S3Access \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::'"$BUCKET_NAME"'",
        "arn:aws:s3:::'"$BUCKET_NAME"'/*"
      ]
    }]
  }' \
  --profile $PROFILE

# Attach Bedrock embedding permission
aws iam put-role-policy \
  --role-name docuquery-kb-role \
  --policy-name BedrockEmbeddingAccess \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": "bedrock:InvokeModel",
      "Resource": "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v2:0"
    }]
  }' \
  --profile $PROFILE
```

### Step 5b - Create OpenSearch Serverless Collection

```bash
PROFILE=YOUR_PROFILE

# Encryption policy (required before creating the collection)
aws opensearchserverless create-security-policy \
  --name docuquery-enc \
  --type encryption \
  --policy '{"Rules":[{"ResourceType":"collection","Resource":["collection/docuquery-vectors"]}],"AWSOwnedKey":true}' \
  --region us-east-1 \
  --profile $PROFILE

# Network policy (allows Bedrock to reach the collection)
aws opensearchserverless create-security-policy \
  --name docuquery-net \
  --type network \
  --policy '[{"Rules":[{"ResourceType":"collection","Resource":["collection/docuquery-vectors"]},{"ResourceType":"dashboard","Resource":["collection/docuquery-vectors"]}],"AllowFromPublic":true}]' \
  --region us-east-1 \
  --profile $PROFILE

# Create the collection (takes 2-4 minutes to become ACTIVE)
aws opensearchserverless create-collection \
  --name docuquery-vectors \
  --type VECTORSEARCH \
  --region us-east-1 \
  --profile $PROFILE
# Note the collection ID returned - you will need it below
```

Wait for the collection to become ACTIVE:

```bash
aws opensearchserverless list-collections \
  --collection-filters name=docuquery-vectors \
  --region us-east-1 \
  --profile $PROFILE \
  --query "collectionSummaries[0].status"
# Wait until output is "ACTIVE"
```

Then grant the KB role access to the collection index:

```bash
COLLECTION_ID=YOUR_COLLECTION_ID
ACCOUNT_ID=YOUR_ACCOUNT_ID
PROFILE=YOUR_PROFILE

aws iam put-role-policy \
  --role-name docuquery-kb-role \
  --policy-name AOSSAccess \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": "aoss:APIAccessAll",
      "Resource": "arn:aws:aoss:us-east-1:'"$ACCOUNT_ID"':collection/'"$COLLECTION_ID"'"
    }]
  }' \
  --profile $PROFILE

# Data access policy - grants KB role full index access
aws opensearchserverless create-access-policy \
  --name docuquery-access \
  --type data \
  --policy '[{
    "Rules": [
      {
        "ResourceType": "index",
        "Resource": ["index/docuquery-vectors/*"],
        "Permission": [
          "aoss:CreateIndex","aoss:DeleteIndex","aoss:UpdateIndex",
          "aoss:DescribeIndex","aoss:ReadDocument","aoss:WriteDocument"
        ]
      },
      {
        "ResourceType": "collection",
        "Resource": ["collection/docuquery-vectors"],
        "Permission": [
          "aoss:CreateCollectionItems","aoss:DeleteCollectionItems",
          "aoss:UpdateCollectionItems","aoss:DescribeCollectionItems"
        ]
      }
    ],
    "Principal": [
      "arn:aws:iam::'"$ACCOUNT_ID"':role/docuquery-kb-role"
    ]
  }]' \
  --region us-east-1 \
  --profile $PROFILE
```

### Step 5c - Create the Vector Index

Use the Python script below (signed HTTP PUT to the OpenSearch endpoint):

```python
import boto3
import json
import urllib.request
from botocore.awsrequest import AWSRequest
from botocore.auth import SigV4Auth

PROFILE = "YOUR_PROFILE"
COLLECTION_ID = "YOUR_COLLECTION_ID"

session = boto3.Session(profile_name=PROFILE, region_name="us-east-1")
creds = session.get_credentials().get_frozen_credentials()

endpoint = f"https://{COLLECTION_ID}.us-east-1.aoss.amazonaws.com"
url = f"{endpoint}/docuquery-index"

body = json.dumps({
    "settings": {"index": {"knn": True}},
    "mappings": {
        "properties": {
            "embedding": {
                "type": "knn_vector",
                "dimension": 1024,
                "method": {"name": "hnsw", "engine": "faiss", "space_type": "l2"}
            },
            "text":     {"type": "text"},
            "metadata": {"type": "text"}
        }
    }
}).encode("utf-8")

request = AWSRequest(method="PUT", url=url, data=body,
                     headers={"Content-Type": "application/json"})
SigV4Auth(creds, "aoss", "us-east-1").add_auth(request)

req = urllib.request.Request(url, data=body, headers=dict(request.headers), method="PUT")
with urllib.request.urlopen(req) as resp:
    print("Index created:", resp.read().decode())
```

Run it:

```bash
python create_index.py
# Expected: {"acknowledged":true,"shards_acknowledged":true,"index":"docuquery-index"}
```

### Step 5d - Create the Bedrock Knowledge Base

```python
# create_kb.py
import boto3

PROFILE = "YOUR_PROFILE"
ACCOUNT_ID = "YOUR_ACCOUNT_ID"
COLLECTION_ID = "YOUR_COLLECTION_ID"

session = boto3.Session(profile_name=PROFILE, region_name="us-east-1")
client = session.client("bedrock-agent")

resp = client.create_knowledge_base(
    name="docuquery-dev",
    roleArn=f"arn:aws:iam::{ACCOUNT_ID}:role/docuquery-kb-role",
    knowledgeBaseConfiguration={
        "type": "VECTOR",
        "vectorKnowledgeBaseConfiguration": {
            "embeddingModelArn": "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v2:0",
            "embeddingModelConfiguration": {
                "bedrockEmbeddingModelConfiguration": {"dimensions": 1024}
            }
        }
    },
    storageConfiguration={
        "type": "OPENSEARCH_SERVERLESS",
        "opensearchServerlessConfiguration": {
            "collectionArn": f"arn:aws:aoss:us-east-1:{ACCOUNT_ID}:collection/{COLLECTION_ID}",
            "vectorIndexName": "docuquery-index",
            "fieldMapping": {
                "vectorField": "embedding",
                "textField": "text",
                "metadataField": "metadata"
            }
        }
    }
)

print("KB ID:", resp["knowledgeBase"]["knowledgeBaseId"])
```

```bash
python create_kb.py
# Save the KB ID printed
```

### Step 5e - Create the S3 Data Source

```python
# create_datasource.py
import boto3

PROFILE = "YOUR_PROFILE"
KB_ID = "YOUR_KB_ID_FROM_STEP_5d"
BUCKET_NAME = "YOUR_BUCKET_NAME_FROM_STEP_4"

session = boto3.Session(profile_name=PROFILE, region_name="us-east-1")
client = session.client("bedrock-agent")

resp = client.create_data_source(
    knowledgeBaseId=KB_ID,
    name="docuquery-s3-source",
    dataSourceConfiguration={
        "type": "S3",
        "s3Configuration": {
            "bucketArn": f"arn:aws:s3:::{BUCKET_NAME}"
        }
    },
    vectorIngestionConfiguration={
        "chunkingConfiguration": {
            "chunkingStrategy": "FIXED_SIZE",
            "fixedSizeChunkingConfiguration": {
                "maxTokens": 1000,
                "overlapPercentage": 20
            }
        }
    }
)

print("Data Source ID:", resp["dataSource"]["dataSourceId"])
```

```bash
python create_datasource.py
# Save the Data Source ID printed
```

---

## Step 6 - Re-deploy CDK with KB and Data Source IDs

Now that you have both IDs, wire them into the Lambda environment variables:

```bash
cd infra
npx cdk deploy \
  --profile YOUR_PROFILE \
  --require-approval never \
  --context environment=dev \
  --context awsRegion=us-east-1 \
  --context awsAccountId=YOUR_ACCOUNT_ID \
  --context knowledgeBaseId=YOUR_KB_ID \
  --context dataSourceId=YOUR_DATA_SOURCE_ID
```

---

## Step 7 - Configure the Frontend

Create `frontend/.env.local` (this file is gitignored - never commit it):

```bash
VITE_USER_POOL_ID=us-east-1_XXXXXXXXX
VITE_USER_POOL_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
VITE_IDENTITY_POOL_ID=us-east-1:XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
VITE_API_URL=https://XXXXXXXXXX.execute-api.us-east-1.amazonaws.com/dev/
VITE_DOCUMENT_BUCKET_NAME=YOUR_BUCKET_NAME
```

Use the values from the CDK outputs saved in Step 4.

---

## Step 8 - Build and Deploy the Frontend via Amplify

```bash
cd frontend

# Local dev (connects to live AWS backend)
npm run dev
# App runs at http://localhost:5173

# Production build
npm run build
# Output: frontend/dist/
```

For Amplify hosting, the GitHub Actions CI/CD pipeline handles deployment automatically on every push to `main`. See `.github/workflows/deploy.yml`.

---

## Step 9 - Verify the Deployment

### Check CDK stack status

```bash
aws cloudformation describe-stacks \
  --stack-name DocuQueryStack \
  --region us-east-1 \
  --profile YOUR_PROFILE \
  --query "Stacks[0].StackStatus" \
  --output text
# Expected: CREATE_COMPLETE or UPDATE_COMPLETE
```

### Check Lambda environment variables

```bash
aws lambda get-function-configuration \
  --function-name docuquery-query-dev \
  --region us-east-1 \
  --profile YOUR_PROFILE \
  --query "Environment.Variables" \
  --output table
# KNOWLEDGE_BASE_ID and DATA_SOURCE_ID must be set
```

### Run the API smoke test

```bash
API_URL="https://XXXXXXXXXX.execute-api.us-east-1.amazonaws.com/dev"

# Without auth - should return 401
curl -s -o /dev/null -w "%{http_code}" $API_URL/documents
# Expected: 401

# CORS preflight - should return Access-Control headers
curl -X OPTIONS "$API_URL/documents" \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: GET" \
  -v 2>&1 | grep "Access-Control"
```

### End-to-end test

1. Open the app at your Amplify URL or `http://localhost:5173`
2. Register a new account with a real email address
3. Verify the account using the 6-digit code sent to your inbox
4. Sign in and navigate to the Documents page
5. Upload a text-based PDF (not a scanned image)
6. Watch the status badge: `uploaded` then `processing` then `ready`
7. Ask a question about the document content
8. Verify the answer includes citations with document name and source passage
9. Navigate to History - the question should be listed

---

## Cleanup

> **Important:** Delete resources in this order to avoid dependency errors.

### Step 1 - Empty the S3 Bucket

The CDK stack cannot delete a non-empty S3 bucket. Empty it first:

```bash
aws s3 rm s3://YOUR_BUCKET_NAME --recursive --profile YOUR_PROFILE
```

### Step 2 - Destroy the CDK Stack

This removes all Lambda functions, API Gateway, DynamoDB, Cognito, S3 bucket, and IAM roles created by CDK:

```bash
cd infra
npx cdk destroy \
  --profile YOUR_PROFILE \
  --force \
  --context environment=dev \
  --context awsRegion=us-east-1 \
  --context awsAccountId=YOUR_ACCOUNT_ID
```

### Step 3 - Delete the Bedrock Knowledge Base and Data Source

```python
# cleanup_kb.py
import boto3

PROFILE = "YOUR_PROFILE"
KB_ID = "YOUR_KB_ID"
DS_ID = "YOUR_DATA_SOURCE_ID"

session = boto3.Session(profile_name=PROFILE, region_name="us-east-1")
client = session.client("bedrock-agent")

# Delete data source first
client.delete_data_source(knowledgeBaseId=KB_ID, dataSourceId=DS_ID)
print("Data source deleted")

# Then delete the KB
client.delete_knowledge_base(knowledgeBaseId=KB_ID)
print("Knowledge Base deleted")
```

```bash
python cleanup_kb.py
```

### Step 4 - Delete OpenSearch Serverless Resources

```bash
PROFILE=YOUR_PROFILE
COLLECTION_ID=YOUR_COLLECTION_ID

# Delete access policy
aws opensearchserverless delete-access-policy \
  --name docuquery-access --type data \
  --region us-east-1 --profile $PROFILE

# Delete collection
aws opensearchserverless delete-collection \
  --id $COLLECTION_ID \
  --region us-east-1 --profile $PROFILE

# Delete security policies
aws opensearchserverless delete-security-policy \
  --name docuquery-net --type network \
  --region us-east-1 --profile $PROFILE

aws opensearchserverless delete-security-policy \
  --name docuquery-enc --type encryption \
  --region us-east-1 --profile $PROFILE
```

### Step 5 - Delete the KB IAM Role

```bash
PROFILE=YOUR_PROFILE

# Remove inline policies first
for policy in S3Access BedrockEmbeddingAccess AOSSAccess; do
  aws iam delete-role-policy \
    --role-name docuquery-kb-role \
    --policy-name $policy \
    --profile $PROFILE
done

# Then delete the role
aws iam delete-role \
  --role-name docuquery-kb-role \
  --profile $PROFILE
```

### Verify cleanup

```bash
# Should return empty or error (stack gone)
aws cloudformation describe-stacks \
  --stack-name DocuQueryStack \
  --region us-east-1 \
  --profile YOUR_PROFILE 2>&1

# Should return empty list
aws bedrock-agent list-knowledge-bases \
  --region us-east-1 \
  --profile YOUR_PROFILE \
  --query "knowledgeBaseSummaries[?name=='docuquery-dev']"

# Should return empty list
aws opensearchserverless list-collections \
  --collection-filters name=docuquery-vectors \
  --region us-east-1 \
  --profile YOUR_PROFILE \
  --query "collectionSummaries"
```

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Document stuck on `processing` | Titan rate limit or first-call delay | Check CloudWatch `/aws/lambda/docuquery-ingest-dev` for ThrottlingException; wait 60s and re-upload |
| `502` on `/query` | Claude 3 Haiku not enabled | Open Bedrock console, check for Anthropic use case form; complete if shown |
| `401` on every API call | Wrong token type | Confirm `authApi.ts` sends `idToken` not `accessToken` |
| CORS error in browser | Missing header | Confirm middleware adds `Access-Control-Allow-Origin: *` |
| `SignatureDoesNotMatch` on S3 upload | ContentLength in presigned URL | Confirm `upload-url` handler does not include `ContentLength` in PutObjectCommand |
| `ConflictException` on ingest | KB already running a job | Upload one file at a time; wait for `ready` before next upload |
| `cdk bootstrap` fails | Orphaned staging bucket | Empty and delete `cdk-hnb659fds-assets-{account}-{region}`, delete stuck CDKToolkit stack |
