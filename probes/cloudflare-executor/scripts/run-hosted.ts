import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Clock, Console, Effect, Exit, Match, Result, Schema, type Runtime } from 'effect';

import { trustedApprovalPolicy } from '../src/activation-policy.ts';
import { dryRun, reportExit } from '../src/offline-runner.ts';
import { readBounded } from '../src/runner-input.ts';

const Arguments = Schema.Tuple([
  Schema.Literal('--dry-run'),
  Schema.Literal('--worksheet'),
  Schema.NonEmptyString,
  Schema.Literal('--approval'),
  Schema.NonEmptyString,
]);
const decodeArgs = Schema.decodeUnknownResult(Arguments);
const encodeReport = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const refusal = Console.error('{"_tag":"DryRunRefused","activation":"Blocked"}').pipe(
  Effect.map(() => 1 as const),
);
const usage = Console.error('{"_tag":"UsageError"}').pipe(Effect.map(() => 64 as const));
function inspectFiles(args: typeof Arguments.Type) {
  function* inspect() {
    const text = yield* readBounded(args[2]);
    const receipt = yield* readBounded(args[4]);
    const nowMs = yield* Clock.currentTimeMillis;
    const report = yield* dryRun(text, receipt, trustedApprovalPolicy, nowMs);
    const output = Match.value(report).pipe(
      Match.tag('DryRunRefused', () => Console.error(encodeReport(report))),
      Match.orElse(() => Console.log(encodeReport(report))),
    );
    yield* output;
    return reportExit(report);
  }
  const operation = Effect.gen(inspect);
  return operation;
}
const argumentsResult = decodeArgs(Bun.argv.slice(2));
const selected = Result.match(argumentsResult, { onFailure: () => usage, onSuccess: inspectFiles });
const session = Effect.scoped(selected);
const scoped = session.pipe(Effect.timeout('5 seconds'));
const checked = scoped.pipe(Effect.result);
const rendered = checked.pipe(
  Effect.flatMap(Result.match({ onFailure: () => refusal, onSuccess: Effect.succeed })),
);
export const program = Effect.provide(rendered, BunServices.layer);
const decodeExit = Schema.decodeUnknownResult(Schema.Literals([1, 2, 64]));
const teardown: Runtime.Teardown = (exit, onExit) => {
  function completed(value: unknown) {
    const result = decodeExit(value);
    const code = result.pipe(Result.getOrElse(() => 1));
    onExit(code);
  }
  Exit.match(exit, { onSuccess: completed, onFailure: () => onExit(1) });
};
BunRuntime.runMain(program, { disableErrorReporting: true, teardown });
