import { Cause, Config, Data, Effect, Logger, Match, Option, Schema } from 'effect';

import { Job, Policy } from '../job.ts';
import { OperatorProbeRefusal } from '../operator.ts';
import { privateOperatorProbe } from './runtime.ts';

const Code = Schema.Literals([
  'Disabled',
  'Usage',
  'InvalidConfiguration',
  'TimedOut',
  'Mismatch',
  'InvalidStatus',
  'Unavailable',
  'InvalidReport',
]);
type Code = typeof Code.Type;
class CommandRefusal extends Data.TaggedError('CommandRefusal')<{ readonly code: Code }> {}
const Failure = Schema.TaggedStruct('OperatorRefused', { code: Code });
const encodeFailure = Schema.encodeSync(Schema.fromJsonString(Failure));
const Report = Schema.Struct({
  protocol: Schema.Literal('readonly-policy-v1'),
  policy: Policy,
  job: Schema.Union([Job, Schema.Null]),
});
const decodeReport = Schema.decodeUnknownEffect(Report, { onExcessProperty: 'error' });
const Observation = Schema.TaggedStruct('OperatorObservation', Report.fields);
const encodeObservation = Schema.encodeSync(Schema.fromJsonString(Observation));
const quiet = Logger.layer([]);
const Arguments = Schema.Tuple([Schema.Literal('probe')]);
const decodeArguments = Schema.decodeUnknownEffect(Arguments);

function failed(code: Code) {
  const exitCode = Match.value(code).pipe(
    Match.when('Usage', () => 64),
    Match.when('Disabled', () => 2),
    Match.orElse(() => 1),
  );
  return { exitCode, stdout: '', stderr: `${encodeFailure({ _tag: 'OperatorRefused', code })}\n` };
}
function failureCode(error: unknown): Code {
  return Match.value(error).pipe(
    Match.when(
      (value: unknown): value is CommandRefusal => value instanceof CommandRefusal,
      (value) => value.code,
    ),
    Match.when(
      (value: unknown): value is OperatorProbeRefusal => value instanceof OperatorProbeRefusal,
      (value) => value.code,
    ),
    Match.when(
      (value: unknown): value is Config.ConfigError => value instanceof Config.ConfigError,
      () => 'InvalidConfiguration' as const,
    ),
    Match.orElse(() => 'Unavailable' as const),
  );
}

export function runOperatorCommand(argv: ReadonlyArray<string>, operation = privateOperatorProbe) {
  function* execute() {
    yield* decodeArguments(argv).pipe(Effect.mapError(() => new CommandRefusal({ code: 'Usage' })));
    const mode = yield* Config.String('CEIREAN_OPERATOR_PREVIEW').pipe(
      Config.withDefault('disabled'),
    );
    const approval = Match.value(mode).pipe(
      Match.when('approved', () => Effect.void),
      Match.orElse(() => Effect.fail(new CommandRefusal({ code: 'Disabled' }))),
    );
    yield* approval;
    // The SDK can persist local bearer tokens before its output sink runs.
    const dump = yield* Config.String('WORKERD_DUMP_CONFIG').pipe(Config.option);
    const dumping = Effect.succeed(Option.isSome(dump));
    yield* Effect.fail(new CommandRefusal({ code: 'InvalidConfiguration' })).pipe(
      Effect.when(dumping),
    );
    const raw = yield* operation;
    const report = yield* decodeReport(raw).pipe(
      Effect.mapError(() => new CommandRefusal({ code: 'InvalidReport' })),
    );
    const stdout = `${encodeObservation({ _tag: 'OperatorObservation', ...report })}\n`;
    const oversized = Effect.succeed(new TextEncoder().encode(stdout).byteLength > 16384);
    yield* Effect.fail(new CommandRefusal({ code: 'InvalidReport' })).pipe(Effect.when(oversized));
    return { exitCode: 0, stdout, stderr: '' };
  }
  const executing = Effect.gen(execute);
  const silenced = Effect.provide(executing, quiet);
  const bounded = silenced.pipe(
    Effect.timeoutOrElse({
      duration: '45 seconds',
      orElse: () => Effect.fail(new CommandRefusal({ code: 'TimedOut' })),
    }),
  );
  function refused(cause: Cause.Cause<unknown>) {
    const code = Cause.findErrorOption(cause).pipe(
      Option.map(failureCode),
      Option.getOrElse(() => 'Unavailable' as const),
    );
    const refusal = Effect.succeed(failed(code));
    return refusal;
  }
  return bounded.pipe(Effect.catchCause(refused));
}
