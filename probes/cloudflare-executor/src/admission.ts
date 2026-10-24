import { Effect, Match, Option, Ref, Result, Schema } from 'effect';

import {
  decodeRequest,
  Identity,
  limits,
  type ProbeRequest,
  strict,
  Timestamp,
} from './contract.ts';

const SessionConfig = Schema.Struct({
  sessionId: Identity,
  startsAtMs: Timestamp,
  executionDeadlineMs: Timestamp,
  endsAtMs: Timestamp,
});
type SessionConfig = typeof SessionConfig.Type;
type Refusal =
  | 'InvalidRequest'
  | 'InvalidClock'
  | 'WrongSession'
  | 'DeadlineExceeded'
  | 'Busy'
  | 'OperationConflict';
export type AdmissionDecision =
  | {
      readonly _tag: 'Accepted';
      readonly operationId: string;
      readonly activation: 'Blocked';
      readonly deadlineMs: number;
    }
  | { readonly _tag: 'Replay'; readonly operationId: string; readonly activation: 'Blocked' }
  | { readonly _tag: 'Refused'; readonly reason: Refusal };
type Reservation = { readonly request: ProbeRequest; readonly deadlineMs: number };
export interface AdmissionSession {
  readonly config: SessionConfig;
  readonly nowMs: number;
  readonly observedAtMs: number;
  readonly reservation: Option.Option<Reservation>;
}

function validWindow(config: SessionConfig) {
  return [
    config.executionDeadlineMs > config.startsAtMs,
    config.executionDeadlineMs - config.startsAtMs <= limits.executionMs,
    config.endsAtMs - config.startsAtMs <= limits.sessionMs,
    config.endsAtMs - config.executionDeadlineMs >= limits.cleanupMs,
  ].every(Boolean);
}

function refused(
  session: AdmissionSession,
  reason: Refusal,
): readonly [AdmissionDecision, AdmissionSession] {
  return [{ _tag: 'Refused', reason }, session];
}

function sameRequest(left: ProbeRequest, right: ProbeRequest) {
  return [
    left.sessionId === right.sessionId,
    left.operationId === right.operationId,
    left.kind === right.kind,
    left.sourceSha === right.sourceSha,
    left.durationMs === right.durationMs,
    left.budget.commandOutputBytes === right.budget.commandOutputBytes,
    left.budget.artifactBytes === right.budget.artifactBytes,
  ].every(Boolean);
}

function selectSlot(
  request: ProbeRequest,
  session: AdmissionSession,
): readonly [AdmissionDecision, AdmissionSession] {
  function accept(): readonly [AdmissionDecision, AdmissionSession] {
    const deadlineMs = session.nowMs + request.durationMs;
    const reservation = Option.some({ request: structuredClone(request), deadlineMs });
    return [
      { _tag: 'Accepted', operationId: request.operationId, activation: 'Blocked', deadlineMs },
      { ...session, reservation },
    ];
  }
  function reserved(existing: Reservation): readonly [AdmissionDecision, AdmissionSession] {
    const reason = Match.value(request.operationId === existing.request.operationId).pipe(
      Match.when(true, () => 'OperationConflict' as const),
      Match.orElse(() => 'Busy' as const),
    );
    return Match.value(sameRequest(request, existing.request)).pipe(
      Match.when(
        true,
        () =>
          [
            { _tag: 'Replay', operationId: request.operationId, activation: 'Blocked' },
            session,
          ] as const,
      ),
      Match.orElse(() => refused(session, reason)),
    );
  }
  return Option.match(session.reservation, { onNone: accept, onSome: reserved });
}

function clockValid(session: AdmissionSession) {
  return [
    Number.isSafeInteger(session.nowMs),
    session.nowMs >= session.config.startsAtMs,
    session.nowMs >= session.observedAtMs,
  ].every(Boolean);
}

function fitsWindow(request: ProbeRequest, session: AdmissionSession) {
  return [
    request.durationMs <= session.config.executionDeadlineMs - session.nowMs,
    request.durationMs <= session.config.endsAtMs - session.nowMs - limits.cleanupMs,
  ].every(Boolean);
}

/** Pure proposal only; makeAdmissionGate owns the atomic local reservation. */
export function admit(
  input: unknown,
  session: AdmissionSession,
): readonly [AdmissionDecision, AdmissionSession] {
  function choose(request: ProbeRequest): readonly [AdmissionDecision, AdmissionSession] {
    function afterClock(): readonly [AdmissionDecision, AdmissionSession] {
      const observed = { ...session, observedAtMs: session.nowMs };
      return Match.value(request).pipe(
        Match.when(
          () => !fitsWindow(request, observed),
          () => refused(observed, 'DeadlineExceeded'),
        ),
        Match.orElse(() => selectSlot(request, observed)),
      );
    }
    return Match.value(session).pipe(
      Match.when(
        () => request.sessionId !== session.config.sessionId,
        () => refused(session, 'WrongSession'),
      ),
      Match.when(
        () => Option.isSome(session.reservation),
        () => selectSlot(request, session),
      ),
      Match.when(
        () => !clockValid(session),
        () => refused(session, 'InvalidClock'),
      ),
      Match.orElse(afterClock),
    );
  }
  return Result.match(decodeRequest(input), {
    onFailure: () => refused(session, 'InvalidRequest'),
    onSuccess: choose,
  });
}

export function makeAdmissionGate(input: unknown) {
  function* constructGate() {
    const decoded = yield* Schema.decodeUnknownEffect(SessionConfig, strict)(input);
    const config = structuredClone(decoded);
    const checked = Result.succeed(config).pipe(
      Result.filterOrFail(validWindow, () => 'InvalidSessionWindow' as const),
    );
    yield* Effect.fromResult(checked);
    const state = yield* Ref.make<AdmissionSession>({
      config,
      nowMs: config.startsAtMs,
      observedAtMs: config.startsAtMs,
      reservation: Option.none(),
    });
    function reserve(request: unknown, nowMs: number) {
      function transition(current: AdmissionSession) {
        return admit(request, { ...current, nowMs });
      }
      const operation = Ref.modify(state, transition);
      return operation;
    }
    return { admit: reserve };
  }
  const workflow = Effect.gen(constructGate);
  return workflow;
}
