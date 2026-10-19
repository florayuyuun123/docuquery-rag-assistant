/**
 * Property 2: Chunking Completeness
 *
 * Validates: Requirements 4.5, 14.1
 *
 * All tokens from the input text must appear in at least one chunk.
 * No token should be silently dropped during the chunking process.
 */

import * as fc from 'fast-check';
import { get_encoding } from 'tiktoken';

import { chunkText } from '../../src/ingest/chunker';

describe('Property 2: Chunking Completeness', () => {
  it('all tokens from input appear in at least one chunk', () => {
    const enc = get_encoding('cl100k_base');

    try {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 5000 }), (input) => {
          const chunks = chunkText(input);

          // Empty input (after trim) should yield no chunks
          if (chunks.length === 0) return input.trim().length === 0;

          const inputTokens = Array.from(enc.encode(input));

          // If there are no tokens, we expect no chunks
          if (inputTokens.length === 0) return chunks.length === 0;

          const chunkTokenSets = chunks.map((c) => Array.from(enc.encode(c)));

          // Every input token must appear in at least one chunk
          return inputTokens.every((token) =>
            chunkTokenSets.some((ct) => ct.includes(token)),
          );
        }),
        { numRuns: 100 },
      );
    } finally {
      enc.free();
    }
  });
});
