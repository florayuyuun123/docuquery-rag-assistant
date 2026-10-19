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
10. [Verifying a Successful Deployment](#verifying-a-successful-deployment)
11. [Local Development](#local-development)
12. [Running Tests](#running-tests)
13. [Cost Breakdown](#cost-breakdown)
14. [Lessons Learned](#lessons-learned)

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
[4] INDEX            → Bedrock Knowledge Base → S3 Vectors (your account only)

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

> **Open `docs/architecture.drawio`** in [diagrams.net](https://app.diagrams.net) or the VS Code Draw.io extension to view the interactive diagram with AWS official icons.

The architecture is divided into five tiers:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  TIER 1 — FRONTEND                                                           │
│  React 18 + TypeScript SPA  hosted on  AWS Amplify                          │
│  Cognito Hosted UI flows · JWT token management · XHR upload progress       │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ HTTPS + JWT Bearer
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  TIER 2 — API                                                                │
│  Amazon API Gateway REST  ←→  Amazon Cognito (JWT authorizer)               │
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
│ Amazon   │  │ DynamoDB │  │ Textract │  │  Bedrock     │       │
│   S3     │  │ (single  │  │  (OCR)   │  │  KB +        │◄──────┘
│(SSE-S3)  │  │  table)  │  │          │  │  Claude/     │
└──────────┘  └──────────┘  └──────────┘  │  Titan       │
                                           └──────────────┘
                                                  │
                                                  ▼
                                     ┌────────────────────┐
                                     │ S3 Vectors         │
                                     │ (vector index,     │
                                     │  pay-per-request)  │
                                     └────────────────────┘
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

### Challenge 1: Choosing a vector store that doesn't cost $700/month

The standard recommendation for Bedrock Knowledge Bases is OpenSearch Serverless. The problem: OpenSearch Serverless has a **minimum cost of ~$700/month** regardless of usage. For a learning project, that's a non-starter.

**Solution:** Amazon recently introduced **S3 Vectors** as a Bedrock Knowledge Base backend. It charges only for vectors stored and queries made — making idle cost effectively $0. The tradeoff is slightly higher per-query latency vs. OpenSearch, which is acceptable for a document Q&A use case where 10-second responses are within target.

---

### Challenge 2: Per-user data isolation in a shared vector store

A shared Knowledge Base means all users' document chunks live in the same index. If not handled carefully, User A could retrieve chunks from User B's documents.

**Solution:** Every chunk indexed into the Knowledge Base carries a `userId` metadata attribute. The `query-fn` always passes a retrieval filter:
```typescript
filter: { equals: { key: "userId", value: callerId } }
```
This is enforced at the vector store level, not in application code, making it robust. The S3 key prefix (`USER#{userId}/DOC#{docId}/`) provides a second layer of separation in raw storage.

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

### Challenge 6: TypeScript ESM/CJS interop in Lambda

The monorepo uses `module: Node16` (ESM) throughout, but several dependencies (`pdf-parse`, `tiktoken`, `mammoth`) ship as CommonJS. Lambda's Node.js 20 runtime supports both, but `ts-jest` for unit tests does not handle ESM `.js` extension imports gracefully without configuration.

**Solution:**
- Lambda bundles use `esbuild` (handles ESM/CJS interop natively)
- Jest config uses `moduleNameMapper` to strip `.js` extensions and force CommonJS compilation via inline `tsconfig` override in `ts-jest`
- `pdf-parse` is imported via `require()` to avoid the ESM default export issue

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | React 18 + TypeScript + Vite | Fast builds, strict types, Amplify v6 integration |
| Hosting | AWS Amplify | Managed CI/CD, Cognito integration built-in |
| Auth | Amazon Cognito | Managed JWT, email MFA, account lockout — no auth server to run |
| API | API Gateway REST | Per-request billing, Cognito authorizer, request validation |
| Backend | Lambda (Node.js 20, ARM64) | ~20% cheaper than x86, cold starts acceptable |
| Storage | Amazon S3 + DynamoDB | S3 for raw files, DDB single-table for metadata + chat |
| Extraction | Textract + mammoth + pdf-parse | Each optimised for its file type |
| Embeddings | Bedrock Titan Embeddings V2 | Managed, no embedding server to run |
| Vector store | Bedrock KB + S3 Vectors | Pay-per-request, avoids OpenSearch Serverless cost |
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
│   └── src/
│       ├── api/                      # documentsApi, queryApi, historyApi
│       ├── components/               # UploadZone, CitationPanel, ErrorBoundary
│       ├── hooks/                    # useAuthSession
│       └── pages/                    # SignIn, SignUp, Verify, Documents, Chat, History
│
└── infra/                            ← AWS CDK stack
    ├── bin/docuquery.ts              # CDK app entry (reads context, no hardcoded values)
    ├── lib/docuquery-stack.ts        # All resources in one deployable stack
    └── test/docuquery-stack.test.ts  # 16 CDK assertion tests
```

---

## Prerequisites

Before deploying, ensure you have:

**1. AWS CLI configured**
```bash
aws configure
# Access Key ID, Secret Access Key, region: us-east-1, output: json
aws sts get-caller-identity   # confirm credentials work
```

**2. Node.js 20+ and npm 10+**
```bash
node --version   # must be ≥ 20
npm --version    # must be ≥ 10
```

**3. CDK bootstrapped** (one-time per account/region)
```bash
npx cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/us-east-1
```

**4. Bedrock model access**

Amazon foundation models (Titan Embeddings V2) are automatically enabled when first invoked — no manual activation needed. For Anthropic models (Claude 3 Haiku), first-time users may need to submit use case details before access is granted.

If this is your first time using Anthropic models in your account:
1. Open the [Amazon Bedrock console](https://console.aws.amazon.com/bedrock)
2. Navigate to **Model access**
3. If prompted, complete the Anthropic use case form for **Claude 3 Haiku**
4. Access is typically granted within a few minutes

All other models in this project (Titan Embeddings V2) invoke instantly with no prior setup.

**5. Bedrock Knowledge Base creation**

The CDK stack accepts a `knowledgeBaseId` context parameter. You need to create the KB manually first (or via CDK's `CfnKnowledgeBase`) and then pass its ID:

```bash
# After deployment, update cdk.json to add your KB ID:
# "knowledgeBaseId": "XXXXXXXXXX"
# Then re-deploy: npx cdk deploy
```

---

## Deployment Guide

```bash
# Step 1 — Install all dependencies
npm install

# Step 2 — Build the shared package (types + constants)
npm run build --workspace=shared

# Step 3 — Run all tests to verify the codebase
npm test --workspace=backend    # 62 tests
npm test --workspace=infra      # 16 CDK assertions

# Step 4 — Deploy the CDK stack
cd infra
npm install
npx cdk deploy --require-approval never

# ── CDK outputs will print to your terminal ──────────────────────────────────
# DocuQueryStack.UserPoolId         = us-east-1_XXXXXXXXX
# DocuQueryStack.UserPoolClientId   = xxxxxxxxxxxxxxxxxxxxxxxxxx
# DocuQueryStack.IdentityPoolId     = us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
# DocuQueryStack.ApiGatewayUrl      = https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/dev/
# DocuQueryStack.DocumentBucketName = docuquery-documents-XXXXXXXXXXXX-us-east-1-dev
# DocuQueryStack.AmplifyAppId       = dXXXXXXXXX
# ─────────────────────────────────────────────────────────────────────────────

# Step 5 — Configure the frontend environment
cd ../frontend
cp .env.example .env
# Edit .env and paste the values from the CDK output above
# NEVER commit .env to source control

# Step 6 — Build the frontend
npm run build
# Output is in frontend/dist/ — deploy via Amplify or S3 static hosting
```

---

## Verifying a Successful Deployment

### Step 1 — CloudFormation status

```bash
cd infra && npx cdk diff
# Should output: "There were no differences"
```

In the AWS Console → **CloudFormation → DocuQueryStack**:
- Stack status: `CREATE_COMPLETE` ✅
- Outputs tab: all 6 values present ✅

### Step 2 — Console resource checklist

Open the AWS Console in `us-east-1` and verify each resource:

| Service | Resource name | Expected state |
|---------|--------------|----------------|
| Cognito | `docuquery-user-pool-dev` | Active, email sign-in enabled |
| API Gateway | `docuquery-api-dev` | 5 resources, Cognito authorizer attached |
| Lambda | `docuquery-upload-url-dev` | Active, ARM64, Node.js 20 |
| Lambda | `docuquery-ingest-dev` | Active, 1 024 MB, 5-min timeout |
| Lambda | `docuquery-documents-dev` | Active |
| Lambda | `docuquery-query-dev` | Active |
| Lambda | `docuquery-history-dev` | Active |
| S3 | `docuquery-documents-*-dev` | Block Public Access: ON, SSE: AES256 |
| DynamoDB | `docuquery-table-dev` | On-demand, 1 GSI |
| CloudWatch | `/aws/lambda/docuquery-*-dev` | 5 log groups, retention: 30 days |
| Amplify | `docuquery-dev` | App created |

### Step 3 — API smoke tests

```bash
API_URL="https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/dev"

# Should return 401 (auth is enforced — not 403 or 5xx)
curl -s -o /dev/null -w "%{http_code}" $API_URL/documents
# Expected: 401

# CORS preflight should succeed
curl -X OPTIONS $API_URL/documents \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Authorization" \
  -v 2>&1 | grep "Access-Control"
# Expected: Access-Control-Allow-Origin: http://localhost:5173
```

### Step 4 — End-to-end test

1. Open the frontend (`npm run dev` or the Amplify URL)
2. **Register** a new account using a real email address
3. **Verify** your email using the 6-digit code
4. **Sign in** — you should land on the Documents page
5. **Upload** a text-based PDF (non-scanned works fastest)
   - Watch the status badge: `uploaded → processing → ready`
   - If stuck on `processing` after 3 minutes → check CloudWatch (see below)
6. **Ask a question** about the document's content
   - You should receive an answer within 10 seconds
   - Citations should appear below the answer
7. **Click a citation** to expand the source passage
8. **Navigate to History** — your question should appear

### Step 5 — CloudWatch log verification

Navigate to **CloudWatch → Log groups → `/aws/lambda/docuquery-ingest-dev`**

A healthy ingestion log looks like:
```json
{"timestamp":"2024-11-15T10:23:41.123Z","functionName":"ingest-fn","userId":"abc123","operationType":"ingest:complete","durationMs":8420,"outcome":"success","chunkCount":24,"documentId":"uuid-v4"}
```

A failed ingestion will show `"outcome":"error"` with `errorMessage` and the step that failed.

### Common issues and fixes

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Document stuck on `processing` forever | Titan model invocation failed on first call | Check CloudWatch ingest logs for a Bedrock `AccessDeniedException`; re-invoke to trigger auto-enable |
| `502` on `/query` endpoint | Claude 3 Haiku use case form not submitted | Open Bedrock console → Model access, complete the Anthropic use case form if prompted |
| `401` on every API request | `VITE_API_URL` missing trailing slash | Ensure `.env` value ends with `/` |
| Citations show empty `documentName` | Chunk metadata not stored correctly | Check `KNOWLEDGE_BASE_ID` env var on Lambda matches actual KB |
| Frontend can't sign in | `VITE_USER_POOL_ID` or `VITE_USER_POOL_CLIENT_ID` incorrect | Copy exact values from CDK output |
| Textract timeout | Very large scanned PDF | Increase `ingest-fn` timeout beyond 5 min in CDK |

---

## Local Development

```bash
cd frontend
npm install
npm run dev
# App runs at http://localhost:5173
```

The frontend connects to the deployed AWS backend. Your `frontend/.env` must contain valid CDK output values. Lambda functions run in AWS — there is no local emulation.

```bash
# frontend/.env (never commit this file)
VITE_USER_POOL_ID=us-east-1_XXXXXXXXX
VITE_USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_IDENTITY_POOL_ID=us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
VITE_API_URL=https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/dev/
VITE_DOCUMENT_BUCKET_NAME=docuquery-documents-XXXXXXXXXXXX-us-east-1-dev
```

---

## Running Tests

```bash
# Backend: 62 tests (5 unit suites + 5 property-based suites)
npm test --workspace=backend

# CDK infrastructure: 16 assertion tests
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

## Cost Breakdown

This project is designed for low-cost learning and development. All services use pay-per-request pricing — there is no minimum fee.

| Service | Pricing basis | Est. cost at 100 queries/month |
|---------|--------------|-------------------------------|
| Lambda (5 functions) | $0.20 per 1M invocations + duration | < $0.01 |
| API Gateway | $3.50 per 1M requests | < $0.01 |
| DynamoDB (on-demand) | $1.25 per 1M reads | < $0.01 |
| S3 (storage + requests) | $0.023/GB + $0.0004/1K requests | < $0.05 |
| Cognito | Free ≤ 50,000 MAU | $0.00 |
| Bedrock Titan Embeddings V2 | $0.0001 per 1K tokens | < $0.02 |
| Bedrock Claude 3 Haiku | $0.00025/$0.00125 per 1K in/out | < $0.20 |
| Bedrock KB + S3 Vectors | ~$0.005 per query | $0.50 |
| CloudWatch Logs | $0.50/GB ingested | < $0.05 |
| Amplify Hosting | $0.01/GB served | < $0.05 |
| **Total** | | **< $1/month** |

> ⚠️ Cost scales with document volume and query frequency. Monitor **AWS Cost Explorer** after deployment. The main cost driver at scale is Bedrock inference (Titan + Claude per query).

---

## Lessons Learned

**1. S3 Vectors is a game-changer for budget-conscious RAG**
OpenSearch Serverless' $700/month floor makes it impractical for learning projects. S3 Vectors changes the economics entirely. The trade-off (slightly higher latency) is irrelevant for document Q&A use cases.

**2. The pre-signed URL pattern is non-negotiable for file uploads**
Routing file uploads through a Lambda function wastes memory, adds latency, and costs more. The browser-to-S3 direct upload with pre-signed URLs is the right pattern — it also gives you native XHR upload progress events at no extra cost.

**3. Property-based testing finds edge cases example-based tests miss**
The tiktoken chunker worked correctly on all my handwritten test inputs. Fast-check found an off-by-one in the overlap calculation with a 201-character input that none of my examples triggered. Property-based testing for data transformation code is worth the setup cost.

**4. Anthropic model access requires a one-time use case submission for new accounts**
AWS now auto-enables foundation models on first invocation, which is a big improvement. The catch is Anthropic specifically — Claude models may still require a brief use case form for first-time users. The failure is silent at deploy time (the CDK stack succeeds regardless), so the first symptom is a `502` on the `/query` endpoint. CloudWatch logs will show a Bedrock `AccessDeniedException` pointing directly at the issue. Complete the form in the Bedrock console once and it never needs to be revisited.

**5. TypeScript strict mode catches real bugs at Lambda boundary**
Lambda event types (`APIGatewayProxyEvent`) have deeply optional fields. Without strict mode, it's easy to write `event.body.question` and only discover the `null` dereference in production. Strict mode + nullish coalescing everywhere prevented several runtime errors.

---

## Architecture Diagram

The draw.io file at `docs/architecture.drawio` uses official AWS shape libraries and can be opened in:
- [diagrams.net](https://app.diagrams.net) (free, browser-based)
- VS Code with the [Draw.io Integration](https://marketplace.visualstudio.com/items?itemName=hediet.vscode-drawio) extension
- JetBrains IDEs with the Draw.io plugin

Export it as PNG/SVG from diagrams.net for use in blog posts and presentations.

---

## License

MIT — use, modify, and redistribute freely. Attribution appreciated but not required.

---

*Built with [Amazon Bedrock](https://aws.amazon.com/bedrock/), [AWS CDK](https://aws.amazon.com/cdk/), and a healthy skepticism of $700/month vector databases.*

