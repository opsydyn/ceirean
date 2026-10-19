import { Context } from 'effect';

import { makeCandidateVerifier, makeRunRepository } from './service-factories.ts';

export class RunRepository extends Context.Service<
  RunRepository,
  ReturnType<typeof makeRunRepository>
>()('@leviathan/engine/RunRepository') {}

export class CandidateVerifier extends Context.Service<
  CandidateVerifier,
  ReturnType<typeof makeCandidateVerifier>
>()('@leviathan/engine/CandidateVerifier') {}
