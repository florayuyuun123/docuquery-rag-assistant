# DocuQuery RAG Assistant

> **Document Q&A powered by AWS Bedrock RAG**
> 
> Upload documents (PDF/DOCX/TXT) → Ask questions in natural language → Get answers with source citations

---

## 🎯 Project Status

**Current Status:** ⚠️ **Development - Deployment Paused**

The infrastructure has been cleaned up and is ready for re-deployment. All code fixes have been committed and are ready to deploy.

### Recent Updates (2026-11-06)

✅ **Completed Fixes:**
- Switched from `tiktoken` (WASM) to `js-tiktoken` (pure JS) for Lambda compatibility
- Fixed authentication: now using `idToken` instead of `accessToken` for Cognito authorizer
- Added CORS headers to all Lambda responses
- Fixed `DATA_SOURCE_ID` bug in ingest and delete handlers
- Made AWS Textract optional (graceful fallback when not enabled)
- Fixed document list filtering (DOC# vs CHAT# records)
- Fixed presigned URL ContentLength signature issue
- All 62 tests passing

🚧 **Known Limitations:**
- AWS Textract not enabled on current account → PDFs with text layers work via `pdf-parse`, scanned PDFs return empty
- Delete operation requires `DATA_SOURCE_ID` env var to be set correctly

🔄 **Next Deployment Steps:**
1. Re-run `cdk deploy` with KB and Data Source IDs
2. Test upload → ingest → query → delete flow end-to-end
3. Enable Textract if OCR support needed for scanned PDFs

### Latest Session Summary (2026-11-06)

**Issues Resolved:**
1. ✅ Authentication token mismatch (accessToken → idToken)
2. ✅ CORS policy blocking API requests (added headers to middleware)
3. ✅ Lambda bundling failures (tiktoken WASM → js-tiktoken pure JS)
4. ✅ DATA_SOURCE_ID confusion in ingest/delete handlers
5. ✅ Document list contaminated with chat records (added SK filter)
6. ✅ S3 upload signature errors (removed ContentLength from presigned URL)
7. ✅ Textract subscription requirement (made optional with graceful fallback)

**Resources Cleaned Up:**
- CDK Stack (all Lambdas, API Gateway, DynamoDB, S3, Cognito)
- Bedrock Knowledge Base (GWCJWPQZSF) and Data Source (7EVM39KBAD)
- Amplify App (frontend hosting)

**What's Ready:**
- All code committed to `main` branch
- All 62 tests passing (unit + property-based)
- ESLint clean, no warnings
- Infrastructure code ready for re-deployment

**What's Next:**
- Deploy infrastructure: `cd infra && npx cdk deploy`
- Create Bedrock KB and wire IDs into stack
- Test full workflow with non-scanned PDFs

---

## 📐 Architecture

![Architecture Diagram](docs/architecture.drawio.png)

**Quick Links:**
- [Editable Diagram (draw.io)](docs/architecture.drawio)
- [Mermaid Source](docs/architecture.mmd)
- [Architecture Documentation](docs/architecture.md)

### System Components

```
┌─────────────────────────────────────────────────────────┐
│  USER INTERFACE                                          │
│  React 18 SPA + AWS Amplify Hosting                     │
│  Authentication: Amazon Cognito                          │
└────────────────────┬────────────────────────────────────┘
                     │ HTTPS (JWT Bearer Token)
                     ▼
┌─────────────────────────────────────────────────────────┐
│  API GATEWAY (REST)                                      │
│  Routes: /documents, /query, /history, /upload-url      │
│  Authorizer: Cognito User Pool                          │
└────────────┬────────────────────────────────────────────┘
             │
      ┌──────┴──────────┬─────────────┬──────────────┐
      ▼                 ▼             ▼              ▼
┌──────────┐  ┌──────────────┐  ┌─────────┐  ┌──────────┐
│ upload-  │  │ documents-fn │  │query-fn │  │history-fn│
│ url-fn   │  │              │  │ (RAG)   │  │          │
└────┬─────┘  └──────┬───────┘  └────┬────┘  └────┬─────┘
     │               │               │            │
     ▼               ▼               ▼            ▼
┌─────────────────────────────────────────────────────────┐
│  DATA & STORAGE LAYER                                    │
│  • Amazon S3 (documents)                                 │
│  • DynamoDB (metadata + chat history)                    │
│  • Bedrock Knowledge Base (vectors)                      │
│  • OpenSearch Serverless (vector storage)                │
└─────────────────────────────────────────────────────────┘
     │
     └──► S3 Event Trigger
          │
          ▼
     ┌─────────────┐
     │  ingest-fn  │
     │  • Extract  │──► Textract (OCR)
     │  • Chunk    │──► js-tiktoken
     │  • Embed    │──► Bedrock KB
     └─────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

```bash
# 1. AWS CLI configured
aws configure --profile YOUR_PROFILE
aws sts get-caller-identity --profile YOUR_PROFILE

# 2. Node.js 20+
node --version  # >= 20.x.x

# 3. CDK Bootstrap (one-time)
cd infra
npx cdk bootstrap --profile YOUR_PROFILE
```

### Installation

```bash
# Install dependencies
npm install

# Build shared package
npm run build --workspace=shared

# Run tests
npm test

# Lint
npm run lint
```

### Deployment

See [DEPLOYMENT.md](docs/DEPLOYMENT.md) for complete deployment guide including:
- CDK stack deployment
- Bedrock Knowledge Base setup
- OpenSearch Serverless configuration
- Amplify frontend deployment

---

## 📁 Project Structure

```
docuquery-rag-assistant/
├── backend/              # Lambda functions
│   ├── src/
│   │   ├── documents/    # Document CRUD
│   │   ├── ingest/       # Text extraction & chunking
│   │   ├── query/        # RAG implementation
│   │   ├── history/      # Chat history
│   │   ├── upload-url/   # Presigned URL generation
│   │   └── lib/          # Shared utilities
│   └── test/
│       ├── unit/         # Jest unit tests
│       └── properties/   # Property-based tests (fast-check)
│
├── frontend/             # React SPA
│   ├── src/
│   │   ├── api/          # API clients
│   │   ├── components/   # React components
│   │   ├── hooks/        # Custom hooks
│   │   └── pages/        # Route pages
│   └── .env.example      # Environment template
│
├── infra/                # AWS CDK infrastructure
│   ├── bin/              # CDK app entry
│   ├── lib/              # Stack definition
│   └── test/             # CDK tests
│
├── shared/               # Shared TypeScript types
│   └── src/
│       ├── types.ts      # Common types
│       └── constants.ts  # Shared constants
│
└── docs/                 # Documentation
    ├── architecture.drawio
    ├── architecture.md
    └── DEPLOYMENT.md
```

---

## 🧪 Testing

### Unit Tests (Jest)

```bash
# Run all tests
npm test

# Backend only
npm test --workspace=backend

# With coverage
npm test -- --coverage

# Watch mode
npm test -- --watch
```

### Property-Based Tests (fast-check)

Located in `backend/test/properties/`:
- P1: Text round-trip (TXT files)
- P2: Chunking completeness
- P3: Chunking size bounds
- P4: DOCX paragraph boundaries
- P5: Per-user isolation

```bash
npm test --workspace=backend -- --testPathPattern=properties
```

---

## 🛠️ Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Frontend** | React 18 + TypeScript + Vite | Modern SPA with fast builds |
| **Hosting** | AWS Amplify | Managed CI/CD + CDN |
| **Auth** | Amazon Cognito | User pools + JWT |
| **API** | API Gateway REST | Serverless API |
| **Compute** | AWS Lambda (Node.js 20, ARM64) | Serverless functions |
| **Storage** | Amazon S3 + DynamoDB | Documents + metadata |
| **Text Extraction** | pdf-parse, mammoth, Textract* | Multi-format support |
| **Tokenization** | js-tiktoken | Pure JS, no WASM |
| **Embeddings** | Bedrock Titan V2 | 1024-dim vectors |
| **Vector Store** | OpenSearch Serverless | HNSW/faiss index |
| **LLM** | Bedrock Claude 3 Haiku | Fast, cost-effective |
| **IaC** | AWS CDK v2 (TypeScript) | Type-safe infrastructure |
| **CI/CD** | GitHub Actions | Automated testing + deployment |
| **Monitoring** | CloudWatch | Structured JSON logs |

*Textract optional — requires AWS account enablement

---

## 📊 Cost Estimate

**Estimated monthly cost for low-medium usage:**

| Service | Usage | Monthly Cost |
|---------|-------|--------------|
| Lambda | 10K invocations | $0.20 |
| API Gateway | 10K requests | $0.04 |
| DynamoDB | On-demand, 1K writes | $1.50 |
| S3 | 10 GB storage | $0.25 |
| Cognito | 1K MAU | Free tier |
| Bedrock (Claude 3 Haiku) | 1M tokens | $0.25 |
| Bedrock (Titan Embeddings V2) | 1M tokens | $0.10 |
| OpenSearch Serverless | 1 collection* | ~$700/month |
| Textract (if enabled) | 1K pages | $15.00 |
| **Total** | | **~$717/month** |

*OpenSearch Serverless is the primary cost driver. Consider S3 Vectors backend for lower-cost alternative.

**Free tier eligible services:** Lambda (1M requests/month), API Gateway (1M requests/month), Cognito (50K MAU)

---

## 🔒 Security

- **Authentication:** Cognito JWT tokens with email verification
- **Authorization:** API Gateway Cognito authorizer validates every request
- **Per-user isolation:** Vector store metadata filtering by `userId`
- **S3 encryption:** SSE-S3 enabled by default
- **IAM principle of least privilege:** Each Lambda has minimal required permissions
- **No hardcoded secrets:** All sensitive values via CDK context or env vars

---

## 📝 Key Design Decisions

### 1. Why OpenSearch Serverless?
While AOSS has higher baseline cost (~$700/month), it provides:
- Battle-tested vector search with HNSW/faiss
- Fully managed with auto-scaling
- Native Bedrock Knowledge Base integration
- Can be replaced with S3 Vectors for lower cost

### 2. Why js-tiktoken over tiktoken?
- Pure JavaScript (no WASM binary)
- Bundles cleanly with esbuild
- Same cl100k_base encoding as Claude
- ~5-10ms slower per chunk but still sub-second overall

### 3. Why single DynamoDB table?
- Single-table design reduces complexity
- PK/SK pattern enables flexible access patterns
- Lower cost than multiple tables
- Follows AWS best practices

### 4. Why Lambda ARM64?
- ~20% cheaper than x86_64
- Equivalent performance for I/O-bound workloads
- Cold start difference negligible (<100ms)

---

## 🐛 Known Issues & Limitations

1. **Textract Not Enabled**
   - Scanned PDFs will return empty text
   - Enable Textract in AWS account for OCR support
   - Workaround: Use PDFs with text layers

2. **Delete Requires Complete Deployment**
   - `DATA_SOURCE_ID` must be set in Lambda env
   - Fixed in code, requires re-deployment

3. **No Concurrent Ingestion**
   - Single document processed at a time
   - Future: Add SQS queue for parallel processing

4. **OpenSearch Serverless Cost**
   - Consider S3 Vectors backend for cost reduction
   - Or use Aurora Serverless v2 with pgvector

---

## 🤝 Contributing

This project follows spec-driven development:
1. Requirements → Design → Tasks (in `.kiro/specs/`)
2. Property-based tests define correctness
3. All PRs must pass lint + tests + CDK tests

---

## 📄 License

MIT License - See [LICENSE](LICENSE) file

---

## 🙏 Acknowledgments

- AWS Bedrock team for Knowledge Bases API
- Anthropic for Claude 3 Haiku
- js-tiktoken maintainers for the pure JS port

---

## 📞 Support

- **Issues:** [GitHub Issues](https://github.com/florayuyuun123/docuquery-rag-assistant/issues)
- **Discussions:** [GitHub Discussions](https://github.com/florayuyuun123/docuquery-rag-assistant/discussions)

---

**Last Updated:** 2026-11-06
**Version:** 1.0.0-dev
**Status:** Development - Ready for re-deployment
