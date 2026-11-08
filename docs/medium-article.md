# I Built a Production RAG App on AWS — With AWS Kiro Writing Most of the Code

*How an AI-powered IDE took a project from blank canvas to deployed cloud infrastructure in one session*

---

## The Problem I Set Out to Solve

Every organisation I have worked with has the same invisible problem: knowledge trapped in documents.

HR policies buried in a 90-page PDF. Compliance manuals no one has read since they were written. Technical runbooks that live on a shared drive and are only remembered to exist when something breaks at 2am.

When someone needs an answer, the workflow is always the same: open the document, hit Ctrl+F, skim 200 pages, give up, ask a colleague, repeat. And even when you find the answer, you cannot easily cite it, share it, or trust that it has not been superseded by a newer version.

I wanted to build something that changed that. A system where you upload your documents, ask a question in plain English, and get a cited, verifiable answer drawn exclusively from your own content — not from a model's training data, not from the internet.

The result is **DocuQuery** — a fully serverless RAG (Retrieval-Augmented Generation) application built entirely on AWS managed services.

And here is the part that made this project different from anything I had built before: I used **AWS Kiro** to write most of it.

> 📸 **[Screenshot: DocuQuery home page — upload zone, document list, chat interface side by side]**

---

## What Is AWS Kiro?

Kiro is AWS's AI-powered development environment. Unlike a code autocomplete tool, Kiro works from *specs*. You describe what you want to build in natural language, and Kiro produces a requirements document, a system design, a task breakdown, and then writes the actual code, runs the tests, and deploys.

> 📸 **[Screenshot: Kiro IDE showing the spec panel — requirements.md open on the left, generated code on the right]**

It is the closest thing I have used to pair programming with someone who has already shipped a dozen projects like the one you are building.

I will be honest about what that meant in practice: I made the architectural decisions. I directed the work. I reviewed every file. But Kiro wrote the boilerplate, caught the edge cases I would have missed at 11pm, and debugged production errors by reading CloudWatch logs faster than I could scroll them.

Let me walk you through how DocuQuery works, what we built, and the eleven production issues Kiro caught and fixed along the way.

---

## The Architecture

DocuQuery is structured around five horizontal tiers, each mapping to a clear responsibility.

> 🏗️ **[Insert architecture diagram here — docs/architecture.drawio exported as PNG]**
>
> *Open the full interactive diagram at: https://github.com/florayuyuun123/docuquery-rag-assistant/blob/main/docs/architecture.drawio*

The five tiers are:

| Tier | Responsibility | Services |
|---|---|---|
| 1 | Frontend & Identity | AWS Amplify, Amazon Cognito |
| 2 | API Layer | Amazon API Gateway REST |
| 3 | Compute | AWS Lambda × 5 (Node.js 20, ARM64) |
| 4 | Storage & Data | Amazon S3, DynamoDB, Bedrock KB, OpenSearch Serverless |
| 5 | AI / ML | Bedrock Titan Embeddings V2, Claude 3 Haiku |

### Tier 1 — Frontend & Identity

The user interface is a **React 18 + TypeScript SPA** hosted on **AWS Amplify**. Amplify handles the CDN, CI/CD pipeline, and environment variable injection. Authentication flows through **Amazon Cognito**, which issues JWT tokens on sign-in.

> 📸 **[Screenshot: Sign-in page and registration flow]**

One early lesson: Cognito's authorizer validates **ID tokens**, not access tokens. The frontend was sending the access token; every API call returned 401. Kiro spotted it in the logs, cross-referenced the Cognito authorizer configuration in the CDK stack, and fixed `authApi.ts` in one pass.

### Tier 2 — API Layer

**Amazon API Gateway REST** sits in front of every Lambda. It validates the Cognito JWT on every request before traffic reaches any function. Five routes:

- `POST /documents/upload-url` — get a presigned S3 URL
- `GET /documents` — list documents for the caller
- `DELETE /documents/{id}` — delete a document
- `POST /query` — ask a question
- `GET /history` — retrieve past conversations

### Tier 3 — Compute

Five **AWS Lambda functions**, all running Node.js 20 on ARM64 (about 20% cheaper than x86 for the same workload).

**upload-url-fn** generates a short-lived S3 presigned PUT URL and saves the document metadata to DynamoDB with `status: uploaded`. The browser uploads the file directly to S3 — no Lambda proxy, no size limit from API Gateway.

**ingest-fn** is the core of the pipeline. Triggered by an S3 `ObjectCreated` event, completely asynchronous from the user's perspective.

**query-fn** is the RAG engine. It retrieves the top-5 relevant chunks from the Knowledge Base, applies a relevance score threshold of 0.5 (below which Claude is never called — no hallucination possible), and generates a grounded answer with citations.

> 📸 **[Screenshot: AWS Lambda console showing all five functions with their ARM64 runtime badge]**

### Tier 4 — Storage & Data

**Amazon S3** stores raw documents partitioned by user ID (`USER#{userId}/DOC#{documentId}/filename`). SSE-S3 encryption enabled by default.

**Amazon DynamoDB** uses a single-table design. Document records and chat records coexist, keyed by `PK = USER#{userId}`, `SK = DOC#{documentId}` or `SK = CHAT#{sessionId}`.

**Amazon Bedrock Knowledge Base** backed by **OpenSearch Serverless** stores the vector embeddings. The collection uses an HNSW/faiss index with 1,024 dimensions, matching the output of Titan Embeddings V2.

> 📸 **[Screenshot: Bedrock Knowledge Base console showing the KB status as ACTIVE with data source]**

### Tier 5 — AI / ML

**Amazon Bedrock** provides both embedding and generation:

- **Titan Embeddings V2** converts text chunks into 1,024-dimensional semantic vectors
- **Claude 3 Haiku** generates answers from the retrieved context

The system prompt is explicit: *"Answer ONLY from the provided passages. If the passages do not contain sufficient information, respond: 'I could not find an answer in the provided documents.'"* No guessing, no training data bleed-through.

---

## The Upload Flow

Here is what happens when a user uploads a document, step by step:

```
1. Browser → POST /upload-url         (request presigned URL)
2. Lambda  → S3 PutObject             (generate presigned URL)
3. Lambda  → DynamoDB                 (save metadata, status=uploaded)
4. Lambda  → Browser                  (return { presignedUrl, documentId })
5. Browser → S3 PUT (direct)          (upload file bytes, no Lambda proxy)
6. S3      → ingest-fn (event)        (ObjectCreated fires async)
```

> 📸 **[Screenshot: Documents page showing a file with status "processing" mid-upload]**

The presigned URL approach keeps Lambda out of the data path entirely. Large files go straight from the browser to S3 at full network speed.

---

## The Ingestion Pipeline in Detail

When a file lands in S3, the ingest Lambda fires. It:

1. **Downloads the file** from S3
2. **Extracts text** — `pdf-parse` for PDFs with text layers, `mammoth` for DOCX, raw UTF-8 decode for TXT
3. **Chunks the text** into 1,000-token segments with 200-token overlap using `js-tiktoken`
4. **Calls `StartIngestionJob`** on the Bedrock Knowledge Base — KB picks up the new S3 object, embeds each chunk via Titan, writes vectors to OpenSearch
5. **Updates DynamoDB** to `status: ready`

```
Extracted text  →  js-tiktoken chunker  →  Bedrock KB StartIngestionJob
                   (1000 tok / 200 overlap)     │
                                                ▼
                                    Titan Embeddings V2
                                    (1024-dim vectors)
                                                │
                                                ▼
                                    OpenSearch Serverless
                                    (HNSW/faiss index)
```

> 📸 **[Screenshot: DynamoDB item showing a document record with status field = "ready"]**

The chunking overlap means no important sentence gets split across a chunk boundary without appearing in at least one complete chunk.

---

## The Query (RAG) Flow

When a user asks a question:

```
1. Browser → POST /query { question }
2. query-fn → Bedrock KB.Retrieve(question, userId filter, top=5)
3. KB  → Titan (embed the question)
4. Titan → OpenSearch (cosine similarity search, userId-scoped)
5. OpenSearch → KB (return top-5 chunks + relevance scores)
6. query-fn → score check: all scores < 0.5? → return fallback (no Claude call)
7. query-fn → Claude 3 Haiku (context + question → grounded answer)
8. query-fn → DynamoDB (save chat record)
9. query-fn → Browser { answer, citations, isFallback }
```

> 📸 **[Screenshot: Chat interface showing a question, the answer, and the citation panel with document name and passage]**

The score threshold is the anti-hallucination layer. If none of the retrieved chunks are relevant enough, the system says so honestly rather than letting Claude improvise.

---

## Eleven Things That Broke (and What We Learned)

Every one of these issues was real, encountered in production, and debugged from CloudWatch logs.

> 📸 **[Screenshot: CloudWatch Logs Insights showing structured JSON log entries with correlationId, outcome, durationMs]**

### 1. Wrong Token Type — 401 on Every API Call

Cognito issues three tokens. The API Gateway Cognito authorizer validates the **ID token**. We were sending the access token. Fixed by switching from `session.tokens?.accessToken` to `session.tokens?.idToken`.

### 2. CORS Blocking Everything

The middleware was not setting `Access-Control-Allow-Origin` on responses. Fixed by adding the header in the Lambda middleware wrapper shared by all five functions.

### 3. tiktoken WASM Bundling Failure

`tiktoken` includes a WebAssembly binary (`tiktoken_bg.wasm`). esbuild cannot bundle WASM. Lambda deployed but crashed: `Missing tiktoken_bg.wasm`.

Switched to `js-tiktoken` — a pure JavaScript port. Same encoding (`cl100k_base`), no WASM. One API difference: `decode()` returns a string directly, so the `TextDecoder` wrapper was removed.

```typescript
// Before (tiktoken — WASM, crashes in Lambda)
import { get_encoding } from 'tiktoken';
const enc = get_encoding('cl100k_base');
const text = new TextDecoder().decode(enc.decode(tokens));
enc.free();

// After (js-tiktoken — pure JS, bundles cleanly)
import { getEncoding } from 'js-tiktoken';
const enc = getEncoding('cl100k_base');
const text = enc.decode(tokens); // returns string directly
```

### 4. DATA_SOURCE_ID Confusion

The Bedrock Knowledge Base has two distinct IDs: a **Knowledge Base ID** and a **Data Source ID**. `StartIngestionJobCommand` requires both. We were passing the KB ID for both. Error: `DataSource with id {KB_ID} is not found`.

### 5. Document List Returning Chat Records

The DynamoDB GSI query for `GET /documents` returned both document and chat records — both item types share the `userId` attribute. Fixed with `FilterExpression: 'begins_with(SK, :docPrefix)'`.

### 6. S3 Presigned URL Signature Error

The presigned URL included `ContentLength` in the signed headers. The browser XHR PUT did not send a matching `Content-Length` header. S3 returned `SignatureDoesNotMatch`. Fixed by removing `ContentLength` from the `PutObjectCommand` parameters.

### 7. Textract Not Available

AWS Textract requires subscription on new accounts. Scanned PDFs returned empty from `pdf-parse`, fell through to Textract, which threw `SubscriptionRequiredException`. Made Textract optional with a graceful fallback and warning log.

### 8. Delete Blocking on KB Sync — Lambda Timeout

The delete handler awaited `StartIngestionJob` for a re-sync. The Lambda had a 29s timeout. With retry waits exceeding the timeout, every delete returned 500.

Fix: KB sync is now **fire-and-forget**. Delete S3 and DynamoDB immediately. KB re-sync runs in the background.

```typescript
// Before — blocks the response, causes timeout
await startIngestionWithRetry(new StartIngestionJobCommand({...}));

// After — fire-and-forget, delete always succeeds
void startIngestionWithRetry(new StartIngestionJobCommand({...}))
  .catch(() => { /* best-effort */ });
```

### 9. Bedrock 429 ThrottlingException

New AWS accounts have low Titan Embeddings quota. Added exponential backoff retry: up to 8 attempts, 2s base delay doubling per attempt, capped at 15s.

### 10. Bedrock 409 ConflictException

The KB only allows one ingestion job at a time. Uploading two files quickly hit `ConflictException: Knowledge Base already in use`. Added `ConflictException` to the retry logic with a 10s base delay.

### 11. Lambda Timeout Too Short

The documents Lambda inherited a 29s timeout from the base config. Increased to 60s. The ingest Lambda was already set to 5 minutes.

---

## The Testing Strategy

The project has 62 tests across two layers.

> 📸 **[Screenshot: Terminal showing jest test run — 62 tests passing, 0 failures]**

**Unit tests** (Jest + aws-sdk-client-mock) test each Lambda in isolation. They cover happy paths, error paths, ownership enforcement, and status transitions.

**Property-based tests** (fast-check) verify correctness properties across 100 randomly generated inputs per property:

- **P1** — TXT round-trip: text extracted from a TXT file is identical to the original
- **P2** — Chunking completeness: all tokens appear in at least one chunk
- **P3** — Chunking size bound: no chunk exceeds `CHUNK_SIZE_TOKENS`
- **P4** — DOCX paragraph preservation: paragraph boundaries are respected
- **P5** — Per-user isolation: a user never retrieves another user's document chunks

Property P2 caught a real bug: the chunker dropped the final partial chunk when total token count was an exact multiple of the step size.

---

## Infrastructure as Code

The entire stack lives in a single AWS CDK TypeScript file. Notable decisions:

**Per-Lambda IAM roles** — each function has minimum permissions. No shared catch-all role.

**Explicit CloudWatch log groups** — the CDK stack creates named log groups with 30-day retention before the first invocation. Retention is enforced from deploy time, not runtime.

**Context-driven deployment** — KB ID and Data Source ID are CDK context values, not hardcoded. The CI/CD pipeline auto-discovers the Data Source ID:

```yaml
# .github/workflows/deploy.yml
- name: Discover DataSource ID
  run: |
    DS_ID=$(aws bedrock-agent list-data-sources \
      --knowledge-base-id $KB_ID \
      --query 'dataSourceSummaries[0].dataSourceId' \
      --output text)
    echo "DATA_SOURCE_ID=$DS_ID" >> $GITHUB_ENV
```

> 📸 **[Screenshot: GitHub Actions workflow run showing all steps green — lint, test, cdk deploy]**

---

## Cost Profile

| Service | Estimated Monthly Cost |
|---|---|
| Lambda (5 functions, low traffic) | ~$0.50 |
| API Gateway | ~$0.05 |
| DynamoDB (on-demand) | ~$1.50 |
| S3 (10 GB) | ~$0.25 |
| Bedrock (Claude 3 Haiku + Titan) | ~$0.50 |
| **OpenSearch Serverless** | **~$700** |
| **Total** | **~$702/month** |

OpenSearch Serverless is the dominant cost. For production with real traffic, that is justified by the managed vector search. For experimentation, switch to the Amazon S3 Vectors backend — cost drops to near-zero.

---

## The Kiro Experience — Honest Take

**What Kiro did well:**

It wrote the CDK stack correctly the first time — IAM policies, log groups, environment variable wiring. Infrastructure code is tedious and error-prone to write by hand; Kiro treated it as boilerplate.

It debugged production errors faster than I would have. Connecting `ValidationException: Too many requests` in a CloudWatch log to needing exponential backoff on `StartIngestionJob` is the kind of non-obvious inference that takes experience. Kiro made it in seconds.

It held context across a long session. When debugging issue #8 (delete timeout), Kiro cross-referenced the Lambda timeout it had set in the CDK stack two hours earlier and increased it without being asked.

**What still required human judgment:**

Architecture decisions. Choosing OpenSearch Serverless over S3 Vectors, single-table DynamoDB, ARM64 Lambda — judgment calls that depend on project constraints. Kiro executed the chosen architecture; it did not choose it.

Product decisions. Making KB sync fire-and-forget was a decision about acceptable consistency trade-offs. Kiro implemented it cleanly once the direction was given.

> 📸 **[Screenshot: Kiro chat showing a debugging conversation — CloudWatch log error pasted in, Kiro identifying root cause and proposing the fix]**

---

## What's Next

1. **Enable Textract** for scanned PDF support
2. **SQS-based ingest queue** to handle concurrent uploads without ConflictException throttling
3. **S3 Vectors backend** to reduce OpenSearch Serverless costs
4. **Document versioning** — re-upload a newer version, KB auto-replaces old chunks

---

## Try It Yourself

Full source code: **[github.com/florayuyuun123/docuquery-rag-assistant](https://github.com/florayuyuun123/docuquery-rag-assistant)**

The README has a complete CLI-driven deployment guide:
- CDK bootstrap and stack deploy
- Bedrock Knowledge Base creation (Python/boto3 script included)
- OpenSearch Serverless collection and index setup
- Amplify frontend deployment

If you are evaluating AWS Kiro for your own projects, this codebase is a realistic benchmark — full-stack, authentication, async pipelines, vector search, LLM integration. Everything in the repository was written in a single development session.

---

*Found this useful? Follow for more AWS architecture deep-dives. Issues and PRs welcome on the GitHub repo.*
