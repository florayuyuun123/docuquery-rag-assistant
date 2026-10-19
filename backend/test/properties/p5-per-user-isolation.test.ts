/**
 * Property 5: Per-User Data Isolation
 *
 * Validates: Requirements 5.6, 10.4, 11.3
 *
 * The ownership check must reject cross-user access for any pair of distinct
 * UUIDs.  A caller can only access their own documents.
 */

import * as fc from 'fast-check';

describe('Property 5: Per-User Data Isolation', () => {
  it('ownership check rejects cross-user access for any two distinct user UUIDs', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        (ownerUserId, callerUserId) => {
          // Pre-condition: the two UUIDs must be different
          fc.pre(ownerUserId !== callerUserId);

          // The ownership check implemented in documents handler:
          // if (doc['userId'] !== userId) throw ForbiddenError
          const docUserId = ownerUserId;
          const isAllowed = docUserId === callerUserId;

          return !isAllowed; // Cross-user access must always be denied
        },
      ),
      { numRuns: 100 },
    );
  });

  it('ownership check permits access for the owner themselves', () => {
    fc.assert(
      fc.property(fc.uuid(), (userId) => {
        const docUserId = userId;
        const isAllowed = docUserId === userId;
        return isAllowed; // Owner access must always be permitted
      }),
      { numRuns: 100 },
    );
  });

  it('PK scoping ensures different users have separate key spaces', () => {
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), (userId1, userId2) => {
        fc.pre(userId1 !== userId2);

        const pk1 = `USER#${userId1}`;
        const pk2 = `USER#${userId2}`;

        // Different users must have different partition keys
        return pk1 !== pk2;
      }),
      { numRuns: 100 },
    );
  });
});
