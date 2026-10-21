import {
  NonNegativeSafeInteger,
  QualificationRefusal,
  RunId,
  checkEligibility,
  decideQualification,
  decodeReceipt,
} from '@ceirean/domain';
import { Clock, Effect, Match, Option, Result, Schema } from 'effect';

import { RunSnapshot, type CommitResult } from './contracts.ts';
import { CandidateVerifier, RunRepository } from './ports.ts';

export const QualificationOutcome = Schema.Union([
  Schema.TaggedStruct('Qualified', { snapshot: RunSnapshot }),
  Schema.TaggedStruct('Refused', {
    refusal: Schema.Union([QualificationRefusal, Schema.TaggedStruct('RunNotFound', {})]),
  }),
  Schema.TaggedStruct('Conflict', { runId: RunId, expectedRevision: NonNegativeSafeInteger }),
]);
export type QualificationOutcome = typeof QualificationOutcome.Type;

function refused(
  refusal: Extract<QualificationOutcome, { _tag: 'Refused' }>['refusal'],
): QualificationOutcome {
  return { _tag: 'Refused', refusal };
}

function committed(result: CommitResult): QualificationOutcome {
  return Match.value(result).pipe(
    Match.tag('Committed', ({ snapshot }) => ({ _tag: 'Qualified' as const, snapshot })),
    Match.tag('Conflict', (conflict) => conflict),
    Match.exhaustive,
  );
}

export function qualifyRun(runId: RunId) {
  function* qualification() {
    const repository = yield* RunRepository;
    const verifier = yield* CandidateVerifier;
    const found = yield* repository.load(runId);
    const initialTime = yield* Clock.currentTimeMillis;
    const eligible: Result.Result<
      RunSnapshot,
      Extract<QualificationOutcome, { _tag: 'Refused' }>['refusal']
    > = Option.match(found, {
      onNone: () => Result.fail({ _tag: 'RunNotFound' as const }),
      onSome: (snapshot) =>
        Result.map(checkEligibility(snapshot.state, initialTime), () => snapshot),
    });
    const verification = Result.match(eligible, {
      onFailure: (refusal) => Effect.succeed(Result.fail(refusal)),
      onSuccess: ({ state, contract }) =>
        verifier
          .verify(
            structuredClone({
              identity: {
                runId: state.runId,
                attemptId: state.attemptId,
                generation: state.generation,
                candidateDigest: state.candidateDigest,
                contractId: state.contractId,
                contractDigest: state.contractDigest,
              },
              contract,
            }),
          )
          .pipe(Effect.map(decodeReceipt)),
    });
    const receipt = yield* verification;
    const finalTime = yield* Clock.currentTimeMillis;
    function* decision() {
      const snapshot = yield* eligible;
      const evidence = yield* receipt;
      const next = decideQualification(snapshot.state, snapshot.contract, evidence, finalTime);
      return yield* Match.value(next).pipe(
        Match.tag('Refused', ({ refusal }) => Result.fail(refusal)),
        Match.tag('Accepted', ({ state, facts }) =>
          Result.succeed({
            runId,
            expectedRevision: snapshot.revision,
            state,
            facts,
          }),
        ),
        Match.exhaustive,
      );
    }
    const change = Result.gen(decision);
    const commit = Result.match(change, {
      onFailure: (refusal) => Effect.succeed(refused(refusal)),
      onSuccess: (accepted) => repository.commit(accepted).pipe(Effect.map(committed)),
    });
    return yield* commit;
  }
  const program = Effect.gen(qualification);
  const operation = program.pipe(Effect.withSpan('RunCoordinator.qualifyRun'));
  return operation;
}
