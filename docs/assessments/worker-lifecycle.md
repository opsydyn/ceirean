# Worker Lifecycle Qualification

Task 1's compatibility gate below is historical evidence from 2026-10-19; its
then-pending review subsequently passed at `91c0f01`. All six task reviews are
complete and clean through `781c71cc83889271702b8aa68e81ded0cc84e975`, including
the recorded fixes. Final whole-implementation review at that source returned
With fixes for I1: normal released-owner reconciliation incorrectly ActorFailed.
The single scoped fix `f38b0e45f531c186217af493e444222e9d2ef61c` has clean
independent scoped rereview, closing the whole-implementation review. Controller
verification independently passes 458 tests / 1900 assertions at that source.
This is offline branch-quality approval, not production or deployment approval.
ADR-0002's framework selection is unchanged. No live mechanism is qualified.

## Implementation Decisions

These are preserved controller rulings, not new architecture approval:

- `WorkerObservationRequest` carries the operation and optional bound immutable
  container ID. Names/labels cannot replace that authority. Reversal costs one
  request schema plus driver/fake/call-site updates.
- Generic `Completed` decoding permits empty observations; journal authority is
  action-specific: Create/Start require presence, Stop matching stopped presence,
  Remove exact-ID absence. No-match never resolves outstanding Create/Start.
  Reversal costs decoder/domain tests and action-specific journal tests.
- Task 3 proves atomic claim/cancellation order; actual dispatch-race proof moved
  to Task 4's real actor, avoiding a test-only dispatch engine. Acceptance was
  retained, not dropped; reversal would move test ownership again.
- Required persisted `editTimeFloorMs` and `outcomeEvidenceFloorMs` separate edit
  ordering from late truthful outcome ordering. New claims invalidate readiness.
  Missing floors refuse; reconstruction invents no timestamps. Reversal costs
  two private snapshot fields and codec/fixture changes, not deployed migration.
- `worker-lifecycle-tasks.ts` contains private declared Effect tasks;
  `worker-lifecycle.ts` remains the only statechart. Reversal costs consolidating
  one private module, not adding an alternate reducer.
- Cancel/cleanup intent commits before notification; execution authorization
  remains in the machine. Fake external state outlives interrupted invocations.
  Moving these barriers would require renewed race qualification.
- The service-owned request loop captures interpreter dependencies once. Public
  methods exchange typed requests/results, with no helper provisioning or new
  runtime. Reversal requires reviewing ownership/backpressure design.
- Task 6's private `worker-property-fixture.ts` owns deterministic responders and
  shared audit; the scenario interpreter only drives the actual service and
  checks evidence. It is not a second lifecycle oracle. Reversal costs one-file
  consolidation into `worker-properties.test.ts`.
- Safety traces audit typed failures instead of requiring every adversarial
  action to succeed; constructive laws require progress. This does not approve
  every error classification. The final review's separate API regressions found
  and corrected I1; the cost of this policy is maintaining that complementary
  success/failure contract coverage.

## Historical Task 1 Gate

## Baseline

Clean branch `codex/worker-lifecycle-design`, HEAD
`698806cdd732d2a48520a44ef8f30ff6c6272277`. Root lock Git blob
`5394db9099be0a5888b9bc0a247f6d9920fb5cad`; SHA-256
`94a67265d92385e3bff7a980c22a49ace848a15f3d1f3cf641f3e0d71f2af024`.

Actual tools/packages: Bun 1.4.2, Moon 2.5.4, Effect 4.0.5, TypeScript 7.0.2,
bun-types 1.4.2, oxlint 1.88.0, oxfmt 0.73.0, @opsydyn/oxlint-effect 2.0.1;
Node v24.15.0 is tooling-only. Engine vendor checking is `skipLibCheck: false`.

Fresh sequential baseline commands all exited 0 under
`env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR"`:

```sh
bun run check
moon run domain:typecheck --force --no-actions
moon run engine:typecheck --force --no-actions
moon run probe:typecheck --force --no-actions
moon run domain:test --force --no-actions
moon run engine:test --force --no-actions
moon run probe:test --force --no-actions
git diff --check
```

Lint: zero warnings/errors. Domain: 119 tests / 407 assertions; engine: 55 / 201;
probe: 36 / 104. Total: 210 / 712. None of these existing tests is new actor proof.

## Exact Artifact And Resolution

Only the private engine manifest gained `@xstate/effect@0.1.0-alpha.6` and
`xstate@6.0.0-alpha.64`. Complete manifest/lock diff inspection and a structured
JSONC comparison found exactly those two added package records, no changed or
removed existing package records, and only the engine workspace record changed.
The existing Zod/probe dependency cohort was not changed or extended.

Script-free install and then frozen script-free install both exited 0:

```sh
env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" bun install --ignore-scripts
env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" bun install --frozen-lockfile --ignore-scripts
```

The initial sandbox install failed with `tempdir: EPERM`; the approved escalation
succeeded, installing two packages. Frozen output: `Checked 126 installs across
180 packages (no changes)`. No caches were deleted.

Evaluated lock Git blob: `15c84a8a0dac6c0d43c169c682d710674232b6a6`.
SHA-256: `aa90aa27ce4e98d36624b1b701e2f93ea988afa52dc157294b9219809cd5e32e`.
Exact registry artifact integrity from that lock:

```text
@xstate/effect@0.1.0-alpha.6
sha512-6fQ8vTfQf8evetno5x4vrS49IoS9XuiyPJixDHmQeIabZVXo1nSBtIZp6tw2ofYDkfdtlSPBYUnjoGhPB8T0Rw==
xstate@6.0.0-alpha.64
sha512-TJ3bMBeFq+Qhl+b0R747RdVLUx5D6P7j/JcSfqJMmPajAY+ZadGIQ+p3z8WEPdIsJ5xpzqy7P0Ou5fTDx/FOGw==
```

Installed adapter peers are Effect `^4.0.0` and XState `^6.0.0-alpha.63`.
The engine and adapter both resolve Effect to the same real path:
`node_modules/.bun/effect@4.0.5/node_modules/effect/dist/index.js`. The physical
package store contains only `effect@4.0.5`; the root lock has one Effect record.
There is one repository root lock. All baseline tool versions remain unchanged.

The installed package, not moving documentation or dist-tags, is API authority:
`dist/declarations/src/{setupEffect,fromEffect,createEffectActor,actorScope,actor}.d.ts`
and its shipped JavaScript. Adapter entry `dist/xstate-effect.js` SHA-256:
`78bbe37b717b81f1e763da94b4d32ac62dd2e93057d7d4e5113a658934c5dcc6`;
actor host chunk `dist/state-14a1fecf.js`:
`a857f2e4fb2ab9a1e587be26638629eb65a74721a960ebed634e024672c12b82`.
XState resolved entry `dist/xstate.cjs.js`:
`3f4668a57d72bc858a689ac66ac3311c2339af31e2f3a195ad34143c680a6b01`.
The owner's source locator is release commit
`c62db3e7520f3544faf5cf40988a2bf7208a670d`, `packages/xstate-effect/src`;
that locator is reported, not independently established as npm build provenance.

## RED And Inference Controls

Before adding dependencies, the focused test exited 1: `Cannot find module
'@xstate/effect'`, with 0 pass / 1 fail / 1 error. It was the required missing-package
RED, not an actor assertion failure.

```sh
env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" bun --no-env-file --no-install test --timeout 30000 packages/engine/tests/xstate-compatibility.test.ts
```

The real declared task consumes a `Context.Service` inferred from a real factory.
Its machine moves pending to ready; `waitFor` observes `container-1`. Removing
only the retained `@ts-expect-error` produced TS2345:
`Effect<void, ActorStoppedError, TestContainers>` cannot run where requirements
must be `never`. A deliberately unused directive on the provided program produced
TS2578. Both controls exited 1 under strict engine typecheck; experimental edits
were restored, leaving only the meaningful missing-service directive.

## GREEN And Limits

Focused suite: six tests, 16 assertions, zero failures. It qualifies the declared
inferred service/task, a 10ms TestClock timer (still pending at 9ms), invocation
release before ready versus selective `withActorScope` release at root closure,
state-exit interruption and local release while the root remains alive, original
typed task failure through `join`, and sanitized tagged mapping of an unknown
machine failure. Pending work has no timer that could imitate cancellation;
observation waits are bounded, its latch has a same-binding scope finalizer, and
actor scopes own and drain hosted fibers. Layers wrap the closed actor program,
not individual operations. Each executed test has one runtime boundary.

The complete sequential baseline command list was rerun successfully with the
new cohort. Domain: 119 / 407; engine: 61 / 217; probe: 36 / 104. Total:
216 tests / 728 assertions. Lint and format pass with zero warnings/errors;
strict domain/engine/probe typechecks and `git diff --check` pass. All 141 Effect
rules remain at error, and engine `skipLibCheck: false` is unchanged.

Initial scaffold lint failures were corrected using domain result records,
explicit exported composition boundaries, separate infrastructure wiring and
scope-owned bounded coordination. No rule, configuration, vendor declaration,
manual channel, cast, runtime fallback or dependency was weakened to pass.

This is exact-cohort local Bun admission only. Experimental API stability,
worker ownership protocol, durable recovery, external cleanup, live Docker and
production behavior remain unqualified. No lifecycle implementation, restoration,
supervision retries, qualification/probe source changes, ADR changes, merge or push.

## Task 6 Qualification Method

Task 6 base HEAD: `ee0d0f82d1070e9e64ff12db27f20c5830f39f18`; base tree:
`f4d2993ddbe43e0781aca899c2493f3710871375`. Production domain/engine source,
existing tests/laws/diagnostic helper, dependencies, lock, lint/configuration and
probe source are unchanged from that reviewed base. New source is test-only:
`packages/engine/tests/worker-properties.test.ts` and private
`packages/engine/tests/worker-property-fixture.ts`.

The interpreter acquires the real `makeWorkerLifecycle`, invokes its public
methods, replaces authority through the existing journal seam, advances TestClock
and selects controlled mechanism replies. Reconstruction closes the old service
scope and acquires a new actual service with a distinct issuer. The _same_ memory
journal, fake external Ref, responders and complete chronological audit remain
case-owned across that reconstruction. No fake phase machine, oracle reducer,
snapshot restoration, helper provisioning, new production API or per-case runtime
is used. Each property evaluation, including shrinking, builds and releases a
fresh fixture/service scope/TestClock at the test composition boundary; one
`Effect.runPromise` owns each law/seed test, not each case.

Arbitrary generates valid canonical operations with all three purposes. Identity,
configuration, policy and time fixtures remain canonical: creation 900ms, initial
clock 950ms, execution deadline 1000ms, spend 17, repairs 1, cleanup window 100ms.
The fixed initial acquisition plus at most 45 generated actions stays below 50
scenario actions. Actions cover acquisition, execution, cancellation, replacement,
clock advance, selected readback/outcome, reconciliation, reconstruction and
shutdown. Bootstrap includes successful startup, Unknown Create and Failed Start;
the latter retains the reviewed failed-Start cleanup regression in sequences.
Readback covers absent, not-running, foreign, replacement, retained-mount,
configuration-mismatch, malformed and staging-present evidence. Outcomes include
Completed, Failed, Unknown and lost response. Literal tests retain finer races.

Seven named safety predicates inspect committed edit results, the authoritative
journal immediately before calls, readback and public snapshots: unique prior
claim; one issuer/call per action; cancellation/replacement authorization; full
matching current readiness; complete absence without unresolved Create/Start;
foreign/replacement/retained custody; immutable reconstructed limits/deadlines.
Cleanup targeting additionally validates the actual preceding custody readback.
Tagged public failures are recorded and checked as sanitized observations, never
converted into success receipts. Canonical acquisition/reconstruction must succeed
or falsify the property. Dedicated constructive Readiness, Execution and Release
predicates demand real progress; an always-blocked implementation cannot pass.

Each of these **10 laws** executes **1000 primary cases at each seed 0, 1, 163**:
**30,000 new primary cases**, size 50, maxShrinks 1000, maxDiscards 10000.
Named inferred Effect predicates use installed `Arbitrary.checkEffect` and the
unchanged `validateCheckResult`; false/exhausted/wrong-count results fail. Seeds
are separate Bun tests under the unchanged 30000ms timeout. Passing runs do not
shrink. Existing 36 domain acceptance laws add 108,000 primary cases (13 evidence,
18 run, 5 worker laws), for 138,000 acceptance-law primary cases total. Harness
diagnostic controls, shrinking evaluations and Bun assertions are not included
in that acceptance-case count.

## Behavioral RED Controls

All commands below use `env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR"`.
Focused commands run from `packages/engine`; each is
`bun --no-env-file --no-install test tests/worker-properties.test.ts --timeout 30000`
plus the named `--test-name-pattern`. Each temporary broken variant separately
passes `moon run engine:typecheck --force --no-actions` (exit 0) before its
behavioral test fails (exit 1). No broken source is retained in the commit.

| Temporary change                                                                                                                                        | Catcher                                                                                        | Observed failure                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Disable memory-journal duplicate claim guard (`alreadyClaimed = snapshot.intents.some(sameAction) && false`)                                            | **Literal** `resolved Start cannot be claimed by a second issuer after service reconstruction` | 0 pass / 1 fail, 2 assertions: expected Refused/AlreadyClaimed, received Committed with old controller-1 Failed Start plus new controller-2 Claimed Start. This is a deterministic two-issuer recovery replay, not a randomized law or simultaneous race.                       |
| Remove `&& !unresolvedCreation` from cleanup absence guard                                                                                              | **Law** `stateful complete absence without unresolved creation; seed 0`                        | False at primary case 215, 0 shrinks. Unknown Create + Readback Absent + Shutdown falsely confirms cleanup. Replay `[0,"0",214,11,[],"ReturnedFalse"]`.                                                                                                                         |
| At the real service's existing load/decode seam, return deadline `value.operation.limits.deadlineMs + 100` only for reconstructed issuer `controller-2` | **Law** `stateful reconstructed immutable limits and deadlines; seed 0`                        | PropertyError at primary case 34, 1 shrink: FailedStart + Reconstruct; ConflictingOperation for worker-1. Replay `[0,"0",33,2,[2],"PropertyError"]`. The real immutable admission check catches the reset before an extended wait; this is not a measured late native dispatch. |

The deadline control's complete temporary substitution was local to `find`:

```typescript
const reconstructed =
  issuerId === 'controller-2'
    ? {
        ...value,
        operation: {
          ...value.operation,
          limits: {
            ...value.operation.limits,
            deadlineMs: value.operation.limits.deadlineMs + 100,
          },
        },
      }
    : value;
// Decode reconstructed instead of value, then restore exact original source.
```

`git diff --exit-code -- packages/engine/src packages/engine/tests/worker-memory-journal.ts`
exited 0 after restoration at Task 6 qualification. The three final control logs
were `task-6-qualified-control-{claim,cleanup,deadline}-{typecheck,red}.log` in
the transient plan scratch directory. The table, substitutions and replay
coordinates above preserve the evidence after final-review scratch cleanup.

## Investigation And Root Error Evidence

No actual production defect was fixed in Task 6. The initial focused constructive
Release and service root-error tests passed (2 tests / 9 assertions). Initial
static typing/lint issues were test authoring failures, corrected without any
configuration exception. The first safety run hit 30000ms: a stale cancellation
RequestCleanup notification let TestClock advance before shutdown anchored its
drain deadline. Clearing only the notification queue before the fresh shutdown
barrier fixed the fixture; the chronological audit was never cleared. The same
1000-case seed then passed in 3668ms; no budget/timeout was expanded.

First matrix: 28 pass / 3 fail, 36 assertions. All failures were the custody
predicate's mistaken fixture: a different container ID with the same full
operation subject before binding is valid discovery, not foreign ownership.
Foreign now has a genuinely different operation ID; replacement has the next
generation; retained evidence is represented by an escaping retained mount,
not by pretending an artifact path is an immutable container ID. No action mode
or seed was removed. Corrected custody/root/replay selection: 6 pass / 22 assertions.

The first deadline-control attempt also timed out at 30000ms because the test
ignored a canonical reconstruction refusal and waited for cleanup on a service
that never acquired the operation. Canonical acquire now must be Accepted; the
same control promptly falsifies with ConflictingOperation. Later stricter test
experiments incorrectly demanded that every generated service call succeed or
reuse exactly the drain error. A preliminary engine run was 212 pass / 21 fail
(1083 assertions), and two smaller experiments were 0/4. Traces included shutdown
then reconcile, and cancel/reconcile/reconcile after Released. At the Task 6
source these surfaced sanitized actor errors and passed safety-channel auditing;
that historical policy did not prove correct completed-operation classification.
Final review identified normal-release reconciliation as I1. The scoped fix
corrects that API defect without adding an arbitrary-success requirement or
changing any safety law or budget. Historical experiment results remain above.

The deferred root-supervision regression uses the existing journal seam:
a real Claim commits normally, but only its schema-valid returned snapshot omits
that intent. `mutationInput` then fails on the root transition before a mechanism
task can call the driver. A separate test of the **same production machine
definition** observes failed real `join`, root status `error`, `taskError: null`,
`issue: null`, stored Claim retained and zero mechanism calls. The real application
service test verifies sanitized ActorFailed retention through read, shutdown,
repeated shutdown and later read with no leaked cause. This is an adversarial
journal-return contract violation, not normal journal operation or durability
proof. Task 6 and final independent review confirmed this distinction; the
controller closed the deferred minor. The retained root/task failure contracts
remain binding on the final I1 fix.

## Measured Verification

2026-10-20 author qualification: domain **186 tests / 634 assertions**, engine
**233 / 1104**, probe **36 / 104**, total **455 tests / 1842 assertions**.
Task 6 contributes **33 tests / 49 assertions**: 30 law/seed tests (30,000 primary
cases) plus two distinct root-error tests and one literal recovery replay.
The measured full engine run took 131.24s in total; no individual seed test hit
the unchanged 30000ms timeout. This is not a performance comparison or SLA.

Final sequential minimal-environment commands, with no retry/cache/env-file:

| Command                                          | Exit / evidence                                                            |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| `bun install --frozen-lockfile --ignore-scripts` | 0; checked 126 installs across 180 packages, no changes                    |
| `bun run check`                                  | 0; 0 warnings/errors, 210 total lint rules on 62 files; 91 files formatted |
| `moon run domain:typecheck --force --no-actions` | 0; strict, vendor checking                                                 |
| `moon run engine:typecheck --force --no-actions` | 0; strict, vendor checking                                                 |
| `moon run probe:typecheck --force --no-actions`  | 0; original probe-only vendor exception unchanged                          |
| `moon run domain:test --force --no-actions`      | 0; 186 / 634                                                               |
| `moon run engine:test --force --no-actions`      | 0; 233 / 1104                                                              |
| `moon run probe:test --force --no-actions`       | 0; 36 / 104                                                                |
| `git diff --check`                               | 0                                                                          |

The same full sequence is retained as `task-6-final-1..8.log` in controller
scratch; frozen/cohort evidence has separate named logs. Source Git blobs:
`worker-properties.test.ts` = `47bbeed8ca3312240bc85a242b1a7ff9caa92a95`;
`worker-property-fixture.ts` = `0b6ee47fc5306bd64ac5e8f6faf2b5cabf6f2733`.
The final commit/tree identity is appended to the controller ledger/report after
commit, avoiding a self-referential committed tree hash.

Fresh installed-manifest/realpath and JSONC baseline-lock audit passes: exact
Effect 4.0.5, adapter 0.1.0-alpha.6, XState 6.0.0-alpha.64, Bun 1.4.2,
Moon 2.5.4, TypeScript 7.0.2, bun-types 1.4.2, oxlint 1.88.0, oxfmt 0.73.0,
@opsydyn/oxlint-effect 2.0.1; tooling-only Node v24.15.0. All **141 Effect rules
remain at error**. Domain/engine stay strict with `skipLibCheck: false`.
`bun pm ls --all` exits 0. Engine and adapter resolve to the same real Effect
entry `node_modules/.bun/effect@4.0.5/node_modules/effect/dist/index.js`; only one
physical Effect package exists. XState does not itself import Effect, so no
non-consuming-package resolution is invented. Against pre-install `698806c`,
every existing lock package/pin is unchanged; the only new package records are
the two approved packages, private engine only, with no extra transitive records.
Against Task 6 base, manifests/lock have no diff. Current lock blob/SHA-256 remain
`15c84a8a0dac6c0d43c169c682d710674232b6a6` /
`aa90aa27ce4e98d36624b1b701e2f93ea988afa52dc157294b9219809cd5e32e`.

## Final I1 Fix Verification

One final fix wave starts at exact source
`781c71cc83889271702b8aa68e81ded0cc84e975`. Only the service transition helper
changes in production. Successful `done`/`released` ownership must also have
committed CleanupConfirmed; snapshot and retained failures are inspected first.
The same check handles closure racing listener startup. Execution on a completed
owner refuses AlreadyClaimed; no new actor, claim replay or public result shape.

The new `worker-completion.test.ts` literal tests cover normal execution release,
normal cancellation release, and release racing an in-flight reconciliation's
waiter startup. They use the real service and memory journal, TestClock, a
test-only journal-load barrier and an ActorScope finalizer signal, not sleeps or
a production injection API. In the OPEN service both repeated reconciliations
observe the tombstone; reacquisition, later read, first/repeated drain and fresh
service reconstruction work with unchanged complete intent records and exactly
9 execution-path or 8 cancellation-path calls. Execution cannot restart them.

Final test source against the exact original service: **0 pass / 3 fail, 13
assertions**, all ActorFailed. Restoring the fix: **3 pass / 0 fail, 58
assertions**. Command from `packages/engine`, with only PATH/HOME/TMPDIR:
`bun --no-env-file --no-install test tests/worker-completion.test.ts --timeout 30000`.
The unchanged genuine root/task/drain error controls separately pass **6 / 55**.

Fresh sequential final gates, each with only PATH/HOME/TMPDIR, all exit 0:

| Gate                                             | Result                                                     |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `bun run check`                                  | 0 warnings/errors; 63 files, 210 rules; 92 formatted files |
| `moon run domain:typecheck --force --no-actions` | strict/vendor checking passes                              |
| `moon run engine:typecheck --force --no-actions` | strict/vendor checking passes                              |
| `moon run probe:typecheck --force --no-actions`  | existing policy passes                                     |
| `moon run domain:test --force --no-actions`      | 186 tests / 634 assertions                                 |
| `moon run engine:test --force --no-actions`      | 236 / 1162                                                 |
| `moon run probe:test --force --no-actions`       | 36 / 104                                                   |
| `git diff --check`                               | clean                                                      |

Total: **458 tests / 1900 assertions**, including the unchanged 30,000 worker-law
primary cases and all existing law budgets (138,000 primary cases overall).
Frozen script-free install: 126 installs / 180 packages, no changes. Installed
manifest/realpath/baseline-lock audit and package listing pass: exact cohort,
one physical Effect 4.0.5, all 141 Effect rules at error, original strict/vendor
policy. No timeout or budget change. Documentation-only measurement edits are
followed by a fresh root check before commit.

Actual verified source Git blobs: service
`78527618e41711d92952cd1736f307c4f95be9a9`; new completion test
`79681e381130d842a0d232fb5dc2ea8cd649c761`. The original Task 6 law/fixture,
memory-journal and lock identities above remain unchanged. Protected comparison
against the exact input HEAD is empty with only these exact file exclusions:
`README.md`, this assessment, `docs/superpowers/plans/2026-10-19-worker-lifecycle.md`,
`docs/superpowers/specs/2026-10-19-worker-lifecycle-design.md`,
`packages/engine/src/worker-lifecycle-service.ts`, and
`packages/engine/tests/worker-completion.test.ts`. No source-directory blanket.

The execution reports/logs were transient controller scratch. The commands,
final-source RED/GREEN, source identities and measured results above preserve
the qualification independently of scratch cleanup. All six task reviews and
the final scoped rereview are clean; no open finding remains.

Controller verification at `f38b0e45f531c186217af493e444222e9d2ef61c` independently
ran frozen install, root check, all three typechecks, all three test workspaces,
cohort audit and whitespace check sequentially. Every exit was 0: domain
186 tests / 634 assertions, engine 236 / 1162, probe 36 / 104, totaling
458 / 1900. Lint reported zero warnings/errors across 63 files and 210 rules;
all 92 matched files were formatted. The exact cohort, one physical Effect,
all 141 Effect rules and strict/vendor policy remain unchanged. Property budgets
remain 138,000 primary cases in total, including Task 6's 30,000.

The original final review covered `698806c..781c71c`; scoped rereview covered
`781c71c..f38b0e4`, addressing I1 without new breakage. Its race judgment is
precise: the literal holds an in-flight request's pre-transition journal load
while release finishes; the later listener-installation closure fallback is
additionally source-reviewed, not claimed as a separately injected runtime race.
Subsequent completion edits are documentation only. No native/durable proof is
inferred from this approval.

## Remaining Boundaries

The historical Task 6 post-release ActorFailed concern was adjudicated as I1,
not accepted as a limitation. The scoped fix observes a committed tombstone only
for successful done/released ownership, including closure during waiter startup;
it retains failure inspection and does not blanket-catch ActorFailed or accept
all inactive actors. Literal execution/cancellation release and deterministic
in-flight reconciliation regressions pass, without new calls or claims. Final
scoped rereview is clean at `f38b0e4`. Historical controls and identities above refer
to their original source, not this changed service.

All proof here is local Bun, the actual statechart/application service and a
memory journal with controlled fakes. Registry/package admission is separate
from synthetic protocol qualification. Browser/manual proof: none. Native
Docker cleanup/isolation, real providers/subprocess driver, production adapter,
durable storage/controller fencing, process/host-loss recovery, deployment,
real migration, throughput/scaling proof: none. No merge or push. All six task
reviews and the final whole-implementation review are complete and clean for
this offline slice. A local merge or push still needs owner approval.
