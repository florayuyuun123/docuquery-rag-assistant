/**
 * Text chunker for the DocuQuery ingestion pipeline.
 *
 * Splits plain text into token-bounded chunks with a configurable overlap,
 * using the cl100k_base encoding (the same encoding used by Claude models).
 *
 * Satisfies Requirements 4.5, 14.1.
 */

import { get_encoding } from 'tiktoken';
import { CHUNK_SIZE_TOKENS, CHUNK_OVERLAP_TOKENS } from '@docuquery/shared';

/**
 * Split `text` into chunks of at most `CHUNK_SIZE_TOKENS` tokens, with
 * `CHUNK_OVERLAP_TOKENS` token overlap between consecutive chunks.
 *
 * Returns an array of plain-text strings.  An empty input returns [].
 */
export function chunkText(text: string): string[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const enc = get_encoding('cl100k_base');

  try {
    const tokens = enc.encode(text);
    const totalTokens = tokens.length;

    if (totalTokens === 0) {
      return [];
    }

    const chunks: string[] = [];
    const step = CHUNK_SIZE_TOKENS - CHUNK_OVERLAP_TOKENS;

    let start = 0;
    while (start < totalTokens) {
      const end = Math.min(start + CHUNK_SIZE_TOKENS, totalTokens);
      const chunkTokens = tokens.slice(start, end);
      // Decode back to a UTF-8 string
      const chunkText = new TextDecoder().decode(enc.decode(chunkTokens));
      chunks.push(chunkText);

      if (end === totalTokens) {
        break;
      }
      start += step;
    }

    return chunks;
  } finally {
    enc.free();
  }
}
