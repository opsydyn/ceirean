# Migration Storage

Private native storage for the dedicated migration ledger. Configuration always
supplies a bounded ledger identifier and an explicit `MigrationStatePolicy`.
There is no environment, working-directory, default-root or live-admission lookup.

Task 3 implements empty-ledger initialization, internal scope-held ownership and
status only. It exposes no driver, transaction, run-admission or SQL API.
Nonempty ledgers refuse validation. This is not history, recovery-controller or
native-worker qualification; Task 4 must replay retained audit commands from empty
and compare exact records and events.

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
Missing WAL/SHM refuses rather than creating sidecars. No immutable-WAL bypass,
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
