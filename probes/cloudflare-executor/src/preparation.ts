import { Data, Effect, Match, Result, Schema } from 'effect';

import { reviewedInputs } from './pins.ts';

const strict = { onExcessProperty: 'error' } as const;

export class PreparationError extends Data.TaggedError('PreparationError')<{
  readonly code:
    | 'InvalidManifest'
    | 'RecipeMismatch'
    | 'InvalidInventory'
    | 'RegistryRequestDenied';
}> {}

function commandSchema(command: { readonly cwd: string; readonly argv: ReadonlyArray<string> }) {
  return Schema.Struct({
    cwd: Schema.Literal(command.cwd),
    argv: Schema.Tuple(command.argv.map((part) => Schema.Literal(part))),
  });
}

function journeySchema(journey: {
  readonly path: string;
  readonly interactions: ReadonlyArray<string>;
}) {
  return Schema.Struct({
    path: Schema.Literal(journey.path),
    interactions: Schema.Tuple(journey.interactions.map((part) => Schema.Literal(part))),
  });
}

export const PreparationManifest = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  repository: Schema.Literal('opsydyn/fold-kit-experiments'),
  sourceSha: Schema.Literal('b7484cb46e66b162c8afddcfba235c9507b4f0ab'),
  platform: Schema.Literal('linux/amd64'),
  recipeSha256: Schema.Literal(reviewedInputs.recipeSha256),
  image: Schema.Literal('Unbuilt'),
  privateInvocation: Schema.Literal('Unverified'),
  toolchain: Schema.Struct({
    bun: Schema.Literal('1.3.11'),
    node: Schema.Literal('22.23.4'),
    git: Schema.Literal('2.43.0'),
    playwright: Schema.Literal('1.64.1'),
    chromium: Schema.Literal('156.0.8078.4'),
    chromiumRevision: Schema.Literal('1248'),
    sandboxSdk: Schema.Literal('1.0.3'),
    interFonts: Schema.Literal('5.3.0'),
  }),
  images: Schema.Struct({
    base: Schema.Literal(reviewedInputs.images.base),
    node: Schema.Literal(reviewedInputs.images.node),
    bun: Schema.Literal(reviewedInputs.images.bun),
    helper: Schema.Literal(reviewedInputs.images.helper),
  }),
  artifacts: Schema.Struct({
    source: Schema.Literal('Pending'),
    bunCache: Schema.Literal('Pending'),
    npmCache: Schema.Literal('Pending'),
    browserHarness: Schema.Literal('Pending'),
  }),
  commands: Schema.Struct({
    install: commandSchema(reviewedInputs.commands.install),
    check: commandSchema(reviewedInputs.commands.check),
    typecheck: commandSchema(reviewedInputs.commands.typecheck),
    test: commandSchema(reviewedInputs.commands.test),
    build: commandSchema(reviewedInputs.commands.build),
    storybook: commandSchema(reviewedInputs.commands.storybook),
  }),
  journeys: Schema.Struct({
    carousel: journeySchema(reviewedInputs.journeys.carousel),
    promoLine: journeySchema(reviewedInputs.journeys.promoLine),
  }),
  viewports: Schema.Struct({
    desktop: Schema.Struct({ width: Schema.Literal(1440), height: Schema.Literal(900) }),
    mobile: Schema.Struct({ width: Schema.Literal(390), height: Schema.Literal(844) }),
  }),
});

export function sha256(text: string) {
  const digest = Effect.promise(() =>
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  );
  return digest.pipe(
    Effect.map((buffer) =>
      Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join(''),
    ),
  );
}

export const PreparationReport = Schema.TaggedStruct('PreparationOnly', {
  activation: Schema.Literal('Blocked'),
  recipeSha256: Schema.String,
  blockers: Schema.Array(Schema.String),
});

export function preparationCondition(
  valid: boolean,
  code: (typeof PreparationError.prototype)['code'],
) {
  return Match.value(valid).pipe(
    Match.when(true, () => Result.succeed(true)),
    Match.orElse(() => Result.fail(new PreparationError({ code }))),
  );
}

export function validatePreparation(input: unknown, recipe: string) {
  function* inspectRecipe() {
    const manifest = yield* Schema.decodeUnknownEffect(
      PreparationManifest,
      strict,
    )(input).pipe(Effect.mapError(() => new PreparationError({ code: 'InvalidManifest' })));
    const recipeSha256 = yield* sha256(recipe);
    yield* Effect.fromResult(
      preparationCondition(recipeSha256 === manifest.recipeSha256, 'RecipeMismatch'),
    );
    return {
      _tag: 'PreparationOnly' as const,
      activation: 'Blocked' as const,
      recipeSha256,
      blockers: [
        'PrivateInvocationUnverified',
        'FinalImageUnbuilt',
        'SourcePending',
        'BunCachePending',
        'NpmCachePending',
        'BrowserHarnessPending',
      ],
    };
  }
  const workflow = Effect.gen(inspectRecipe);
  return workflow;
}

const unsafeComponents = new Set(['', '.', '..']);
function isSafeComponent(part: string) {
  return !unsafeComponents.has(part);
}

export function isSafeArchivePath(path: string) {
  const parts = path.split('/');
  return path.length <= 512 && /^[A-Za-z0-9_@.+/-]+$/.test(path) && parts.every(isSafeComponent);
}

const entryContent = Schema.String.check(Schema.isMaxLength(1048576));
const SourceEntry = Schema.Struct({
  path: Schema.String.check(Schema.isMaxLength(512)),
  kind: Schema.Literals(['File', 'Directory']),
  content: Schema.optionalKey(entryContent),
});
const SourceInventory = Schema.Array(SourceEntry).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4096),
);

function hasSensitiveName(path: string) {
  const parts = path.split('/');
  return parts.some(isSensitiveComponent);
}

function isSensitiveComponent(part: string) {
  return /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.git|id_rsa|id_ed25519)$|\.(?:pem|key)$/i.test(part);
}

const isFile = Schema.is(Schema.Literal('File'));

export function validateSourceInventory(input: unknown) {
  function* inspectInventory() {
    const entries = yield* Schema.decodeUnknownEffect(
      SourceInventory,
      strict,
    )(input).pipe(Effect.mapError(() => new PreparationError({ code: 'InvalidInventory' })));
    const paths = new Map<string, string>();
    for (const entry of entries) {
      const sensitiveContent =
        /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----|github_pat_[A-Za-z0-9_]+/.test(
          entry.content ?? '',
        );
      const valid =
        isSafeArchivePath(entry.path) &&
        !hasSensitiveName(entry.path) &&
        !sensitiveContent &&
        !paths.has(entry.path);
      yield* Effect.fromResult(preparationCondition(valid, 'InvalidInventory'));
      paths.set(entry.path, entry.kind);
    }
    for (const entry of entries) {
      const parts = entry.path.split('/');
      for (let length = 1; length < parts.length; length += 1) {
        const parent = parts.slice(0, length).join('/');
        yield* Effect.fromResult(
          preparationCondition(!isFile(paths.get(parent)), 'InvalidInventory'),
        );
      }
    }
    return { _tag: 'ValidatedInventory' as const, entries: entries.length };
  }
  const workflow = Effect.gen(inspectInventory);
  return workflow;
}

const registryOrigin = new URL('https://registry.npmjs.org');
const isReadMethod = Schema.is(Schema.Literal('GET'));

export function validateRegistryRequest(
  url: string,
  method: string,
  approved: ReadonlyArray<string>,
) {
  function* inspectRequest() {
    const parsed = yield* Effect.try({
      try: () => new URL(url),
      catch: () => new PreparationError({ code: 'RegistryRequestDenied' }),
    });
    const valid = [
      isReadMethod(method),
      parsed.origin === registryOrigin.origin,
      parsed.username.length === 0,
      parsed.password.length === 0,
      parsed.search.length === 0,
      parsed.hash.length === 0,
      parsed.href === url,
      approved.includes(url),
    ].every(Boolean);
    yield* Effect.fromResult(preparationCondition(valid, 'RegistryRequestDenied'));
    return { _tag: 'ApprovedRegistryRequest' as const, url };
  }
  const workflow = Effect.gen(inspectRequest);
  return workflow;
}
