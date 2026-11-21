/**
 * How a verifier reports that it could not produce evidence at all.
 *
 * The `CandidateVerifier` port promises `unknown`, because a verifier may be
 * any implementation and the domain decodes whatever arrives. That is honest
 * but lossy: a verifier that refused before running anything — because the plan
 * did not cover the contract — has something specific to say, and an
 * undecodable receipt would reach the domain as a bare `InvalidReceipt`.
 *
 * This narrows the port's promise in exactly one direction. A reply may be a
 * plan-refusal envelope; anything else is a receipt for the domain to decode,
 * exactly as before. No existing verifier changes, and the coordinator gains
 * the refusal's reason instead of guessing at it.
 *
 * When a second real verifier exists, the port should take a proper union and
 * this envelope should become one of its arms. Until then the `unknown` is the
 * wart, and this is the smallest honest patch over it.
 */

import { Schema } from 'effect';

import { PlanRefusal } from './verification-plan.ts';

export const PlanRefusedReply = Schema.TaggedStruct('PlanRefused', { refusal: PlanRefusal });
export type PlanRefusedReply = typeof PlanRefusedReply.Type;

export const decodePlanRefusedReply = Schema.decodeUnknownResult(PlanRefusedReply);
