import { Match, Schema } from 'effect';

import { Identity } from './contract.ts';

export const InspectionReceipt = Schema.Struct({
  sessionId: Identity,
  operationId: Identity,
  worksheetSha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
});
export type InspectionReceipt = typeof InspectionReceipt.Type;
export const ReplayState = Schema.Union([
  Schema.TaggedStruct('Empty', {}),
  Schema.TaggedStruct('Recorded', { receipt: InspectionReceipt }),
]);
export type ReplayState = typeof ReplayState.Type;
export const ReplayDecision = Schema.Struct({
  disposition: Schema.Literals(['Recorded', 'Replay', 'Conflict', 'Busy', 'WrongSession']),
  state: ReplayState,
  activation: Schema.Literal('Blocked'),
});
export type ReplayDecision = typeof ReplayDecision.Type;
export function decideReplay(state: ReplayState, receipt: InspectionReceipt): ReplayDecision {
  function recorded({ receipt: existing }: Extract<ReplayState, { _tag: 'Recorded' }>) {
    const disposition = Match.value(receipt).pipe(
      Match.when(
        () => existing.sessionId !== receipt.sessionId,
        () => 'WrongSession' as const,
      ),
      Match.when(
        () => existing.operationId !== receipt.operationId,
        () => 'Busy' as const,
      ),
      Match.when(
        () => existing.worksheetSha256 !== receipt.worksheetSha256,
        () => 'Conflict' as const,
      ),
      Match.orElse(() => 'Replay' as const),
    );
    return { disposition, state, activation: 'Blocked' } as const;
  }
  return Match.value(state).pipe(
    Match.tag(
      'Empty',
      () =>
        ({
          disposition: 'Recorded',
          state: { _tag: 'Recorded', receipt: structuredClone(receipt) },
          activation: 'Blocked',
        }) as const,
    ),
    Match.tag('Recorded', recorded),
    Match.exhaustive,
  );
}
