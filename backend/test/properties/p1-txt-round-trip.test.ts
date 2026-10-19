/**
 * Property 1: TXT Round-Trip Fidelity
 *
 * Validates: Requirements 4.1, 14.2
 *
 * parse(serialize(parse(input))) === parse(input) for TXT files.
 * Ensures that running extractText twice on the same UTF-8 bytes always
 * produces identical output — the extraction is stable/idempotent.
 */

import * as fc from 'fast-check';

import { extractText } from '../../src/ingest/extract';

describe('Property 1: TXT Round-Trip Fidelity', () => {
  it('parse(serialize(parse(input))) === parse(input) for TXT', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (input) => {
        const inputBuffer = Buffer.from(input, 'utf-8');
        const parsed1 = await extractText('test.txt', inputBuffer, 'text/plain', 'bucket');
        const serialized = Buffer.from(parsed1, 'utf-8');
        const parsed2 = await extractText('test.txt', serialized, 'text/plain', 'bucket');
        return parsed1 === parsed2;
      }),
      { numRuns: 100 },
    );
  });
});
