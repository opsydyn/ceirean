import { Effect, Match, Option, Ref, Result, Schema } from 'effect';

import { strict } from './contract.ts';
import { DriverFailure, DriverQuery, DriverReply, type OwnedIdentity } from './driver-protocol.ts';

export type SimulationTransport = (
  query: DriverQuery,
  signal: AbortSignal,
) => Promise<Result.Result<unknown, DriverFailure>>;
function identityOf(query: DriverQuery) {
  return Match.value(query).pipe(
    Match.tag('Start', ({ operation }) => operation.identity),
    Match.orElse(({ identity }) => identity),
  );
}
function sameIdentity(left: OwnedIdentity, right: OwnedIdentity) {
  return [
    left.sessionId === right.sessionId,
    left.operationId === right.operationId,
    left.resourceId === right.resourceId,
  ].every(Boolean);
}
const observed = Schema.is(
  Schema.TaggedStruct('Observed', { identity: Schema.Unknown, observation: Schema.Unknown }),
);
function acknowledges(reply: DriverReply, expected: string) {
  return Match.value(reply).pipe(
    Match.tag('Acknowledged', ({ action }) => action === expected),
    Match.orElse(() => false),
  );
}
function corresponds(query: DriverQuery, reply: DriverReply) {
  const actionMatches = Match.value(query).pipe(
    Match.tag('Authorize', () => ['Authorized', 'Denied'].includes(reply._tag)),
    Match.tag('Inspect', () => observed(reply)),
    Match.orElse(({ _tag }) => acknowledges(reply, _tag)),
  );
  return sameIdentity(identityOf(query), reply.identity) && actionMatches;
}
/** Simulation boundary only: no provider adapter or activation path. */
export function makeSimulationDriver(transport: SimulationTransport) {
  // One driver is one trusted rehearsal boundary. Ownership is never released.
  const owner = Ref.makeUnsafe<Option.Option<string>>(Option.none());
  function claimSession(sessionId: string) {
    function claim(
      current: Option.Option<string>,
    ): readonly [Result.Result<void, DriverFailure>, Option.Option<string>] {
      return Option.match(current, {
        onNone: () => [Result.succeed(undefined), Option.some(sessionId)],
        onSome: () => [Result.fail(new DriverFailure({ code: 'OwnerAlreadyClaimed' })), current],
      });
    }
    const operation = Ref.modify(owner, claim).pipe(Effect.flatMap(Effect.fromResult));
    return operation;
  }
  function request(input: DriverQuery) {
    function* exchange() {
      const decoded = yield* Schema.decodeUnknownEffect(DriverQuery, strict)(input);
      const query = structuredClone(decoded);
      const result = yield* Effect.tryPromise({
        try: (signal) => transport(structuredClone(query), signal),
        catch: () => new DriverFailure({ code: 'TransportLost' }),
      });
      const raw = yield* Effect.fromResult(result);
      const reply = yield* Schema.decodeUnknownEffect(DriverReply, strict)(raw);
      const checked = Result.succeed(reply).pipe(
        Result.filterOrFail(
          (value) => corresponds(query, value),
          () => new DriverFailure({ code: 'InvalidReply' }),
        ),
      );
      return structuredClone(yield* Effect.fromResult(checked));
    }
    const workflow = Effect.gen(exchange);
    return workflow;
  }
  return { mode: 'Simulation' as const, claimSession, request };
}
