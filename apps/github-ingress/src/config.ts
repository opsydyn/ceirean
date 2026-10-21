import { AuthorityRevision, LocalIngressPolicy } from '@ceirean/domain';
import { Effect, FileSystem, Match, Result, Schema } from 'effect';

export class CliError extends Schema.TaggedError<CliError>()('CliError', {
  code: Schema.Literals([
    'InvalidArguments',
    'InvalidConfig',
    'UnsafeCredentials',
    'OperationFailed',
    'ShutdownFailed',
  ]),
}) {}
const isDot = Schema.is(Schema.Literals(['.', '..']));
const isRoot = Schema.is(Schema.Literal('/'));
const isConfigure = Schema.is(Schema.Literal('configure'));
export const AbsolutePath = Schema.String.check(
  Schema.isMaxLength(4096),
  Schema.makeFilter(
    (value) =>
      value.startsWith('/') &&
      !value.includes('\0') &&
      !value.split('/').some(isDot) &&
      !value.includes('//') &&
      (isRoot(value) || !value.endsWith('/')),
  ),
);
const ConfigData = Schema.Struct({
  policy: LocalIngressPolicy.check(
    Schema.makeFilter((policy) => policy.allowedOperatorIds.length > 0),
  ),
  stateRoot: Schema.optional(AbsolutePath),
  webhookSecretFile: AbsolutePath,
  privateKeyFile: AbsolutePath,
});
const Configuration = Schema.Struct({ ...ConfigData.fields, stateRoot: AbsolutePath });
export type Configuration = typeof Configuration.Type;
export function decodeConfig(input: unknown, home: string) {
  return Schema.decodeUnknownResult(ConfigData, { onExcessProperty: 'error' })(input).pipe(
    Result.flatMap((config) =>
      Schema.decodeUnknownResult(Configuration)({
        ...config,
        stateRoot: config.stateRoot ?? `${home}/Library/Application Support/Ceirean`,
      }),
    ),
    Result.mapError(() => new CliError({ code: 'InvalidConfig' })),
  );
}
const Argv = Schema.Struct({
  command: Schema.Literals(['init', 'start', 'status', 'configure']),
  configFile: AbsolutePath,
  database: Schema.optionalKey(AbsolutePath),
  expectedRevision: Schema.optionalKey(AuthorityRevision),
}).check(
  Schema.makeFilter((args) => isConfigure(args.command) === (args.expectedRevision !== undefined)),
);
export type Arguments = typeof Argv.Type;
export function parseArgv(argv: ReadonlyArray<string>) {
  function parse() {
    const [command, ...flags] = argv;
    const values: Record<string, unknown> = { command };
    const names: Record<string, string> = {
      '--config': 'configFile',
      '--database': 'database',
      '--expected-revision': 'expectedRevision',
    };
    for (let index = 0; index < flags.length; index += 2) {
      const key = names[flags[index]];
      const valid =
        Object.hasOwn(names, flags[index]) &&
        key !== undefined &&
        !Object.hasOwn(values, key) &&
        flags[index + 1] !== undefined;
      const checked = Match.value(valid).pipe(
        Match.when(false, () => Result.fail(new CliError({ code: 'InvalidArguments' }))),
        Match.orElse(() => Result.succeed(true)),
      );
      Result.getOrThrow(checked);
      values[key] = flags[index + 1];
    }
    return Schema.decodeUnknownSync(Argv)(values);
  }
  return Result.try({ try: parse, catch: () => new CliError({ code: 'InvalidArguments' }) });
}
export const HostContext = Schema.Struct({
  ownerUid: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  homeDirectory: AbsolutePath,
  cwd: AbsolutePath,
  temporaryRoots: Schema.Array(AbsolutePath),
  repositoryRoots: Schema.Array(AbsolutePath),
  buildRoots: Schema.Array(AbsolutePath),
  syncedRoots: Schema.Array(AbsolutePath),
  ownedTemporaryRoot: Schema.optionalKey(AbsolutePath),
});
export type HostContext = typeof HostContext.Type;
const jsonSchema = Schema.fromJsonString(Schema.Unknown);

export function readConfiguration(file: string, home: string) {
  function* read() {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs.readFileString(file);
    const json = yield* Schema.decodeUnknownEffect(jsonSchema)(text);
    return yield* Effect.fromResult(decodeConfig(json, home));
  }
  const reading = Effect.gen(read);
  return reading.pipe(Effect.mapError(() => new CliError({ code: 'InvalidConfig' })));
}
