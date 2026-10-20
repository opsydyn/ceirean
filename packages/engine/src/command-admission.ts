import { VerifiedCommand, decideAssessment, type AdmissionReply } from '@leviathan/domain';
import { Context, Effect, Match, Result, Schema } from 'effect';

import { CommandInbox } from './command-inbox-port.ts';

export function makeCommandAdmission() {
  function* acquireService() {
    const inbox = yield* CommandInbox;
    function admit(input: unknown) {
      function decodeInput() {
        return Schema.decodeUnknownResult(VerifiedCommand)(structuredClone(input));
      }
      function* admitDecoded() {
        const decoded = yield* Effect.try({ try: decodeInput, catch: () => undefined }).pipe(
          Effect.result,
          Effect.map(Result.flatMap((value) => value)),
        );
        function evaluate(verified: VerifiedCommand) {
          function* evaluateTrusted() {
            const observation = yield* inbox.loadAuthority(verified.candidate.ingressScopeId);
            const decision = decideAssessment({
              candidate: verified.candidate,
              authority: observation.state,
              nowMs: observation.atMs,
            });
            return yield* Match.value(decision).pipe(
              Match.tag('Ignored', (ignored) =>
                Effect.succeed<AdmissionReply>({ _tag: 'Unrecorded', decision: ignored }),
              ),
              Match.orElse((recordable) =>
                inbox.commit({
                  verified,
                  decision: recordable,
                  evaluatedAtMs: observation.atMs,
                  expectedAuthorityRevision: observation.state.revision,
                }),
              ),
            );
          }
          const program = Effect.gen(evaluateTrusted);
          return program;
        }
        return yield* Result.match(decoded, {
          onSuccess: evaluate,
          onFailure: () =>
            Effect.succeed<AdmissionReply>({
              _tag: 'Unrecorded',
              decision: { _tag: 'Rejected', reason: 'MalformedInput' },
            }),
        });
      }
      const program = Effect.gen(admitDecoded);
      return program;
    }
    return { admit };
  }
  const acquisition = Effect.gen(acquireService);
  return acquisition;
}

export class CommandAdmission extends Context.Service<
  CommandAdmission,
  Effect.Success<ReturnType<typeof makeCommandAdmission>>
>()('@leviathan/engine/CommandAdmission') {}
