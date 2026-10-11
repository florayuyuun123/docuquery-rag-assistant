# Requirements Document

## Introduction

DocuQuery is a serverless web application that enables employees and students to upload their own documents and ask natural-language questions answered exclusively from the content of those documents. The system uses a Retrieval-Augmented Generation (RAG) pipeline backed by AWS managed services: documents are stored in Amazon S3, text is extracted via Amazon Textract, embeddings are generated and answers are synthesized via Amazon Bedrock, and vector storage uses Amazon Bedrock Knowledge Bases with S3 Vectors. Authentication is managed by Amazon Cognito. The frontend is a React/TypeScript single-page application hosted on AWS Amplify; the backend runs on AWS Lambda behind Amazon API Gateway; metadata and chat history are stored in Amazon DynamoDB. Infrastructure is defined with AWS CDK in TypeScript. The project is cost-conscious and serverless-first.

---

## Glossary

- **System**: The DocuQuery web application as a whole.
- **User**: An authenticated human interacting with the System via a web browser.
- **Auth_Service**: The Amazon Cognito user pool and identity pool that handle sign-up, sign-in, and token issuance.
- **Document_Store**: The Amazon S3 bucket that holds raw uploaded files, partitioned by User ID.
- **Ingestion_Pipeline**: The set of AWS Lambda functions and Amazon Textract jobs that extract text, chunk it, generate embeddings via Amazon Bedrock, and index chunks into the Knowledge_Base.
- **Knowledge_Base**: The Amazon Bedrock Knowledge Base backed by S3 Vectors that stores chunk embeddings and metadata.
- **Query_Engine**: The AWS Lambda function that receives a question, retrieves relevant chunks from the Knowledge_Base, and calls an Amazon Bedrock Claude model to generate a grounded answer.
- **Metadata_Store**: The Amazon DynamoDB table that stores document records (name, owner, status, timestamps) and chat-session records.
- **API**: The Amazon API Gateway REST API that exposes backend endpoints to the frontend.
- **Frontend**: The React/TypeScript single-page application hosted on AWS Amplify.
- **CDK_Stack**: The AWS CDK TypeScript application that defines all infrastructure resources.
- **Chunk**: A contiguous passage of text extracted from a document, stored with metadata (document ID, document name, page number, chunk index).
- **Citation**: A reference attached to an answer that identifies the source document name, page number, and the supporting passage text.
- **Embedding**: A numerical vector representation of a Chunk produced by Amazon Bedrock.

---

## Requirements

### Requirement 1: User Registration

**User Story:** As a new visitor, I want to create an account, so that I can securely store and query my own documents.

#### Acceptance Criteria

1. THE Auth_Service SHALL support self-service account registration using an email address and password.
2. WHEN a User submits a registration form with an email address in valid RFC 5322 format and no longer than 254 characters, and a password that meets the complexity rules defined in criterion 4, THE Auth_Service SHALL create a new pending user account and send a verification email to that address.
3. WHEN a User submits a registration form with an email address that matches an existing account, whether verified or pending verification, THE Auth_Service SHALL return an error message indicating the address is already in use.
4. WHEN a User submits a registration form with a password shorter than 8 characters or missing an uppercase letter, a lowercase letter, a digit, or a special character, THE Auth_Service SHALL return a descriptive validation error identifying the unmet rule.
5. WHEN a User submits an email verification code within 24 hours of its issuance, THE Auth_Service SHALL activate the account and redirect the User to the sign-in page.
6. IF a User submits an expired or incorrect verification code, THEN THE Auth_Service SHALL return an error message indicating the reason for rejection, invalidate the submitted code, and allow the User to request a new verification code up to a maximum of 3 resend attempts; WHEN a new verification code is issued, THE Auth_Service SHALL invalidate any previously issued code for that account.

---

### Requirement 2: User Authentication

**User Story:** As a registered user, I want to sign in and sign out, so that my documents and queries remain private.

#### Acceptance Criteria

1. WHEN a User submits valid credentials on the sign-in page, THE Auth_Service SHALL issue a JWT access token with a lifetime of 15 minutes and a refresh token with a lifetime of 7 days, and redirect the User to the application home page.
2. WHEN a User submits invalid credentials on the sign-in page, THE Auth_Service SHALL return an error message indicating authentication failed and SHALL NOT disclose which field (email or password) was incorrect.
3. WHEN a User's access token expires and the refresh token is still valid, THE Auth_Service SHALL automatically issue a new access token using the refresh token without requiring the User to sign in again.
4. IF a User's refresh token is expired or invalid, THEN THE Auth_Service SHALL invalidate the session and redirect the User to the sign-in page.
5. WHEN a User clicks the sign-out button, THE System SHALL invalidate the current session's access token and refresh token and redirect the User to the sign-in page.
6. WHILE a User is not authenticated, THE Frontend SHALL restrict access to all application routes and redirect the User to the sign-in page.
7. WHEN a User submits incorrect credentials 5 consecutive times within a 15-minute window, THE Auth_Service SHALL lock the account for 30 minutes and return an error message indicating the account is temporarily locked.

---

### Requirement 3: Document Upload

**User Story:** As an authenticated user, I want to upload documents, so that I can later query their content.

#### Acceptance Criteria

1. THE System SHALL accept document uploads in PDF, DOCX, and TXT formats only.
2. THE System SHALL accept document files up to 20 MB in size.
3. WHEN a User selects a file with an unsupported format, THE Frontend SHALL display an error message listing the supported formats (PDF, DOCX, TXT) before the upload begins.
4. WHEN a User selects a file exceeding 20 MB, THE Frontend SHALL display an error message stating the maximum allowed size before the upload begins.
5. WHEN a User initiates an upload of a valid file, THE API SHALL return a pre-signed S3 URL and THE Frontend SHALL upload the file directly to the Document_Store using that URL.
6. WHEN a file upload to the Document_Store completes successfully, THE System SHALL create a document record in the Metadata_Store with status "uploaded" and submit the document reference to the Ingestion_Pipeline for processing.
7. WHILE a document is being uploaded, THE Frontend SHALL display an upload progress indicator showing the percentage of data transferred (0–100%).
8. IF the upload to the Document_Store fails, THEN THE System SHALL set the document status to "failed" in the Metadata_Store and THE Frontend SHALL display an error message to the User.
9. IF a post-upload step (creating the Metadata_Store record or submitting to the Ingestion_Pipeline) fails, THEN THE System SHALL set the document status to "failed" in the Metadata_Store and THE Frontend SHALL display an error message to the User.
10. THE Document_Store SHALL store each uploaded file under a key prefixed with the authenticated User's unique identifier, so that files belonging to different users are logically separated.

---

### Requirement 4: Document Ingestion Pipeline

**User Story:** As an authenticated user, I want my uploaded documents to be automatically processed, so that I can query them as soon as they are ready.

#### Acceptance Criteria

1. WHEN a new file arrives in the Document_Store, THE Ingestion_Pipeline SHALL automatically begin text extraction without requiring manual intervention.
2. WHEN text extraction begins, THE Ingestion_Pipeline SHALL set the document status to "processing" in the Metadata_Store.
3. WHEN processing a PDF for which no selectable text layer is detected, THE Ingestion_Pipeline SHALL use Amazon Textract to perform OCR and extract the text content.
4. WHEN processing a DOCX or TXT file, THE Ingestion_Pipeline SHALL extract text without invoking Amazon Textract.
5. WHEN text extraction completes, THE Ingestion_Pipeline SHALL split the extracted text into Chunks not exceeding 1,000 tokens each, with an overlap of 200 tokens between consecutive Chunks.
6. WHEN Chunks are created, THE Ingestion_Pipeline SHALL generate an Embedding for each Chunk using Amazon Bedrock and store the Chunk text, Embedding, and metadata (document ID, document name, page number, chunk index) in the Knowledge_Base.
7. WHEN all Chunks have been indexed, THE Ingestion_Pipeline SHALL set the document status to "ready" in the Metadata_Store.
8. IF any step in the Ingestion_Pipeline fails, THEN THE Ingestion_Pipeline SHALL remove any Chunks already indexed for that document from the Knowledge_Base, set the document status to "failed" in the Metadata_Store, and log an error entry to Amazon CloudWatch that includes the failed step name and document ID.
9. IF text extraction produces an empty result (zero characters extracted), THEN THE Ingestion_Pipeline SHALL set the document status to "failed" in the Metadata_Store and log the empty-extraction event to Amazon CloudWatch, without proceeding to chunking or embedding.
10. THE Ingestion_Pipeline SHALL store each Chunk's metadata with the authenticated User's account ID so that retrieval is scoped to that User.

---

### Requirement 5: Document Management

**User Story:** As an authenticated user, I want to view and delete my documents, so that I can manage what the system can query.

#### Acceptance Criteria

1. WHEN a User navigates to the document list page, THE System SHALL retrieve and display only the document records owned by the authenticated User from the Metadata_Store.
2. WHEN a User navigates to the document list page, THE System SHALL display the name, upload timestamp, file size (in B, KB, MB, or GB as appropriate), and current status (uploaded, processing, ready, or failed) for each document.
3. WHEN a User requests deletion of a document, THE System SHALL delete the raw file from the Document_Store, remove all associated Chunks and Embeddings from the Knowledge_Base, and delete the document record from the Metadata_Store.
4. WHEN deletion completes successfully, THE Frontend SHALL remove the document from the displayed list without requiring a full page reload.
5. IF any step in the deletion sequence (Document_Store, Knowledge_Base, or Metadata_Store) fails, THEN THE System SHALL halt the deletion, preserve the document record and any remaining data in its pre-deletion state, return an error response to the Frontend, and THE Frontend SHALL display an error message to the User indicating that deletion failed.
6. IF a User attempts to access, query, or delete a document that belongs to a different user, THEN THE API SHALL return a 403 Forbidden response and SHALL NOT expose any information about that document.

---

### Requirement 6: Natural-Language Question Answering

**User Story:** As an authenticated user, I want to ask natural-language questions, so that I can get accurate answers grounded in my documents.

#### Acceptance Criteria

1. WHEN a User submits a question in the chat interface, THE Query_Engine SHALL retrieve the top-5 most semantically relevant Chunks from the Knowledge_Base scoped to the authenticated User's documents.
2. WHEN relevant Chunks are retrieved, THE Query_Engine SHALL construct a prompt containing only the retrieved Chunk texts and instruct the Amazon Bedrock Claude model to answer using exclusively that content.
3. WHEN the Claude model generates an answer, THE Query_Engine SHALL return the answer text and the list of Citations to the Frontend within 10 seconds of the User submitting the question under normal operating conditions.
4. THE Query_Engine SHALL include in the system prompt an explicit instruction that the model must not use knowledge outside the provided Chunks.
5. WHEN the answer is returned, THE Frontend SHALL display the answer text and each Citation (document name, page number) beneath the answer.
6. WHEN a User clicks on a Citation, THE Frontend SHALL display the supporting Chunk passage text in a readable panel.
7. IF the Query_Engine does not receive a response from Amazon Bedrock within 10 seconds, THEN THE Query_Engine SHALL return an HTTP 504 response and THE Frontend SHALL display a timeout message instructing the User to retry.

---

### Requirement 7: Fallback Behavior

**User Story:** As an authenticated user, I want to receive an honest response when my documents don't contain the answer, so that I don't act on fabricated information.

#### Acceptance Criteria

1. WHEN all retrieved Chunks have a relevance score below the configured similarity threshold, OR when zero Chunks are returned for a query, THE Query_Engine SHALL return a fallback response stating that the answer was not found in the provided documents and SHALL NOT include any speculative or supplemental content.
2. THE Query_Engine SHALL include in the system prompt an explicit instruction that the model must respond only with a fallback message stating the answer was not found when the Chunks do not support the question, without adding supplemental information from outside those Chunks.
3. WHEN a fallback response is returned, THE Frontend SHALL display the fallback message clearly and prominently.
4. WHEN a fallback response is returned, THE Frontend SHALL NOT display any Citations alongside the response.
5. IF no documents with status "ready" exist for the authenticated User, THEN THE Query_Engine SHALL return a message informing the User that no documents are available to query, without invoking the Amazon Bedrock Claude model.

---

### Requirement 8: Citations

**User Story:** As an authenticated user, I want every answer to reference its sources, so that I can verify the information.

#### Acceptance Criteria

1. THE Query_Engine SHALL attach a Citation to the answer for each Chunk used to generate that answer.
2. Each Citation SHALL include the source document name, the page number (or a "page N/A" indicator for TXT files that do not carry page metadata), and the verbatim Chunk passage text.
3. THE Frontend SHALL render Citations as numbered references linked to the corresponding passage.
4. WHEN a User expands a Citation, THE Frontend SHALL display the full Chunk passage text in a panel without navigating away from the chat view.
5. THE System SHALL preserve Citation data in the chat history record stored in the Metadata_Store.

---

### Requirement 9: Chat History

**User Story:** As an authenticated user, I want to review past conversations, so that I can reference previous answers without re-asking questions.

#### Acceptance Criteria

1. THE System SHALL store each question, answer, and associated Citations as a chat-session record in the Metadata_Store, keyed by the authenticated User's unique identifier and a session timestamp.
2. WHEN a User opens the chat interface, THE Frontend SHALL load and display the authenticated User's most recent 50 chat-session records in reverse-chronological order.
3. WHEN a User views a past conversation entry, THE Frontend SHALL render the stored Citations in the same format as a live answer.
4. THE System SHALL associate chat history exclusively with the authenticated User who created it, and SHALL NOT expose any user's chat history to another user.
5. IF the Metadata_Store is unavailable when loading chat history, THEN THE Frontend SHALL display an error message indicating that history could not be loaded, and the chat interface SHALL remain fully functional for new questions.

---

### Requirement 10: Security and Data Privacy

**User Story:** As an authenticated user, I want my documents and queries to be secure and private, so that sensitive information is not exposed.

#### Acceptance Criteria

1. THE Document_Store SHALL enforce server-side encryption at rest using AWS-managed keys (SSE-S3) for all stored files.
2. THE Knowledge_Base SHALL store Embeddings and Chunk metadata encrypted at rest using AWS-managed keys.
3. THE Metadata_Store SHALL enable DynamoDB encryption at rest using AWS-managed keys.
4. THE CDK_Stack SHALL configure each Lambda execution role with only the IAM actions required for that function's specific operations, and each role SHALL be scoped to only the specific AWS resource ARNs it must access, with no wildcard resource permissions.
5. THE System SHALL transmit all data between the Frontend, API, and AWS services exclusively over HTTPS/TLS.
6. THE CDK_Stack SHALL configure the Document_Store to block all public S3 access.
7. THE System SHALL never store AWS credentials or secrets in source code or environment variables accessible outside AWS-managed secret storage.

---

### Requirement 11: Error Handling and User Feedback

**User Story:** As an authenticated user, I want clear error messages when something goes wrong, so that I understand what happened and what to do next.

#### Acceptance Criteria

1. WHEN the Ingestion_Pipeline sets a document status to "failed", THE Frontend SHALL display a human-readable error message on the document list indicating that processing failed and suggesting the User retry the upload.
2. WHEN the Query_Engine encounters an Amazon Bedrock service error during answer generation, THE API SHALL return an HTTP 502 response and THE Frontend SHALL display a message instructing the User to retry.
3. WHEN the API receives a request with an expired or invalid authentication token, THE API SHALL return an HTTP 401 response and THE Frontend SHALL redirect the User to the sign-in page.
4. WHEN the API receives an invalid request (malformed body, missing required field), THE API SHALL return an HTTP 400 response with a message describing the invalid field.
5. WHEN a network error prevents the Frontend from reaching the API, THE Frontend SHALL display a connection error message and SHALL NOT display a blank or unresponsive screen.
6. IF an upload, ingestion, or query operation fails, THEN THE Ingestion_Pipeline or Query_Engine SHALL log the error details, including a correlation ID, to Amazon CloudWatch.

---

### Requirement 12: Observability

**User Story:** As a developer operating DocuQuery, I want logs and metrics for all backend operations, so that I can detect and diagnose issues quickly.

#### Acceptance Criteria

1. THE System SHALL emit structured JSON logs to Amazon CloudWatch for every Lambda invocation, including the invocation timestamp, function name, User ID (non-PII token), operation type, duration in milliseconds, and outcome (success or error code).
2. WHEN a Lambda function throws an unhandled exception, THE System SHALL log the full error message and stack trace to Amazon CloudWatch before returning an error response.
3. THE CDK_Stack SHALL configure a CloudWatch log retention period of 30 days for all Lambda log groups.

---

### Requirement 13: Infrastructure and Deployment

**User Story:** As a developer, I want all infrastructure defined as code, so that the environment is reproducible and auditable.

#### Acceptance Criteria

1. THE CDK_Stack SHALL define all AWS resources (S3, DynamoDB, Lambda, API Gateway, Cognito, Bedrock Knowledge Base, Amplify, CloudWatch) required by the System in a single deployable CDK application.
2. THE CDK_Stack SHALL parameterize environment-specific values (AWS region, account ID, allowed origins) so that the same stack definition can be deployed to multiple environments without source-code changes.
3. THE CDK_Stack SHALL use AWS CDK constructs at the highest available abstraction level (L2 or L3) before falling back to L1 CfnResource constructs.
4. THE System SHALL include unit tests for all backend Lambda handler functions covering the following critical logic paths: authentication token validation, document ownership authorization checks, document status transitions (uploaded → processing → ready, uploaded → failed), fallback detection when no Chunks meet the similarity threshold, and citation assembly from retrieved Chunks.

---

### Requirement 14: Document Parsing Round-Trip Integrity

**User Story:** As a developer, I want text extraction to produce consistent, verifiable output, so that chunk quality is reliable and testable.

#### Acceptance Criteria

1. THE Ingestion_Pipeline SHALL produce a deterministic plain-text representation for any given document input, such that processing the same document twice produces byte-for-byte identical extracted text.
2. FOR ALL valid TXT documents, parsing then serializing the extracted text then parsing again SHALL produce an extracted text string that is identical to the result of a single parse (round-trip property).
3. WHEN a DOCX file is parsed, THE Ingestion_Pipeline SHALL preserve paragraph boundaries as newline separators in the extracted text.
4. IF a PDF contains only scanned images and Amazon Textract returns an empty text result, THEN THE Ingestion_Pipeline SHALL treat the document as an empty-extraction failure per Requirement 4, Criterion 9.
5. THE Ingestion_Pipeline SHALL include unit tests that verify the round-trip property and determinism for each supported file format (PDF text layer, DOCX, TXT), using fixed sample files with known expected outputs.
