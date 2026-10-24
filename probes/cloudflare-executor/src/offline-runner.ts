import { Effect, Match, Option, Result, Schema } from 'effect';

import { ApprovalError, inspectApproval } from './approval.ts';

const json = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const unconfigured = Effect.succeed({
  _tag: 'DryRunBlocked',
  activation: 'Blocked',
  reason: 'TrustedPolicyUnconfigured',
} as const);
const refused = { _tag: 'DryRunRefused', activation: 'Blocked' } as const;
function withinBounds(text: string) {
  return text.length <= 65536 && new TextEncoder().encode(text).byteLength <= 65536;
}

/** No transport or allocation capability is accepted at this boundary. */
export function dryRun(
  text: string,
  receipt: string,
  policy: Option.Option<unknown>,
  nowMs: number,
) {
  function* inspect() {
    const bounded = Result.succeed(true).pipe(
      Result.filterOrFail(
        () => [text, receipt].every(withinBounds),
        () => new ApprovalError({ code: 'InputTooLarge' }),
      ),
    );
    yield* Effect.fromResult(bounded);
    // Parse both files before reporting a structural dry-run, never import JSON.
    yield* json(text);
    const approval = yield* json(receipt);
    function configured(trusted: unknown) {
      const operation = inspectApproval(text, approval, trusted, nowMs);
      return operation;
    }
    return yield* Option.match(policy, { onNone: () => unconfigured, onSome: configured });
  }
  const operation = Effect.gen(inspect);
  const checked = operation.pipe(Effect.result);
  const report = checked.pipe(
    Effect.map(Result.match({ onFailure: () => refused, onSuccess: (report) => report })),
  );
  return report;
}

export function reportExit(report: {
  readonly _tag: 'OfflinePlan' | 'DryRunBlocked' | 'DryRunRefused';
}) {
  return Match.value(report).pipe(
    Match.tag('DryRunRefused', () => 1 as const),
    Match.orElse(() => 2 as const),
  );
}
