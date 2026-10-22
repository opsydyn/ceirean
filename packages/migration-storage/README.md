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
recovery controller. Native-worker/restart execution qualification is separate.

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
