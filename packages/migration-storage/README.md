# Migration Storage

Private native storage for the dedicated migration ledger. Configuration always
supplies a bounded ledger identifier and an explicit `MigrationStatePolicy`.
There is no environment, working-directory, default-root or live-admission lookup.

`initializeMigrationLedger(config)` explicitly creates an empty ledger.
`openMigrationLedger(config)` is scoped and yields the existing `runRepository`
and `workerJournal` ports plus `registerRun({ state, contract })` and
`readRecovery()`. Opening does not register runs, start actors or execute effects.
No native handle or SQL API is exported. `readMigrationLedgerStatus(config)`
reports validated counts without writer ownership.

Every mutation uses one synchronous `BEGIN IMMEDIATE` transaction and the public
pure engine journal policy. Run/peer changes and one audit event commit together;
conflicts/refusals append nothing. Errors roll back, except a lost response after
COMMIT retains its committed intent: read back before deciding what to do next.
There is no implicit retry on Busy or ambiguous outcomes. Existing port error
tags are preserved with finite Busy, CapacityExceeded and Closed codes.

Validation replays every retained commit command from empty state through the
pure policy and compares exact resulting records **and** events. Current snapshots
alone cannot prove overwritten readiness or shortened cleanup-window evidence.
Replay never executes effects. Recovery is one bounded consistent read transaction
returning detached records and unresolved intent IDs, not an actor or lifecycle
recovery controller. The test-only reconstruction boundary below qualifies local
restart behavior; native-worker execution qualification remains separate.

Application limits are 32 runs, 256 workers total/64 per run, 4096 audit events,
1 MiB UTF-8 per record/command/event and 64 MiB aggregate application payloads.
SQLite measures record and **all retained commit payload bytes before decode**.
Writes also bound the larger current/proposed record set plus retained commits
and the proposed command/event before writing. No eviction or deadline renewal
occurs. These are parser/application bounds, not database/WAL filesystem quotas.
The exact STRICT schema uses foreign keys, WAL, synchronous FULL and zero busy
timeout; existing opens perform no DDL, migration or implicit repair.

The optional `testFault(point)` callback is accepted only with TestOwnedTemporary
policy; Production rejects it before path acquisition. Its finite points are
AfterRunWrite, AfterWorkerWrite, AfterEventWrite, BeforeCommit, AfterCommit and
Close. Only the point name is supplied, never a database/SQL capability. Scope
closure invalidates all returned services, even when native close reports failure.

The ledger and rollback-journal ownership guard have separate application/schema
validation and are bound to their file identities. An OS-backed exclusive SQLite
transaction owns the guard until scope exit. No PID, age or timeout can steal it.
All native connections use strict close, including failed acquisitions; close
failures remain finite redacted finalizer defects and do not suppress other
finalizers. Partial initialization is retained for operator investigation, never
repaired or deleted automatically.

Roots must be owner-owned 0700 and files regular, single-link, owner-owned 0600.
Links, special files, excluded production roots and unexpected file identities
refuse before service return. The operator trusts local ancestor directories
against concurrent hostile replacement. Descriptor and inode readback narrow but
do not eliminate pathname races; this is not a custom SQLite VFS or hostile-host,
network-filesystem, arbitrary-sync-client or power-loss durability guarantee.

Status uses the real read-only WAL-aware ledger connection. It may update only
existing main-ledger SHM read bookkeeping; it is not a zero-write forensic reader.
File inventory, main/guard/WAL bytes, schema and business rows remain unchanged.
Existing owner opens and status both require WAL/SHM before native acquisition;
missing sidecars refuse rather than being recreated. No immutable-WAL bypass,
business mutation, initialization or writer-authority receipt is involved.

Under a live owner, status validates the immutable guard schema/identity through
a bounded descriptor read and a scoped native readonly in-memory image, not a
disk copy. Its source header must retain rollback read/write versions; the image
itself reports SQLite memory journal mode. Actual ownership still validates the
real guard's DELETE journal mode and holds its native exclusive transaction.
The guard-image bound reuses the engine's defensive maximum record size. All
acquisition paths retain descriptor/inode checks and refuse partial guard state.

Every native test uses an explicitly owned temporary directory under
`/private/tmp`. Tests never initialize operational Application Support storage.

## Local Restart Qualification

`tests/recovery.test.ts` has 37 deterministic controls. The fixed
`tests/restart-child.ts` accepts only the strict synthetic protocol in
`tests/fixtures.ts`; `tests/readiness.ts` spawns that exact entry with an empty
environment, `--no-env-file --no-install`, no shell and no consumer commands.
Readiness is capped at 64 bytes with a three-second live-clock watchdog. Owned
children are killed and awaited on scope exit. Transaction barriers block only
inside the fixed child, so SIGKILL interrupts real uncommitted SQLite writes.

All five points (before transaction, after run write, after worker write, after
event write, after commit before acknowledgement) reacquire the released native
lock in a fresh process. Live ownership is never displaced. Recovery exposes
whole pre/post state; replay after lost acknowledgement conflicts without a
second audit event. Deliberately skipped peer writes and replayed claimed actions
both failed their controls, then passed after restoration.

`tests/recovery-controller.ts` explicitly reconstructs the existing WorkerLifecycle
from `readRecovery()` with a new issuer and fake mechanism. Claimed/Unknown
Create/Start and authorized execution are not replayed. Missing/ambiguous
materialization evidence remains blocked. Matching immutable evidence resolves
intents and permits cleanup within the original 960..1000 window, but not at its
expiry. Persisted retained-evidence paths retain bytes and file identity; fake
cleanup requests never target them. This is not live filesystem/container cleanup
acceptance. The owner-approved lifecycle repair only projects declared mutation
reply binding fields in reconciliation and the unknown-outcome fallback; native
strict decoding and the single machine are unchanged.

`tests/properties.test.ts` contains one native refinement law: seeds 0/1/163,
1000 runs each, size 50, maxShrinks 1000, maxDiscards 10000, one 180-second total
test bound. Each of 3000 primary cases owns fresh storage, executes eight valid
or refused commands with committed controls, compares real replies/readback to
the pure policy, mutates returned objects and closes/reopens SQLite. The focused
final run passed in 110.669 seconds (87003 assertions). It covers cancellation,
replacement, canonical Options and original consumed limits/cleanup windows.
The domain validator is unchanged; Effect-native `Arbitrary.checkEffect` owns I/O.

Run qualification from the workspace root with credential-free isolated HOME and
network denied, except established loopback fixtures in the full suite:

```sh
bun --no-env-file --no-install test ./packages/migration-storage/tests/recovery.test.ts --timeout 30000
bun --no-env-file --no-install test ./packages/migration-storage/tests/properties.test.ts
bun --no-env-file run check
moon run :typecheck --force --no-actions
moon run :test --force --no-actions
```

See the [measured assessment](../../docs/assessments/native-migration-ledger.md)
for full gates and the separate cached, telemetry-off, credential-free Fallow
run. Controller-owned independent Task 5 and whole-branch reviews remain pending.
Local SIGKILL/reopen is not host-loss, power-loss, native worker, Colima/Docker,
SQLite-filesystem quota or real migration proof. Plan A remains Draft,
publication Disabled, with all seven blockers unchanged. No operational storage
has been initialized and Plans C-D are not activated.
