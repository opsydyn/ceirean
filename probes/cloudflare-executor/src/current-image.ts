import { Effect, Schema } from 'effect';

import { CurrentBaseline, currentBaseline } from './current-baseline.ts';
import { reviewedInputs } from './pins.ts';
import { PreparationError, preparationCondition, sha256 } from './preparation.ts';

const candidate = {
  recipeSha256: 'a28e577719b00c3feb86c180c8273e91c259745cf881eadbff6818ccfc98792f',
  contractSha256: '928f9451a7522fcae93db4c312358072ae5f929a99e2350929d8050ca5832e25',
  bunImage:
    'docker.io/oven/bun@sha256:c017a211c49a21adc0e49dda7b60ac8112887c3d9465e01427f434ed107c830e',
} as const;
function pending(path: string) {
  return Schema.Struct({ path: Schema.Literal(path), status: Schema.Literal('Pending') });
}
const CurrentImagePreparation = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  profileId: CurrentBaseline.fields.profileId,
  platform: CurrentBaseline.fields.platform,
  sourceSha: CurrentBaseline.fields.source.fields.sha,
  lockSha256: CurrentBaseline.fields.source.fields.lockSha256,
  contractSha256: Schema.Literal(candidate.contractSha256),
  recipeSha256: Schema.Literal(candidate.recipeSha256),
  activation: Schema.Literal('Blocked'),
  image: Schema.Literal('Unbuilt'),
  images: Schema.Struct({
    node: Schema.Literal(reviewedInputs.images.node),
    bun: Schema.Literal(candidate.bunImage),
    playwright: Schema.Literal(reviewedInputs.images.base),
  }),
  inputs: Schema.Struct({
    source: pending('input/source.tar'),
    bunCache: pending('input/bun-cache.tar'),
    npmCache: pending('input/npm-cache.tar'),
    browserHarness: pending('input/browser-harness.tar'),
    baselineWorker: pending('input/baseline-worker.mjs'),
  }),
});
const decodePreparation = Schema.decodeUnknownEffect(CurrentImagePreparation, {
  onExcessProperty: 'error',
});
export function validateCurrentImagePreparation(input: unknown, recipe: string) {
  function* inspect() {
    const manifest = yield* decodePreparation(input).pipe(
      Effect.mapError(() => new PreparationError({ code: 'InvalidManifest' })),
    );
    const recipeSha256 = yield* sha256(recipe);
    yield* Effect.fromResult(
      preparationCondition(recipeSha256 === manifest.recipeSha256, 'RecipeMismatch'),
    );
    const contract = currentBaseline();
    return {
      _tag: 'CurrentBaselinePreparation' as const,
      activation: 'Blocked' as const,
      image: 'Unbuilt' as const,
      sourceSha: contract.source.sha,
      contractSha256: manifest.contractSha256,
      recipeSha256,
      requiredChecks: contract.checks.length,
      browserCases: contract.browserCases.length,
      blockers: [
        'CurrentSourcePayloadPending',
        'CurrentBunCachePending',
        'CurrentNpmCachePending',
        'CurrentBrowserHarnessPending',
        'BaselineWorkerPending',
        'TrustedInputCustodyPending',
        'BuildApprovalPending',
        'FinalImageUnbuilt',
        'LinuxBaselineUnqualified',
        'PreviewServersUnqualified',
        'ThreeBrowserSandboxConflict',
        'HostedActivationBlocked',
      ],
    };
  }
  const inspection = Effect.gen(inspect);
  return inspection;
}
