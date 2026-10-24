import { Effect, Schema } from 'effect';

import { ApprovalReceipt, inspectApproval } from './approval.ts';
import { Identity, strict } from './contract.ts';

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

const Routing = Schema.Struct({
  session: Schema.Struct({ sessionId: Identity }),
  request: Schema.Struct({ operationId: Identity }),
});
const decodeRouting = Schema.decodeUnknownEffect(Schema.fromJsonString(Routing));
export function authenticatePrivateMessage(input: unknown, policy: unknown, nowMs: number) {
  function* verify() {
    const decoded = yield* Schema.decodeUnknownEffect(Envelope, strict)(input);
    const envelope = structuredClone(decoded);
    const report = yield* inspectApproval(envelope.worksheet, envelope.approval, policy, nowMs);
    // Decode routing from the same immutable, signed text, never caller-owned objects.
    const routing = yield* decodeRouting(envelope.worksheet);
    const receipt = {
      sessionId: routing.session.sessionId,
      operationId: routing.request.operationId,
      worksheetSha256: report.worksheetSha256,
    };
    return { report, receipt };
  }
  const workflow = Effect.gen(verify);
  return workflow;
}
