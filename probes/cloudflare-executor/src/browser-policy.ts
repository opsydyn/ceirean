import type { APIResponse } from '@playwright/test';
import { Data, Effect, Match, Result, Schema } from 'effect';

export function fetchBrowserResponse(
  fetchResponse: (options: { maxRedirects: number; timeout: number }) => Promise<APIResponse>,
) {
  function* fetchOnce() {
    const response = yield* Effect.tryPromise(() =>
      fetchResponse({ maxRedirects: 0, timeout: 5000 }),
    );
    const status = response.status();
    yield* requireRuntime(status < 300 || status >= 400);
    return response;
  }
  const workflow = Effect.gen(fetchOnce);
  return workflow;
}

class BrowserRuntimeError extends Data.TaggedError('BrowserRuntimeError')<{
  readonly code: 'RuntimeRefused';
}> {}
function requireRuntime(valid: boolean) {
  return Result.succeed(true).pipe(
    Result.filterOrFail(
      () => valid,
      () => new BrowserRuntimeError({ code: 'RuntimeRefused' }),
    ),
    Effect.fromResult,
  );
}

const origins = Schema.Literals(['http://127.0.0.1:4321', 'http://127.0.0.1:4322']);
const isHttp = Schema.is(Schema.Literal('http:'));
const isVersion = Schema.is(Schema.Literal('156.0.8078.4'));
const isExecutable = Schema.is(
  Schema.Literal('/ms-playwright/chromium-1248/chrome-linux64/chrome'),
);
const UnsafeArgument = Schema.String.check(
  Schema.isPattern(/^--(?:no-sandbox|disable-setuid-sandbox)(?:=|$)/),
);
const isUnsafeArgument = Schema.is(UnsafeArgument);
function matchesOrigin(parsed: URL, origin: string) {
  return [
    Schema.is(origins)(origin),
    parsed.origin === origin,
    parsed.username.length === 0,
    parsed.password.length === 0,
    isHttp(parsed.protocol),
  ].every(Boolean);
}
export function allowBrowserRequest(url: string, origin: string) {
  function* check() {
    const checked = yield* Effect.try(() => new URL(url)).pipe(Effect.result);
    return Match.value(checked).pipe(
      Match.tag('Success', ({ success }) => matchesOrigin(success, origin)),
      Match.orElse(() => false),
    );
  }
  const workflow = Effect.gen(check);
  return workflow;
}
export function inspectBrowserRuntime(version: string, args: ReadonlyArray<string>) {
  function* inspect() {
    yield* requireRuntime(isVersion(version) && args.length > 0 && args.length <= 128);
    yield* requireRuntime(args.every((arg) => arg.length <= 2048));
    yield* requireRuntime(isExecutable(args[0]));
    yield* requireRuntime(!args.some(isUnsafeArgument));
    return { activation: 'Blocked' as const, sandboxAcceptance: 'Unverified' as const };
  }
  const workflow = Effect.gen(inspect);
  return workflow;
}
