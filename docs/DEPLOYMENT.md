# Deployment Guide

> Complete step-by-step deployment guide for DocuQuery RAG Assistant.
> This covers CDK stack, Bedrock Knowledge Base, OpenSearch Serverless, and Amplify frontend.

---

## Deployment Guide

This is the exact sequence used for the current deployment (account `800445863339`, region `us-east-1`).

```bash
# ÔöÇÔöÇ Step 1: Install all dependencies ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
npm install

# ÔöÇÔöÇ Step 2: Build the shared package ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
npm run build --workspace=shared

# ÔöÇÔöÇ Step 3: Bootstrap CDK (one-time per account/region) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
cd infra
npx cdk bootstrap aws://800445863339/us-east-1 --profile flotech-demo-account

# ÔöÇÔöÇ Step 4: Initial CDK deploy (no KB ID yet) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
npx cdk deploy \
  --profile flotech-demo-account \
  --require-approval never \
  --context environment=dev \
  --context awsRegion=us-east-1 \
  --context awsAccountId=800445863339

# CDK outputs: save these ÔÇö you will need them in Step 7 and Step 9
# DocuQueryStack.UserPoolId         = us-east-1_mBss1Hu0l
# DocuQueryStack.UserPoolClientId   = 5jgr5ml0r123hmn2blj720r1du
# DocuQueryStack.IdentityPoolId     = us-east-1:3ebd9bf1-a612-4f1f-8a41-8cf46e9cce43
# DocuQueryStack.ApiGatewayUrl      = https://2u9omiey76.execute-api.us-east-1.amazonaws.com/dev/
# DocuQueryStack.DocumentBucketName = docuquerystack-documentbucketae41e5a9-y4e69bwevqic
# DocuQueryStack.AmplifyAppId       = d3m1ddehppkb04
```

### Create the Bedrock Knowledge Base (CLI)

After the stack is deployed you have the S3 bucket name needed for the data source.

```bash
# ÔöÇÔöÇ Step 5a: Create IAM role for the KB ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
aws iam create-role --role-name docuquery-kb-role \
  --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Principal":{"Service":"bedrock.amazonaws.com"},
      "Action":"sts:AssumeRole",
      "Condition":{
        "StringEquals":{"aws:SourceAccount":"800445863339"},
        "ArnLike":{"aws:SourceArn":"arn:aws:bedrock:us-east-1:800445863339:knowledge-base/*"}
      }
    }]
  }' --profile flotech-demo-account

# Attach S3 read permission
aws iam put-role-policy --role-name docuquery-kb-role --policy-name S3Access \
  --policy-document '{
    "Version":"2012-10-17",
    "Statement":[{"Effect":"Allow","Action":["s3:GetObject","s3:ListBucket"],
    "Resource":["arn:aws:s3:::docuquerystack-documentbucketae41e5a9-y4e69bwevqic",
                "arn:aws:s3:::docuquerystack-documentbucketae41e5a9-y4e69bwevqic/*"]}]
  }' --profile flotech-demo-account

# Attach Bedrock embedding permission
aws iam put-role-policy --role-name docuquery-kb-role --policy-name BedrockEmbeddingAccess \
  --policy-document '{
    "Version":"2012-10-17",
    "Statement":[{"Effect":"Allow","Action":"bedrock:InvokeModel",
    "Resource":"arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v2:0"}]
  }' --profile flotech-demo-account

# ÔöÇÔöÇ Step 5b: Create OpenSearch Serverless vector collection ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
# Encryption policy (required first)
aws opensearchserverless create-security-policy --name docuquery-enc --type encryption \
  --policy '{"Rules":[{"ResourceType":"collection","Resource":["collection/docuquery-vectors"]}],"AWSOwnedKey":true}' \
  --region us-east-1 --profile flotech-demo-account

# Network policy (allow Bedrock to reach it)
aws opensearchserverless create-security-policy --name docuquery-net --type network \
  --policy '[{"Rules":[{"ResourceType":"collection","Resource":["collection/docuquery-vectors"]},{"ResourceType":"dashboard","Resource":["collection/docuquery-vectors"]}],"AllowFromPublic":true}]' \
  --region us-east-1 --profile flotech-demo-account

# Create collection
aws opensearchserverless create-collection --name docuquery-vectors \
  --type VECTORSEARCH --region us-east-1 --profile flotech-demo-account
# Returns collection ID, e.g. h04acuqvvvd64qsauu2k ÔÇö wait ~3 min for ACTIVE status

# Data access policy ÔÇö grants KB role full index access
aws opensearchserverless create-access-policy --name docuquery-access --type data \
  --policy '[{"Rules":[
    {"ResourceType":"index","Resource":["index/docuquery-vectors/*"],
     "Permission":["aoss:CreateIndex","aoss:DeleteIndex","aoss:UpdateIndex",
                   "aoss:DescribeIndex","aoss:ReadDocument","aoss:WriteDocument"]},
    {"ResourceType":"collection","Resource":["collection/docuquery-vectors"],
     "Permission":["aoss:CreateCollectionItems","aoss:DeleteCollectionItems",
                   "aoss:UpdateCollectionItems","aoss:DescribeCollectionItems"]}],
    "Principal":["arn:aws:iam::800445863339:role/docuquery-kb-role",
                 "arn:aws:iam::800445863339:user/YOUR_IAM_USER"]}]' \
  --region us-east-1 --profile flotech-demo-account

# Attach AOSS API access to the KB role (replace COLLECTION_ID)
aws iam put-role-policy --role-name docuquery-kb-role --policy-name AOSSAccess \
  --policy-document '{
    "Version":"2012-10-17",
    "Statement":[{"Effect":"Allow","Action":"aoss:APIAccessAll",
    "Resource":"arn:aws:aoss:us-east-1:800445863339:collection/COLLECTION_ID"}]
  }' --profile flotech-demo-account

# ÔöÇÔöÇ Step 5c: Create vector index in the collection ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
# Use a signed HTTP PUT to the collection endpoint:
# PUT https://{collectionId}.us-east-1.aoss.amazonaws.com/docuquery-index
# Body:
# {
#   "settings": {"index": {"knn": true}},
#   "mappings": {
#     "properties": {
#       "embedding": {"type":"knn_vector","dimension":1024,
#                     "method":{"name":"hnsw","engine":"faiss","space_type":"l2"}},
#       "text":     {"type":"text"},
#       "metadata": {"type":"text"}
#     }
#   }
# }

# ÔöÇÔöÇ Step 5d: Create the Bedrock Knowledge Base ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
# (Use the Python script below or boto3 directly ÔÇö the AWS CLI JSON escaping
#  on Windows PowerShell is unreliable for nested structures)

python - <<'PYEOF'
import boto3
session = boto3.Session(profile_name="flotech-demo-account", region_name="us-east-1")
client = session.client("bedrock-agent")
resp = client.create_knowledge_base(
    name="docuquery-dev",
    roleArn="arn:aws:iam::800445863339:role/docuquery-kb-role",
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
            "collectionArn": "arn:aws:aoss:us-east-1:800445863339:collection/COLLECTION_ID",
            "vectorIndexName": "docuquery-index",
            "fieldMapping": {"vectorField":"embedding","textField":"text","metadataField":"metadata"}
        }
    }
)
print("KB ID:", resp["knowledgeBase"]["knowledgeBaseId"])
PYEOF

# ÔöÇÔöÇ Step 5e: Create S3 data source ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
python - <<'PYEOF'
import boto3
session = boto3.Session(profile_name="flotech-demo-account", region_name="us-east-1")
client = session.client("bedrock-agent")
resp = client.create_data_source(
    knowledgeBaseId="KB_ID_FROM_STEP_5d",
    name="docuquery-s3-source",
    dataSourceConfiguration={
        "type": "S3",
        "s3Configuration": {
            "bucketArn": "arn:aws:s3:::docuquerystack-documentbucketae41e5a9-y4e69bwevqic"
        }
    },
    vectorIngestionConfiguration={
        "chunkingConfiguration": {
            "chunkingStrategy": "FIXED_SIZE",
            "fixedSizeChunkingConfiguration": {"maxTokens": 1000, "overlapPercentage": 20}
        }
    }
)
print("Data Source ID:", resp["dataSource"]["dataSourceId"])
PYEOF
```

### Re-deploy with the Knowledge Base ID

```bash
# ÔöÇÔöÇ Step 6: Re-deploy CDK stack with KB ID wired into Lambda env + IAM ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
cd infra
npx cdk deploy \
  --profile flotech-demo-account \
  --require-approval never \
  --context environment=dev \
  --context awsRegion=us-east-1 \
  --context awsAccountId=800445863339 \
  --context knowledgeBaseId=LPLGCWRHOM
```

### Configure the frontend

```bash
# ÔöÇÔöÇ Step 7: Copy CDK outputs into frontend env file ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
# frontend/.env.local  (never commit ÔÇö already in .gitignore)
VITE_USER_POOL_ID=us-east-1_mBss1Hu0l
VITE_USER_POOL_CLIENT_ID=5jgr5ml0r123hmn2blj720r1du
VITE_IDENTITY_POOL_ID=us-east-1:3ebd9bf1-a612-4f1f-8a41-8cf46e9cce43
VITE_API_URL=https://2u9omiey76.execute-api.us-east-1.amazonaws.com/dev/
VITE_DOCUMENT_BUCKET_NAME=docuquerystack-documentbucketae41e5a9-y4e69bwevqic

# ÔöÇÔöÇ Step 8: Build the frontend ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
cd ../frontend && npm run build
# Output: frontend/dist/ ÔÇö connect to Amplify via console or CLI for hosting
```

---

## Deployed Resources

Current deployment ÔÇö account `800445863339`, region `us-east-1`.

### CDK Stack

| Output | Value |
|--------|-------|
| Stack name | `DocuQueryStack` |
| Stack ARN | `arn:aws:cloudformation:us-east-1:800445863339:stack/DocuQueryStack/61c21df0-cba5-11f1-93db-12ffcd224ecd` |
| Stack status | `CREATE_COMPLETE` |

### Core AWS Resources

| Service | Resource name | Value / ID |
|---------|--------------|-----------|
| Cognito User Pool | `docuquery-dev` | `us-east-1_mBss1Hu0l` |
| Cognito App Client | ÔÇö | `5jgr5ml0r123hmn2blj720r1du` |
| Cognito Identity Pool | ÔÇö | `us-east-1:3ebd9bf1-a612-4f1f-8a41-8cf46e9cce43` |
| DynamoDB Table | `docuquery-dev` | PAY_PER_REQUEST ┬À AES256 ┬À 1 GSI |
| S3 Document Bucket | `docuquerystack-documentbucketae41e5a9-y4e69bwevqic` | SSE-S3 ┬À Block Public Access |
| API Gateway | `docuquery-dev` | `https://2u9omiey76.execute-api.us-east-1.amazonaws.com/dev/` |
| Lambda: upload-url | `docuquery-upload-url-dev` | ARM64 ┬À Node 20 ┬À 29s timeout |
| Lambda: ingest | `docuquery-ingest-dev` | ARM64 ┬À Node 20 ┬À 5m timeout ┬À 1024 MB |
| Lambda: documents | `docuquery-documents-dev` | ARM64 ┬À Node 20 ┬À 29s timeout |
| Lambda: query | `docuquery-query-dev` | ARM64 ┬À Node 20 ┬À 29s timeout |
| Lambda: history | `docuquery-history-dev` | ARM64 ┬À Node 20 ┬À 29s timeout |
| Amplify App | `docuquery-dev` | App ID: `d3m1ddehppkb04` |

### Bedrock & Vector Store Resources

| Resource | Name / ID | Notes |
|----------|----------|-------|
| Bedrock Knowledge Base | `docuquery-dev` | ID: `LPLGCWRHOM` |
| KB Data Source | `docuquery-s3-source` | ID: `BIMFCFRPEH` ┬À S3-backed |
| AOSS Collection | `docuquery-vectors` | ID: `h04acuqvvvd64qsauu2k` ┬À ACTIVE |
| AOSS Vector Index | `docuquery-index` | 1024-dim ┬À HNSW/faiss ┬À l2 space |
| KB IAM Role | `docuquery-kb-role` | `arn:aws:iam::800445863339:role/docuquery-kb-role` |
| Embedding model | Titan Embeddings V2 | `amazon.titan-embed-text-v2:0` |
| Generation model | Claude 3 Haiku | `anthropic.claude-3-haiku-20240307-v1:0` |

### CDK Bootstrap

| Resource | Value |
|----------|-------|
| CDKToolkit stack | `CREATE_COMPLETE` |
| Staging bucket | `cdk-hnb659fds-assets-800445863339-us-east-1` |
| Bootstrap qualifier | `hnb659fds` |

---

## Verifying a Successful Deployment

### Step 1 ÔÇö CloudFormation status

```bash
cd infra
npx cdk diff --profile flotech-demo-account --context environment=dev \
  --context knowledgeBaseId=LPLGCWRHOM
# Expected: "There were no differences"
```

### Step 2 ÔÇö Console resource checklist

Open the AWS Console in `us-east-1`, account `800445863339`:

| Service | Resource name | Expected state |
|---------|--------------|----------------|
| Cognito | `docuquery-dev` | Active, email sign-in enabled |
| API Gateway | `docuquery-dev` | 5 resources, Cognito authorizer attached, stage `dev` |
| Lambda | `docuquery-upload-url-dev` | Active, ARM64, Node.js 20 |
| Lambda | `docuquery-ingest-dev` | Active, 1,024 MB, 5-min timeout |
| Lambda | `docuquery-documents-dev` | Active |
| Lambda | `docuquery-query-dev` | Active, `KNOWLEDGE_BASE_ID=LPLGCWRHOM` |
| Lambda | `docuquery-history-dev` | Active |
| S3 | `docuquerystack-documentbucketae41e5a9-y4e69bwevqic` | Block Public Access: ON, SSE: AES256 |
| DynamoDB | `docuquery-dev` | On-demand, 1 GSI (`userId-createdAt-index`) |
| CloudWatch | `/aws/lambda/docuquery-*-dev` | 5 log groups, retention: 30 days |
| Amplify | `d3m1ddehppkb04` | App created |
| Bedrock KB | `LPLGCWRHOM` | Status: ACTIVE |
| AOSS | `docuquery-vectors` | Status: ACTIVE |

### Step 3 ÔÇö Verify Lambda environment variables

```bash
aws lambda get-function-configuration --function-name docuquery-query-dev \
  --region us-east-1 --profile flotech-demo-account \
  --query "Environment.Variables" --output table
# KNOWLEDGE_BASE_ID must be LPLGCWRHOM
```

### Step 4 ÔÇö API smoke tests

```bash
API_URL="https://2u9omiey76.execute-api.us-east-1.amazonaws.com/dev"

# Should return 401 (auth enforced)
curl -s -o /dev/null -w "%{http_code}" $API_URL/documents
# Expected: 401

# CORS preflight
curl -X OPTIONS "$API_URL/documents" \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Authorization" \
  -v 2>&1 | grep "Access-Control"
# Expected: Access-Control-Allow-Origin header present
```

### Step 5 ÔÇö End-to-end test

1. Start local frontend: `cd frontend && npm run dev` (runs at `http://localhost:5173`)
2. **Register** a new account with a real email
3. **Verify** via the 6-digit code sent to your inbox
4. **Sign in** ÔÇö lands on the Documents page
5. **Upload** a text-based PDF
   - Status badge: `uploaded ÔåÆ processing ÔåÆ ready`
   - If stuck on `processing` after 3 minutes ÔåÆ check CloudWatch `/aws/lambda/docuquery-ingest-dev`
6. **Ask** a question about the document content ÔÇö response should arrive within 10 seconds
7. **Click a citation** to expand the source passage
8. Navigate to **History** ÔÇö the question should be listed

### Common issues and fixes

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Document stuck on `processing` | Titan invocation failed on first call | Check CloudWatch ingest logs for `AccessDeniedException`; re-upload to trigger retry |
| `502` on `/query` | Claude 3 Haiku use case form needed | Open Bedrock console ÔåÆ check for Anthropic use case prompt; complete if shown |
| `401` on every API request | `VITE_API_URL` missing trailing slash | Ensure `.env.local` value ends with `/` |
| Citations show empty `documentName` | KB ID mismatch | Verify `KNOWLEDGE_BASE_ID` env var on all three Lambdas equals `LPLGCWRHOM` |
| Frontend can't sign in | Wrong `VITE_USER_POOL_ID` or client ID | Use values from the [Deployed Resources](#deployed-resources) table above |
| `cdk bootstrap` fails with EarlyValidation | Orphaned staging bucket | Empty + delete `cdk-hnb659fds-assets-800445863339-us-east-1`, delete stuck CDKToolkit stack, retry |

---

## Local Development

```bash
cd frontend
npm install
npm run dev
# App runs at http://localhost:5173
```

The frontend connects to the deployed AWS backend. Your `frontend/.env.local` must contain the live CDK output values. Lambda functions run in AWS ÔÇö there is no local emulation.

```bash
# frontend/.env.local  ÔåÉ this file is gitignored, never commit it
VITE_USER_POOL_ID=us-east-1_mBss1Hu0l
VITE_USER_POOL_CLIENT_ID=5jgr5ml0r123hmn2blj720r1du
VITE_IDENTITY_POOL_ID=us-east-1:3ebd9bf1-a612-4f1f-8a41-8cf46e9cce43
VITE_API_URL=https://2u9omiey76.execute-api.us-east-1.amazonaws.com/dev/
VITE_DOCUMENT_BUCKET_NAME=docuquerystack-documentbucketae41e5a9-y4e69bwevqic
```

---

## Running Tests

```bash
# Backend: unit + property-based tests (10 suites, 62 tests)
npm test --workspace=backend

# CDK infrastructure assertions
npm test --workspace=infra

# Type-check all packages without building
npm run typecheck --workspace=backend
npm run typecheck --workspace=frontend
npm run typecheck --workspace=shared
```

The property-based tests use **fast-check** to verify 12 correctness properties:

| Property | What it proves |
|----------|---------------|
| P1: TXT Round-Trip Fidelity | `parse(serialize(parse(x))) === parse(x)` for TXT |
| P2: Chunking Completeness | Every input token appears in at least one chunk |
| P3: Chunking Size Bound | Every chunk Ôëñ 1,000 tokens |
| P4: DOCX Paragraph Boundaries | Newlines preserved at paragraph boundaries |
| P5: Per-User Isolation | Cross-user access always returns 403 |
| P6: Fallback Threshold | Scores < 0.5 always triggers fallback, no Claude call |
| P7: Citation Completeness | Non-fallback answers always have citations with all fields |
| P8: Status Monotonicity | No backward status transitions (ready ÔåÆ processing etc.) |
| P9: Empty Input Rejection | Empty/whitespace text ÔåÆ failed, no KB indexing |
| P10: Ingestion Determinism | Same input always produces same extracted text |
| P11: Prompt Instructions | System prompt always contains grounding + fallback instructions |
| P12: Log Completeness | Every log entry has all 6 required structured fields |

---

## CI/CD Pipeline

Every push to `main` automatically lints, tests, deploys infra changes, and builds the frontend via Amplify. No manual AWS console steps required.

### How it works

```
push to main
     |
     v
[1] CI Gate ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ lint + all tests + frontend typecheck + build
     |
     v
[2] Connect Amplify ÔöÇÔöÇ wires GitHub repo to Amplify app once (idempotent ÔÇö no-op after first run)
     |                 creates the main branch in Amplify with auto-build enabled
     v
[3] CDK Deploy ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ applies any infra changes (Lambda code, IAM, env vars)
     |                  no-op in ~15 s when nothing changed
     v
[4] Monitor Amplify ÔöÇÔöÇÔöÇ waits for Amplify's automatic build to complete
                        Amplify triggers itself via GitHub webhook on every push
                        falls back to a manual trigger if the webhook fires late
```

After the first run, step 2 is always a no-op ÔÇö Amplify is already wired. Steps 3 and 4
are the only meaningful work on subsequent pushes.

### One-time setup: add GitHub secrets

Go to **Settings ÔåÆ Secrets and variables ÔåÆ Actions** in the repository.

**Secrets:**

| Name | Value | Where to get it |
|------|-------|----------------|
| `AWS_ACCESS_KEY_ID` | IAM access key ID | AWS Console ÔåÆ IAM ÔåÆ Users ÔåÆ `flotech-demo-account` ÔåÆ Security credentials |
| `AWS_SECRET_ACCESS_KEY` | Secret access key | Same ÔÇö create new access key if needed |
| `AWS_ACCOUNT_ID` | `800445863339` | Fixed |
| `GITHUB_PAT` | GitHub Personal Access Token | [github.com/settings/tokens](https://github.com/settings/tokens) ÔåÆ Generate new token (classic) ÔåÆ tick `repo` scope |

> **GITHUB_PAT** is only used in the `connect-amplify` step to authorise the one-time
> Amplify Ôåö GitHub OAuth handshake. After the connection is established it is never used
> again. It can be a fine-grained PAT scoped to just this repository with
> `contents: read` and `webhooks: write` permissions if you prefer tighter scoping.

**Optional variables** (Settings ÔåÆ Variables ÔåÆ Actions):

| Name | Default |
|------|---------|
| `ENVIRONMENT` | `dev` |
| `AWS_REGION` | `us-east-1` |

### After adding the secrets

Push any commit to `main`. On the first run:

1. `connect-amplify` links `https://github.com/florayuyuun123/docuquery-rag-assistant` to Amplify app `d3m1ddehppkb04` and creates the `main` branch with auto-build enabled
2. Amplify installs the GitHub webhook automatically ÔÇö all future pushes trigger builds without GitHub Actions involvement
3. The frontend is live at `https://main.d3m1ddehppkb04.amplifyapp.com`

Track the run at:
```
https://github.com/florayuyuun123/docuquery-rag-assistant/actions
```

### Running CI locally before pushing

```bash
npm ci
npm run build --workspace=shared

npm run lint
npm run format:check
npm test --workspace=backend
npm test --workspace=infra
npm run typecheck --workspace=frontend
npm run build --workspace=frontend
```

---

## Manual Application Testing

Walk through each feature of the live application. Run `npm run dev --workspace=frontend` or use the Amplify-hosted URL.

**Before you start:** confirm `frontend/.env.local` has the values from [Deployed Resources](#deployed-resources).

---

### Test 1 ÔÇö User registration and email verification

**Goal:** Cognito sign-up flow works end-to-end.

```
1. Navigate to /signup
2. Enter a real email and a password:
   - 8+ characters, 1 uppercase, 1 lowercase, 1 digit, 1 symbol
3. Click Register
4. Check email for the 6-digit code
5. Enter the code on /verify

Expected:
[x] Field-level password errors show in real time
[x] Email arrives within 60 seconds
[x] Wrong code shows "Invalid verification code" with a retry option
[x] Correct code redirects to /signin
```

---

### Test 2 ÔÇö Sign in and session handling

**Goal:** JWT auth and token refresh work correctly.

```
1. Sign in with the verified account from Test 1
2. Open DevTools -> Application -> Local Storage
   -> Cognito tokens present (keys prefixed CognitoIdentityServiceProvider)
3. Sign out -> navigating to /documents redirects to /signin

Expected:
[x] Wrong credentials show "Authentication failed" (no field-level detail)
[x] After sign-out, all protected routes redirect to /signin
[x] Silent token refresh happens after 15 min ÔÇö no forced redirect
```

---

### Test 3 ÔÇö Document upload (TXT / DOCX / native PDF)

**Goal:** Upload flow, S3 pre-signed URL, and ingestion pipeline work.

```
1. Navigate to /documents
2. Upload a TXT file under 20 MB
3. Watch the status badge: uploaded -> processing -> ready
   (typically 10ÔÇô30 s for text files)
4. Repeat with DOCX and a native (text-layer) PDF

Expected:
[x] File appears instantly with status "uploaded"
[x] Status transitions to "processing" within a few seconds
[x] Status reaches "ready" once ingestion completes
[x] Unsupported file type (e.g. .xlsx) -> client-side error, no API call
[x] File > 20 MB -> size error, no API call
```

**Check ingestion logs:**
```bash
aws logs tail /aws/lambda/docuquery-ingest-dev \
  --region us-east-1 --profile flotech-demo-account --follow
```
Healthy log entry:
```json
{ "functionName":"ingest-fn", "operationType":"ingest:complete",
  "outcome":"success", "chunkCount":24, "durationMs":8420 }
```

**Verify S3 and DynamoDB:**
```bash
# File in S3 under USER#{userId}/DOC#{documentId}/
aws s3 ls s3://docuquerystack-documentbucketae41e5a9-y4e69bwevqic \
  --recursive --profile flotech-demo-account

# Record in DynamoDB with status=ready
aws dynamodb query --table-name docuquery-dev --region us-east-1 \
  --profile flotech-demo-account \
  --key-condition-expression "PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"USER#<your-cognito-sub>"}}' \
  --output table
```

---

### Test 4 ÔÇö Scanned PDF (Textract path)

**Goal:** Textract fallback triggers for image-only PDFs.

```
1. Upload a scanned PDF (no embedded text layer)
2. Status stays on "processing" longer ÔÇö 30ÔÇô90 s while Textract runs OCR

Expected:
[x] Status eventually reaches "ready" (not "failed")
[x] CloudWatch shows "operationType":"textract:poll" entries during processing
[x] chunkCount > 0 in the completion log
```

---

### Test 5 ÔÇö RAG query with citations

**Goal:** Full retrieval + generation pipeline returns a grounded answer.

```
1. Ensure at least one document has status "ready"
2. Navigate to /chat
3. Ask a specific question whose answer is in the uploaded document

Expected:
[x] Answer appears (typically 2ÔÇô8 seconds)
[x] Citation panel shows below the answer
[x] Each citation shows: document name and page number
[x] Clicking a citation expands the verbatim passage
[x] CloudWatch query log shows "isFallback":false
```

**Check query logs:**
```bash
aws logs tail /aws/lambda/docuquery-query-dev \
  --region us-east-1 --profile flotech-demo-account --follow
```
Healthy log entry:
```json
{ "functionName":"query-fn", "operationType":"query:complete",
  "outcome":"success", "isFallback":false, "citationCount":3, "durationMs":3210 }
```

---

### Test 6 ÔÇö Fallback (question not in documents)

**Goal:** Threshold guard fires ÔÇö Claude is never called for irrelevant questions.

```
1. With Document A uploaded, ask a completely unrelated question
   e.g. "What is the capital of France?" (not in any uploaded doc)

Expected:
[x] Response: "I could not find the answer in your documents."
[x] No citation panel
[x] CloudWatch log shows "isFallback":true
[x] No Bedrock Claude invocation in the log (no InvokeModel call for Claude)
```

---

### Test 7 ÔÇö No documents state

**Goal:** Informational message returned before any Bedrock calls are made.

```
1. Delete all documents from /documents
2. Navigate to /chat and ask any question

Expected:
[x] Response: "No documents are currently available to query."
[x] No Bedrock calls at all (CloudWatch shows no log entry for this query)
```

---

### Test 8 ÔÇö Document deletion cascade

**Goal:** Deleting a document removes it from S3, KB, and DynamoDB.

```
1. On /documents, click Delete on a "ready" document
2. Confirm the item disappears from the list immediately (no page reload)

Expected:
[x] Item removed from UI
[x] S3 object gone:
    aws s3 ls s3://docuquerystack-documentbucketae41e5a9-y4e69bwevqic --recursive
[x] DynamoDB record gone:
    aws dynamodb get-item --table-name docuquery-dev --region us-east-1 ...
[x] Querying that document's content now returns fallback
```

---

### Test 9 ÔÇö Chat history

**Goal:** All queries persist and display in reverse-chronological order.

```
1. Ask 3ÔÇô5 questions on /chat
2. Navigate to /history

Expected:
[x] All questions appear, newest first
[x] Each entry shows: question, answer, citations
[x] History page shows at most 50 entries
```

**Verify in DynamoDB:**
```bash
aws dynamodb query --table-name docuquery-dev --region us-east-1 \
  --profile flotech-demo-account \
  --key-condition-expression "PK = :pk AND begins_with(SK, :sk)" \
  --expression-attribute-values '{":pk":{"S":"USER#<sub>"},":sk":{"S":"CHAT#"}}' \
  --output table
```

---

### Test 10 ÔÇö Per-user data isolation

**Goal:** Users cannot see each other's documents or history.

```
1. Register a second account (User B, different email)
2. Sign in as User B -> /documents must be empty (User A's docs not visible)
3. Navigate to /history -> must be empty
4. Sign back in as User A -> documents and history intact

Expected:
[x] Zero data leakage between accounts
[x] API enforces userId filter at the DynamoDB and KB Retrieve level
```

---

### Observability quick-reference

```bash
# Tail all five Lambda log groups (open in separate terminals)
aws logs tail /aws/lambda/docuquery-upload-url-dev  --follow --profile flotech-demo-account --region us-east-1
aws logs tail /aws/lambda/docuquery-ingest-dev      --follow --profile flotech-demo-account --region us-east-1
aws logs tail /aws/lambda/docuquery-documents-dev   --follow --profile flotech-demo-account --region us-east-1
aws logs tail /aws/lambda/docuquery-query-dev       --follow --profile flotech-demo-account --region us-east-1
aws logs tail /aws/lambda/docuquery-history-dev     --follow --profile flotech-demo-account --region us-east-1

# Search for errors in a log group
aws logs filter-log-events \
  --log-group-name /aws/lambda/docuquery-ingest-dev \
  --region us-east-1 --profile flotech-demo-account \
  --filter-pattern '{ $.outcome = "error" }'

# Trace a request by correlation ID
aws logs filter-log-events \
  --log-group-name /aws/lambda/docuquery-query-dev \
  --region us-east-1 --profile flotech-demo-account \
  --filter-pattern '{ $.correlationId = "<id-here>" }'
```

---

---

## Cost Breakdown

All services use pay-per-request pricing ÔÇö no idle charges except the AOSS collection, which incurs OCU charges while active.

| Service | Pricing basis | Est. cost at 100 queries/month |
|---------|--------------|-------------------------------|
| Lambda (5 functions) | $0.20 per 1M invocations + duration | < $0.01 |
| API Gateway | $3.50 per 1M requests | < $0.01 |
| DynamoDB (on-demand) | $1.25 per 1M reads | < $0.01 |
| S3 (storage + requests) | $0.023/GB + $0.0004/1K requests | < $0.05 |
| Cognito | Free Ôëñ 50,000 MAU | $0.00 |
| Bedrock Titan Embeddings V2 | $0.0001 per 1K tokens | < $0.02 |
| Bedrock Claude 3 Haiku | $0.00025/$0.00125 per 1K in/out tokens | < $0.20 |
| OpenSearch Serverless | OCU charges (~$0.24/OCU-hr, min 2 OCU) | ~$340/month at minimum |
| CloudWatch Logs | $0.50/GB ingested | < $0.05 |
| Amplify Hosting | $0.01/GB served | < $0.05 |

> ÔÜá´©Å **The dominant cost driver in this deployment is OpenSearch Serverless**, which charges for compute capacity units (OCUs) regardless of query volume. For a production workload with continuous traffic this cost is justified, but for a dev/test environment consider deleting the AOSS collection and KB when not in use, and re-creating them for active testing sessions.
>
> Monitor **AWS Cost Explorer** after deployment and set a billing alert.

---

## Lessons Learned

**1. CDK bootstrap can silently fail and leave orphaned resources**
If the CDKToolkit stack ends up in `REVIEW_IN_PROGRESS` (never progressed past changeset creation), the staging bucket may still exist. Subsequent bootstrap attempts fail with `EarlyValidation` errors because the bucket name conflicts. Always check for stale buckets and stuck stacks before retrying.

**2. The pre-signed URL pattern is non-negotiable for file uploads**
Routing file uploads through a Lambda function wastes memory, adds latency, and costs more. The browser-to-S3 direct upload with pre-signed URLs is the right pattern ÔÇö it also gives you native XHR upload progress events at no extra cost.

**3. Property-based testing finds edge cases example-based tests miss**
The tiktoken chunker worked correctly on all handwritten test inputs. Fast-check found an off-by-one in the overlap calculation with a specific input length that no example triggered. Property-based testing for data transformation code is worth the setup cost.

**4. Anthropic model access requires a one-time use case submission for new accounts**
AWS now auto-enables foundation models on first invocation, which is a significant improvement. The exception is Anthropic ÔÇö Claude models may still require a brief use case form for first-time users. The failure is silent at deploy time (CDK succeeds regardless), so the first symptom is a `502` on the `/query` endpoint. CloudWatch logs will show a Bedrock `AccessDeniedException` pointing directly at the issue.

**5. TypeScript strict mode catches real bugs at Lambda boundary**
Lambda event types (`APIGatewayProxyEvent`) have deeply optional fields. Without strict mode, it's easy to write `event.body.question` and only discover the `null` dereference in production. Strict mode + nullish coalescing everywhere prevented several runtime errors.

**6. Use boto3/Python for complex AWS CLI operations on Windows**
PowerShell's string escaping makes deeply nested JSON arguments to AWS CLI commands unreliable on Windows ÔÇö multi-level quotes frequently cause silent command cancellations. For operations like creating a Bedrock Knowledge Base (which requires nested JSON configs), writing a 10-line Python boto3 script is faster and more reliable than fighting PowerShell escaping.

---


---

## Cleanup

The cleanup order matters because of resource dependencies. The CDK stack is the central step ÔÇö and for the **dev** environment it now removes the S3 bucket, DynamoDB table, and Cognito User Pool automatically (see note below).

> **Why `cdk destroy` handles everything in dev**
>
> The stack was updated so that stateful resources use `removalPolicy: DESTROY` when
> `environment != 'prod'`. In a prod deployment those same resources use `RETAIN` to
> protect real user data from accidental deletion. On dev, `cdk destroy` is a complete
> teardown ÔÇö no manual resource cleanup needed.

---

### Step 1 ÔÇö Delete the Bedrock Knowledge Base and data source

These live outside CloudFormation, so they are never touched by `cdk destroy`.

```bash
python - <<'PYEOF'
import boto3
session = boto3.Session(profile_name="flotech-demo-account", region_name="us-east-1")
client = session.client("bedrock-agent")
# Data source must be deleted before the KB
client.delete_data_source(knowledgeBaseId="LPLGCWRHOM", dataSourceId="BIMFCFRPEH")
print("Data source deleted")
client.delete_knowledge_base(knowledgeBaseId="LPLGCWRHOM")
print("Knowledge base deleted")
PYEOF
```

### Step 2 ÔÇö Delete the OpenSearch Serverless collection

This is the dominant cost driver (~OCU charges). Delete it before the CDK stack ÔÇö the
KB IAM role (managed by CDK) is still present at this point and the delete will succeed.

```bash
# Delete the collection
aws opensearchserverless delete-collection --id h04acuqvvvd64qsauu2k \
  --region us-east-1 --profile flotech-demo-account

# Wait ~60 seconds for deletion, then remove the associated policies
aws opensearchserverless delete-access-policy --name docuquery-access --type data \
  --region us-east-1 --profile flotech-demo-account
aws opensearchserverless delete-security-policy --name docuquery-net --type network \
  --region us-east-1 --profile flotech-demo-account
aws opensearchserverless delete-security-policy --name docuquery-enc --type encryption \
  --region us-east-1 --profile flotech-demo-account
```

### Step 3 ÔÇö Delete the KB IAM role

This role was created manually (not by CDK), so `cdk destroy` does not remove it.

```bash
aws iam delete-role-policy --role-name docuquery-kb-role --policy-name S3Access \
  --profile flotech-demo-account
aws iam delete-role-policy --role-name docuquery-kb-role --policy-name BedrockEmbeddingAccess \
  --profile flotech-demo-account
aws iam delete-role-policy --role-name docuquery-kb-role --policy-name AOSSAccess \
  --profile flotech-demo-account
aws iam delete-role --role-name docuquery-kb-role --profile flotech-demo-account
```

### Step 4 ÔÇö Destroy the CDK stack

On **dev** this removes everything the stack created: Lambda ├ù 5, API Gateway, Amplify,
IAM execution roles, CloudWatch log groups, **and** the S3 bucket, DynamoDB table, and
Cognito User Pool (because `removalPolicy = DESTROY` for non-prod environments).

```bash
cd infra
npx cdk destroy \
  --profile flotech-demo-account \
  --force \
  --context environment=dev \
  --context awsRegion=us-east-1 \
  --context awsAccountId=800445863339 \
  --context knowledgeBaseId=LPLGCWRHOM
```

> **Prod teardown:** If `--context environment=prod` is used, the S3 bucket, DynamoDB
> table, and Cognito User Pool are retained after the stack is deleted. You would then
> need to empty and delete them manually before all charges stop.

### Step 5 ÔÇö Delete the CDK bootstrap stack (optional)

Only needed if you have no other CDK apps in this account/region.

```bash
# Empty the staging bucket first
aws s3 rm s3://cdk-hnb659fds-assets-800445863339-us-east-1 \
  --recursive --profile flotech-demo-account

# Destroy the CDKToolkit stack
aws cloudformation delete-stack --stack-name CDKToolkit \
  --region us-east-1 --profile flotech-demo-account

aws cloudformation wait stack-delete-complete --stack-name CDKToolkit \
  --region us-east-1 --profile flotech-demo-account
```

### Step 6 ÔÇö Verify everything is gone

```bash
# AOSS collection
aws opensearchserverless list-collections \
  --region us-east-1 --profile flotech-demo-account

# Lambda functions
aws lambda list-functions --region us-east-1 --profile flotech-demo-account \
  --query "Functions[?starts_with(FunctionName,'docuquery')].FunctionName"

# S3 buckets
aws s3 ls --profile flotech-demo-account | grep docuquery

# DynamoDB tables
aws dynamodb list-tables --region us-east-1 --profile flotech-demo-account \
  --query "TableNames[?starts_with(@,'docuquery')]"

# Bedrock Knowledge Bases
aws bedrock-agent list-knowledge-bases --region us-east-1 --profile flotech-demo-account \
  --query "knowledgeBaseSummaries[].{Name:name,Status:status}"
```

All five commands should return empty results. Check **AWS Cost Explorer** the next day
to confirm no `DocuQuery`-tagged charges are accruing.

### Cleanup order summary

| Order | Resource | Created by | Deleted by |
|-------|----------|-----------|------------|
| 1 | KB data source `BIMFCFRPEH` | Manual (boto3) | Manual (boto3) ÔÇö must go before KB |
| 2 | Knowledge Base `LPLGCWRHOM` | Manual (boto3) | Manual (boto3) ÔÇö must go before AOSS |
| 3 | AOSS collection `docuquery-vectors` | Manual (CLI) | Manual (CLI) ÔÇö main cost driver |
| 4 | AOSS policies (access, network, encryption) | Manual (CLI) | Manual (CLI) ÔÇö after collection |
| 5 | KB IAM role `docuquery-kb-role` | Manual (CLI) | Manual (CLI) ÔÇö not in CDK |
| 6 | Everything else (Lambda, API GW, Amplify, S3, DDB, CognitoÔÇª) | CDK | `cdk destroy` (dev auto-deletes stateful resources) |
| 7 | CDKToolkit stack | CDK bootstrap | Optional ÔÇö only if no other CDK apps |

---

