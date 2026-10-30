import { Effect, FileSystem, Schema } from 'effect';

import { requireInventory } from './dependency-inventory.ts';

type InertOwnership = {
  readonly _tag: 'InertArchiveOwnership';
  readonly uid: 1000;
  readonly gid: 1000;
};
const admitted = new WeakSet<object>();
const Ids = Schema.Tuple([
  Schema.Literal('1000'),
  Schema.Literal('1000'),
  Schema.Literal('1000'),
  Schema.Literal('1000'),
]);
const Zero = Schema.Tuple([Schema.String.check(Schema.isPattern(/^0{16}$/))]);
const Privileges = Schema.Tuple([Schema.Literal('1')]);
const isWorkerGroup = Schema.is(Schema.Literal('1000'));
const isAuthorityShape = Schema.is(
  Schema.Struct({
    _tag: Schema.Literal('InertArchiveOwnership'),
    uid: Schema.Literal(1000),
    gid: Schema.Literal(1000),
  }),
);
export function getInertArchiveOwnership() {
  function* admit() {
    const fs = yield* FileSystem.FileSystem;
    const status = yield* fs.readFileString('/proc/self/status');
    yield* requireInventory(status.length <= 16384, 'ResolutionRefused');
    const fields = new Map<string, string[]>();
    for (const line of status.split('\n').filter(Boolean)) {
      const colon = line.indexOf(':');
      const key = line.slice(0, colon);
      yield* requireInventory(colon > 0 && !fields.has(key), 'ResolutionRefused');
      fields.set(
        key,
        line
          .slice(colon + 1)
          .trim()
          .split(/\s+/)
          .filter(Boolean),
      );
    }
    yield* Schema.decodeUnknownEffect(Ids)(fields.get('Uid'));
    yield* Schema.decodeUnknownEffect(Ids)(fields.get('Gid'));
    for (const key of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'])
      yield* Schema.decodeUnknownEffect(Zero)(fields.get(key));
    yield* Schema.decodeUnknownEffect(Privileges)(fields.get('NoNewPrivs'));
    const groups = fields.get('Groups') ?? [];
    yield* requireInventory(groups.every(isWorkerGroup), 'ResolutionRefused');
    const authority: InertOwnership = Object.freeze({
      _tag: 'InertArchiveOwnership',
      uid: 1000,
      gid: 1000,
    });
    admitted.add(authority);
    return authority;
  }
  const workflow = Effect.gen(admit);
  return workflow;
}
export function isInertArchiveOwnership(value: unknown): value is InertOwnership {
  return isAuthorityShape(value) && admitted.has(value);
}
export type InertArchiveOwnership = Effect.Success<ReturnType<typeof getInertArchiveOwnership>>;
