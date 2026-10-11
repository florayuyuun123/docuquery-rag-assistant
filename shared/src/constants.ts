// DynamoDB key prefixes
export const USER_PREFIX = "USER#";
export const DOC_PREFIX = "DOC#";
export const CHAT_PREFIX = "CHAT#";

// Supported file MIME types
export const SUPPORTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
] as const;

// Supported file extensions
export const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".txt"] as const;

// Maximum upload file size: 20 MB
export const MAX_FILE_SIZE_BYTES = 20_971_520;

// Vector similarity threshold for retrieval
export const DEFAULT_SIMILARITY_THRESHOLD = 0.5;

// Text chunking parameters
export const CHUNK_SIZE_TOKENS = 1000;
export const CHUNK_OVERLAP_TOKENS = 200;

// Pre-signed S3 URL validity window: 15 minutes
export const PRESIGNED_URL_EXPIRY_SECONDS = 900;

// DynamoDB GSI name for user + date queries
export const USER_CREATED_AT_INDEX = "userId-createdAt-index";

// Default Bedrock model IDs
export const DEFAULT_CLAUDE_MODEL_ID =
  "anthropic.claude-3-haiku-20240307-v1:0";
export const DEFAULT_TITAN_EMBED_MODEL_ID = "amazon.titan-embed-text-v2:0";

// Maximum chat history records to return
export const MAX_CHAT_HISTORY_RECORDS = 50;
