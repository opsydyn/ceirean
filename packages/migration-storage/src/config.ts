import { Predicate, Schema } from 'effect';

const pathInput = Schema.NonEmptyString.check(Schema.isMaxLength(4096));
const uid = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);
const common = { stateRoot: pathInput, ownerUid: uid };
export type MigrationLedgerTestFaultPoint =
  | 'AfterRunWrite'
  | 'AfterWorkerWrite'
  | 'AfterEventWrite'
  | 'BeforeCommit'
  | 'AfterCommit'
  | 'Close';
export type MigrationLedgerTestFault = (point: MigrationLedgerTestFaultPoint) => void;
const testFault = Schema.declare((value): value is MigrationLedgerTestFault =>
  Predicate.isFunction(value),
);
const roots = Schema.Array(pathInput).check(Schema.isMaxLength(256));
export const MigrationStatePolicy = Schema.Union([
  Schema.TaggedStruct('Production', {
    ...common,
    homeDirectory: pathInput,
    repositoryRoots: roots,
    buildRoots: roots,
    temporaryRoots: roots,
    syncedRoots: roots,
    filesystem: Schema.Literal('OperatorDeclaredLocalNonSynced'),
  }),
  Schema.TaggedStruct('TestOwnedTemporary', { ...common, ownedTemporaryRoot: pathInput }),
]);
export type MigrationStatePolicy = typeof MigrationStatePolicy.Type;
export const MigrationLedgerConfig = Schema.Struct({
  ledgerId: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/)),
  pathPolicy: MigrationStatePolicy,
  testFault: Schema.optional(testFault),
});
export type MigrationLedgerConfig = typeof MigrationLedgerConfig.Type;
