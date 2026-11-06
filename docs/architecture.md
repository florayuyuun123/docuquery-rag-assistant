# DocuQuery — Architecture Diagram

This diagram renders natively on GitHub, GitLab, and any Mermaid-compatible viewer.
The raw `.mmd` source is `architecture.mmd` in this folder.

> **Viewing options**
> - **GitHub** — displays automatically in this page
> - **VS Code** — [Markdown Preview Mermaid Support](https://marketplace.visualstudio.com/items?itemName=bierner.markdown-mermaid) extension
> - **Live editor** — paste the source at [mermaid.live](https://mermaid.live)
> - **draw.io** — import the `.mmd` file via Extras → Edit Diagram (select Mermaid)

---

```mermaid
---
title: DocuQuery RAG Assistant — Architecture
---
flowchart TB
    subgraph User["👤 User Browser"]
        Browser["React 18 + TypeScript SPA"]
    end

    subgraph Hosting["AWS Amplify Hosting  (App: d2aorcdg8vm2l4)"]
        Amplify["Amplify CDN"]
    end

    subgraph Auth["Amazon Cognito"]
        UserPool["User Pool\ndocuquery-dev\nus-east-1_kc9C1KHxz"]
        IdentityPool["Identity Pool"]
    end

    subgraph API["Amazon API Gateway REST  —  docuquery-dev"]
        APIGW["REST API\nhttps://r3btd92wdh.execute-api.us-east-1.amazonaws.com/dev/"]
        Authorizer["Cognito JWT Authorizer"]
    end

    subgraph Lambdas["AWS Lambda  (Node.js 20 · ARM64)"]
        UploadFn["upload-url-fn\nPOST /documents/upload-url"]
        DocsFn["documents-fn\nGET · DELETE · PATCH /documents"]
        IngestFn["ingest-fn\nS3 ObjectCreated trigger"]
        QueryFn["query-fn\nPOST /query"]
        HistoryFn["history-fn\nGET /history"]
    end

    subgraph Storage["Storage"]
        S3["Amazon S3\ndocuquerystack-documentbucketae41e5a9-2fj13ymhn5u2\nSSE-S3 · Block Public Access"]
        DDB["Amazon DynamoDB\ndocuquery-dev\nPAY_PER_REQUEST · GSI: userId-createdAt"]
    end

    subgraph Bedrock["Amazon Bedrock"]
        Titan["Titan Embeddings V2\namazon.titan-embed-text-v2:0\n1024-dim vectors"]
        Claude["Claude 3 Haiku\nanthropic.claude-3-haiku-20240307-v1:0\nRAG answer generation"]
        KB["Bedrock Knowledge Base\ndocuquery-dev · ID: GWCJWPQZSF"]
    end

    subgraph VectorStore["Amazon OpenSearch Serverless"]
        AOSS["Collection: docuquery-vectors\nID: 9uh8a5ei1z5qh6luc4b4\nIndex: docuquery-index · HNSW/faiss · 1024-dim"]
    end

    subgraph OCR["Amazon Textract"]
        Textract["Async OCR\nStartDocumentTextDetection\nScanned PDF fallback"]
    end

    subgraph Observability["Amazon CloudWatch"]
        Logs["Log Groups\n/aws/lambda/docuquery-*-dev\nStructured JSON · 30-day retention"]
    end

    %% User ↔ Amplify
    Browser <-->|HTTPS| Amplify

    %% User ↔ Auth
    Browser <-->|Auth flows · JWT| UserPool
    UserPool --- IdentityPool

    %% User ↔ API
    Browser -->|"HTTPS + Bearer JWT"| APIGW
    APIGW --- Authorizer
    Authorizer -->|validates| UserPool

    %% API → Lambdas
    APIGW -->|POST upload-url| UploadFn
    APIGW -->|GET·DELETE·PATCH| DocsFn
    APIGW -->|POST query| QueryFn
    APIGW -->|GET history| HistoryFn

    %% Upload path
    UploadFn -->|PutItem status=uploaded| DDB
    UploadFn -->|presigned PUT URL| Browser
    Browser -->|"Direct PUT (no Lambda proxy)"| S3

    %% Ingest path
    S3 -->|ObjectCreated event| IngestFn
    IngestFn -->|UpdateItem status=processing| DDB
    IngestFn -->|GetObject| S3
    IngestFn -->|Scanned PDF → StartDocumentTextDetection| Textract
    IngestFn -->|StartIngestionJob| KB
    KB -->|embed chunks| Titan
    Titan -->|vectors| AOSS
    IngestFn -->|UpdateItem status=ready| DDB

    %% Documents path
    DocsFn <-->|Query · Delete · Update| DDB
    DocsFn -->|DeleteObject| S3
    DocsFn -->|StartIngestionJob| KB

    %% Query / RAG path
    QueryFn -->|Query ready docs| DDB
    QueryFn -->|Retrieve top-5 chunks| KB
    KB -->|embed question| Titan
    AOSS -->|similarity results| KB
    QueryFn -->|InvokeModel| Claude
    QueryFn -->|PutItem chat record| DDB

    %% History path
    HistoryFn -->|Query CHAT# SK| DDB

    %% Observability
    UploadFn & DocsFn & IngestFn & QueryFn & HistoryFn -->|structured JSON logs| Logs

    %% AOSS backing KB
    KB <-->|index · search| AOSS

    %% Styling
    classDef aws fill:#FF9900,stroke:#232F3E,color:#232F3E,font-weight:bold
    classDef lambda fill:#FF9900,stroke:#E47911,color:#232F3E
    classDef storage fill:#3F8624,stroke:#2D6A1A,color:#fff
    classDef bedrock fill:#8B5CF6,stroke:#6D28D9,color:#fff
    classDef user fill:#147EBA,stroke:#0F5A87,color:#fff
    classDef obs fill:#E05243,stroke:#B03A2E,color:#fff

    class APIGW,Authorizer,UserPool,IdentityPool,Amplify aws
    class UploadFn,DocsFn,IngestFn,QueryFn,HistoryFn lambda
    class S3,DDB storage
    class Titan,Claude,KB,AOSS bedrock
    class Browser,Textract user
    class Logs obs
```

---

## Service Quick Reference

| Service | Resource name | ID / ARN fragment |
|---------|--------------|------------------|
| Cognito User Pool | `docuquery-dev` | `us-east-1_kc9C1KHxz` |
| Cognito App Client | — | `6kunv07r1at24o6srco0kkc6i4` |
| Cognito Identity Pool | — | `us-east-1:89cefc81-e969-4864-b770-4a0276e48c5f` |
| API Gateway | `docuquery-dev` | `https://r3btd92wdh.execute-api.us-east-1.amazonaws.com/dev/` |
| S3 Document Bucket | `docuquerystack-documentbucketae41e5a9-2fj13ymhn5u2` | `arn:aws:s3:::docuquerystack-...` |
| DynamoDB Table | `docuquery-dev` | `arn:aws:dynamodb:us-east-1:800445863339:table/docuquery-dev` |
| Bedrock Knowledge Base | `docuquery-dev` | `GWCJWPQZSF` |
| AOSS Collection | `docuquery-vectors` | `9uh8a5ei1z5qh6luc4b4` |
| Amplify App | `docuquery-dev` | `d2aorcdg8vm2l4` |
| CloudFormation Stack | `DocuQueryStack` | `arn:aws:cloudformation:us-east-1:800445863339:stack/DocuQueryStack/...` |

## Data Flow Summary

### Upload
1. Browser → `POST /documents/upload-url` → **upload-url-fn** creates presigned S3 URL, writes DynamoDB record (`status=uploaded`)
2. Browser → `PUT` directly to S3 (no Lambda proxy)
3. S3 ObjectCreated → **ingest-fn**: extract text (TXT/DOCX/PDF+Textract) → chunk (1000 tokens/200 overlap) → `StartIngestionJob` → Bedrock KB embeds via Titan → stores vectors in AOSS → DynamoDB `status=ready`

### Query (RAG)
1. Browser → `POST /query` → **query-fn**
2. Check DynamoDB for any `status=ready` document — if none, return informational fallback
3. `KB.Retrieve(question, filter={userId}, top=5)` → AOSS cosine similarity search via Titan embeddings
4. If all scores < 0.5 threshold → return fallback (no Claude call)
5. `InvokeModel(Claude 3 Haiku)` with system prompt + retrieved excerpts (10s timeout)
6. Assemble citations, persist chat record to DynamoDB, return `{answer, citations, isFallback}`
