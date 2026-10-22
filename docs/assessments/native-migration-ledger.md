# Native Migration Ledger: Local Qualification

Plan B implements private native run/worker persistence and local recovery only.
Source base is `56c123e` on `codex/native-migration-ledger-plan`, in the isolated
`/private/tmp/ceirean-replay-profile` worktree. Tasks 1-4 already passed their
independent reviews. Task 5 author qualification is recorded below; fresh Task 5
and final whole-branch reviews belong to the controller and remain pending.
No merge, push, operational initialization or native mechanism is implied.

## Boundary And Storage

The public package is `packages/migration-storage`, with explicit
`initializeMigrationLedger`, scoped `openMigrationLedger`, `registerRun`,
`readRecovery` and read-only status. One native owner backs the existing
RunRepository and WorkerJournal ports. Every accepted mutation writes run/peer
authority and one audit event in a synchronous transaction. Open/read validates
all retained commands by pure replay from empty and compares exact records and
events; snapshot-only validation cannot establish overwritten historical facts.

Storage identity is application ID `0x4345524d`, schema version 1,
`migration.sqlite` plus `migration.sqlite.owner.sqlite`. WAL, synchronous FULL,
STRICT tables, foreign keys and zero busy timeout remain unchanged. Limits are
32 runs, 256 workers/64 per run, 4096 events, 1 MiB per encoded record/command/event
and exactly 64 MiB aggregate application payload. Native accounting includes all
retained audit payload bytes; the pure state's sequence does not contain that
history. This is not a measured database/WAL filesystem quota.

Status may update existing main SHM read bookkeeping only; authoritative bytes,
guard/WAL and file inventory remain stable. Guard validation uses a bounded
read-only in-memory native image while the owner lock remains exclusive. Open
requires existing WAL/SHM and never repairs missing files. Parent-directory and
local-filesystem trust remains explicit.

## Recovery Evidence

`packages/migration-storage/tests/recovery.test.ts`: 37 passing controls, 597
assertions in the focused final recovery run (9.03s).

| Control                                                        | Observed Result                                                                          |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| SIGKILL before transaction, after run, worker and event writes | Fresh native owner/process sees exactly pre-transaction state                            |
| SIGKILL after commit, before acknowledgement                   | Whole post-transaction run/peer state; replay conflicts, audit count unchanged           |
| Live owner                                                     | Competitor refuses; no PID/age/deadline lock stealing                                    |
| Killed Create/Start claim and persisted Unknown outcome        | New issuer reconstructs existing lifecycle; no repeated Create/Start                     |
| Authorized execution without acknowledgement                   | No repeated execution after reconstruction                                               |
| Absent/ambiguous materializing resource                        | No cleanup confirmation inferred from absence; ambiguity remains blocked                 |
| Matching immutable resource, original 960..1000 cleanup window | Resolves original intents and confirms fake cleanup at 970; refuses confirmation at 1000 |
| Retained evidence bound in persisted custody                   | Bytes/device/inode/size unchanged; no cleanup call targets evidence                      |

`tests/recovery-controller.ts` consumes `readRecovery` and assembles real native
services with the existing WorkerLifecycle factory and a synthetic mechanism.
There is no second reducer, actor snapshot persistence or public resume API.
The fixed child protocol is in `tests/fixtures.ts`, spawning/bounded parent waits
in `tests/readiness.ts`, and the exact child entry in `tests/restart-child.ts`.
Only strict allowlisted synthetic modes, fault points and owned temporary roots
are accepted. Empty environment, no shell, `--no-env-file --no-install`, 64-byte
readiness cap, three-second live-clock parent waits, bounded child fallback
watchdog, scope-owned SIGKILL and awaited exit limit the fixture. Child errors
emit only fixed refusal output, never raw storage contents.

The first positive Create/Start controls exposed the existing lifecycle's full
operation spread into `WorkerMutationReply`. Qualification stopped. After
explicit owner approval, only the reconciliation and analogous Unknown fallback
reply constructors in `packages/engine/src/worker-lifecycle-tasks.ts` changed:
operationId, identity, hostId and daemonId are explicitly projected. Both paths
failed at the real strict native boundary before the fix and passed afterward.
Intent, issuer, custody, time and cleanup limits, strict decoding and the single
machine are preserved. Original failure logs remain retained.

Two deliberate negative controls were restored before final qualification:
skipping all but one changed worker SQL write makes crash/reopen fail; replaying
stored intents through the fake mechanism during reconstruction makes the
explicit no-Create replay assertion fail. Native transaction source was restored
byte-for-byte; reconstruction again performs no direct mechanism mutation.
These are observed test-sensitivity controls, not deployed failure injection.

## Native Refinement Law

`tests/properties.test.ts` uses `Arbitrary.checkEffect` and unchanged domain
`validateCheckResult`. One law covers all 3000 primary cases: seeds 0/1/163,
1000 runs/seed, size 50, maxShrinks 1000, maxDiscards 10000. Every case owns fresh
temporary SQLite storage, executes eight commands, includes valid committed
controls and refused/stale commands, compares actual replies and recovery to
the pure composite policy, mutates returned objects and verifies close/reopen.
Cancellation/replacement, canonical Options, original spend/repairs/deadlines
and earliest cleanup windows are exercised. No sync-only checkLaw wrapper was
changed and no collect-then-true or reduced-budget law was substituted.

Focused final result: 1 law passed, 87003 assertions, 110668.70ms inside the single
180000ms total test bound. Cumulative seed timings: 36974 / 73396 / 110668ms.
The initial pre-fix law also passed at 132698.12ms; it did not substitute for
recovery or final-tree verification.

## Gates And Fallow

Required root gates use the existing isolated Task 3 runner: fresh temporary
credential-free HOME, `env -i`, cached toolchains/dependencies, no env files or
installation and OS-denied network. Only established synthetic loopback fixtures
are allowed for the full workspace test command.

```sh
bun --no-env-file run check
moon run :typecheck --force --no-actions
moon run :test --force --no-actions
```

Measured author gates: root check exits 0 (zero lint warnings/errors; all files
formatted), typecheck exits 0 (9 tasks), and tests exit 0 (9 tasks, 1160 pass /
0 fail). The native package contributes 138 tests / 88980 assertions, including
the complete three-seed law at 134640.40ms under concurrent workspace load
(cumulative seed times 44160 / 87995 / 134639ms), still below 180000ms. The full
workspace run took 258.293s. Final frozen-tree verification is recorded in the
author handoff report, not represented as controller review.

Author self-review checked both production field projections, real native
port/SQLite use, unchanged strict codecs and pure validator budgets, new issuer
reconstruction, original intent/resource/time bindings, evidence retention,
child ownership/watchdogs, restored negative mutations, and documentation proof
limits. No unresolved material author finding remains. This is self-review and
author verification, not independent acceptance.

Fallow 3.34.1 ran separately from its already-cached native binary with
`FALLOW_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1`, isolated credential-free HOME,
`--no-cache --no-type-aware --format json dead-code`, all network denied.
Initial run reported a readiness/child cycle; moving the shared protocol to the
existing fixture module removed it without suppression or rule changes. Final
Fallow exits 0: no unused files/exports/types, unresolved/unlisted imports or
cycles; exactly one warning remains for `@modelcontextprotocol/sdk` in
`probes/github-admission/package.json`. Its compatibility dependency is retained.
Unconfigured architecture/rule-pack diagnostics are not proof of those checks.

## Proof Limits

All databases/children/evidence are test-owned temporary state. No Application
Support path, operational config, credentials, .env, consumer command, registry,
model, GitHub or external network access was used. No Docker/Colima or native
worker was started. Local SIGKILL/reopen is not host-loss, power-loss, filesystem
quota, live cleanup, isolation or successful migration proof. Plan A remains
Draft, publication Disabled, with seven blockers unchanged. Plans C-D and
controller-owned independent reviews remain separate, uncompleted gates.
