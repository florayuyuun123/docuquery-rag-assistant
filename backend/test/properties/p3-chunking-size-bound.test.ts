/**
 * Property 3: Chunking Size Bound
 *
 * Validates: Requirements 4.5, 14.1
 *
 * Every chunk produced by chunkText() must contain at most 1000 tokens.
 * This is the hard upper bound mandated by CHUNK_SIZE_TOKENS.
 */

import * as fc from 'fast-check';
import { chunkText } from '../../src/ingest/chunker';
import { get_encoding } from 'tiktoken';
import { CHUNK_SIZE_TOKENS } from '@docuquery/shared';

describe('Property 3: Chunking Size Bound', () => {
  it('every chunk has at most 1000 tokens', () => {
    const enc = get_encoding('cl100k_base');

    try {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 10000 }), (input) => {
          const chunks = chunkText(input);
          return chunks.every((chunk) => enc.encode(chunk).length <= CHUNK_SIZE_TOKENS);
        }),
        { numRuns: 100 },
      );
    } finally {
      enc.free();
    }
  });
});
