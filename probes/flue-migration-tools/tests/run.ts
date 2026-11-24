import { BunChildProcessSpawner, BunFileSystem, BunPath } from '@effect/platform-bun';
import { Effect, Layer, ManagedRuntime, Result } from 'effect';

import { type MigrationToolPolicy, resolveForRead, resolveForWrite } from '../src/policy.ts';
import { openToolSurface } from '../src/tools.ts';

const services = Layer.merge(BunFileSystem.layer, BunPath.layer);
const platform = Layer.provideMerge(BunChildProcessSpawner.layer, services);
/**
 * One runtime for the whole suite, built from the layer once. These services
 * hold no finalizer worth draining, so it is never disposed: `bun test` exits
 * the process when the last file finishes.
 */
const runtime = ManagedRuntime.make(platform);

type Refusal = { readonly code: string };

function refusalOf(error: Refusal) {
  return { code: error.code };
}

function valueOf<A>(value: A) {
  return { value };
}

function report<A>(outcome: Result.Result<A, Refusal>) {
  return Result.match(outcome, { onFailure: refusalOf, onSuccess: valueOf });
}

/**
 * The test boundary: the one place where an effect under test is executed and
 * the platform services are provided.
 *
 * An outcome is reported as `{ value }` or `{ code }` rather than thrown, so a
 * test states which it expects and a refusal that should have succeeded fails
 * on the comparison instead of on an exception.
 *
 * Each wrapper takes plain arguments and runs a concrete effect, so no effect
 * type is written out anywhere here. One shared helper is not possible without
 * writing one: a union parameter collapses every channel to `unknown`.
 */
export function resolveRead(policy: MigrationToolPolicy, candidate: string) {
  const resolution = resolveForRead(policy, candidate);
  const captured = Effect.result(resolution);
  const described = Effect.map(captured, report);
  const outcome = runtime.runPromise(described);
  return outcome;
}

export function resolveWrite(policy: MigrationToolPolicy, candidate: string) {
  const resolution = resolveForWrite(policy, candidate);
  const captured = Effect.result(resolution);
  const described = Effect.map(captured, report);
  const outcome = runtime.runPromise(described);
  return outcome;
}

/** The four tools, each bound to one policy and returning a reported outcome. */
export function prepare(policy: MigrationToolPolicy) {
  const surface = openToolSurface(policy);

  function read(candidate: string) {
    const effect = surface.readFile(candidate);
    const captured = Effect.result(effect);
    const described = Effect.map(captured, report);
    const outcome = runtime.runPromise(described);
    return outcome;
  }

  function write(candidate: string, content: string) {
    const effect = surface.writeFile(candidate, content);
    const captured = Effect.result(effect);
    const described = Effect.map(captured, report);
    const outcome = runtime.runPromise(described);
    return outcome;
  }

  function search(query: string) {
    const effect = surface.searchFiles(query);
    const captured = Effect.result(effect);
    const described = Effect.map(captured, report);
    const outcome = runtime.runPromise(described);
    return outcome;
  }

  function check(name: string) {
    const effect = surface.runCheck(name);
    const captured = Effect.result(effect);
    const described = Effect.map(captured, report);
    const outcome = runtime.runPromise(described);
    return outcome;
  }

  return { read, write, search, check };
}
