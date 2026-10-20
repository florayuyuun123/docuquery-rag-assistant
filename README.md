# DocuQuery — Building a RAG-Powered Document Q&A Assistant on AWS

> **"Stop searching. Start asking."** Upload your PDFs, policies, and reports. Ask questions in plain English. Get answers grounded in your own documents — with cited sources you can verify.

---

## Table of Contents

1. [The Problem](#the-problem)
2. [The Solution](#the-solution)
3. [How RAG Works](#how-rag-works)
4. [Architecture Overview](#architecture-overview)
5. [Key Design Decisions & Challenges](#key-design-decisions--challenges)
6. [Tech Stack](#tech-stack)
7. [Project Structure](#project-structure)
8. [Prerequisites](#prerequisites)
9. [Deployment Guide](#deployment-guide)
10. [Deployed Resources](#deployed-resources)
11. [Verifying a Successful Deployment](#verifying-a-successful-deployment)
12. [Local Development](#local-development)
13. [Running Tests](#running-tests)
14. [CI/CD Pipeline](#cicd-pipeline)
15. [Manual Application Testing](#manual-application-testing)
16. [Cost Breakdown](#cost-breakdown)
17. [Lessons Learned](#lessons-learned)
18. [Cleanup](#cleanup)

---

## The Problem

Every organisation accumulates documents — HR policies, compliance manuals, technical runbooks, research papers, onboarding guides. When someone needs an answer, they either:

- Spend 20 minutes Ctrl+F-ing through a 200-page PDF
- Ask a colleague who then spends 20 minutes doing the same
- Give up and make a decision without the right information

The deeper problem is **verifiability**. Even if you use a general-purpose LLM like ChatGPT, you have no guarantee the answer came from *your* documents, not from the model's training data. For legal, compliance, or safety-sensitive contexts, that matters enormously.

### The specific pain points this project addresses:

| Pain | Impact |
|------|--------|
| Manual document search | 15–30 min per query, error-prone |
| No source attribution | Answers can't be verified or audited |
| Generic LLM hallucination | Model invents facts not in the source material |
| Data privacy | Sending proprietary docs to third-party LLM APIs |
| Infrastructure complexity | RAG systems typically require OpenSearch or Pinecone, adding cost and ops burden |

---

## The Solution

**DocuQuery** is a fully serverless, cost-conscious Retrieval-Augmented Generation (RAG) web application built entirely on AWS managed services.

Upload a document. Ask a question. Get an answer that:
- Is drawn **exclusively** from your uploaded documents
- Cites the **exact source** (document name, page number, verbatim passage)
- Tells you honestly when it **doesn't know** rather than guessing
- Stays **private** — your documents never leave your AWS account

The entire stack is defined as Infrastructure as Code using AWS CDK. There are no servers to manage, no idle capacity to pay for, and no third-party vector databases.

### What a user experience looks like

```
1. Register with email → verify → sign in
2. Upload: "Q3_2024_Compliance_Policy.pdf" (8 pages, scanned)
   Status: uploaded → processing → ready (Textract OCR running)
3. Ask: "What is the maximum transaction limit for Level 2 accounts?"
4. Answer: "Level 2 accounts are subject to a maximum single transaction
            limit of $50,000 per day, as defined in Section 4.3..."
   [Source 1] Q3_2024_Compliance_Policy.pdf — Page 4
   ► "Level 2 account holders shall not exceed..."
```

---

## How RAG Works

Standard LLMs answer from their training data, which ends at a cutoff date and contains nothing about your internal documents. RAG solves this:

```
YOUR DOCUMENT
     │
     ▼
[1] EXTRACT TEXT     → OCR (Textract) / mammoth (DOCX) / UTF-8 (TXT)
     │
     ▼
[2] CHUNK            → Split into 1,000-token segments, 200-token overlap
     │
     ▼
[3] EMBED            → Titan Embeddings V2 → 1,024-dimension vector
     │
     ▼
[4] INDEX            → Bedrock Knowledge Base → OpenSearch Serverless (your account only)

AT QUERY TIME:
     │
     ▼
[5] EMBED QUESTION   → Same embedding model
     │
     ▼
[6] RETRIEVE         → Cosine similarity search → top-5 chunks
     │                 (userId metadata filter = only YOUR documents)
     ▼
[7] GENERATE         → Claude 3 Haiku + system prompt:
     │                 "Answer ONLY from the provided passages.
     │                  If insufficient, say so."
     ▼
[8] RETURN           → { answer, citations[ { doc, page, passage } ] }
```

The key guarantee: the system prompt explicitly forbids the model from using knowledge outside the retrieved chunks. If the chunks don't contain the answer, the fallback message is returned — no guessing.

---

## Architecture Overview

> The architecture diagram is in [`docs/architecture.md`](docs/architecture.md).
> It uses **Mermaid** and renders natively on GitHub — no plugins needed.
> Raw source: [`docs/architecture.mmd`](docs/architecture.mmd) — paste at [mermaid.live](https://mermaid.live) for an interactive view.

The architecture is divided into five tiers:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  TIER 1 — FRONTEND                                                           │
│  React 18 + TypeScript SPA  hosted on  AWS Amplify (App: d3m1ddehppkb04)   │
│  Cognito auth flows · JWT token management · XHR upload progress            │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ HTTPS + JWT Bearer
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  TIER 2 — API                                                                │
│  Amazon API Gateway REST  ←→  Amazon Cognito (JWT authorizer)               │
│  https://2u9omiey76.execute-api.us-east-1.amazonaws.com/dev/               │
│  5 routes · CORS · Request validation · Throttling                          │
└────┬──────────────┬──────────────┬────────────────┬───────────────┬─────────┘
     │              │              │                │               │
     ▼              ▼              ▼                ▼               ▼
┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  ┌──────────┐
│upload-  │  │documents │  │ingest-fn │  │ query-fn     │  │history-  │
│url-fn   │  │-fn       │  │(S3 trig.)│  │ (RAG core)   │  │fn        │
└────┬────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘  └────┬─────┘
     │             │             │                │                │
     ▼             ▼             ▼                ▼                │
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐       │
│  TIER 3  │  │ Amazon   │  │ Amazon   │  │  Amazon      │       │
│ Amazon   │  │ DynamoDB │  │ Textract │  │  Bedrock KB  │◄──────┘
│   S3     │  │ (single  │  │  (OCR)   │  │  (LPLGCWRHOM)│
│(SSE-S3)  │  │  table)  │  │          │  │  Claude 3 /  │
└──────────┘  └──────────┘  └──────────┘  │  Titan Emb.  │
                                           └──────┬───────┘
                                                  │
                                                  ▼
                                     ┌────────────────────────┐
                                     │ OpenSearch Serverless  │
                                     │ Collection:            │
                                     │ docuquery-vectors      │
                                     │ Index: docuquery-index │
                                     │ (1024-dim, HNSW/faiss) │
                                     └────────────────────────┘
                                  ↕ all Lambdas
                             Amazon CloudWatch
                          (structured JSON, 30-day)
```

### Upload flow

```
Browser ──1──► POST /documents/upload-url ──► upload-url-fn
                                               │ returns { presignedUrl, documentId }
Browser ──2──► PUT {file} ──────────────────► S3 (direct, no Lambda proxy)
                                               │ S3 ObjectCreated
                                               └──► ingest-fn (async)
                                                     ├── status = "processing"
                                                     ├── Extract text
                                                     ├── Chunk (1000/200 tokens)
                                                     ├── StartIngestionJob → KB
                                                     └── status = "ready"
```

### Query (RAG) flow

```
Browser ──► POST /query { question } ──► query-fn
                                          ├── Check ready docs exist (skip Bedrock if none)
                                          ├── KB.Retrieve(question, filter={userId}, top=5)
                                          ├── scores < 0.5 → fallback response (no Claude call)
                                          ├── InvokeModel(Claude 3 Haiku, system_prompt, 10s)
                                          ├── Assemble citations
                                          ├── Persist chat record (DynamoDB)
                                          └── Return { answer, citations, isFallback }
```

---

## Key Design Decisions & Challenges

### Challenge 1: Vector store selection

The standard recommendation for Bedrock Knowledge Bases is OpenSearch Serverless (AOSS). While AOSS has a minimum cost of ~$700/month at standby capacity in some configurations, this project uses it because:

- AOSS is the most fully-featured and battle-tested vector store backend for Bedrock KBs
- The AOSS collection in this deployment uses the `VECTORSEARCH` type with `standbyReplicas: ENABLED`
- The `docuquery-vectors` collection + `docuquery-index` (HNSW/faiss, 1024 dimensions) was created via AWS CLI, not the console

> **Note on S3 Vectors:** The original design intended to use Amazon S3 Vectors (a newer, pay-per-request vector backend). At the time of this deployment, AOSS was selected as the proven, stable option. S3 Vectors remains the lower-cost alternative for future consideration.

---

### Challenge 2: Per-user data isolation in a shared vector store

A shared Knowledge Base means all users' document chunks live in the same index. If not handled carefully, User A could retrieve chunks from User B's documents.

**Solution:** Every chunk indexed into the Knowledge Base carries a `userId` metadata attribute. The `query-fn` always passes a retrieval filter:
```typescript
filter: { equals: { key: "userId", value: callerId } }
```
This is enforced at the vector store level, not in application code. The S3 key prefix (`USER#{userId}/DOC#{docId}/`) provides a second layer of separation in raw storage.

---

### Challenge 3: Handling scanned PDFs without a text layer

Many real-world PDFs are scanned images — `pdf-parse` returns an empty string for them.

**Solution:** A two-pass extraction strategy:
1. Try `pdf-parse` to extract the embedded text layer
2. If the result is empty, fall back to **Amazon Textract** (`StartDocumentTextDetection` + async polling)

This means native PDFs process in seconds; scanned PDFs take 15–60 seconds but are handled automatically. The document status (`processing → ready`) reflects this — the frontend polls every 3 seconds so users see live updates.

---

### Challenge 4: Preventing double-indexing on Lambda retry

S3 event triggers can retry on failure. If `ingest-fn` fails halfway through (after some chunks are indexed), a retry would index those chunks a second time, corrupting the vector store.

**Solution:**
- Set `MaximumRetryAttempts: 0` on the S3 event source mapping
- On any failure: run a compensating rollback (delete all chunks for that `documentId` from the KB) before setting status to `failed`
- The frontend shows a "Processing failed — please retry upload" message, prompting the user to re-upload rather than auto-retrying

---

### Challenge 5: Avoiding hallucination in the LLM response

Without explicit constraints, Claude will happily answer from its training data even when the retrieved chunks don't support the question.

**Solution:** Two-layer enforcement:
1. **Pre-Claude check:** if all retrieved chunks have a relevance score below the configured threshold (default 0.5), return the fallback response immediately — never call Claude
2. **System prompt instruction:** "Answer the user's question using ONLY the document passages provided. If the passages do not contain sufficient information, respond exactly with: 'I could not find an answer to your question in the provided documents.'"

This was validated with property-based tests (fast-check) covering 100 iterations of generated inputs.

---

### Challenge 6: CDK bootstrap blocked by EarlyValidation hook

When bootstrapping CDK in this account for the first time, the `AWS::EarlyValidation::ResourceExistenceCheck` hook rejected the changeset because a stale CDK staging bucket (`cdk-hnb659fds-assets-800445863339-us-east-1`) from a prior attempt already existed.

**Solution:** Manually empty and delete the orphaned bucket (including all object versions and delete markers), delete the stuck `CDKToolkit` stack in `REVIEW_IN_PROGRESS` state, then re-run `cdk bootstrap`. With a clean slate, bootstrap succeeded in under 2 minutes.

**Lesson:** When CDK bootstrap fails partway through, always check for orphaned S3 staging buckets before retrying. The bucket name follows the pattern `cdk-hnb659fds-assets-{account}-{region}`.

---

### Challenge 7: TypeScript ESM/CJS interop in Lambda

The monorepo uses `module: Node16` (ESM) throughout, but several dependencies (`pdf-parse`, `tiktoken`, `mammoth`) ship as CommonJS. Lambda's Node.js 20 runtime supports both, but `ts-jest` for unit tests does not handle ESM `.js` extension imports gracefully without configuration.

**Solution:**
- Lambda bundles use `esbuild` (handles ESM/CJS interop natively)
- Jest config uses `moduleNameMapper` to strip `.js` extensions and force CommonJS compilation via inline `tsconfig` override in `ts-jest`
- `pdf-parse` is imported via `require()` to avoid the ESM default export issue

### Challenge 8: ESLint type-aware rules in a monorepo

`eslint-plugin-import` was configured with `eslint-import-resolver-typescript` in the settings, but that package was never installed. This caused every `import/` rule to crash with `typescript with invalid interface loaded as resolver` on CI.

**Solution:** Two changes to `.eslintrc.js`:
- Removed `plugin:import/typescript` and `settings['import/resolver'].typescript` — these are only needed for `import/no-unresolved`, which was already disabled
- Added `project: true` + `tsconfigRootDir: __dirname` to `parserOptions` so type-aware rules (`no-floating-promises`, `no-unsafe-*`) find each package's `tsconfig.json` automatically

Also added `test/**/*` to `backend/tsconfig.json` `include` so ESLint can type-check test files alongside source files. This surfaced real bugs: unsafe `.sub` member access on `any`-typed JWT claims (fixed by casting to `Record<string, string>`), `!=` instead of `!==`, and async React handlers passed directly to `onSubmit` (fixed with `void` wrapper).

### Challenge 9: CDK test expected explicit CloudWatch log groups

The CDK assertion test `all Lambda log groups have 30-day retention` failed with `Expected 5 resources of type AWS::Logs::LogGroup but found 0` because the stack relied on Lambda auto-creating log groups at runtime rather than defining them in CDK.

**Problem:** Auto-created log groups have no retention policy — logs accumulate indefinitely and are not visible in `cdk diff` or testable via CDK assertions.

**Solution:** Added an explicit `logs.LogGroup` for each of the 5 Lambda functions with `retention: logs.RetentionDays.ONE_MONTH` and `removalPolicy` matching the environment. Each log group is pre-named `/aws/lambda/docuquery-{fn}-{env}` and wired via the `logGroup` prop on `NodejsFunction`. The log groups now exist from deploy time — before the first Lambda invocation — and the retention policy is enforced from day one.

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | React 18 + TypeScript + Vite | Fast builds, strict types, Amplify v6 integration |
| Hosting | AWS Amplify (App: `d3m1ddehppkb04`) | Managed CI/CD, Cognito integration built-in |
| Auth | Amazon Cognito | Managed JWT, email MFA, account lockout — no auth server to run |
| API | API Gateway REST | Per-request billing, Cognito authorizer, request validation |
| Backend | Lambda × 5 (Node.js 20, ARM64) | ~20% cheaper than x86, cold starts acceptable |
| Storage | Amazon S3 + DynamoDB | S3 for raw files, DDB single-table for metadata + chat |
| Extraction | Textract + mammoth + pdf-parse | Each optimised for its file type |
| Embeddings | Bedrock Titan Embeddings V2 | Managed, no embedding server to run |
| Vector store | Bedrock KB + OpenSearch Serverless | AOSS `docuquery-vectors`, HNSW/faiss, 1024 dimensions |
| Generation | Bedrock Claude 3 Haiku | Fast (median 2s), cheap ($0.00025/1K input tokens) |
| IaC | AWS CDK v2 TypeScript | Type-safe, L2/L3 constructs, per-Lambda IAM |
| Observability | CloudWatch structured JSON | Correlation IDs, 30-day retention, zero extra tooling |
| Unit tests | Jest + aws-sdk-client-mock | Mock AWS SDK v3 clients without network calls |
| Property tests | fast-check | 12 correctness properties, 100 iterations each |

---

## Project Structure

```
docuquery-rag-assistant/
│
├── README.md
├── docs/
│   └── architecture.drawio          ← open in diagrams.net
│
├── shared/                           ← shared TypeScript types + constants
│   └── src/
│       ├── types.ts                  # DocumentRecord, ChatRecord, Citation...
│       └── constants.ts              # Key prefixes, chunk sizes, model IDs
│
├── backend/                          ← Lambda handlers
│   ├── src/
│   │   ├── upload-url/handler.ts
│   │   ├── documents/handler.ts
│   │   ├── ingest/
│   │   │   ├── handler.ts            # S3 event handler
│   │   │   ├── extract.ts            # PDF / DOCX / TXT / Textract
│   │   │   └── chunker.ts            # tiktoken cl100k_base
│   │   ├── query/handler.ts          # RAG engine
│   │   ├── history/handler.ts
│   │   └── lib/
│   │       ├── logger.ts             # Structured JSON → CloudWatch
│   │       ├── errors.ts             # AppError hierarchy
│   │       └── middleware.ts         # Correlation ID + error mapping
│   └── test/
│       ├── unit/                     # Jest (aws-sdk-client-mock)
│       └── properties/               # fast-check (P1–P12)
│
├── frontend/                         ← React SPA
│   ├── .env.example                  # Template — copy to .env.local for local dev
│   └── src/
│       ├── api/                      # documentsApi, queryApi, historyApi
│       ├── components/               # UploadZone, CitationPanel, ErrorBoundary
│       ├── hooks/                    # useAuthSession
│       └── pages/                    # SignIn, SignUp, Verify, Documents, Chat, History
│
└── infra/                            ← AWS CDK stack
    ├── bin/docuquery.ts              # CDK app entry (reads context, no hardcoded values)
    ├── lib/docuquery-stack.ts        # All resources in one deployable stack
    └── test/docuquery-stack.test.ts  # CDK assertion tests
```

---

## Prerequisites

**1. AWS CLI configured with the target account**
```bash
aws configure --profile flotech-demo-account
# Account: 800445863339 | region: us-east-1 | output: json
aws sts get-caller-identity --profile flotech-demo-account
```

**2. Node.js 20+ and npm 10+**
```bash
node --version   # must be ≥ 20
npm --version    # must be ≥ 10
```

**3. CDK bootstrapped** (one-time per account/region)
```bash
npx cdk bootstrap aws://800445863339/us-east-1 --profile flotech-demo-account
```

> **Heads-up:** If bootstrap fails with `AWS::EarlyValidation::ResourceExistenceCheck`, an orphaned CDK staging bucket likely exists from a prior attempt. See [Challenge 6](#challenge-6-cdk-bootstrap-blocked-by-earlyvalidation-hook) above for the fix.

**4. Bedrock model access**

The AWS Model Access page has been retired. Foundation models are now **automatically enabled on first invocation** — no manual activation step needed.

> **Anthropic models only:** First-time Anthropic users in a given account may still be prompted to submit a use case form for Claude 3 Haiku before the model activates. If `POST /query` returns `502`, check CloudWatch logs for `AccessDeniedException` from Bedrock and complete the form in the Bedrock console if shown.

**5. Bedrock Knowledge Base**

The KB must exist before deploying the stack with its ID. Follow the steps in the [Deployment Guide](#deployment-guide) — a full CLI-based KB creation script is included.

---

## Deployment Guide

This is the exact sequence used for the current deployment (account `800445863339`, region `us-east-1`).

```bash
# ── Step 1: Install all dependencies ──────────────────────────────────────────
npm install

# ── Step 2: Build the shared package ──────────────────────────────────────────
npm run build --workspace=shared

# ── Step 3: Bootstrap CDK (one-time per account/region) ──────────────────────
cd infra
npx cdk bootstrap aws://800445863339/us-east-1 --profile flotech-demo-account

# ── Step 4: Initial CDK deploy (no KB ID yet) ─────────────────────────────────
npx cdk deploy \
  --profile flotech-demo-account \
  --require-approval never \
  --context environment=dev \
  --context awsRegion=us-east-1 \
  --context awsAccountId=800445863339

# CDK outputs: save these — you will need them in Step 7 and Step 9
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
# ── Step 5a: Create IAM role for the KB ──────────────────────────────────────
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

# ── Step 5b: Create OpenSearch Serverless vector collection ───────────────────
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
# Returns collection ID, e.g. h04acuqvvvd64qsauu2k — wait ~3 min for ACTIVE status

# Data access policy — grants KB role full index access
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

# ── Step 5c: Create vector index in the collection ───────────────────────────
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

# ── Step 5d: Create the Bedrock Knowledge Base ────────────────────────────────
# (Use the Python script below or boto3 directly — the AWS CLI JSON escaping
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

# ── Step 5e: Create S3 data source ────────────────────────────────────────────
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
# ── Step 6: Re-deploy CDK stack with KB ID wired into Lambda env + IAM ───────
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
# ── Step 7: Copy CDK outputs into frontend env file ───────────────────────────
# frontend/.env.local  (never commit — already in .gitignore)
VITE_USER_POOL_ID=us-east-1_mBss1Hu0l
VITE_USER_POOL_CLIENT_ID=5jgr5ml0r123hmn2blj720r1du
VITE_IDENTITY_POOL_ID=us-east-1:3ebd9bf1-a612-4f1f-8a41-8cf46e9cce43
VITE_API_URL=https://2u9omiey76.execute-api.us-east-1.amazonaws.com/dev/
VITE_DOCUMENT_BUCKET_NAME=docuquerystack-documentbucketae41e5a9-y4e69bwevqic

# ── Step 8: Build the frontend ────────────────────────────────────────────────
cd ../frontend && npm run build
# Output: frontend/dist/ — connect to Amplify via console or CLI for hosting
```

---

## Deployed Resources

Current deployment — account `800445863339`, region `us-east-1`.

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
| Cognito App Client | — | `5jgr5ml0r123hmn2blj720r1du` |
| Cognito Identity Pool | — | `us-east-1:3ebd9bf1-a612-4f1f-8a41-8cf46e9cce43` |
| DynamoDB Table | `docuquery-dev` | PAY_PER_REQUEST · AES256 · 1 GSI |
| S3 Document Bucket | `docuquerystack-documentbucketae41e5a9-y4e69bwevqic` | SSE-S3 · Block Public Access |
| API Gateway | `docuquery-dev` | `https://2u9omiey76.execute-api.us-east-1.amazonaws.com/dev/` |
| Lambda: upload-url | `docuquery-upload-url-dev` | ARM64 · Node 20 · 29s timeout |
| Lambda: ingest | `docuquery-ingest-dev` | ARM64 · Node 20 · 5m timeout · 1024 MB |
| Lambda: documents | `docuquery-documents-dev` | ARM64 · Node 20 · 29s timeout |
| Lambda: query | `docuquery-query-dev` | ARM64 · Node 20 · 29s timeout |
| Lambda: history | `docuquery-history-dev` | ARM64 · Node 20 · 29s timeout |
| Amplify App | `docuquery-dev` | App ID: `d3m1ddehppkb04` |

### Bedrock & Vector Store Resources

| Resource | Name / ID | Notes |
|----------|----------|-------|
| Bedrock Knowledge Base | `docuquery-dev` | ID: `LPLGCWRHOM` |
| KB Data Source | `docuquery-s3-source` | ID: `BIMFCFRPEH` · S3-backed |
| AOSS Collection | `docuquery-vectors` | ID: `h04acuqvvvd64qsauu2k` · ACTIVE |
| AOSS Vector Index | `docuquery-index` | 1024-dim · HNSW/faiss · l2 space |
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

### Step 1 — CloudFormation status

```bash
cd infra
npx cdk diff --profile flotech-demo-account --context environment=dev \
  --context knowledgeBaseId=LPLGCWRHOM
# Expected: "There were no differences"
```

### Step 2 — Console resource checklist

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
| CloudWatch | `/aws/lambda/docuquery-*-dev` | 5 log groups, retention: 30 days (CDK-managed) |
| Amplify | `d3m1ddehppkb04` | App created |
| Bedrock KB | `LPLGCWRHOM` | Status: ACTIVE |
| AOSS | `docuquery-vectors` | Status: ACTIVE |

### Step 3 — Verify Lambda environment variables

```bash
aws lambda get-function-configuration --function-name docuquery-query-dev \
  --region us-east-1 --profile flotech-demo-account \
  --query "Environment.Variables" --output table
# KNOWLEDGE_BASE_ID must be LPLGCWRHOM
```

### Step 4 — API smoke tests

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

### Step 5 — End-to-end test

1. Start local frontend: `cd frontend && npm run dev` (runs at `http://localhost:5173`)
2. **Register** a new account with a real email
3. **Verify** via the 6-digit code sent to your inbox
4. **Sign in** — lands on the Documents page
5. **Upload** a text-based PDF
   - Status badge: `uploaded → processing → ready`
   - If stuck on `processing` after 3 minutes → check CloudWatch `/aws/lambda/docuquery-ingest-dev`
6. **Ask** a question about the document content — response should arrive within 10 seconds
7. **Click a citation** to expand the source passage
8. Navigate to **History** — the question should be listed

### Common issues and fixes

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Document stuck on `processing` | Titan invocation failed on first call | Check CloudWatch ingest logs for `AccessDeniedException`; re-upload to trigger retry |
| `502` on `/query` | Claude 3 Haiku use case form needed | Open Bedrock console → check for Anthropic use case prompt; complete if shown |
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

The frontend connects to the deployed AWS backend. Your `frontend/.env.local` must contain the live CDK output values. Lambda functions run in AWS — there is no local emulation.

```bash
# frontend/.env.local  ← this file is gitignored, never commit it
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
| P3: Chunking Size Bound | Every chunk ≤ 1,000 tokens |
| P4: DOCX Paragraph Boundaries | Newlines preserved at paragraph boundaries |
| P5: Per-User Isolation | Cross-user access always returns 403 |
| P6: Fallback Threshold | Scores < 0.5 always triggers fallback, no Claude call |
| P7: Citation Completeness | Non-fallback answers always have citations with all fields |
| P8: Status Monotonicity | No backward status transitions (ready → processing etc.) |
| P9: Empty Input Rejection | Empty/whitespace text → failed, no KB indexing |
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
[1] CI Gate ────────── lint + all tests + frontend typecheck + build
     |
     v
[2] Connect Amplify ── wires GitHub repo to Amplify app once (idempotent — no-op after first run)
     |                 creates the main branch in Amplify with auto-build enabled
     v
[3] CDK Deploy ──────── applies any infra changes (Lambda code, IAM, env vars)
     |                  no-op in ~15 s when nothing changed
     v
[4] Monitor Amplify ─── waits for Amplify's automatic build to complete
                        Amplify triggers itself via GitHub webhook on every push
                        falls back to a manual trigger if the webhook fires late
```

After the first run, step 2 is always a no-op — Amplify is already wired. Steps 3 and 4
are the only meaningful work on subsequent pushes.

### One-time setup: add GitHub secrets

Go to **Settings → Secrets and variables → Actions** in the repository.

**Secrets:**

| Name | Value | Where to get it |
|------|-------|----------------|
| `AWS_ACCESS_KEY_ID` | IAM access key ID | AWS Console → IAM → Users → `flotech-demo-account` → Security credentials |
| `AWS_SECRET_ACCESS_KEY` | Secret access key | Same — create new access key if needed |
| `AWS_ACCOUNT_ID` | `800445863339` | Fixed |
| `GH_PAT` | GitHub Personal Access Token | [github.com/settings/tokens](https://github.com/settings/tokens) → Generate new token (classic) → tick `repo` scope |

> **GH_PAT** is only used in the `connect-amplify` step to authorise the one-time
> Amplify ↔ GitHub OAuth handshake. After the connection is established it is never used
> again. It can be a fine-grained PAT scoped to just this repository with
> `contents: read` and `webhooks: write` permissions if you prefer tighter scoping.
>
> **If `GH_PAT` is not yet set**, the `connect-amplify` step exits cleanly with a
> message — it does NOT fail the pipeline. CDK deploy and all other jobs continue
> normally. Add the secret whenever you're ready and the next push will wire Amplify.

**Optional variables** (Settings → Variables → Actions):

| Name | Default |
|------|---------|
| `ENVIRONMENT` | `dev` |
| `AWS_REGION` | `us-east-1` |

### After adding the secrets

Push any commit to `main`. On the first run:

1. `connect-amplify` links `https://github.com/florayuyuun123/docuquery-rag-assistant` to Amplify app `d3m1ddehppkb04` and creates the `main` branch with auto-build enabled
2. Amplify installs the GitHub webhook automatically — all future pushes trigger builds without GitHub Actions involvement
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

### Test 1 — User registration and email verification

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

### Test 2 — Sign in and session handling

**Goal:** JWT auth and token refresh work correctly.

```
1. Sign in with the verified account from Test 1
2. Open DevTools -> Application -> Local Storage
   -> Cognito tokens present (keys prefixed CognitoIdentityServiceProvider)
3. Sign out -> navigating to /documents redirects to /signin

Expected:
[x] Wrong credentials show "Authentication failed" (no field-level detail)
[x] After sign-out, all protected routes redirect to /signin
[x] Silent token refresh happens after 15 min — no forced redirect
```

---

### Test 3 — Document upload (TXT / DOCX / native PDF)

**Goal:** Upload flow, S3 pre-signed URL, and ingestion pipeline work.

```
1. Navigate to /documents
2. Upload a TXT file under 20 MB
3. Watch the status badge: uploaded -> processing -> ready
   (typically 10–30 s for text files)
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

### Test 4 — Scanned PDF (Textract path)

**Goal:** Textract fallback triggers for image-only PDFs.

```
1. Upload a scanned PDF (no embedded text layer)
2. Status stays on "processing" longer — 30–90 s while Textract runs OCR

Expected:
[x] Status eventually reaches "ready" (not "failed")
[x] CloudWatch shows "operationType":"textract:poll" entries during processing
[x] chunkCount > 0 in the completion log
```

---

### Test 5 — RAG query with citations

**Goal:** Full retrieval + generation pipeline returns a grounded answer.

```
1. Ensure at least one document has status "ready"
2. Navigate to /chat
3. Ask a specific question whose answer is in the uploaded document

Expected:
[x] Answer appears (typically 2–8 seconds)
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

### Test 6 — Fallback (question not in documents)

**Goal:** Threshold guard fires — Claude is never called for irrelevant questions.

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

### Test 7 — No documents state

**Goal:** Informational message returned before any Bedrock calls are made.

```
1. Delete all documents from /documents
2. Navigate to /chat and ask any question

Expected:
[x] Response: "No documents are currently available to query."
[x] No Bedrock calls at all (CloudWatch shows no log entry for this query)
```

---

### Test 8 — Document deletion cascade

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

### Test 9 — Chat history

**Goal:** All queries persist and display in reverse-chronological order.

```
1. Ask 3–5 questions on /chat
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

### Test 10 — Per-user data isolation

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
# Log groups are CDK-managed with 30-day retention (created on deploy, not first invocation)
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

All services use pay-per-request pricing — no idle charges except the AOSS collection, which incurs OCU charges while active.

| Service | Pricing basis | Est. cost at 100 queries/month |
|---------|--------------|-------------------------------|
| Lambda (5 functions) | $0.20 per 1M invocations + duration | < $0.01 |
| API Gateway | $3.50 per 1M requests | < $0.01 |
| DynamoDB (on-demand) | $1.25 per 1M reads | < $0.01 |
| S3 (storage + requests) | $0.023/GB + $0.0004/1K requests | < $0.05 |
| Cognito | Free ≤ 50,000 MAU | $0.00 |
| Bedrock Titan Embeddings V2 | $0.0001 per 1K tokens | < $0.02 |
| Bedrock Claude 3 Haiku | $0.00025/$0.00125 per 1K in/out tokens | < $0.20 |
| OpenSearch Serverless | OCU charges (~$0.24/OCU-hr, min 2 OCU) | ~$340/month at minimum |
| CloudWatch Logs | $0.50/GB ingested | < $0.05 |
| Amplify Hosting | $0.01/GB served | < $0.05 |

> ⚠️ **The dominant cost driver in this deployment is OpenSearch Serverless**, which charges for compute capacity units (OCUs) regardless of query volume. For a production workload with continuous traffic this cost is justified, but for a dev/test environment consider deleting the AOSS collection and KB when not in use, and re-creating them for active testing sessions.
>
> Monitor **AWS Cost Explorer** after deployment and set a billing alert.

---

## Lessons Learned

**1. CDK bootstrap can silently fail and leave orphaned resources**
If the CDKToolkit stack ends up in `REVIEW_IN_PROGRESS` (never progressed past changeset creation), the staging bucket may still exist. Subsequent bootstrap attempts fail with `EarlyValidation` errors because the bucket name conflicts. Always check for stale buckets and stuck stacks before retrying.

**2. The pre-signed URL pattern is non-negotiable for file uploads**
Routing file uploads through a Lambda function wastes memory, adds latency, and costs more. The browser-to-S3 direct upload with pre-signed URLs is the right pattern — it also gives you native XHR upload progress events at no extra cost.

**3. Property-based testing finds edge cases example-based tests miss**
The tiktoken chunker worked correctly on all handwritten test inputs. Fast-check found an off-by-one in the overlap calculation with a specific input length that no example triggered. Property-based testing for data transformation code is worth the setup cost.

**4. Anthropic model access requires a one-time use case submission for new accounts**
AWS now auto-enables foundation models on first invocation, which is a significant improvement. The exception is Anthropic — Claude models may still require a brief use case form for first-time users. The failure is silent at deploy time (CDK succeeds regardless), so the first symptom is a `502` on the `/query` endpoint. CloudWatch logs will show a Bedrock `AccessDeniedException` pointing directly at the issue.

**5. TypeScript strict mode catches real bugs at Lambda boundary**
Lambda event types (`APIGatewayProxyEvent`) have deeply optional fields. Without strict mode, it's easy to write `event.body.question` and only discover the `null` dereference in production. Strict mode + nullish coalescing everywhere prevented several runtime errors.

**6. Use boto3/Python for complex AWS CLI operations on Windows**
PowerShell's string escaping makes deeply nested JSON arguments to AWS CLI commands unreliable on Windows — multi-level quotes frequently cause silent command cancellations. For operations like creating a Bedrock Knowledge Base (which requires nested JSON configs), writing a 10-line Python boto3 script is faster and more reliable than fighting PowerShell escaping.

---

## Cleanup

The cleanup order matters because of resource dependencies. The CDK stack is the central step — and for the **dev** environment it now removes the S3 bucket, DynamoDB table, and Cognito User Pool automatically (see note below).

> **Why `cdk destroy` handles everything in dev**
>
> The stack was updated so that stateful resources use `removalPolicy: DESTROY` when
> `environment != 'prod'`. In a prod deployment those same resources use `RETAIN` to
> protect real user data from accidental deletion. On dev, `cdk destroy` is a complete
> teardown — no manual resource cleanup needed.

---

### Step 1 — Delete the Bedrock Knowledge Base and data source

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

### Step 2 — Delete the OpenSearch Serverless collection

This is the dominant cost driver (~OCU charges). Delete it before the CDK stack — the
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

### Step 3 — Delete the KB IAM role

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

### Step 4 — Destroy the CDK stack

On **dev** this removes everything the stack created: Lambda × 5, API Gateway, Amplify,
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

### Step 5 — Delete the CDK bootstrap stack (optional)

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

### Step 6 — Verify everything is gone

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
| 1 | KB data source `BIMFCFRPEH` | Manual (boto3) | Manual (boto3) — must go before KB |
| 2 | Knowledge Base `LPLGCWRHOM` | Manual (boto3) | Manual (boto3) — must go before AOSS |
| 3 | AOSS collection `docuquery-vectors` | Manual (CLI) | Manual (CLI) — main cost driver |
| 4 | AOSS policies (access, network, encryption) | Manual (CLI) | Manual (CLI) — after collection |
| 5 | KB IAM role `docuquery-kb-role` | Manual (CLI) | Manual (CLI) — not in CDK |
| 6 | Everything else (Lambda, API GW, Amplify, S3, DDB, Cognito…) | CDK | `cdk destroy` (dev auto-deletes stateful resources) |
| 7 | CDKToolkit stack | CDK bootstrap | Optional — only if no other CDK apps |

---

## Architecture Diagram

The diagram is in [`docs/architecture.md`](docs/architecture.md) using **Mermaid** syntax.
It renders automatically on GitHub and in any Mermaid-capable viewer.

Viewing options:
- **GitHub** — opens and renders automatically at the link above
- **VS Code** — install [Markdown Preview Mermaid Support](https://marketplace.visualstudio.com/items?itemName=bierner.markdown-mermaid)
- **Live editor** — paste `docs/architecture.mmd` at [mermaid.live](https://mermaid.live)
- **draw.io** — File → Import from → Device, select `docs/architecture.mmd`

> Note: draw.io does not render official AWS service icons from Mermaid source.
> The diagram uses colour-coded node groups (orange = AWS managed, purple = Bedrock/AOSS,
> green = storage, red = observability) to convey service categories clearly.

---

## License

MIT — use, modify, and redistribute freely. Attribution appreciated but not required.

---

*Built with [Amazon Bedrock](https://aws.amazon.com/bedrock/), [AWS CDK](https://aws.amazon.com/cdk/), and [OpenSearch Serverless](https://aws.amazon.com/opensearch-service/features/serverless/) on AWS account `800445863339`.*