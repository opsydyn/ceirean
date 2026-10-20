import {
  LiveAdmissionDraft,
  LocalPolicyObservation,
  VerifiedCommand,
  decideLiveAdmission,
  type LiveAdmissionReply,
} from '@leviathan/domain';
import { Context, Effect, Match, Option, Result, Schema } from 'effect';

import { LiveAuthority, LiveInbox } from './live-admission-ports.ts';

function unrecorded(
  reason: 'MalformedInput' | 'AuthorityChanged' | 'InvalidClock',
): LiveAdmissionReply {
  return { _tag: 'Unrecorded', decision: { _tag: 'Rejected', reason } };
}

export function makeLiveAdmission() {
  function* acquire() {
    const inbox = yield* LiveInbox;
    const authority = yield* LiveAuthority;
    function admit(input: unknown) {
      function evaluate(verified: VerifiedCommand) {
        function* evaluateFresh() {
          const observation = yield* inbox.loadPolicy(verified.candidate.ingressScopeId);
          const local = decideLiveAdmission({
            verified,
            policy: observation.policy,
            evidence: Option.none(),
            now: observation.at,
          });
          function checkLive() {
            function* checked() {
              const lease = yield* authority.check({ verified, policy: observation.policy });
              const current = yield* inbox.loadPolicy(verified.candidate.ingressScopeId);
              const unchanged = Schema.toEquivalence(LocalPolicyObservation.fields.policy)(
                observation.policy,
                current.policy,
              );
              const forwardClock =
                current.at.wallMs >= observation.at.wallMs &&
                current.at.monotonicMs >= observation.at.monotonicMs;
              function commitChecked() {
                const decision = decideLiveAdmission({
                  verified,
                  policy: current.policy,
                  evidence: Option.some(lease),
                  now: current.at,
                });
                const raw = {
                  verified,
                  expectedLocalRevision: current.policy.revision,
                  decision,
                  provenance: { _tag: 'LiveChecked', evidence: lease.evidence },
                  startedMonotonicMs: lease.startedMonotonicMs,
                  evaluatedAtMs: current.at.wallMs,
                  evaluatedMonotonicMs: current.at.monotonicMs,
                };
                const draft = Schema.decodeUnknownResult(LiveAdmissionDraft)(raw);
                const refusal = Match.value(decision).pipe(
                  Match.tag('Rejected', (rejected) => ({
                    _tag: 'Unrecorded' as const,
                    decision: rejected,
                  })),
                  Match.orElse(() => ({
                    _tag: 'Unrecorded' as const,
                    decision: { _tag: 'Rejected' as const, reason: 'InvalidAuthority' as const },
                  })),
                );
                return Result.match(draft, {
                  onSuccess: inbox.commit,
                  onFailure: () =>
                    Effect.succeed<LiveAdmissionReply>({
                      _tag: 'Unrecorded',
                      decision: refusal.decision,
                    }),
                });
              }
              return yield* Match.value(true).pipe(
                Match.when(
                  () => !forwardClock,
                  () => Effect.succeed(unrecorded('InvalidClock')),
                ),
                Match.when(() => unchanged, commitChecked),
                Match.orElse(() => Effect.succeed(unrecorded('AuthorityChanged'))),
              );
            }
            const program = Effect.gen(checked);
            return program;
          }
          return yield* Match.value(local).pipe(
            Match.when({ _tag: 'Rejected', reason: 'AuthorityUnavailable' }, checkLive),
            Match.tag('Rejected', (decision) =>
              inbox.commit({
                verified,
                expectedLocalRevision: observation.policy.revision,
                decision,
                provenance: { _tag: 'LocalPolicy', revision: observation.policy.revision },
                evaluatedAtMs: observation.at.wallMs,
                evaluatedMonotonicMs: observation.at.monotonicMs,
              }),
            ),
            Match.orElse(() => Effect.succeed(unrecorded('MalformedInput'))),
          );
        }
        const program = Effect.gen(evaluateFresh);
        return program;
      }
      function* admitValidated() {
        const decoded = yield* Effect.try({
          try: () => Schema.decodeUnknownResult(VerifiedCommand)(structuredClone(input)),
          catch: () => undefined,
        }).pipe(Effect.result, Effect.map(Result.flatMap((value) => value)));
        function replayFirst(verified: VerifiedCommand) {
          function* resolve() {
            const replay = yield* inbox.resolveReplay(verified);
            return yield* Match.value(replay).pipe(
              Match.tag('Absent', () => evaluate(verified)),
              Match.tag('Duplicate', ({ record }) =>
                Effect.succeed<LiveAdmissionReply>({ _tag: 'Duplicate', record }),
              ),
              Match.tag('Conflict', ({ reason }) =>
                Effect.succeed<LiveAdmissionReply>({
                  _tag: 'Unrecorded',
                  decision: { _tag: 'Rejected', reason },
                }),
              ),
              Match.tag('CapacityExceeded', () =>
                Effect.succeed<LiveAdmissionReply>({
                  _tag: 'Unrecorded',
                  decision: { _tag: 'Rejected', reason: 'CapacityExceeded' },
                }),
              ),
              Match.exhaustive,
            );
          }
          const program = Effect.gen(resolve);
          return program;
        }
        return yield* Result.match(decoded, {
          onSuccess: replayFirst,
          onFailure: () => Effect.succeed(unrecorded('MalformedInput')),
        });
      }
      const program = Effect.gen(admitValidated);
      return program.pipe(Effect.withSpan('LiveAdmission.admit'));
    }
    return { admit };
  }
  const acquisition = Effect.gen(acquire);
  return acquisition;
}

export class LiveAdmission extends Context.Service<
  LiveAdmission,
  Effect.Success<ReturnType<typeof makeLiveAdmission>>
>()('@leviathan/engine/LiveAdmission') {}
