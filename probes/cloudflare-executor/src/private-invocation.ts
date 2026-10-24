import { Effect, Schema } from 'effect';

import { ApprovalReceipt, inspectApproval } from './approval.ts';
import { strict } from './contract.ts';

const Envelope = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  purpose: Schema.Literal('InspectOfflineApproval'),
  worksheet: Schema.String.check(Schema.isMaxLength(65536)),
  approval: ApprovalReceipt,
});

/** Prepared Queue consumer boundary; no ack, send, evidence or executor capability. */
export function inspectPrivateMessage(input: unknown, policy: unknown, nowMs: number) {
  function* inspect() {
    const decoded = yield* Schema.decodeUnknownEffect(Envelope, strict)(input);
    const envelope = structuredClone(decoded);
    return yield* inspectApproval(envelope.worksheet, envelope.approval, policy, nowMs);
  }
  const workflow = Effect.gen(inspect);
  return workflow;
}
