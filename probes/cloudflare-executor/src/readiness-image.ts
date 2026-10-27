import { Effect, Schema } from 'effect';

import { reviewedInputs } from './pins.ts';
import { PreparationError, preparationCondition, sha256 } from './preparation.ts';

// This source pin, not a manifest supplied by a caller, identifies the candidate.
const candidate = {
  recipeSha256: '140c90b94cebfddd8ce1c56d7f6d5899e8830eda2b4595b537c113b8597048f1',
} as const;
const strict = { onExcessProperty: 'error' } as const;

function pendingArtifact(path: string) {
  return Schema.Struct({ path: Schema.Literal(path), sha256: Schema.Literal('Pending') });
}

const ReadinessImageManifest = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  platform: Schema.Literal('linux/amd64'),
  recipeSha256: Schema.Literal(candidate.recipeSha256),
  activation: Schema.Literal('Blocked'),
  image: Schema.Literal('Unbuilt'),
  images: Schema.Struct({
    node: Schema.Literal(reviewedInputs.images.node),
    bun: Schema.Literal(reviewedInputs.images.bun),
    playwright: Schema.Literal(reviewedInputs.images.base),
  }),
  straceSource: Schema.Struct({
    tagObject: Schema.Literal('129b5e1cc8edb89b80e75edda8e2dacb527ed89c'),
    commit: Schema.Literal('1d78a4ce1bfa3754b3b99b1e4bb15790001b77cb'),
  }),
  artifacts: Schema.Struct({
    readinessWorker: pendingArtifact('input/readiness-worker.mjs'),
    strace: pendingArtifact('input/strace'),
    observerCanary: pendingArtifact('input/observer-canary'),
  }),
});

export function validateReadinessImagePreparation(input: unknown, recipe: string) {
  function* inspect() {
    yield* Schema.decodeUnknownEffect(
      ReadinessImageManifest,
      strict,
    )(input).pipe(Effect.mapError(() => new PreparationError({ code: 'InvalidManifest' })));
    const recipeSha256 = yield* sha256(recipe);
    yield* Effect.fromResult(
      preparationCondition(recipeSha256 === candidate.recipeSha256, 'RecipeMismatch'),
    );
    return {
      _tag: 'PreparationOnly' as const,
      activation: 'Blocked' as const,
      image: 'Unbuilt' as const,
      recipeSha256,
      blockers: [
        'ReadinessWorkerPending',
        'StracePending',
        'ObserverCanaryPending',
        'ArtifactProvenancePending',
        'BuildToolchainPending',
        'TransitiveClosurePending',
        'RunnerIdentityPending',
        'FreshContextAdmissionPending',
        'IndependentReviewPending',
        'BuildAndRunApprovalPending',
        'FinalImageUnbuilt',
        'RuntimeReadbacksPending',
      ],
    };
  }
  const workflow = Effect.gen(inspect);
  return workflow;
}
