# GitHub Adapter Storage

`@leviathan/github-adapter/storage` exports scoped `initializeLiveInbox`,
`openLiveInbox`, and `readLiveInboxStatus`. The future application owns platform
layers, configuration, credentials and its single runtime. This adapter creates
no runtime, listener or GitHub client. Status never reads credentials or takes
the exclusive owner lock. Configure acquires the same owner lock as start and
uses the trusted `updatePolicy({ expectedRevision, next })` operation; it cannot
run while a listener owner exists.

Init exclusively reserves the ledger and `<file>.owner.sqlite` as 0600 files.
Partial initialization remains an error requiring operator recovery. Normal
open uses `create: false`, validates through a read-only connection, and executes
no DDL or migration. The ledger uses WAL/FULL/foreign keys/zero busy timeout;
the separate ownership database uses rollback journaling and a lifetime
`BEGIN EXCLUSIVE`. Kernel locks, not PID files, provide ownership. Replacing or
moving either database changes its canonical file identity and refuses startup.
Do not restore or copy state files in place while an owner is active.

## Explicit Path Policy

The adapter's `LiveInboxConfig` adds a required `pathPolicy` to the shared
file/scope/initial-policy/limits/clock contract. Production policy is:

```typescript
{
  _tag: 'Production',
  stateRoot, ownerUid, homeDirectory,
  repositoryRoots, buildRoots, temporaryRoots, syncedRoots,
  filesystem: 'OperatorDeclaredLocalNonSynced'
}
```

The application supplies trusted host context, including the effective operator
UID, absolute repository/build/temp exclusions and known sync roots. These are
not webhook inputs or additional arbitrary keys in the specified CLI JSON.
The application translates its validated config and host context once at its
composition boundary. The CLI default remains
`~/Library/Application Support/Leviathan/github-admission.sqlite`; this adapter
does not select a home directory or read environment variables.

Any explicit absolute custom production stateRoot is admissible, not only an
Application Support path. Root and database paths must be normalized, contained
and free of symlink components. Ancestors must be directories owned by root or
the operator and not group/other writable; the OS root need not be 0700.
The stateRoot and all database-parent directories beneath it must belong to the
operator and be 0700. Files and existing sidecars must be single-link 0600 files
owned by that operator. Repository ancestors containing `.git` are rejected.
Declared repository/build/temp/sync roots are excluded, as are standard temp
roots and the exact macOS `Library/CloudStorage` and `Library/Mobile Documents`
roots. No generic cloud-name substring heuristic is used.

The operator must declare a local non-synced filesystem. Pathnames, mode bits and
realpath checks cannot establish the absence of arbitrary third-party sync
software or network mounts. This implementation does not claim such proof, or
protection against a malicious process with the same UID. SQLite file identity
and schema validation do not provide cryptographic anti-rollback protection
against arbitrary same-inode backup overwrites by that operator.

Tests explicitly select `TestOwnedTemporary` with an exact `ownedTemporaryRoot`.
This permits test-owned macOS temporary paths, not production paths, while
retaining containment, file ownership, permissions and symlink checks. Only that
test configuration admits synchronous fault hooks. No production fallback to
temporary storage exists.

Decisions, evidence and receipts are committed together with bounded unique
keys. A final revision and wall/monotonic barrier runs after testable writes;
failure rolls back the savepoint. Historical records never persist request-local
monotonic ticks or act as permission caches. Limits remain 256 decisions, 1024
receipts and 256 local policy revisions. Known receipt replay stays readable at
capacity; fresh receipts may refuse. Revision reuse always refuses.
