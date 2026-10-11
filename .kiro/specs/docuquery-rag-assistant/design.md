# Design Document: DocuQuery RAG Assistant

## Overview

DocuQuery is a serverless, cost-conscious web application that lets authenticated users upload documents and ask natural-language questions answered exclusively from those documents. It implements a Retrieval-Augmented Generation (RAG) pipeline using AWS managed services throughout.

**Core design principles:**

- **Serverless-first** — no EC2, no containers; every compute unit is a Lambda function or managed service.
- **Per-user isolation** — every data store enforces ownership at the key/filter level; no shared state leaks across users.
- **Least-privilege IAM** — each Lambda has its own execution role scoped to exactly the resources and actions it needs.
- **Cost-conscious** — services are chosen for their free-tier generosity and pay-per-request pricing (DynamoDB on-demand, Bedrock per-token, S3 Vectors instead of OpenSearch Serverless).
- **Infrastructure as code** — the entire stack is defined in AWS CDK TypeScript; no ClickOps.

**Technology choices:**

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | React + TypeScript on AWS Amplify | Managed hosting with built-in CI/CD; Cognito Hosted UI integration |
| Auth | Amazon Cognito (User Pool + Identity Pool) | Managed auth; JWT tokens; no custom auth server |
| API | Amazon API Gateway REST + Lambda | Per-request billing; Cognito JWT authorizer built-in |
| Document storage | Amazon S3 (SSE-S3, public access blocked) | Durable; pre-signed URL pattern avoids proxying large files through Lambda |
| Text extraction | Amazon Textract (scanned PDFs); mammoth (DOCX); UTF-8 (TXT) | Textract handles OCR; mammoth is a lightweight DOCX parser |
| Embeddings | Amazon Bedrock — Titan Embeddings V2 | Managed; no separate vector embedding server |
| Answer generation | Amazon Bedrock — Claude 3 Haiku | Fast, inexpensive; strong instruction-following for RAG grounding |
| Vector store | Amazon Bedrock Knowledge Bases + S3 Vectors | Avoids OpenSearch Serverless cost (~$700/month minimum); S3 Vectors is pay-per-request |
| Metadata + chat | Amazon DynamoDB (single-table, on-demand) | Sub-millisecond reads; per-request billing |
| Monitoring | Amazon CloudWatch (structured JSON, 30-day retention) | Centralized; no extra tooling cost |
| IaC | AWS CDK TypeScript | Type-safe constructs; L2/L3 abstractions where available |

---

## Architecture

### High-Level Architecture

```xml
<mxGraphModel dx="1422" dy="762" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1654" pageHeight="1169" math="0" shadow="0">
  <root>
    <mxCell id="0" />
    <mxCell id="1" parent="0" />

    <!-- Title -->
    <mxCell id="title" value="DocuQuery RAG Assistant — High-Level Architecture" style="text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;whiteSpace=wrap;rounded=0;fontSize=18;fontStyle=1;" vertex="1" parent="1">
      <mxGeometry x="327" y="20" width="1000" height="40" as="geometry" />
    </mxCell>

    <!-- ===== ZONES ===== -->
    <!-- Browser zone -->
    <mxCell id="zone-browser" value="User Browser" style="points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_user;strokeColor=#147EBA;fillColor=#E6F2F8;verticalLabelPosition=top;verticalAlign=bottom;align=center;spacingTop=25;fontStyle=1;fontSize=11;" vertex="1" parent="1">
      <mxGeometry x="40" y="80" width="200" height="200" as="geometry" />
    </mxCell>

    <!-- User icon -->
    <mxCell id="user-icon" value="User" style="shape=mxgraph.aws4.user;fillColor=#232F3E;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="100" y="130" width="48" height="48" as="geometry" />
    </mxCell>

    <!-- React SPA icon -->
    <mxCell id="react-spa" value="React + TypeScript SPA" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.general;fillColor=#232F3E;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="160" y="130" width="48" height="48" as="geometry" />
    </mxCell>

    <!-- AWS Amplify -->
    <mxCell id="amplify" value="AWS Amplify&#xa;(Frontend Hosting)" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.amplify;fillColor=#E7157B;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="300" y="100" width="48" height="48" as="geometry" />
    </mxCell>

    <!-- Cognito zone -->
    <mxCell id="zone-cognito" value="Authentication" style="points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_security_identity_compliance;strokeColor=#BF0816;fillColor=#FBEDED;verticalLabelPosition=top;verticalAlign=bottom;align=center;spacingTop=25;fontStyle=1;fontSize=11;" vertex="1" parent="1">
      <mxGeometry x="300" y="200" width="200" height="120" as="geometry" />
    </mxCell>

    <!-- Cognito -->
    <mxCell id="cognito" value="Amazon Cognito&#xa;User Pool + Identity Pool" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.cognito;fillColor=#BF0816;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="375" y="230" width="48" height="48" as="geometry" />
    </mxCell>

    <!-- API Gateway zone -->
    <mxCell id="zone-api" value="API Layer" style="points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_network_content_delivery;strokeColor=#8C4FFF;fillColor=#F4EEFF;verticalLabelPosition=top;verticalAlign=bottom;align=center;spacingTop=25;fontStyle=1;fontSize=11;" vertex="1" parent="1">
      <mxGeometry x="560" y="80" width="220" height="120" as="geometry" />
    </mxCell>

    <!-- API Gateway -->
    <mxCell id="apigw" value="Amazon API Gateway&#xa;REST API (Cognito JWT Auth)" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.api_gateway;fillColor=#8C4FFF;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="635" y="110" width="48" height="48" as="geometry" />
    </mxCell>

    <!-- Lambda zone -->
    <mxCell id="zone-lambda" value="Compute (Lambda Functions)" style="points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_lambda;strokeColor=#E7157B;fillColor=#FDE8F3;verticalLabelPosition=top;verticalAlign=bottom;align=center;spacingTop=25;fontStyle=1;fontSize=11;" vertex="1" parent="1">
      <mxGeometry x="840" y="60" width="360" height="440" as="geometry" />
    </mxCell>

    <!-- upload-url-fn -->
    <mxCell id="fn-upload" value="upload-url-fn&#xa;(POST /documents/upload-url)" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;fillColor=#E7157B;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="860" y="90" width="48" height="48" as="geometry" />
    </mxCell>

    <!-- documents-fn -->
    <mxCell id="fn-docs" value="documents-fn&#xa;(GET, DELETE /documents)" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;fillColor=#E7157B;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="960" y="90" width="48" height="48" as="geometry" />
    </mxCell>

    <!-- query-fn -->
    <mxCell id="fn-query" value="query-fn&#xa;(POST /query)" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;fillColor=#E7157B;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="1060" y="90" width="48" height="48" as="geometry" />
    </mxCell>

    <!-- history-fn -->
    <mxCell id="fn-history" value="history-fn&#xa;(GET /history)" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;fillColor=#E7157B;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="1120" y="90" width="48" height="48" as="geometry" />
    </mxCell>

    <!-- ingest-fn -->
    <mxCell id="fn-ingest" value="ingest-fn&#xa;(S3 ObjectCreated trigger)" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;fillColor=#E7157B;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="990" y="280" width="48" height="48" as="geometry" />
    </mxCell>

    <!-- Storage zone -->
    <mxCell id="zone-storage" value="Storage" style="points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_storage;strokeColor=#3F8624;fillColor=#EBF6E6;verticalLabelPosition=top;verticalAlign=bottom;align=center;spacingTop=25;fontStyle=1;fontSize=11;" vertex="1" parent="1">
      <mxGeometry x="560" y="560" width="500" height="160" as="geometry" />
    </mxCell>

    <!-- S3 bucket -->
    <mxCell id="s3" value="Amazon S3&#xa;Document Store&#xa;(SSE-S3, No Public Access)&#xa;Key: USER#{userId}/DOC#{docId}" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.s3;fillColor=#3F8624;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="590" y="590" width="48" height="48" as="geometry" />
    </mxCell>

    <!-- DynamoDB -->
    <mxCell id="dynamo" value="Amazon DynamoDB&#xa;Metadata Store + Chat History&#xa;(Single-Table, On-Demand)" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.dynamodb;fillColor=#3F8624;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="780" y="590" width="48" height="48" as="geometry" />
    </mxCell>

    <!-- AI/ML zone -->
    <mxCell id="zone-aiml" value="AI / ML (Amazon Bedrock)" style="points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_management_console;strokeColor=#01A88D;fillColor=#E1F5F3;verticalLabelPosition=top;verticalAlign=bottom;align=center;spacingTop=25;fontStyle=1;fontSize=11;" vertex="1" parent="1">
      <mxGeometry x="1100" y="420" width="440" height="220" as="geometry" />
    </mxCell>

    <!-- Bedrock KB -->
    <mxCell id="bedrock-kb" value="Amazon Bedrock&#xa;Knowledge Base&#xa;+ S3 Vectors Backend" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.bedrock;fillColor=#01A88D;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="1140" y="460" width="48" height="48" as="geometry" />
    </mxCell>

    <!-- Bedrock Titan Embeddings -->
    <mxCell id="bedrock-titan" value="Amazon Bedrock&#xa;Titan Embeddings V2" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.bedrock;fillColor=#01A88D;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="1280" y="460" width="48" height="48" as="geometry" />
    </mxCell>

    <!-- Bedrock Claude -->
    <mxCell id="bedrock-claude" value="Amazon Bedrock&#xa;Claude 3 Haiku&#xa;(Answer Generation)" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.bedrock;fillColor=#01A88D;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="1420" y="460" width="48" height="48" as="geometry" />
    </mxCell>

    <!-- Textract -->
    <mxCell id="textract" value="Amazon Textract&#xa;(Scanned PDF OCR)" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.textract;fillColor=#01A88D;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="1140" y="340" width="48" height="48" as="geometry" />
    </mxCell>

    <!-- CloudWatch -->
    <mxCell id="cloudwatch" value="Amazon CloudWatch&#xa;(Structured JSON Logs,&#xa;30-day Retention)" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.cloudwatch;fillColor=#E7157B;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="560" y="430" width="48" height="48" as="geometry" />
    </mxCell>

    <!-- CDK Stack label -->
    <mxCell id="cdk-label" value="All resources defined in AWS CDK TypeScript Stack" style="text;html=1;strokeColor=none;fillColor=#FFF2CC;align=center;verticalAlign=middle;whiteSpace=wrap;rounded=1;fontSize=10;fontStyle=2;border=1;strokeColor=#D6B656;" vertex="1" parent="1">
      <mxGeometry x="40" y="760" width="380" height="30" as="geometry" />
    </mxCell>

    <!-- ===== EDGES ===== -->
    <!-- User -> SPA -->
    <mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;" edge="1" source="user-icon" target="react-spa" parent="1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- SPA -> Amplify -->
    <mxCell id="e2" value="HTTPS" style="edgeStyle=orthogonalEdgeStyle;" edge="1" source="react-spa" target="amplify" parent="1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- SPA -> Cognito (auth) -->
    <mxCell id="e3" value="Sign-up / Sign-in&#xa;(JWT tokens)" style="edgeStyle=orthogonalEdgeStyle;" edge="1" source="react-spa" target="cognito" parent="1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- SPA -> API GW -->
    <mxCell id="e4" value="HTTPS + JWT" style="edgeStyle=orthogonalEdgeStyle;" edge="1" source="react-spa" target="apigw" parent="1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- SPA -> S3 (pre-signed direct upload) -->
    <mxCell id="e5" value="Direct Upload&#xa;(Pre-signed URL, HTTPS)" style="edgeStyle=orthogonalEdgeStyle;dashed=1;" edge="1" source="react-spa" target="s3" parent="1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- API GW -> upload-url-fn -->
    <mxCell id="e6" style="edgeStyle=orthogonalEdgeStyle;" edge="1" source="apigw" target="fn-upload" parent="1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- API GW -> documents-fn -->
    <mxCell id="e7" style="edgeStyle=orthogonalEdgeStyle;" edge="1" source="apigw" target="fn-docs" parent="1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- API GW -> query-fn -->
    <mxCell id="e8" style="edgeStyle=orthogonalEdgeStyle;" edge="1" source="apigw" target="fn-query" parent="1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- API GW -> history-fn -->
    <mxCell id="e9" style="edgeStyle=orthogonalEdgeStyle;" edge="1" source="apigw" target="fn-history" parent="1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- S3 ObjectCreated -> ingest-fn -->
    <mxCell id="e10" value="S3 ObjectCreated&#xa;event trigger" style="edgeStyle=orthogonalEdgeStyle;strokeColor=#E7157B;strokeWidth=2;" edge="1" source="s3" target="fn-ingest" parent="1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- upload-url-fn -> S3 (generate pre-signed URL) -->
    <mxCell id="e11" value="Generate&#xa;Pre-signed URL" style="edgeStyle=orthogonalEdgeStyle;" edge="1" source="fn-upload" target="s3" parent="1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- upload-url-fn -> DynamoDB -->
    <mxCell id="e12" value="Write record&#xa;status=uploaded" style="edgeStyle=orthogonalEdgeStyle;" edge="1" source="fn-upload" target="dynamo" parent="1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- documents-fn -> DynamoDB -->
    <mxCell id="e13" value="Query / Delete" style="edgeStyle=orthogonalEdgeStyle;" edge="1" source="fn-docs" target="dynamo" parent="1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- documents-fn -> S3 -->
    <mxCell id="e14" value="Delete object" style="edgeStyle=orthogonalEdgeStyle;" edge="1" source="fn-docs" target="s3" parent="1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- documents-fn -> Bedrock KB (delete chunks) -->
    <mxCell id="e15" value="Remove chunks" style="edgeStyle=orthogonalEdgeStyle;" edge="1" source="fn-docs" target="bedrock-kb" parent="1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- ingest-fn -> Textract -->
    <mxCell id="e16" value="OCR (scanned PDFs)" style="edgeStyle=orthogonalEdgeStyle;" edge="1" source="fn-ingest" target="textract" parent="1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- ingest-fn -> Bedrock Titan -->
    <mxCell id="e17" value="Generate embeddings" style="edgeStyle=orthogonalEdgeStyle;" edge="1" source="fn-ingest" target="bedrock-titan" parent="1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- ingest-fn -> Bedrock KB -->
    <mxCell id="e18" value="Index chunks +&#xa;StartIngestionJob" style="edgeStyle=orthogonalEdgeStyle;" edge="1" source="fn-ingest" target="bedrock-kb" parent="1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- ingest-fn -> DynamoDB -->
    <mxCell id="e19" value="Update status&#xa;(processing → ready / failed)" style="edgeStyle=orthogonalEdgeStyle;" edge="1" source="fn-ingest" target="dynamo" parent="1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- query-fn -> Bedrock KB (retrieve chunks) -->
    <mxCell id="e20" value="Retrieve top-5 chunks&#xa;(userId filter)" style="edgeStyle=orthogonalEdgeStyle;" edge="1" source="fn-query" target="bedrock-kb" parent="1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- query-fn -> Bedrock Claude -->
    <mxCell id="e21" value="Generate answer" style="edgeStyle=orthogonalEdgeStyle;" edge="1" source="fn-query" target="bedrock-claude" parent="1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- query-fn -> DynamoDB -->
    <mxCell id="e22" value="Persist chat record&#xa;+ citations" style="edgeStyle=orthogonalEdgeStyle;" edge="1" source="fn-query" target="dynamo" parent="1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- history-fn -> DynamoDB -->
    <mxCell id="e23" value="Query last 50&#xa;chat records" style="edgeStyle=orthogonalEdgeStyle;" edge="1" source="fn-history" target="dynamo" parent="1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- All Lambdas -> CloudWatch (logs) -->
    <mxCell id="e24" value="Structured JSON logs" style="edgeStyle=orthogonalEdgeStyle;dashed=1;strokeColor=#E7157B;" edge="1" source="fn-ingest" target="cloudwatch" parent="1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

  </root>
</mxGraphModel>
```

---

## Components and Interfaces

### Lambda Functions

#### 1. `upload-url-fn` — `POST /documents/upload-url`

**Responsibility:** Generate a pre-signed S3 PUT URL so the browser uploads directly to S3 without proxying through Lambda.

**Input:**
```typescript
{ fileName: string; contentType: string; fileSizeBytes: number }
```

**Output:**
```typescript
{ uploadUrl: string; documentId: string; expiresIn: number }
```

**Logic:**
1. Validate `contentType` is `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, or `text/plain`.
2. Validate `fileSizeBytes` ≤ 20,971,520 (20 MB).
3. Generate a UUID `documentId`.
4. Construct S3 key: `USER#{userId}/DOC#{documentId}/{sanitisedFileName}`.
5. Call `s3.getSignedUrlPromise('putObject', ...)` with a 15-minute expiry.
6. Write a DynamoDB record: `PK=USER#{userId}`, `SK=DOC#{documentId}`, `status=uploaded`, `createdAt=<ISO-8601>`, `fileName`, `fileSizeBytes`.
7. Return the pre-signed URL and `documentId`.

**Error handling:** Returns HTTP 400 for validation failures, HTTP 500 with correlation ID for unexpected errors.

---

#### 2. `documents-fn` — `GET /documents` and `DELETE /documents/{documentId}`

**GET logic:**
1. Extract `userId` from the validated JWT claims.
2. Query DynamoDB: `PK = USER#{userId}` AND `SK begins_with DOC#`.
3. Map to response shape: `{ documentId, fileName, fileSizeBytes, status, createdAt }`.

**DELETE logic:**
1. Verify the document's `userId` matches the caller — return 403 if not.
2. Delete raw file from S3: `DeleteObjectCommand`.
3. Remove all chunks from Bedrock Knowledge Base via `DeleteDocumentCommand` (or equivalent KB API).
4. Delete DynamoDB record.
5. If any step fails, halt and preserve remaining data; return HTTP 500.

---

#### 3. `ingest-fn` — S3 `ObjectCreated` event (async, no retry)

**Trigger:** S3 event notification on the document bucket; retry attempts = 0 to prevent double-indexing.

**Logic:**
1. Parse `userId` and `documentId` from the S3 object key.
2. Update DynamoDB: `status = processing`.
3. Download the file from S3.
4. Extract text:
   - **TXT**: decode UTF-8 directly.
   - **DOCX**: use `mammoth` to extract raw text, preserving paragraph newlines.
   - **PDF**: attempt to extract text layer; if result is empty, invoke Amazon Textract `StartDocumentTextDetection` and poll for completion.
5. If extracted text is empty, set `status = failed`, log to CloudWatch, return.
6. Chunk text using `js-tiktoken` with `cl100k_base` encoding: max 1,000 tokens per chunk, 200-token overlap between consecutive chunks.
7. For each chunk, call Bedrock `InvokeModel` with Titan Embeddings V2 to generate a vector.
8. Store chunks via Bedrock KB `StartIngestionJob` with metadata: `{ documentId, documentName, userId, pageNumber, chunkIndex }`.
9. Update DynamoDB: `status = ready`, `chunkCount`.
10. On any failure: remove all indexed chunks for this document from KB, set `status = failed`, log error with correlation ID to CloudWatch.

---

#### 4. `query-fn` — `POST /query`

**Input:**
```typescript
{ question: string; sessionId?: string }
```

**Output:**
```typescript
{ answer: string; citations: Citation[]; sessionId: string }
```

**Logic:**
1. Check DynamoDB for any document with `status = ready` for this user. If none, return informational message without invoking Bedrock.
2. Generate an embedding for the `question` using Titan Embeddings V2.
3. Call Bedrock KB `Retrieve` with `userId` metadata filter; retrieve top-5 chunks.
4. If all chunk relevance scores are below the configured threshold (`SIMILARITY_THRESHOLD` env var, default 0.5) or zero chunks returned, return fallback response — do not call Claude.
5. Construct the prompt:
   - **System message**: "You must answer only from the provided document passages. If the passages do not contain sufficient information, respond with the fallback message: 'I could not find the answer in your documents.' Do not use any knowledge outside the provided passages."
   - **User message**: `<passages>{chunks}</passages>\n\nQuestion: {question}`
6. Call Bedrock `InvokeModel` (Claude 3 Haiku) with a 10-second timeout.
7. Assemble citations: one `Citation` per retrieved chunk, containing `documentName`, `pageNumber` (or `"N/A"` for TXT), `passageText`.
8. Persist chat record to DynamoDB: `PK=USER#{userId}`, `SK=CHAT#{sessionId}#{timestamp}`, `question`, `answer`, `citations`.
9. Return response within 10 seconds; on Bedrock timeout return HTTP 504.

---

#### 5. `history-fn` — `GET /history`

**Logic:**
1. Query DynamoDB: `PK = USER#{userId}` AND `SK begins_with CHAT#`.
2. Sort descending by `SK` (timestamp encoded in key).
3. Return at most 50 records.

---

### Frontend Components

| Component | Responsibility |
|---|---|
| `AuthProvider` | Wraps Amplify Auth; exposes `user`, `signIn`, `signOut`, `signUp` |
| `ProtectedRoute` | Redirects unauthenticated users to `/signin` |
| `DocumentList` | Fetches and renders documents; handles upload, delete, status polling |
| `UploadZone` | Drag-and-drop / file picker; client-side format + size validation; progress bar using `XMLHttpRequest.upload.onprogress` |
| `ChatInterface` | Sends questions to `POST /query`; renders streamed answer + citations |
| `CitationPanel` | Expandable panel showing full chunk passage text |
| `HistoryList` | Renders paginated chat history from `GET /history` |
| `ErrorBoundary` | Catches render errors; displays user-friendly fallback |

---

### API Gateway

- **Type:** REST API (regional)
- **Auth:** Cognito JWT Authorizer on all routes except health check
- **CORS:** Allowed origins configured via CDK parameter; credentials allowed
- **Throttling:** 100 req/s burst, 50 req/s steady-state (adjustable)

| Method | Path | Lambda |
|---|---|---|
| POST | `/documents/upload-url` | `upload-url-fn` |
| GET | `/documents` | `documents-fn` |
| DELETE | `/documents/{documentId}` | `documents-fn` |
| POST | `/query` | `query-fn` |
| GET | `/history` | `history-fn` |

---

## Data Models

### DynamoDB Single-Table Design

**Table name:** `DocuQueryTable`

| Access Pattern | PK | SK | Attributes |
|---|---|---|---|
| Create / read document record | `USER#{userId}` | `DOC#{documentId}` | `fileName`, `fileSizeBytes`, `status`, `createdAt`, `updatedAt`, `chunkCount` |
| List documents for user | `USER#{userId}` | `begins_with(DOC#)` | — |
| Store chat record | `USER#{userId}` | `CHAT#{sessionId}#{ISO-timestamp}` | `question`, `answer`, `citations (JSON)`, `createdAt` |
| List recent chat for user | `USER#{userId}` | `begins_with(CHAT#)` + ScanIndexForward=false, Limit=50 | — |

**GSI:** `userId-createdAt-index`
- PK: `userId` (String)
- SK: `createdAt` (String ISO-8601)
- Purpose: time-ordered queries across both doc and chat item types when needed.

**Document status state machine:**

```
uploaded → processing → ready
              ↓
            failed  (can also transition from uploaded → failed on post-upload step failure)
```

Status transitions are monotonic — once `ready` or `failed`, no further transitions occur.

---

### S3 Key Schema

```
{bucketName}/USER#{userId}/DOC#{documentId}/{originalFileName}
```

Examples:
```
docuquery-documents-prod/USER#abc123/DOC#uuid-v4/report.pdf
docuquery-documents-prod/USER#abc123/DOC#uuid-v4/notes.txt
```

**Bucket configuration:**
- SSE-S3 encryption at rest
- Block all public access: enabled
- Versioning: disabled (cost-conscious; failed uploads produce a clean re-upload)
- Lifecycle: no expiry (user-controlled deletion only)

---

### Knowledge Base Chunk Metadata Schema

Each chunk stored in the Bedrock Knowledge Base carries the following metadata fields:

```typescript
{
  documentId: string;       // UUID of the parent document
  documentName: string;     // Original file name
  userId: string;           // Owner — used as retrieval filter
  pageNumber: number | null; // null for TXT files
  chunkIndex: number;       // 0-based position within the document
  sourceFormat: 'pdf' | 'docx' | 'txt';
}
```

Retrieval always passes `{ userId: <callerUserId> }` as a metadata filter to enforce per-user isolation.

---

### Citation Model

```typescript
interface Citation {
  documentId: string;
  documentName: string;
  pageNumber: number | 'N/A';
  passageText: string;       // verbatim chunk text
  relevanceScore: number;    // 0–1, from KB retrieve response
}
```

---

### Chat Record Model

```typescript
interface ChatRecord {
  sessionId: string;
  userId: string;
  question: string;
  answer: string;
  citations: Citation[];
  createdAt: string;         // ISO-8601
  isFallback: boolean;
}
```

---

## Sequence Diagrams

### Document Upload Flow

```xml
<mxGraphModel dx="1422" dy="762" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1654" pageHeight="1169" math="0" shadow="0">
  <root>
    <mxCell id="0" />
    <mxCell id="1" parent="0" />

    <!-- Title -->
    <mxCell id="title" value="Document Upload — Sequence Diagram" style="text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;whiteSpace=wrap;rounded=0;fontSize=16;fontStyle=1;" vertex="1" parent="1">
      <mxGeometry x="100" y="20" width="1400" height="40" as="geometry" />
    </mxCell>

    <!-- Lifeline headers -->
    <mxCell id="lh-browser" value="Browser (React SPA)" style="shape=mxgraph.aws4.user;fillColor=#232F3E;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="60" y="80" width="48" height="48" as="geometry" />
    </mxCell>
    <mxCell id="lh-apigw" value="API Gateway" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.api_gateway;fillColor=#8C4FFF;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="260" y="80" width="48" height="48" as="geometry" />
    </mxCell>
    <mxCell id="lh-upload-fn" value="upload-url-fn" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;fillColor=#E7157B;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="460" y="80" width="48" height="48" as="geometry" />
    </mxCell>
    <mxCell id="lh-dynamo" value="DynamoDB" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.dynamodb;fillColor=#3F8624;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="660" y="80" width="48" height="48" as="geometry" />
    </mxCell>
    <mxCell id="lh-s3" value="Amazon S3" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.s3;fillColor=#3F8624;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="860" y="80" width="48" height="48" as="geometry" />
    </mxCell>
    <mxCell id="lh-ingest" value="ingest-fn" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;fillColor=#E7157B;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="1060" y="80" width="48" height="48" as="geometry" />
    </mxCell>
    <mxCell id="lh-textract" value="Amazon Textract" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.textract;fillColor=#01A88D;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="1180" y="80" width="48" height="48" as="geometry" />
    </mxCell>
    <mxCell id="lh-kb" value="Bedrock KB" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.bedrock;fillColor=#01A88D;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="1360" y="80" width="48" height="48" as="geometry" />
    </mxCell>

    <!-- Lifelines (vertical dashed lines) -->
    <mxCell id="ll-browser" style="edgeStyle=none;dashed=1;endArrow=none;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="84" y="140" /><mxPoint x="84" y="980" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="ll-apigw" style="edgeStyle=none;dashed=1;endArrow=none;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="284" y="140" /><mxPoint x="284" y="980" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="ll-upload-fn" style="edgeStyle=none;dashed=1;endArrow=none;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="484" y="140" /><mxPoint x="484" y="980" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="ll-dynamo" style="edgeStyle=none;dashed=1;endArrow=none;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="684" y="140" /><mxPoint x="684" y="980" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="ll-s3" style="edgeStyle=none;dashed=1;endArrow=none;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="884" y="140" /><mxPoint x="884" y="980" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="ll-ingest" style="edgeStyle=none;dashed=1;endArrow=none;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1084" y="140" /><mxPoint x="1084" y="980" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="ll-textract" style="edgeStyle=none;dashed=1;endArrow=none;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1204" y="140" /><mxPoint x="1204" y="980" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="ll-kb" style="edgeStyle=none;dashed=1;endArrow=none;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1384" y="140" /><mxPoint x="1384" y="980" /></Array></mxGeometry>
    </mxCell>

    <!-- Step 1: User selects file, browser validates -->
    <mxCell id="note1" value="1. User selects file; browser validates format + size" style="text;html=1;strokeColor=#999;fillColor=#FFF9C4;align=left;verticalAlign=middle;whiteSpace=wrap;rounded=1;fontSize=10;" vertex="1" parent="1">
      <mxGeometry x="84" y="165" width="300" height="25" as="geometry" />
    </mxCell>
    <!-- Step 2: POST /documents/upload-url -->
    <mxCell id="seq2" value="POST /documents/upload-url (fileName, contentType, fileSizeBytes) + JWT" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="84" y="210" /><mxPoint x="284" y="210" /></Array></mxGeometry>
    </mxCell>
    <!-- Step 3: forward to Lambda -->
    <mxCell id="seq3" value="invoke (validated JWT)" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="284" y="240" /><mxPoint x="484" y="240" /></Array></mxGeometry>
    </mxCell>
    <!-- Step 4: Lambda validates, generates pre-signed URL -->
    <mxCell id="note4" value="4. Validate type + size; generate documentId (UUID); build S3 key" style="text;html=1;strokeColor=#999;fillColor=#FFF9C4;align=left;verticalAlign=middle;whiteSpace=wrap;rounded=1;fontSize=10;" vertex="1" parent="1">
      <mxGeometry x="484" y="260" width="360" height="25" as="geometry" />
    </mxCell>
    <!-- Step 5: getSignedUrl -->
    <mxCell id="seq5" value="getSignedUrl(putObject, key, 15 min)" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="484" y="305" /><mxPoint x="884" y="305" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="seq5r" value="pre-signed URL" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;dashed=1;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="884" y="325" /><mxPoint x="484" y="325" /></Array></mxGeometry>
    </mxCell>
    <!-- Step 6: Write DynamoDB record -->
    <mxCell id="seq6" value="PutItem (status=uploaded)" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="484" y="360" /><mxPoint x="684" y="360" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="seq6r" value="OK" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;dashed=1;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="684" y="380" /><mxPoint x="484" y="380" /></Array></mxGeometry>
    </mxCell>
    <!-- Step 7: Return pre-signed URL to browser -->
    <mxCell id="seq7" value="200 { uploadUrl, documentId }" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;dashed=1;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="284" y="415" /><mxPoint x="84" y="415" /></Array></mxGeometry>
    </mxCell>
    <!-- Step 8: Browser uploads directly to S3 -->
    <mxCell id="seq8" value="PUT {file bytes} to pre-signed URL (HTTPS, with progress events)" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;strokeColor=#3F8624;strokeWidth=2;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="84" y="450" /><mxPoint x="884" y="450" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="note8" value="Browser fires XHR upload.onprogress → updates progress bar (0–100%)" style="text;html=1;strokeColor=#3F8624;fillColor=#EBF6E6;align=left;verticalAlign=middle;whiteSpace=wrap;rounded=1;fontSize=10;" vertex="1" parent="1">
      <mxGeometry x="84" y="460" width="380" height="25" as="geometry" />
    </mxCell>
    <mxCell id="seq8r" value="200 OK (S3)" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;dashed=1;strokeColor=#3F8624;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="884" y="510" /><mxPoint x="84" y="510" /></Array></mxGeometry>
    </mxCell>
    <!-- Step 9: S3 fires ObjectCreated event to ingest-fn -->
    <mxCell id="seq9" value="ObjectCreated event (async, retry=0)" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;strokeColor=#E7157B;strokeWidth=2;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="884" y="545" /><mxPoint x="1084" y="545" /></Array></mxGeometry>
    </mxCell>
    <!-- Step 10: ingest-fn sets status=processing -->
    <mxCell id="seq10" value="UpdateItem (status=processing)" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1084" y="570" /><mxPoint x="684" y="570" /></Array></mxGeometry>
    </mxCell>
    <!-- Step 11: Extract text (conditional) -->
    <mxCell id="note11a" value="if scanned PDF (no text layer):" style="text;html=1;strokeColor=none;fillColor=none;align=left;fontStyle=2;fontSize=10;" vertex="1" parent="1">
      <mxGeometry x="1084" y="595" width="220" height="20" as="geometry" />
    </mxCell>
    <mxCell id="seq11a" value="StartDocumentTextDetection → poll" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1084" y="625" /><mxPoint x="1204" y="625" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="seq11ar" value="extracted text" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;dashed=1;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1204" y="645" /><mxPoint x="1084" y="645" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="note11b" value="else (DOCX/TXT): mammoth / UTF-8 decode (in-process)" style="text;html=1;strokeColor=none;fillColor=none;align=left;fontStyle=2;fontSize=10;" vertex="1" parent="1">
      <mxGeometry x="1084" y="660" width="320" height="20" as="geometry" />
    </mxCell>
    <!-- Step 12: Chunk + embed + index -->
    <mxCell id="note12" value="Chunk text (js-tiktoken, 1000 tokens, 200 overlap); generate embeddings (Titan V2)" style="text;html=1;strokeColor=#999;fillColor=#FFF9C4;align=left;verticalAlign=middle;whiteSpace=wrap;rounded=1;fontSize=10;" vertex="1" parent="1">
      <mxGeometry x="1084" y="690" width="460" height="25" as="geometry" />
    </mxCell>
    <!-- Step 13: StartIngestionJob -->
    <mxCell id="seq13" value="StartIngestionJob (chunks + metadata)" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1084" y="730" /><mxPoint x="1384" y="730" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="seq13r" value="job complete" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;dashed=1;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1384" y="750" /><mxPoint x="1084" y="750" /></Array></mxGeometry>
    </mxCell>
    <!-- Step 14: Update status=ready -->
    <mxCell id="seq14" value="UpdateItem (status=ready, chunkCount)" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1084" y="790" /><mxPoint x="684" y="790" /></Array></mxGeometry>
    </mxCell>
    <!-- Step 15: Browser polls for status change -->
    <mxCell id="note15" value="Browser polls GET /documents every ~3s until status=ready or failed" style="text;html=1;strokeColor=#147EBA;fillColor=#E6F2F8;align=left;verticalAlign=middle;whiteSpace=wrap;rounded=1;fontSize=10;" vertex="1" parent="1">
      <mxGeometry x="84" y="820" width="450" height="25" as="geometry" />
    </mxCell>

  </root>
</mxGraphModel>
```

---

### Query (RAG) Flow

```xml
<mxGraphModel dx="1422" dy="762" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1654" pageHeight="1169" math="0" shadow="0">
  <root>
    <mxCell id="0" />
    <mxCell id="1" parent="0" />

    <!-- Title -->
    <mxCell id="title" value="Query (RAG) Flow — Sequence Diagram" style="text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;whiteSpace=wrap;rounded=0;fontSize=16;fontStyle=1;" vertex="1" parent="1">
      <mxGeometry x="100" y="20" width="1400" height="40" as="geometry" />
    </mxCell>

    <!-- Lifeline headers -->
    <mxCell id="lh-browser" value="Browser (React SPA)" style="shape=mxgraph.aws4.user;fillColor=#232F3E;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="60" y="80" width="48" height="48" as="geometry" />
    </mxCell>
    <mxCell id="lh-apigw" value="API Gateway" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.api_gateway;fillColor=#8C4FFF;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="240" y="80" width="48" height="48" as="geometry" />
    </mxCell>
    <mxCell id="lh-query-fn" value="query-fn" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;fillColor=#E7157B;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="440" y="80" width="48" height="48" as="geometry" />
    </mxCell>
    <mxCell id="lh-dynamo" value="DynamoDB" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.dynamodb;fillColor=#3F8624;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="640" y="80" width="48" height="48" as="geometry" />
    </mxCell>
    <mxCell id="lh-kb" value="Bedrock KB&#xa;(S3 Vectors)" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.bedrock;fillColor=#01A88D;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="840" y="80" width="48" height="48" as="geometry" />
    </mxCell>
    <mxCell id="lh-titan" value="Bedrock Titan&#xa;Embeddings V2" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.bedrock;fillColor=#01A88D;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="1040" y="80" width="48" height="48" as="geometry" />
    </mxCell>
    <mxCell id="lh-claude" value="Bedrock Claude&#xa;3 Haiku" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.bedrock;fillColor=#01A88D;strokeColor=none;labelPosition=center;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1">
      <mxGeometry x="1240" y="80" width="48" height="48" as="geometry" />
    </mxCell>

    <!-- Lifelines -->
    <mxCell id="ll-browser" style="edgeStyle=none;dashed=1;endArrow=none;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="84" y="140" /><mxPoint x="84" y="1040" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="ll-apigw" style="edgeStyle=none;dashed=1;endArrow=none;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="264" y="140" /><mxPoint x="264" y="1040" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="ll-query-fn" style="edgeStyle=none;dashed=1;endArrow=none;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="464" y="140" /><mxPoint x="464" y="1040" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="ll-dynamo" style="edgeStyle=none;dashed=1;endArrow=none;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="664" y="140" /><mxPoint x="664" y="1040" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="ll-kb" style="edgeStyle=none;dashed=1;endArrow=none;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="864" y="140" /><mxPoint x="864" y="1040" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="ll-titan" style="edgeStyle=none;dashed=1;endArrow=none;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1064" y="140" /><mxPoint x="1064" y="1040" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="ll-claude" style="edgeStyle=none;dashed=1;endArrow=none;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1264" y="140" /><mxPoint x="1264" y="1040" /></Array></mxGeometry>
    </mxCell>

    <!-- Step 1: POST /query -->
    <mxCell id="seq1" value="POST /query { question, sessionId? } + JWT" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="84" y="180" /><mxPoint x="264" y="180" /></Array></mxGeometry>
    </mxCell>
    <!-- API GW validates JWT and forwards -->
    <mxCell id="seq1b" value="invoke (claims: userId, email)" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="264" y="205" /><mxPoint x="464" y="205" /></Array></mxGeometry>
    </mxCell>

    <!-- Step 2: Check for ready documents -->
    <mxCell id="seq2" value="Query: PK=USER#{userId}, SK begins_with DOC#, filter status=ready" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="464" y="240" /><mxPoint x="664" y="240" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="seq2r" value="document records (or empty)" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;dashed=1;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="664" y="260" /><mxPoint x="464" y="260" /></Array></mxGeometry>
    </mxCell>

    <!-- Alt: no ready documents -->
    <mxCell id="alt-no-docs" value="[alt] no ready documents" style="text;html=1;strokeColor=#BF0816;fillColor=#FBEDED;align=left;verticalAlign=middle;whiteSpace=wrap;rounded=1;fontSize=10;fontStyle=2;" vertex="1" parent="1">
      <mxGeometry x="464" y="280" width="220" height="25" as="geometry" />
    </mxCell>
    <mxCell id="seq2-nodocs" value="return 200 { answer: 'No documents available.', citations: [] }" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;dashed=1;strokeColor=#BF0816;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="264" y="315" /><mxPoint x="84" y="315" /></Array></mxGeometry>
    </mxCell>

    <!-- Step 3: Embed the question -->
    <mxCell id="seq3" value="InvokeModel (Titan Embeddings V2, input=question)" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;strokeColor=#01A88D;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="464" y="355" /><mxPoint x="1064" y="355" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="seq3r" value="embedding vector (1536 dims)" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;dashed=1;strokeColor=#01A88D;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1064" y="375" /><mxPoint x="464" y="375" /></Array></mxGeometry>
    </mxCell>

    <!-- Step 4: Retrieve top-5 chunks -->
    <mxCell id="seq4" value="Retrieve(embedding, filter={userId}, numberOfResults=5)" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;strokeColor=#01A88D;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="464" y="415" /><mxPoint x="864" y="415" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="seq4r" value="top-5 chunks + relevance scores" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;dashed=1;strokeColor=#01A88D;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="864" y="435" /><mxPoint x="464" y="435" /></Array></mxGeometry>
    </mxCell>

    <!-- Step 5: Check threshold -->
    <mxCell id="alt-threshold" value="[alt] all scores below SIMILARITY_THRESHOLD (default 0.5) or zero chunks" style="text;html=1;strokeColor=#BF0816;fillColor=#FBEDED;align=left;verticalAlign=middle;whiteSpace=wrap;rounded=1;fontSize=10;fontStyle=2;" vertex="1" parent="1">
      <mxGeometry x="464" y="460" width="520" height="25" as="geometry" />
    </mxCell>
    <mxCell id="seq5-fallback" value="return 200 { answer: 'I could not find the answer in your documents.', citations: [], isFallback: true }" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;dashed=1;strokeColor=#BF0816;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="264" y="500" /><mxPoint x="84" y="500" /></Array></mxGeometry>
    </mxCell>

    <!-- Step 6: Build prompt -->
    <mxCell id="note6" value="Construct prompt: system=grounding instruction + fallback instruction; user=&lt;passages&gt;{chunks}&lt;/passages&gt; + question" style="text;html=1;strokeColor=#999;fillColor=#FFF9C4;align=left;verticalAlign=middle;whiteSpace=wrap;rounded=1;fontSize=10;" vertex="1" parent="1">
      <mxGeometry x="464" y="530" width="600" height="30" as="geometry" />
    </mxCell>

    <!-- Step 7: Call Claude (10s timeout) -->
    <mxCell id="seq7" value="InvokeModel (Claude 3 Haiku, system+user messages, timeout=10s)" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;strokeColor=#01A88D;strokeWidth=2;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="464" y="580" /><mxPoint x="1264" y="580" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="seq7r" value="answer text" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;dashed=1;strokeColor=#01A88D;strokeWidth=2;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1264" y="610" /><mxPoint x="464" y="610" /></Array></mxGeometry>
    </mxCell>

    <!-- Alt: Bedrock timeout -->
    <mxCell id="alt-timeout" value="[alt] timeout &gt; 10s" style="text;html=1;strokeColor=#BF0816;fillColor=#FBEDED;align=left;verticalAlign=middle;whiteSpace=wrap;rounded=1;fontSize=10;fontStyle=2;" vertex="1" parent="1">
      <mxGeometry x="464" y="630" width="200" height="25" as="geometry" />
    </mxCell>
    <mxCell id="seq7-timeout" value="return HTTP 504 (Gateway Timeout)" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;dashed=1;strokeColor=#BF0816;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="264" y="665" /><mxPoint x="84" y="665" /></Array></mxGeometry>
    </mxCell>

    <!-- Step 8: Assemble citations -->
    <mxCell id="note8" value="Assemble citations: one per chunk — { documentName, pageNumber (or 'N/A' for TXT), passageText, relevanceScore }" style="text;html=1;strokeColor=#999;fillColor=#FFF9C4;align=left;verticalAlign=middle;whiteSpace=wrap;rounded=1;fontSize=10;" vertex="1" parent="1">
      <mxGeometry x="464" y="695" width="640" height="30" as="geometry" />
    </mxCell>

    <!-- Step 9: Persist chat record -->
    <mxCell id="seq9" value="PutItem (PK=USER#{userId}, SK=CHAT#{sessionId}#{ts}, question, answer, citations, isFallback=false)" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="464" y="745" /><mxPoint x="664" y="745" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="seq9r" value="OK" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;dashed=1;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="664" y="765" /><mxPoint x="464" y="765" /></Array></mxGeometry>
    </mxCell>

    <!-- Step 10: Return response to browser -->
    <mxCell id="seq10" value="200 { answer, citations: [{ documentName, pageNumber, passageText }], sessionId }" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;dashed=1;strokeWidth=2;" edge="1" parent="1">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="264" y="805" /><mxPoint x="84" y="805" /></Array></mxGeometry>
    </mxCell>

    <!-- Step 11: Frontend renders -->
    <mxCell id="note11" value="Frontend renders answer text + numbered citations; user can click citation → CitationPanel shows full passageText" style="text;html=1;strokeColor=#147EBA;fillColor=#E6F2F8;align=left;verticalAlign=middle;whiteSpace=wrap;rounded=1;fontSize=10;" vertex="1" parent="1">
      <mxGeometry x="84" y="825" width="600" height="30" as="geometry" />
    </mxCell>

  </root>
</mxGraphModel>
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

---

### Property 1: TXT Round-Trip Fidelity

*For any* valid UTF-8 TXT document content, parsing the content to extract text, serializing the result back to a string, then parsing again SHALL produce an extracted text string that is identical to the result of the first parse.

**Validates: Requirements 14.2**

---

### Property 2: Chunking Completeness

*For any* non-empty extracted text string, the set of all chunks produced by the chunking function SHALL collectively contain every token present in the original text (accounting for the 200-token overlap, no tokens are dropped or invented).

**Validates: Requirements 4.5**

---

### Property 3: Chunking Size Bound

*For any* text input of any length, every chunk produced by the chunking function SHALL contain no more than 1,000 tokens as counted by `js-tiktoken` with the `cl100k_base` encoding, and consecutive chunks SHALL share an overlap region of approximately 200 tokens (within ±1 token to account for encoding boundaries).

**Validates: Requirements 4.5**

---

### Property 4: DOCX Paragraph Boundary Preservation

*For any* DOCX document containing two or more paragraphs with non-empty content, the extracted plain text SHALL contain at least one newline character (`\n`) between the content of each consecutive pair of paragraphs, preserving paragraph structure.

**Validates: Requirements 14.3**

---

### Property 5: Per-User Data Isolation

*For any* two distinct user IDs `userA` and `userB`, and any document owned by `userA`, an API request authenticated as `userB` to read, query, or delete that document SHALL receive an HTTP 403 Forbidden response and SHALL NOT receive any information about that document's content or metadata.

**Validates: Requirements 5.6, 9.4, 10.4**

---

### Property 6: Fallback When No Chunks Satisfy Threshold

*For any* question where all retrieved chunks have a relevance score strictly below the configured `SIMILARITY_THRESHOLD`, OR where zero chunks are returned, the `query-fn` SHALL return a fallback response object with `isFallback: true`, a non-empty fallback message string, and an empty `citations` array — and SHALL NOT invoke the Amazon Bedrock Claude model.

**Validates: Requirements 7.1, 7.4**

---

### Property 7: Citation Completeness for Non-Fallback Answers

*For any* non-fallback answer produced by the `query-fn`, the `citations` array SHALL contain exactly one `Citation` object for each chunk that was retrieved from the Knowledge Base and used to construct the prompt, and each `Citation` SHALL include a non-empty `documentName`, a `pageNumber` that is either a positive integer or the string `"N/A"` (for TXT sources), and a non-empty `passageText` matching the verbatim chunk text.

**Validates: Requirements 8.1, 8.2**

---

### Property 8: Document Status Monotonicity

*For any* document record, the status field SHALL only transition forward through the state machine: `uploaded → processing → ready`, or `uploaded → failed`, or `processing → failed`. Transitions backward (e.g., `ready → processing`, `failed → processing`) SHALL never occur, and the system SHALL reject any update attempt that would violate this ordering.

**Validates: Requirements 4.2, 4.7, 4.8, 3.6**

---

### Property 9: Empty-Input Rejection

*For any* call to the ingestion text-extraction step that returns an empty string (zero characters), the `ingest-fn` SHALL set the document status to `failed` in DynamoDB, log the event to CloudWatch, and SHALL NOT proceed to chunking, embedding, or Knowledge Base indexing.

**Validates: Requirements 4.9, 14.4**

---

### Property 10: Ingestion Determinism

*For any* given document file (PDF with text layer, DOCX, or TXT), invoking the text-extraction step twice on the same byte-identical input SHALL produce byte-for-byte identical extracted text strings on both invocations.

**Validates: Requirements 14.1**

---

### Property 11: Prompt System Instruction Inclusion

*For any* invocation of `query-fn` that proceeds to call the Claude model (i.e., sufficient chunks above threshold exist), the constructed prompt SHALL include both: (a) an explicit instruction that the model must answer only from the provided passages, and (b) an explicit instruction that the model must respond with a fallback message if the passages do not support the question — present in every prompt regardless of the question content or chunk content.

**Validates: Requirements 6.4, 7.2**

---

### Property 12: Structured Log Completeness

*For any* Lambda invocation of any of the five Lambda functions, the structured JSON log entry emitted to CloudWatch SHALL contain all of the following fields with non-null, non-empty values: `timestamp` (ISO-8601), `functionName`, `userId` (anonymised token, not raw PII), `operationType`, `durationMs` (non-negative integer), and `outcome` (either `"success"` or an HTTP/error code string).

**Validates: Requirements 12.1**

---

## Error Handling

### Correlation IDs

Every Lambda function generates a UUID v4 correlation ID at invocation start. This ID is:
- Included in all structured log entries for that invocation.
- Returned in the HTTP error response body under the `correlationId` field for 4xx and 5xx responses.
- Propagated to downstream AWS SDK calls via the `x-amzn-trace-id` header where supported.

### HTTP Status Code Mapping

| Condition | HTTP Status | Frontend Action |
|---|---|---|
| Expired or invalid JWT | 401 Unauthorized | Redirect to sign-in |
| Cross-user resource access | 403 Forbidden | Display "Access denied" |
| Malformed request / missing field | 400 Bad Request | Display field-level error |
| Bedrock service error | 502 Bad Gateway | "Service unavailable, please retry" |
| Bedrock timeout (> 10s) | 504 Gateway Timeout | "Request timed out, please retry" |
| Unexpected Lambda error | 500 Internal Server Error | "Something went wrong, please retry" |
| Network error (no response) | N/A (fetch exception) | "Connection error" — no blank screen |

### Ingestion Pipeline Failure Compensation

When `ingest-fn` encounters an error at any step after indexing has begun, it executes a compensating rollback:

1. Call Bedrock KB `DeleteDocument` for all chunks already indexed for this `documentId`.
2. Update DynamoDB `status = failed`, set `errorMessage` to the step name and correlation ID.
3. Log to CloudWatch: `{ correlationId, documentId, userId, failedStep, error }`.
4. Do **not** throw — return cleanly to prevent the S3 event source from retrying (retry count is 0).

### Upload Failure Handling

If the browser's direct PUT to S3 fails (network error, S3 returns non-2xx), the browser calls `PATCH /documents/{documentId}/status` with `{ status: "failed" }` to update the DynamoDB record. The `documents-fn` handles this endpoint.

### Deletion Partial Failure

If any step in the three-step deletion sequence (S3 → KB → DynamoDB) fails, the remaining steps are aborted. The document record and any remaining data are preserved in their pre-deletion state. The API returns HTTP 500 with `correlationId`. The Frontend displays an error message.

---

## Testing Strategy

### Dual Testing Approach

Unit tests verify specific, concrete examples and error conditions. Property-based tests verify universal properties across randomised inputs. Both are required for comprehensive correctness coverage.

### Testing Stack

| Tool | Purpose |
|---|---|
| **Jest** | Test runner and assertion library for all Lambda handler unit tests |
| **aws-sdk-client-mock** | Mock AWS SDK v3 clients (S3, DynamoDB, Bedrock, Textract) in Lambda unit tests |
| **fast-check** | Property-based testing library; minimum **100 iterations** per property test |
| **CDK Assertions** | Snapshot tests for CDK stack infrastructure configuration |
| **Supertest** | (Optional) Integration tests against a locally deployed API Gateway |

### Unit Tests — Lambda Handlers

Every Lambda handler function has a dedicated Jest test file covering:

| Lambda | Critical Paths |
|---|---|
| `upload-url-fn` | Valid upload; unsupported format → 400; oversized file → 400; S3 pre-signed URL generation; DynamoDB write with status=uploaded |
| `documents-fn` | List returns only caller's documents; cross-user access → 403; successful deletion cascade; partial deletion failure → 500, data preserved |
| `ingest-fn` | status=processing set on start; DOCX/TXT → no Textract call; scanned PDF → Textract invoked; empty extraction → status=failed, no KB call; successful full pipeline → status=ready; failure at any step → rollback + status=failed |
| `query-fn` | No ready documents → informational message; all chunks below threshold → fallback + isFallback:true + no Claude call; successful answer → citations assembled; Bedrock timeout → 504; chat record persisted with citations |
| `history-fn` | Returns ≤ 50 records in descending order; returns only caller's records; DynamoDB unavailable → error response |

### Property-Based Tests — fast-check

Each property test runs a minimum of **100 iterations** via fast-check's `fc.assert(fc.property(...))`. Each test is annotated with a comment in the format:

```
// Feature: docuquery-rag-assistant, Property N: <property title>
```

| Property | fast-check Generators | What Is Verified |
|---|---|---|
| **P1: TXT Round-Trip** | `fc.string()` for document content | `parse(serialize(parse(input))) === parse(input)` |
| **P2: Chunking Completeness** | `fc.string({ minLength: 1 })` for text | Token multiset of all chunks equals token multiset of input |
| **P3: Chunking Size Bound** | `fc.string()` of varying lengths | All chunks ≤ 1000 tokens; consecutive overlap ≈ 200 tokens |
| **P4: DOCX Paragraph Boundaries** | `fc.array(fc.string({ minLength: 1 }), { minLength: 2 })` for paragraph list | Extracted text contains `\n` between each paragraph pair |
| **P5: Per-User Isolation** | `fc.uuid()` × 2 for userA/userB, `fc.record(...)` for document | ownership check always enforces 403 for cross-user access |
| **P6: Fallback Threshold** | `fc.array(fc.float({ min: 0, max: 0.49 }), { minLength: 0, maxLength: 5 })` for scores | isFallback=true, citations=[], Claude mock never called |
| **P7: Citation Completeness** | `fc.array(fc.record({ documentId, documentName, pageNumber, passageText }))` for chunks | citation count equals chunk count; all fields present and non-empty |
| **P8: Status Monotonicity** | `fc.constantFrom` for invalid transitions | Each backward transition is rejected / no-op |
| **P9: Empty-Input Rejection** | N/A (fixed empty string input) | status=failed, Bedrock KB mock never called; edge case, 1 iteration |
| **P10: Ingestion Determinism** | `fc.uint8Array()` for raw file bytes | Two calls to extraction function produce identical output |
| **P11: Prompt Instruction Inclusion** | `fc.string()` for question, `fc.array(chunk)` for chunks above threshold | Prompt string always contains both required instruction substrings |
| **P12: Structured Log Completeness** | `fc.record(...)` for invocation parameters | Log output is valid JSON containing all 6 required fields |

### CDK Snapshot Tests

Infrastructure configuration is verified with CDK's `assertions` package:

- S3 bucket: `BlockPublicAcls: true`, `ServerSideEncryptionConfiguration` using `AES256`.
- DynamoDB table: `SSESpecification.SSEEnabled: true`.
- Each Lambda execution role: IAM policy actions are explicit (no `*`), resources are specific ARNs.
- API Gateway: Cognito authorizer attached to all non-health routes.
- Lambda log groups: `RetentionInDays: 30`.
- `ingest-fn` S3 event source: `BisectBatchOnError: false`, `MaximumRetryAttempts: 0`.

### Integration Tests

Run against a deployed dev/test stack (not in unit test CI):

- Full upload → ingest → query round trip with a real PDF.
- Cognito sign-up, verify email code, sign-in, obtain JWT.
- Query with no ready documents returns informational message.
- Query with a question not answerable from docs returns fallback message.
- Deletion removes file from S3 and chunks from KB (verified by subsequent query returning fallback).

### Test Coverage Target

- Lambda handler unit tests: ≥ 90% line coverage (enforced in CI via Jest `--coverage --coverageThreshold`).
- Property tests: 100 iterations minimum per property, run on every PR.
- CDK snapshot tests: 100% of resource constructs.
