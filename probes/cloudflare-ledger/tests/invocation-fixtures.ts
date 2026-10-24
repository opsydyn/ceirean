import { Clock, Effect, FileSystem, Schema } from 'effect';

import { fixture } from '../../cloudflare-executor/tests/approval-fixtures.ts';

export const InvocationFixture = Schema.Struct({
  policy: Schema.Unknown,
  valid: Schema.String,
  conflict: Schema.String,
  busy: Schema.String,
  expired: Schema.String,
});
export const decodeInvocationFixture = Schema.decodeUnknownSync(
  Schema.fromJsonString(InvocationFixture),
);
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
export function prepareInvocation(root: string, sessionId: string) {
  function* prepare() {
    const f = yield* Effect.promise(fixture);
    const now = yield* Clock.currentTimeMillis;
    const base = {
      ...f.original,
      session: {
        sessionId,
        startsAtMs: now - 1000,
        executionDeadlineMs: now + 2699000,
        endsAtMs: now + 3599000,
      },
      request: { ...f.original.request, sessionId },
      approvedAtMs: now - 1000,
      approvalExpiresAtMs: now + 2699000,
    };
    const policy = { ...f.policy, sessionId };
    function signed(value: unknown) {
      function* makePacket() {
        const packet = yield* Effect.promise(() => f.sign(value));
        return encode({
          schemaVersion: 1,
          purpose: 'InspectOfflineApproval',
          worksheet: packet.text,
          approval: packet.approval,
        });
      }
      const operation = Effect.gen(makePacket);
      return operation;
    }
    const valid = yield* signed(base);
    const conflict = yield* signed({ ...base, request: { ...base.request, durationMs: 2000 } });
    const busy = yield* signed({
      ...base,
      request: { ...base.request, operationId: 'operation-2' },
    });
    const expired = yield* signed({
      ...base,
      session: {
        sessionId,
        startsAtMs: now - 7200000,
        executionDeadlineMs: now - 4500000,
        endsAtMs: now - 3600000,
      },
      approvedAtMs: now - 7200000,
      approvalExpiresAtMs: now - 4500000,
    });
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(
      `${root}/invocation-fixture.json`,
      encode({ policy, valid, conflict, busy, expired }),
    );
    return encode(policy);
  }
  const workflow = Effect.gen(prepare);
  return workflow;
}
