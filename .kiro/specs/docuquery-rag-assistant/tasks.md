# Implementation Plan: DocuQuery RAG Assistant

## Overview

This plan converts the DocuQuery design into a dependency-ordered sequence of coding tasks. Each task builds directly on the previous ones, culminating in a fully wired serverless RAG application: AWS CDK TypeScript infrastructure, five Lambda handlers, a React/TypeScript frontend, and a comprehensive test suite (Jest unit tests + fast-check property-based tests covering all 12 correctness properties).

---

## Tasks

- [x] 1. Scaffold monorepo structure and shared TypeScript configuration
  - Create the root directory layout: `infra/` (CDK app), `backend/` (Lambda functions), `frontend/` (React app), `shared/` (types shared between backend and frontend)
  - Add root `package.json` with workspaces pointing to `infra`, `backend`, `frontend`, `shared`
  - Add root `tsconfig.base.json` with strict mode, `target: ES2022`, `module: Node16`; each sub-package extends it
  - Add root `.eslintrc.js` and `.prettierrc` consistent across all packages
  - Add `.gitignore` covering `node_modules`, CDK `cdk.out`, Lambda build artifacts, `.env` files
  - _Requirements: 13.1, 13.2, 13.3_

- [x] 2. Define shared TypeScript types
  - [x] 2.1 Create `shared/src/types.ts` with all shared interfaces: `DocumentRecord`, `ChatRecord`, `Citation`, `ChunkMetadata`, `DocumentStatus` union type, `ApiResponse<T>`, `ErrorResponse`
    - Align types exactly with the data models section of the design document
    - Export every type; this package has no runtime dependencies
    - _Requirements: 3.6, 4.6, 8.1, 8.2, 9.1_
  - [x] 2.2 Create `shared/src/constants.ts` with string literals for DynamoDB key prefixes (`USER#`, `DOC#`, `CHAT#`), supported MIME types, max file size (20 971 520 bytes), default similarity threshold (0.5), chunk size (1000), overlap (200)
    - _Requirements: 3.1, 3.2, 4.5, 7.1_

- [x] 3. Set up CDK application skeleton and core stack
  - [x] 3.1 Initialise `infra/` as a CDK TypeScript app (`cdk init app --language typescript`); configure `cdk.json`; add `infra/tsconfig.json` extending root
    - _Requirements: 13.1, 13.3_
  - [x] 3.2 Create `infra/lib/docuquery-stack.ts` as the single CDK stack class; add CDK context parameters: `awsRegion`, `awsAccountId`, `allowedOrigins`, `environment` (dev/prod)
    - Stack constructor must accept a `props` interface that exposes those parameters — no hard-coded values
    - _Requirements: 13.1, 13.2_
  - [x] 3.3 Add CDK snapshot tests in `infra/test/docuquery-stack.test.ts` using `@aws-cdk/assertions`; assert that the stack synthesises without errors; add placeholder assertions for resource counts to be tightened in later tasks
    - _Requirements: 13.4_

- [ ] 4. Define DynamoDB table in CDK
  - [-] 4.1 Add `DocuQueryTable` to the CDK stack: `billingMode: PAY_PER_REQUEST`, `partitionKey: { name: 'PK', type: AttributeType.STRING }`, `sortKey: { name: 'SK', type: AttributeType.STRING }`, `encryption: TableEncryption.AWS_MANAGED`
    - Add the `userId-createdAt-index` GSI with `PK: userId (String)`, `SK: createdAt (String)`
    - _Requirements: 10.3, 13.1, 13.3_
  - [ ] 4.2 Update CDK snapshot test: assert DynamoDB table has `SSESpecification.SSEEnabled: true`, has `BillingMode: PAY_PER_REQUEST`, and the GSI is present
    - _Requirements: 10.3, 13.4_

- [ ] 5. Define S3 document store in CDK
  - [-] 5.1 Add `DocumentStoreBucket` to the CDK stack: `encryption: BucketEncryption.S3_MANAGED`, `blockPublicAccess: BlockPublicAccess.BLOCK_ALL`, `versioned: false`; configure CORS to allow PUT from Amplify origin
    - _Requirements: 10.1, 10.6, 13.1, 13.3_
  - [ ] 5.2 Update CDK snapshot test: assert bucket has `BlockPublicAcls: true`, `BlockPublicPolicy: true`, and `ServerSideEncryptionConfiguration` with `AES256`
    - _Requirements: 10.1, 10.6, 13.4_

- [ ] 6. Define Amazon Cognito user pool and identity pool in CDK
  - [-] 6.1 Add `DocuQueryUserPool` to the CDK stack: self-service sign-up enabled; email verification required; password policy: min 8 chars, uppercase, lowercase, digit, symbol; account lockout: 5 failed attempts → 30-minute lock; token validity: access token 15 min, refresh token 7 days
    - Add `DocuQueryUserPoolClient` with `authFlows` including `USER_PASSWORD_AUTH` and `USER_SRP_AUTH`
    - _Requirements: 1.1, 1.4, 2.1, 2.7_
  - [ ] 6.2 Add `DocuQueryIdentityPool` linked to the User Pool client
    - _Requirements: 2.1, 2.3_

- [ ] 7. Set up Lambda build configuration and shared Lambda layer
  - [ ] 7.1 Configure `backend/` as a TypeScript project; add `esbuild` (or `tsc` + bundler script) to produce per-function bundles under `backend/dist/`; each function's entry point is `backend/src/{name}/handler.ts`
    - _Requirements: 13.1_
  - [ ] 7.2 Create `backend/src/lib/logger.ts`: a structured JSON logger that emits a single CloudWatch log line per invocation containing `timestamp`, `functionName`, `userId`, `operationType`, `durationMs`, `outcome`, and optionally `correlationId` and `errorMessage`
    - Logger must never log raw PII — `userId` is passed through as-is (a Cognito sub UUID, not an email)
    - _Requirements: 12.1, 12.2, 11.6_
  - [ ] 7.3 Create `backend/src/lib/errors.ts`: define `AppError` base class and typed subclasses (`ValidationError`, `NotFoundError`, `ForbiddenError`, `TimeoutError`); each carries an HTTP status code and `correlationId`
    - _Requirements: 11.1–11.6_
  - [ ] 7.4 Create `backend/src/lib/middleware.ts`: a thin wrapper that wraps Lambda handler functions with: correlation ID generation (UUID v4), structured logging on entry/exit, `try/catch` that maps `AppError` subclasses to correct HTTP responses and unknown errors to HTTP 500
    - _Requirements: 12.1, 12.2, 11.6_

- [ ] 8. Implement `upload-url-fn` Lambda
  - [ ] 8.1 Create `backend/src/upload-url/handler.ts`: validate `contentType` against allowed MIME types and `fileSizeBytes` ≤ 20 971 520; generate UUID `documentId`; construct S3 key `USER#{userId}/DOC#{documentId}/{sanitisedFileName}`; call `s3.getSignedUrl('putObject', ...)` with 15-minute expiry; write DynamoDB record (`PK=USER#{userId}`, `SK=DOC#{documentId}`, `status=uploaded`, `createdAt`, `fileName`, `fileSizeBytes`); return `{ uploadUrl, documentId, expiresIn: 900 }`
    - Extract `userId` from the API Gateway JWT authorizer context (`event.requestContext.authorizer.claims.sub`)
    - _Requirements: 3.1, 3.2, 3.5, 3.6, 3.10, 10.7_
  - [ ] 8.2 Add `upload-url-fn` to the CDK stack: `NodejsFunction`, runtime `NODEJS_20_X`, handler points to bundled artifact; create a dedicated IAM execution role with `s3:PutObject` scoped to `DocumentStoreBucket/{userId}/*` and `dynamodb:PutItem` scoped to `DocuQueryTable` ARN; attach CloudWatch log group with 30-day retention
    - _Requirements: 10.4, 12.3, 13.3_
  - [ ] 8.3 Add API Gateway `POST /documents/upload-url` resource with Cognito JWT authorizer pointing to `upload-url-fn`
    - _Requirements: 3.5, 2.6_
  - [ ]* 8.4 Write Jest unit tests for `upload-url-fn`: valid upload → 200 with uploadUrl and documentId; unsupported MIME type → 400; file exceeds 20 MB → 400; S3 pre-signed URL generation mocked via `aws-sdk-client-mock`; DynamoDB PutItem called with `status=uploaded`; cross-user key isolation verified
    - _Requirements: 3.1, 3.2, 3.5, 3.6, 13.4_

- [ ] 9. Implement `ingest-fn` Lambda (ingestion pipeline)
  - [ ] 9.1 Create `backend/src/ingest/extract.ts`: implement `extractText(s3Key, fileBytes, contentType)` — for TXT: decode UTF-8; for DOCX: use `mammoth` to extract plain text preserving paragraph newlines; for PDF: attempt pdf-parse text layer extraction, if result is empty string invoke Amazon Textract `StartDocumentTextDetection` and poll `GetDocumentTextDetection` until `SUCCEEDED`; return extracted string
    - Install `mammoth` and `pdf-parse` (pinned versions)
    - _Requirements: 4.3, 4.4, 14.1, 14.3, 14.4_
  - [ ] 9.2 Create `backend/src/ingest/chunker.ts`: implement `chunkText(text: string): string[]` using `js-tiktoken` with `cl100k_base` encoding; produce chunks of at most 1 000 tokens with 200-token overlap between consecutive chunks; return array of chunk strings
    - Install `js-tiktoken` (pinned version)
    - _Requirements: 4.5_
  - [ ] 9.3 Create `backend/src/ingest/handler.ts`: parse `userId` and `documentId` from S3 object key; update DynamoDB `status = processing`; call `extractText`; if empty string → set `status = failed`, log to CloudWatch, return; call `chunkText`; for each chunk call Bedrock `InvokeModel` (Titan Embeddings V2) to generate embedding; store chunks via Bedrock KB `StartIngestionJob` with metadata `{ documentId, documentName, userId, pageNumber, chunkIndex, sourceFormat }`; update DynamoDB `status = ready`, `chunkCount`; on any error → call compensating rollback (KB `DeleteDocument` for this `documentId`), set `status = failed`, log with correlation ID; do not rethrow (retry count = 0)
    - _Requirements: 4.1, 4.2, 4.6, 4.7, 4.8, 4.9, 4.10_
  - [ ] 9.4 Add `ingest-fn` to the CDK stack: S3 event notification (`ObjectCreated`) on `DocumentStoreBucket` triggers `ingest-fn`; set `MaximumRetryAttempts: 0`; dedicated IAM role with `s3:GetObject` scoped to bucket, `dynamodb:UpdateItem` scoped to table, `bedrock:InvokeModel` scoped to Titan Embeddings model ARN, `bedrock:StartIngestionJob` + `bedrock:DeleteDocument` scoped to Knowledge Base ARN, `textract:StartDocumentTextDetection` + `textract:GetDocumentTextDetection`, CloudWatch log group 30-day retention
    - _Requirements: 4.1, 10.4, 12.3, 13.3_
  - [ ]* 9.5 Write Jest unit tests for `ingest-fn` / `extract.ts` / `chunker.ts`: status=processing set before extraction; TXT/DOCX files do not invoke Textract mock; scanned PDF invokes Textract mock; empty extraction → status=failed, no KB call; successful pipeline → status=ready, `chunkCount` matches chunk array length; failure mid-pipeline → KB DeleteDocument called, status=failed
    - _Requirements: 4.2, 4.3, 4.4, 4.7, 4.8, 4.9, 13.4_

- [ ] 10. Implement `documents-fn` Lambda (list + delete)
  - [ ] 10.1 Create `backend/src/documents/handler.ts`:
    - **GET /documents**: query DynamoDB `PK=USER#{userId}`, `SK begins_with DOC#`; map items to `{ documentId, fileName, fileSizeBytes, status, createdAt }`; return array
    - **DELETE /documents/{documentId}**: fetch document record; if `userId` ≠ caller's sub → return 403; delete S3 object (`DeleteObjectCommand`); call Bedrock KB `DeleteDocument` to remove all chunks; delete DynamoDB record; if any step fails → halt, preserve state, return HTTP 500 with correlationId
    - Add handler for `PATCH /documents/{documentId}/status` to allow the browser to set `status=failed` when a direct S3 PUT fails
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 3.8, 3.9_
  - [ ] 10.2 Add `documents-fn` to the CDK stack with API Gateway routes `GET /documents`, `DELETE /documents/{documentId}`, `PATCH /documents/{documentId}/status`; dedicated IAM role scoped to `s3:DeleteObject` on bucket, `dynamodb:Query` + `dynamodb:DeleteItem` + `dynamodb:UpdateItem` on table, `bedrock:DeleteDocument` on KB ARN
    - _Requirements: 10.4, 13.3_
  - [ ]* 10.3 Write Jest unit tests for `documents-fn`: GET returns only caller's records; cross-user DELETE → 403; successful DELETE cascade — S3, KB, and DynamoDB mocks each called once; S3 deletion failure → 500, KB and DynamoDB mocks not called; KB deletion failure → 500, DynamoDB mock not called; PATCH status update persists correctly
    - _Requirements: 5.1, 5.3, 5.5, 5.6, 13.4_

- [ ] 11. Implement `query-fn` Lambda (RAG query engine)
  - [ ] 11.1 Create `backend/src/query/handler.ts`:
    - Check DynamoDB for any document with `status=ready` for this user; if none → return `{ answer: 'No documents are currently available to query. Please upload and process a document first.', citations: [], isFallback: true }` without invoking Bedrock
    - Generate question embedding via Bedrock Titan Embeddings V2 (`InvokeModel`)
    - Call Bedrock KB `Retrieve` with `{ filter: { userId }, numberOfResults: 5 }`; receive chunks + relevance scores
    - If all scores < `SIMILARITY_THRESHOLD` env var (default 0.5) or zero chunks → return fallback `{ answer: 'I could not find the answer in your documents.', citations: [], isFallback: true }` without calling Claude
    - Construct prompt: system message with grounding + fallback instructions (verbatim from design); user message with `<passages>{chunks}</passages>\n\nQuestion: {question}`
    - Call Bedrock `InvokeModel` (Claude 3 Haiku) with 10-second `AbortController` timeout; if timeout → return HTTP 504
    - Assemble `citations`: one per retrieved chunk — `{ documentId, documentName, pageNumber: chunk.metadata.pageNumber ?? 'N/A', passageText: chunk.content, relevanceScore }`
    - Persist chat record to DynamoDB: `PK=USER#{userId}`, `SK=CHAT#{sessionId}#{ISO-timestamp}`, `question`, `answer`, `citations`, `isFallback`, `createdAt`
    - Return `{ answer, citations, sessionId }`
    - _Requirements: 6.1–6.7, 7.1–7.5, 8.1, 8.2, 9.1, 9.5, 11.2_
  - [ ] 11.2 Add `query-fn` to the CDK stack with API Gateway route `POST /query`; dedicated IAM role with `dynamodb:Query` + `dynamodb:PutItem` on table, `bedrock:InvokeModel` scoped to Titan and Claude model ARNs, `bedrock:Retrieve` scoped to KB ARN
    - _Requirements: 10.4, 13.3_
  - [ ]* 11.3 Write Jest unit tests for `query-fn`: no ready documents → informational message, no Bedrock call; all chunks below threshold → fallback + `isFallback: true`, Claude mock not called; successful answer → citations assembled correctly, chat record persisted; Bedrock InvokeModel timeout → 504; 502 on Bedrock service error; chat record includes `isFallback: false` for real answers
    - _Requirements: 6.1, 6.3, 6.7, 7.1, 7.4, 7.5, 8.1, 9.1, 13.4_

- [ ] 12. Implement `history-fn` Lambda
  - [ ] 12.1 Create `backend/src/history/handler.ts`: query DynamoDB `PK=USER#{userId}`, `SK begins_with CHAT#`, `ScanIndexForward=false`, `Limit=50`; map items to `ChatRecord[]`; if DynamoDB unavailable → return HTTP 500 (frontend handles gracefully)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  - [ ] 12.2 Add `history-fn` to the CDK stack with API Gateway route `GET /history`; dedicated IAM role with `dynamodb:Query` scoped to table ARN
    - _Requirements: 10.4, 13.3_
  - [ ]* 12.3 Write Jest unit tests for `history-fn`: returns at most 50 records; returns records in descending order; returns only caller's records; DynamoDB unavailable (mock throws) → HTTP 500
    - _Requirements: 9.2, 9.4, 9.5, 13.4_

- [ ] 13. Checkpoint — Backend Lambda unit tests passing
  - Ensure all Jest unit tests pass (`npm test --workspace=backend`)
  - Ensure Lambda bundles compile without TypeScript errors (`tsc --noEmit`)
  - Ask the user if any questions arise before proceeding to frontend work.

- [ ] 14. Scaffold React + TypeScript frontend
  - [ ] 14.1 Initialise `frontend/` with Vite + React + TypeScript template; add `frontend/tsconfig.json` extending root; configure path aliases for `shared` types
    - Install and pin: `aws-amplify`, `@aws-amplify/ui-react`, `axios`, `react-router-dom`
    - _Requirements: 2.6, 13.1_
  - [ ] 14.2 Create `frontend/src/amplifyConfigure.ts`: read Cognito User Pool ID, App Client ID, API Gateway URL, and S3 bucket name from Vite env variables (`import.meta.env.VITE_*`); call `Amplify.configure(...)` — no secrets in source code
    - _Requirements: 10.7, 13.2_
  - [ ] 14.3 Create `frontend/src/components/ErrorBoundary.tsx`: class component that catches render errors and displays a user-friendly fallback; used as wrapper around all route-level components
    - _Requirements: 11.5_
  - [ ] 14.4 Create `frontend/src/components/ProtectedRoute.tsx`: reads auth state from Amplify; redirects unauthenticated users to `/signin`; renders `<Outlet />` for authenticated users
    - _Requirements: 2.6_

- [ ] 15. Implement authentication UI flows
  - [ ] 15.1 Create `frontend/src/pages/SignUpPage.tsx`: registration form with email + password fields; client-side validation (RFC 5322 email, password complexity rules); calls `Auth.signUp`; on success navigates to `/verify`
    - Display field-level error messages for complexity failures (per requirement 1.4)
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [ ] 15.2 Create `frontend/src/pages/VerifyPage.tsx`: verification code input; calls `Auth.confirmSignUp`; on success navigates to `/signin`; handles expired/incorrect code error with a retry option; tracks resend attempts (max 3); calls `Auth.resendSignUp` for resend
    - _Requirements: 1.5, 1.6_
  - [ ] 15.3 Create `frontend/src/pages/SignInPage.tsx`: sign-in form; calls `Auth.signIn`; on success navigates to `/`; displays generic "Authentication failed" message on wrong credentials (does not reveal which field is wrong); displays "Account temporarily locked" message on lockout error
    - _Requirements: 2.1, 2.2, 2.7_
  - [ ] 15.4 Wire Amplify Hub to listen for `tokenRefresh` and `tokenRefresh_failure` events in `frontend/src/hooks/useAuthSession.ts`; on `tokenRefresh_failure` redirect to `/signin`; expose `signOut` handler that calls `Auth.signOut` and redirects to `/signin`
    - _Requirements: 2.3, 2.4, 2.5_
  - [ ] 15.5 Set up `frontend/src/App.tsx` with React Router v6 routes: `/signin`, `/signup`, `/verify`, and `/*` wrapped in `<ProtectedRoute>`; include `<ErrorBoundary>` at the root
    - _Requirements: 2.6, 11.5_

- [ ] 16. Implement document management UI
  - [ ] 16.1 Create `frontend/src/api/documentsApi.ts`: typed API client functions `requestUploadUrl`, `listDocuments`, `deleteDocument`, `patchDocumentStatus` — each attaches the Cognito JWT from `Auth.currentSession()` as `Authorization: Bearer {accessToken}`; handle 401 → redirect to `/signin`; handle network errors → throw `ConnectionError`
    - _Requirements: 2.3, 11.3, 11.5_
  - [ ] 16.2 Create `frontend/src/components/UploadZone.tsx`: drag-and-drop and file-picker input; client-side validation — reject non-PDF/DOCX/TXT with an error message listing accepted formats; reject files > 20 MB with a size error message; on valid file call `requestUploadUrl` then upload directly via `XMLHttpRequest` to the pre-signed URL; fire `upload.onprogress` events to update a `0–100%` progress bar; on XHR success notify parent; on XHR failure call `patchDocumentStatus(documentId, 'failed')` and display error
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 3.8_
  - [ ] 16.3 Create `frontend/src/pages/DocumentsPage.tsx`: fetch document list on mount via `listDocuments`; poll every 3 seconds while any document has status `uploaded` or `processing`; display each document's name, upload timestamp, human-formatted file size (B/KB/MB/GB), and status badge; show "Processing failed — please retry" message for failed documents; delete button calls `deleteDocument` then removes the item from the list without full reload; display error message if delete fails
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 11.1_

- [ ] 17. Implement chat interface UI
  - [ ] 17.1 Create `frontend/src/api/queryApi.ts` and `frontend/src/api/historyApi.ts`: typed API client functions `sendQuery` and `getChatHistory`, each with JWT attachment and error handling (502 → retry message, 504 → timeout message, network error → connection error, 401 → redirect)
    - _Requirements: 6.3, 6.7, 11.2, 11.3, 11.5_
  - [ ] 17.2 Create `frontend/src/components/CitationPanel.tsx`: expandable panel (initially collapsed); props `citations: Citation[]`; renders numbered citation list showing `documentName` and `pageNumber`; clicking a citation expands to show full `passageText` without navigating away from chat view; fallback responses must not render the panel (conditional on `citations.length > 0`)
    - _Requirements: 6.5, 6.6, 7.3, 7.4, 8.2, 8.3, 8.4_
  - [ ] 17.3 Create `frontend/src/pages/ChatPage.tsx`: question input with submit button; on submit calls `sendQuery`; while waiting display loading indicator; on success render answer text and `<CitationPanel citations={response.citations} />`; on fallback response render fallback message prominently with no citation panel; on 504 display timeout retry message; on 502 display service error retry message; on network error display connection error without blank screen
    - _Requirements: 6.3, 6.5, 6.7, 7.3, 7.4, 11.2, 11.5_
  - [ ] 17.4 Create `frontend/src/pages/HistoryPage.tsx`: on mount call `getChatHistory`; render up to 50 entries in reverse-chronological order; each entry shows question, answer, and `<CitationPanel>` with stored citations in same format as live answers; if history load fails display error message and keep chat interface functional
    - _Requirements: 9.2, 9.3, 9.5_

- [ ] 18. Checkpoint — Frontend compiles and auth flows connect to Cognito
  - Ensure `npm run build --workspace=frontend` produces no TypeScript or lint errors
  - Verify Amplify auth forms render correctly and connect to the deployed Cognito user pool in a dev environment
  - Ask the user if any questions arise before proceeding to property-based tests.

- [ ] 19. Implement property-based tests (fast-check) — ingestion properties
  - [ ] 19.1 Create `backend/test/properties/p1-txt-round-trip.test.ts`: use `fc.string()` as generator; assert `parse(serialize(parse(input))) === parse(input)` for the TXT extractor; annotate `// Feature: docuquery-rag-assistant, Property 1: TXT Round-Trip Fidelity`; run ≥ 100 iterations
    - **Property 1: TXT Round-Trip Fidelity**
    - **Validates: Requirements 14.2**
  - [ ] 19.2 Create `backend/test/properties/p2-chunking-completeness.test.ts`: use `fc.string({ minLength: 1 })` as generator; tokenize input with `js-tiktoken cl100k_base`; assert that the multiset of all tokens in the chunks union equals the multiset of tokens in the input (accounting for 200-token overlap — tokens in overlap appear in two consecutive chunks); annotate `// Feature: docuquery-rag-assistant, Property 2: Chunking Completeness`; run ≥ 100 iterations
    - **Property 2: Chunking Completeness**
    - **Validates: Requirements 4.5**
  - [ ] 19.3 Create `backend/test/properties/p3-chunking-size-bound.test.ts`: use `fc.string()` of varying lengths as generator; assert every chunk ≤ 1 000 tokens; assert consecutive chunk pairs share overlap of 200 ± 1 tokens; annotate `// Feature: docuquery-rag-assistant, Property 3: Chunking Size Bound`; run ≥ 100 iterations
    - **Property 3: Chunking Size Bound**
    - **Validates: Requirements 4.5**
  - [ ] 19.4 Create `backend/test/properties/p4-docx-paragraph-boundaries.test.ts`: use `fc.array(fc.string({ minLength: 1 }), { minLength: 2 })` for a list of paragraph strings; build an in-memory DOCX buffer using `docx` package; pass to `extractText`; assert extracted text contains `\n` between each consecutive paragraph pair; annotate `// Feature: docuquery-rag-assistant, Property 4: DOCX Paragraph Boundary Preservation`; run ≥ 100 iterations
    - **Property 4: DOCX Paragraph Boundary Preservation**
    - **Validates: Requirements 14.3**
  - [ ] 19.5 Create `backend/test/properties/p10-ingestion-determinism.test.ts`: use `fc.uint8Array()` as generator for arbitrary TXT and DOCX byte inputs; call `extractText` twice on the same byte-identical input; assert both results are strictly equal; annotate `// Feature: docuquery-rag-assistant, Property 10: Ingestion Determinism`; run ≥ 100 iterations
    - **Property 10: Ingestion Determinism**
    - **Validates: Requirements 14.1**

- [ ] 20. Implement property-based tests (fast-check) — query and isolation properties
  - [ ] 20.1 Create `backend/test/properties/p5-per-user-isolation.test.ts`: use `fc.uuid()` × 2 for `userA`/`userB`, `fc.record({ documentId: fc.uuid(), userId: fc.constant(userA) })` for a document; call the ownership-check function directly; assert that when `callerUserId !== document.userId` the result is HTTP 403 and no document data is included in the response; annotate `// Feature: docuquery-rag-assistant, Property 5: Per-User Data Isolation`; run ≥ 100 iterations
    - **Property 5: Per-User Data Isolation**
    - **Validates: Requirements 5.6, 9.4, 10.4**
  - [ ] 20.2 Create `backend/test/properties/p6-fallback-threshold.test.ts`: use `fc.array(fc.float({ min: 0, max: 0.49 }), { minLength: 0, maxLength: 5 })` for chunk scores; mock Bedrock KB Retrieve to return chunks with those scores; mock Bedrock InvokeModel (Claude) to record if called; assert `isFallback === true`, `citations` is empty, and Claude mock was never invoked; annotate `// Feature: docuquery-rag-assistant, Property 6: Fallback When No Chunks Satisfy Threshold`; run ≥ 100 iterations
    - **Property 6: Fallback When No Chunks Satisfy Threshold**
    - **Validates: Requirements 7.1, 7.4**
  - [ ] 20.3 Create `backend/test/properties/p7-citation-completeness.test.ts`: use `fc.array(fc.record({ documentId: fc.uuid(), documentName: fc.string({ minLength: 1 }), pageNumber: fc.oneof(fc.integer({ min: 1 }), fc.constant(null)), passageText: fc.string({ minLength: 1 }) }), { minLength: 1, maxLength: 5 })` for retrieved chunks with scores ≥ 0.5; assert `citations.length === chunks.length`; assert every citation has non-empty `documentName`, `passageText`, and `pageNumber` is either a positive integer or `'N/A'`; annotate `// Feature: docuquery-rag-assistant, Property 7: Citation Completeness for Non-Fallback Answers`; run ≥ 100 iterations
    - **Property 7: Citation Completeness for Non-Fallback Answers**
    - **Validates: Requirements 8.1, 8.2**
  - [ ] 20.4 Create `backend/test/properties/p8-status-monotonicity.test.ts`: use `fc.constantFrom` to enumerate all backward transitions (`ready → processing`, `ready → uploaded`, `failed → processing`, `failed → uploaded`, `processing → uploaded`); call the status-transition guard function with each invalid transition; assert all are rejected (throw or return false); assert all forward transitions (`uploaded → processing`, `processing → ready`, `processing → failed`, `uploaded → failed`) are accepted; annotate `// Feature: docuquery-rag-assistant, Property 8: Document Status Monotonicity`; run ≥ 100 iterations
    - **Property 8: Document Status Monotonicity**
    - **Validates: Requirements 4.2, 4.7, 4.8, 3.6**
  - [ ] 20.5 Create `backend/test/properties/p9-empty-input-rejection.test.ts`: pass empty string `""` to `ingest-fn`'s post-extraction step; assert DynamoDB UpdateItem called with `status=failed`; assert Bedrock KB `StartIngestionJob` mock never called; annotate `// Feature: docuquery-rag-assistant, Property 9: Empty-Input Rejection`; 1 iteration (edge case)
    - **Property 9: Empty-Input Rejection**
    - **Validates: Requirements 4.9, 14.4**
  - [ ] 20.6 Create `backend/test/properties/p11-prompt-instruction-inclusion.test.ts`: use `fc.string()` for question, `fc.array(fc.record({ content: fc.string({ minLength: 1 }), score: fc.float({ min: 0.5, max: 1.0 }) }), { minLength: 1, maxLength: 5 })` for chunks; call `buildPrompt(question, chunks)`; assert the returned system message string contains both required substrings: (a) "answer only from the provided" (or equivalent grounding instruction), (b) "I could not find the answer in your documents" (fallback instruction); annotate `// Feature: docuquery-rag-assistant, Property 11: Prompt System Instruction Inclusion`; run ≥ 100 iterations
    - **Property 11: Prompt System Instruction Inclusion**
    - **Validates: Requirements 6.4, 7.2**
  - [ ] 20.7 Create `backend/test/properties/p12-structured-log-completeness.test.ts`: use `fc.record({ functionName: fc.string({ minLength: 1 }), userId: fc.uuid(), operationType: fc.string({ minLength: 1 }), durationMs: fc.nat(), outcome: fc.oneof(fc.constant('success'), fc.string({ minLength: 1 })) })` for invocation parameters; call `logger.emit(params)`; parse the JSON output; assert all 6 required fields are present and non-empty (`timestamp`, `functionName`, `userId`, `operationType`, `durationMs`, `outcome`); annotate `// Feature: docuquery-rag-assistant, Property 12: Structured Log Completeness`; run ≥ 100 iterations
    - **Property 12: Structured Log Completeness**
    - **Validates: Requirements 12.1**

- [ ] 21. Complete CDK snapshot tests and IAM least-privilege assertions
  - [ ] 21.1 Update `infra/test/docuquery-stack.test.ts`: assert each Lambda execution role contains only explicit IAM actions (no `*`); assert each role's resource ARNs reference specific resource ARNs (no `*` in resource fields); assert `ingest-fn` S3 event source has `MaximumRetryAttempts: 0`; assert API Gateway Cognito authorizer is attached to all five routes
    - _Requirements: 10.4, 13.4_
  - [ ] 21.2 Update CDK snapshot test: assert all five Lambda log groups have `RetentionInDays: 30`; assert S3 CORS configuration restricts allowed origins to the `allowedOrigins` CDK parameter value
    - _Requirements: 12.3, 10.5, 13.4_
  - [ ] 21.3 Add CDK stack parameterisation: add an `allowedOrigins` stack parameter read from CDK context; pass it to the S3 CORS rule and API Gateway CORS configuration so the same stack definition deploys to dev and prod without source-code changes
    - _Requirements: 13.2_

- [ ] 22. Configure Amplify hosting and deployment pipeline in CDK
  - [ ] 22.1 Add AWS Amplify app construct to the CDK stack: set the repository and branch (via CDK context parameters `repoUrl` and `branch`); configure build spec to run `npm ci && npm run build --workspace=frontend` and output `frontend/dist`; wire Amplify environment variables (`VITE_USER_POOL_ID`, `VITE_APP_CLIENT_ID`, `VITE_API_URL`, `VITE_BUCKET_NAME`) from CDK-resolved resource ARNs/URLs
    - _Requirements: 13.1, 13.2_
  - [ ] 22.2 Add CDK outputs for all values the frontend needs: `UserPoolId`, `UserPoolClientId`, `ApiGatewayUrl`, `DocumentBucketName`, `IdentityPoolId`; these outputs are used by the Amplify build environment and for local development `.env` files (which must never be committed)
    - _Requirements: 13.2, 10.7_

- [ ] 23. Final checkpoint — all tests pass and stack synthesises
  - Run `npm test --workspace=backend` — all Jest unit tests and fast-check property tests must pass (0 failures)
  - Run `npm test --workspace=infra` — all CDK snapshot and IAM assertion tests must pass
  - Run `npx cdk synth` — CDK stack must synthesise without errors or warnings
  - Run `npm run build --workspace=frontend` — frontend must compile without TypeScript errors
  - Ask the user if any questions arise before initiating a deployment.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP, but all 12 property-based tests are strongly recommended before production deployment
- Each task references specific requirements for full traceability
- Checkpoints (tasks 13, 18, 23) are mandatory pause-points to validate incremental progress before continuing
- The `shared/` package must be built before `backend/` or `frontend/` — ensure workspace dependency order is reflected in the root `package.json`
- All AWS SDK calls use **AWS SDK for JavaScript v3** (`@aws-sdk/*`) — do NOT use v2 (`aws-sdk`)
- `ingest-fn` retry count is 0 to prevent double-indexing; the compensating rollback in task 9.3 is the sole recovery mechanism
- The `SIMILARITY_THRESHOLD` default (0.5) is set as a Lambda environment variable so it can be tuned per environment without code changes
- Property tests P9 is a fixed edge-case test (1 iteration) — the `*` optional marker still applies but the test itself is trivial to run
- CDK context parameters (`cdk.json` or `--context` CLI flag) drive all environment-specific values; no source-code changes are needed between dev and prod deployments

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["2.1", "2.2", "3.1"] },
    { "id": 1, "tasks": ["3.2", "3.3"] },
    { "id": 2, "tasks": ["4.1", "5.1", "6.1", "7.1"] },
    { "id": 3, "tasks": ["4.2", "5.2", "6.2", "7.2", "7.3", "7.4"] },
    { "id": 4, "tasks": ["8.1", "9.1", "9.2", "10.1", "11.1", "12.1", "14.1"] },
    { "id": 5, "tasks": ["8.2", "8.3", "9.3", "10.2", "11.2", "12.2", "14.2", "14.3", "14.4"] },
    { "id": 6, "tasks": ["8.4", "9.4", "10.3", "11.3", "12.3", "15.1", "15.2"] },
    { "id": 7, "tasks": ["9.5", "15.3", "15.4", "15.5", "16.1"] },
    { "id": 8, "tasks": ["16.2", "16.3", "17.1"] },
    { "id": 9, "tasks": ["17.2", "17.3", "17.4"] },
    { "id": 10, "tasks": ["19.1", "19.2", "19.3", "19.4", "19.5", "20.1", "20.2", "20.3", "20.4", "20.5", "20.6", "20.7"] },
    { "id": 11, "tasks": ["21.1", "21.2", "21.3"] },
    { "id": 12, "tasks": ["22.1", "22.2"] }
  ]
}
```
