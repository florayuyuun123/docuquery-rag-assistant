/**
 * Property 3: Chunking Size Bound
 *
 * Validates: Requirements 4.5, 14.1
 *
 * Every chunk produced by chunkText() must contain at most 1000 tokens.
 * This is the hard upper bound mandated by CHUNK_SIZE_TOKENS.
 */

import { CHUNK_SIZE_TOKENS } from '@docuquery/shared';
import * as fc from 'fast-check';
import { get_encoding } from 'js-tiktoken';
import type { Tiktoken } from 'js-tiktoken';

import { chunkText } from '../../src/ingest/chunker';

describe('Property 3: Chunking Size Bound', () => {
  it('every chunk has at most 1000 tokens', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const enc = get_encoding('cl100k_base') as Tiktoken;

    try {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 10000 }), (input) => {
          const chunks = chunkText(input);
          return chunks.every((chunk) => enc.encode(chunk).length <= CHUNK_SIZE_TOKENS);
        }),
        { numRuns: 100 },
      );
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    enc.free();
    }
  });
});
