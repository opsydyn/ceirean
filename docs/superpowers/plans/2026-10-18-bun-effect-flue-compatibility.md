# Bun Effect Flue Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish whether the pinned Bun, Effect and Flue combination supports a shared Effect service bridge, file-backed restart and explicit cancellation with a credential-free synthetic provider.

**Architecture:** Establish a Moon-managed Bun workspace monorepo, with one private compatibility project under probes/bun-effect-flue and one root lockfile. Exercise the published Flue runtime and its SQLite adapter with Pi's faux provider, alongside a small pure fixture and application SQLite file. Do not create the production packages yet; report offline compatibility separately from real-provider, Docker and service qualification.

**Tech Stack:** Moon 2.5.4; Bun 1.4.2; effect 4.0.5; @flue/runtime 2.3.0; @earendil-works/pi-ai 1.3.0; valibot 1.5.0; typescript 7.0.2; bun-types 1.4.2.

**Spec:** [Accepted ADR-0001](../../decisions/0001-adopt-effect-and-domain-boundaries.md), specifically Implementation Impact And Probe Plan. [Service architecture](../specs/2026-10-18-internal-upgrade-service-design.md) supplies constraints; its broader worker/deployment design is not authorised by this plan.

Status: approved for inline execution in an isolated worktree. Owner approved
revising Valibot from 1.1.0 to 1.5.0 to satisfy the resolved JSON-schema adapter.
Task 1 resumes with fresh dependency qualification before runtime probes.

## Global Constraints

- Bun is the controller runtime; no automatic fallback to Node.
- Moon owns the project/task graph, not durable application execution.
- Use one private root Bun workspace and root bun.lock; no probe-local lockfile.
- Pin Moon 2.5.4 and Bun 1.4.2 exactly; do not upgrade global tools implicitly.
- Effect >=4.0.0 <4.1.0; this probe pins 4.0.5 and all direct dependencies exactly.
- One Flue runtime per process; no overlapping owners of one conversation.
- One active run; at most two migration repair attempts in the service design.
- The probe has the proposed two-hour total engineering effort cap, including
  investigation, review and reporting. Stop with evidence rather than extend it.
- This plan has no migration repair loop and adds no production run coordinator.
- No real provider, credentials, consumer source, Docker, GitHub writes, cloud
  provisioning, browser journeys, Alchemy or additional workflow engine.
- Install only after plan approval, with lifecycle scripts disabled. Run probes
  without environment-file loading or automatic package installation.
- Launch test/typecheck commands in a sanitised environment containing only PATH,
  HOME and TMPDIR, using env -i or an equivalent explicit subprocess environment.
  Do not inherit actual provider or publication credentials; Flue also receives
  env {}. This is test hygiene, not a hostile-code sandbox guarantee.
- Keep app and Flue state separate. No direct queries or writes to Flue tables.
- Static imports only. Compose Layers once; no live provision chains in helpers.
- A fake provider establishes runtime integration, not real-model acceptance.
- Real worker/model cancellation and host-loss recovery remain not_run.

## Review Focus

1. Inherited credentials or orchestration shortcuts bypass the probe: sanitised
   env, faux-only providers, disabled env files, uncached Moon tasks with zero
   retries, and forced explicit targets rather than affected-only selection.
2. Runtime singletons leak across tests: serial lifecycle tests and child-process
   isolation; teardown must allow a subsequent clean start.
3. Restart replays completed work or resets limits: preserve a completed receipt
   and ledger values across a real process kill, with no new provider call.
4. Cancelling a reader is confused with aborting work: test these separately and
   await terminal settlement after an explicit abort.
5. Missing evidence is promoted to success: partial phases and excluded systems
   remain visible and cannot yield a production-qualified verdict.

## File Map And Scope

All application-like files below are probe fixtures. Create the root workspace
manifest and minimal Moon configuration, but do not promote fixtures into
production or scaffold apps/cli, packages/domain or packages/engine yet.

| Path | Responsibility |
| --- | --- |
| package.json and bun.lock | Private root workspace, shared tooling and the only dependency lockfile |
| .prototools | Exact Moon and Bun pins |
| .moon/workspace.yml and .moon/toolchains.yml | Explicit probe project and Bun task/dependency tooling |
| tsconfig.base.json | Shared strict no-emit compiler settings |
| probes/bun-effect-flue/package.json, tsconfig.json, moon.yml | Private probe, scripts, compiler include set and explicit Moon targets |
| probes/bun-effect-flue/src/fixture.ts | Pure, deliberately minimal transition fixture |
| probes/bun-effect-flue/src/recorder.ts | One Effect service recording tool tokens |
| probes/bun-effect-flue/src/composition.ts | Shared ManagedRuntime and bridge lifetime |
| probes/bun-effect-flue/src/flue-probe.ts | Faux provider, restricted tool and Flue lifecycle |
| probes/bun-effect-flue/src/ledger.ts | Fixture state and receipt in application SQLite |
| probes/bun-effect-flue/src/restart-child.ts | Controlled write/read child-process entry point |
| probes/bun-effect-flue/src/cancellation-child.ts | Isolated cancellation scenarios with parent watchdog |
| probes/bun-effect-flue/src/report.ts | Typed phase results and honest verdict |
| probes/bun-effect-flue/tests/*.test.ts | Focused red/green contract tests |
| .gitignore | Exclude dependencies, state, environment files and raw artifacts |
| docs/assessments/bun-effect-flue-compatibility.md | Sanitised measured results and limitations |

Canonical Moon commands and all dependency installs run from the repository root.
Direct Bun commands below are focused TDD commands run from probes/bun-effect-flue;
they supplement, never replace, final Moon verification. No test command uses
bunx or another implicit installer.

## Moon Workspace Contract

The root package is private, uses packageManager bun@1.4.2 and workspaces
['apps/*', 'packages/*', 'probes/*']. Put TypeScript and bun-types in root
devDependencies; put Effect, Flue, Pi and Valibot in the private probe package
named @leviathan/compatibility-probe. Its typecheck script is tsc --noEmit.
Its tsconfig extends ../../tsconfig.base.json and includes src and tests.

The .prototools pins are moon = '=2.5.4' and bun = '=1.4.2'. This matches the
installed Moon rather than requiring a global upgrade. Configure the Moon v2
plural .moon/toolchains.yml, not v1's singular toolchain.yml. Enable javascript
with packageManager bun, inferTasksFromScripts false and installDependencies
false; enable bun with versionFromPrototools true and installDependencies false.
The explicit workspace project map contains probe: probes/bun-effect-flue only.

In probe moon.yml, use toolchains.default ['javascript', 'bun']. Every task has
options cache false, retryCount 0 and envFile false. Do not declare raw databases
or transcripts as cached task outputs. Register these target commands exactly:

| Target | Command executed in the probe directory |
| --- | --- |
| probe:domain | bun --no-env-file --no-install test tests/fixture.test.ts |
| probe:flue | bun --no-env-file --no-install test tests/flue.test.ts --timeout 15000 |
| probe:restart | bun --no-env-file --no-install test tests/restart.test.ts --timeout 15000 |
| probe:cancellation | bun --no-env-file --no-install test tests/cancellation.test.ts --timeout 15000 |
| probe:report | bun --no-env-file --no-install test tests/report.test.ts |
| probe:typecheck | bun --bun --no-env-file --no-install run typecheck |
| probe:test | bun --no-env-file --no-install test --timeout 15000 |

Explicit setup is allowed only after plan approval: root Bun installs with
--ignore-scripts, followed by Moon configuration/schema and project-graph
validation using the pinned CLI. Do not run setup while writing this plan.
Record Moon/plugin identities and any setup downloads in the evidence report.
Qualification uses moon run TARGET --force --no-actions after setup so it neither
skips unchanged targets nor installs or syncs dependencies during evidence capture.
Run one evidence target at a time; do not fan out Flue lifecycle tasks in parallel.

From a sanitised environment, run probe:domain twice and verify its command
actually executes both times, with no cache replay or automatic retry. Confirm
there is no probe-local bun.lock and no Node toolchain/runtime fallback. These
checks belong to Task 1; subsequent tasks verify through their explicit targets.

## Shared Probe Contracts

Use these exact fixture contracts; they are not the final UpgradeRun API:

```typescript
type FixtureRun = Readonly<{
  phase: 'pending' | 'frozen' | 'verified' | 'cancelled';
  generation: number;
  digest: string | null;
  deadlineMs: number;
  spentMicros: number;
  repairs: number;
}>;
type FixtureCommand =
  | Readonly<{ type: 'freeze'; generation: number; digest: string }>
  | Readonly<{ type: 'verify'; generation: number; digest: string }>
  | Readonly<{ type: 'cancel'; generation: number }>;
type FixtureRejection = 'InvalidPhase' | 'DigestMismatch' | 'StaleGeneration';
type FixtureDecision =
  | Readonly<{ ok: true; state: FixtureRun }>
  | Readonly<{ ok: false; reason: FixtureRejection; state: FixtureRun }>;
type ProbeReceipt = Readonly<{ submissionId: string; uid: string }>;
type PhaseResult = Readonly<{
  phase: 'domain' | 'flue' | 'restart' | 'cancellation';
  status: 'pass' | 'fail' | 'not_run';
  evidence: ReadonlyArray<string>;
}>;
```

Export each type from the file owning it: fixture types from fixture.ts,
ProbeReceipt from flue-probe.ts, PhaseResult from report.ts. The tests use a
frozen fixture with generation 1, digest 'candidate-a', deadlineMs 2000000000000,
spentMicros 12345 and repairs 1. Those values are synthetic, not actual spend or
an operational deadline.

### Task 1: Pure Fixture Under The Pinned Toolchain

**Files:** Create root package.json, bun.lock, tsconfig.base.json, .prototools,
.moon/workspace.yml, .moon/toolchains.yml and .gitignore; create the private probe
package, tsconfig, moon.yml, src/fixture.ts and tests/fixture.test.ts.

**Interfaces:** Produce decideFixture(state: FixtureRun, command:
FixtureCommand): FixtureDecision. Domain rejections return the unchanged original
state. No I/O or runtime services are permitted in fixture.ts.

- [ ] **Step 1: Establish the Moon workspace and test environment.** Verify
  moon --version is 2.5.4 and bun --version is 1.4.2. Create the exact workspace,
  task and version contract above, with all direct dependency pins from Tech
  Stack. Set both packages private true and type module. Use strict TypeScript with
  target ESNext, module ESNext, moduleResolution Bundler, noEmit true,
  allowImportingTsExtensions true and types ['bun-types'] in tsconfig.base.json;
  the probe tsconfig owns include src and tests. Ignore node_modules, .env and
  .env.*, .local, SQLite journal files and .moon/cache, but track Moon config.
  At the root run bun install --ignore-scripts, followed by
  bun install --frozen-lockfile --ignore-scripts, then explicit Moon setup and
  schema/project-graph validation. Inspect bun why @earendil-works/pi-ai; an incompatible duplicate dependency
  cohort blocks the probe rather than prompting unreviewed overrides.
- [x] **Step 2: Write the failing tests.** Test names and exact outcomes:
  'refuses verification before freeze' returns InvalidPhase; 'refuses changed
  digest' returns DigestMismatch; 'refuses a late generation' returns
  StaleGeneration; 'cancelled state rejects verification' returns InvalidPhase;
  'does not mutate rejected state' retains reference identity and all fixed limit
  values. A pending generation-1 state can freeze candidate-a and then verify it.
  Representative assertion:

```typescript
expect(decideFixture(frozen, {
  type: 'verify', generation: 1, digest: 'candidate-b',
})).toEqual({ ok: false, reason: 'DigestMismatch', state: frozen });
```

- [x] **Step 3: Confirm red.** Run bun --no-env-file --no-install test
  tests/fixture.test.ts. Expect a missing implementation/export failure, not a
  dependency resolution or syntax failure.
- [x] **Step 4: Implement the minimal pure decision function.** Check generation
  first; allow cancel from pending/frozen, freeze from pending, verify from frozen
  only with the same digest. Reject other phases. Preserve the three limit fields;
  do not add a production aggregate, budget calculator or retry engine.
- [x] **Step 5: Confirm green through Moon.** Run moon run probe:domain --force
  --no-actions twice, then moon run probe:typecheck --force --no-actions, all
  from the root. All runs must execute and exit 0, without cache replay, task
  retries, automatic install or Node fallback. Validate declared options against
  the pinned CLI's generated schema. Record resolved pins, task commands and platform.
- [ ] **Step 6: Commit the independently passing fixture and tooling.** Stage only
  root workspace/Moon config and the explicit probe files, never dependencies or state; commit
  with message test: establish pinned Bun Effect compatibility fixture.

### Task 2: Real Flue Tool Calls Through One Effect Runtime

**Files:** Create src/recorder.ts, src/composition.ts, src/flue-probe.ts and
tests/flue.test.ts.

**Interfaces:** ProbeRecorder is a Context.Service with record(token: string):
Effect.Effect<number> and count: Effect.Effect<number>. Its implementation is
created by one Layer and increments a private counter. composition.ts exposes
createRecorderBridge(): { record(token: string): Promise<number>; count():
Promise<number>; dispose(): Promise<void>; lifecycle(): { acquired: number;
released: number } }, backed by one ManagedRuntime. Lifecycle diagnostics remain
readable after disposal without running another Effect.

openFlueProbe({ stateDir, instanceId, mode, record }) returns Promise<ProbeHandle>,
where instanceId is a required stable string, mode is 'tool' or 'blocked', record
is the shared bridge function, and ProbeHandle
provides dispatch(message: string): Promise<ProbeReceipt>, read(receipt:
ProbeReceipt, signal?: AbortSignal): Promise<{ text: string; submissionId:
string }>, abort(): Promise<void>, stop(): Promise<void>, providerCalls(): number,
and toolCalls(): number. Stable wrapper errors have code 'runtime', 'aborted' or
'read_cancelled' and preserve a sanitised cause. The handle also exposes
waitForBlockedResponse(): Promise<void> and releaseBlockedResponse(): void as
synthetic-provider test controls; release is idempotent.

- [ ] **Step 1: Write failing tests.** 'two tool calls share one recorder' expects
  counts 1 then 2, total 2 and one Layer acquisition. 'faux-only startup ignores
  ambient credentials' supplies env {} and records zero outbound fetches.
  'unknown provider fails closed' must not resolve a built-in fallback. 'stop then
  restart releases singleton ownership' successfully starts a fresh session.
  'tool failure is observed' injects a rejecting record callback and checks the
  error is represented in the runtime/tool outcome, not reported as successful
  recording. Use test-scoped fetch tripwires, restoring them in finally.
- [ ] **Step 2: Confirm red.** Run bun --no-env-file --no-install test
  tests/flue.test.ts --timeout 15000. Missing bridge implementation must fail.
- [ ] **Step 3: Implement the bridge.** Use ManagedRuntime.make once in
  composition.ts; callbacks run service effects through that instance. Flue uses
  start and sqlite from @flue/runtime/node, plus init, useModel, useTool and
  defineTool from public exports. Use fauxProvider, fauxAssistantMessage and
  fauxToolCall from @earendil-works/pi-ai/providers/faux. Set providers explicitly
  to the faux handle's provider, env {}, agent identity LeviathanProbe and model
  leviathan-probe/fixture. Configure those matching provider/model IDs in the
  faux factory. For each submission, script one recorder tool call followed by
  text probe-complete; the shared-counter test sends two submissions.
  Use Valibot to validate the tool's token string. No sandbox is attached.
- [ ] **Step 4: Enforce lifecycle.** Flue exposes no host shell or consumer files.
  Run singleton lifecycle tests serially; always stop Flue before disposing the
  Effect bridge. Fail on a tool callback invoked after bridge disposal. No
  callback dispatches and reads its own currently executing conversation.
- [ ] **Step 5: Confirm green.** From the root run explicit Moon targets probe:flue,
  probe:domain and probe:typecheck with --force --no-actions, one at a time.
  Record that this used the real Flue tool loop with a synthetic provider, not a
  real model. Do not replace a failing Flue startup with a mocked runtime.
- [ ] **Step 6: Commit the passing runtime bridge.** Stage the four named files;
  commit with message test: probe Flue tools through a shared Effect runtime.

### Task 3: File Backed Recovery Across A Process Kill

**Files:** Create src/ledger.ts, src/restart-child.ts and tests/restart.test.ts;
reuse flue-probe.ts's stable instance ID and receipt readback contract.

**Interfaces:** openLedger(file: string) returns { save(state: FixtureRun,
receipt: ProbeReceipt): void; load(): { state: FixtureRun; receipt: ProbeReceipt }
| null; close(): void }. It uses bun:sqlite for its own fixture row only.
restart-child.ts accepts write or read and a unique stateDir. It writes one JSON
result line with state, receipt, reply and providerCalls; a separate COMMITTED
line signals that both durable writes completed.

- [ ] **Step 1: Write the failing parent-process test.** 'completed receipt and
  limits survive process death' starts a writer, awaits COMMITTED, sends SIGKILL
  and awaits exit, then starts a reader on the same two database files. Assert
  fixed state fields are unchanged, submissionId is identical, reply text is
  probe-complete, and reader providerCalls is 0. Check app.db and flue.db are
  distinct files. An absent application row is an explicit failure, not a reset.
- [ ] **Step 2: Confirm red.** Run bun --no-env-file --no-install test
  tests/restart.test.ts --timeout 15000; expect the missing child/ledger to fail.
- [ ] **Step 3: Implement the child and ledger.** The writer completes one faux
  submission, saves its completed receipt and frozen fixture in app.db, emits
  COMMITTED, then waits for the deliberate kill without graceful teardown. The
  reader bootstraps the same agent identity with file-backed flue.db and reads the
  stored receipt using its original instance ID. Do not dispatch a new message.
  Never inspect Flue's tables or copy only the main file from a live WAL database.
- [ ] **Step 4: Bound processes and state.** Use the absolute current Bun binary
  and --no-env-file --no-install for children, an explicit minimal environment,
  fresh owner-only temporary directories and a 5-second COMMITTED/read watchdog.
  Parent finally blocks kill and await any remaining child, then remove only
  their newly created fixture directory. No consumer path can be an output target.
- [ ] **Step 5: Confirm green.** Run explicit Moon targets probe:restart, probe:flue,
  probe:domain and probe:typecheck with --force --no-actions, one at a time.
  A retained state test within one process does not satisfy this
  task. Record same-host recovery only; no active-job or host-loss claim.
- [ ] **Step 6: Commit the restart probe.** Stage the three new files and any
  explicitly reviewed adapter change; commit with message test: verify probe
  persistence across Bun process restart.

### Task 4: Cancellation Semantics And Evidence Report

**Files:** Create src/cancellation-child.ts, tests/cancellation.test.ts,
src/report.ts, tests/report.test.ts and
docs/assessments/bun-effect-flue-compatibility.md. Implement blocked mode's
behaviour in flue-probe.ts, and link the results from the root README.

**Interfaces:** blocked mode scripts a synthetic provider response paused on an
explicit test barrier. Track whether a local read was cancelled separately from
the underlying submission's terminal outcome. summarize(results: readonly
PhaseResult[]) returns { verdict: 'offline-compatible' | 'blocked'; phases:
readonly PhaseResult[]; realProvider: 'not_run'; docker: 'not_run'; hostLoss:
'not_run'; productionQualification: false }. Require exactly one pass result
with nonempty evidence for each of the four phases to return offline-compatible.
Reject duplicate or unknown phase identifiers during report validation.

cancellation-child.ts accepts read-only or abort and a unique stateDir, waits for
the provider's blocked-response barrier, then performs the selected scenario.
On success it emits JSON with readerOutcome ('read_cancelled' or 'aborted'),
submissionOutcome ('completed' or 'aborted') and cleanup 'confirmed'. Parent
tests use the same minimal environment and child cleanup discipline as Task 3.

- [ ] **Step 1: Write failing cancellation tests.** 'read cancellation does not
  abort the submission' cancels only read's signal, observes read_cancelled, then
  releases the barrier and reads a completed result using the same receipt.
  'explicit abort settles synthetic work' calls abort, then reads until the
  distinct aborted outcome; an abort-intent acknowledgement alone is not success.
  'late completion cannot advance cancelled fixture' exercises Task 1's decision
  after the barrier releases. Tests need deterministic barriers, not arbitrary
  sleeps. Abort and cleanup have a 5-second external watchdog.
- [ ] **Step 2: Write failing reporting tests.** A missing, failed, duplicate or
  evidence-free phase cannot yield offline-compatible. A complete four-phase pass
  retains all three not_run fields and productionQualification false. A thrown
  startup failure remains visible; no test.skip is counted as a phase pass.
- [ ] **Step 3: Confirm red.** Run bun --no-env-file --no-install test
  tests/cancellation.test.ts tests/report.test.ts --timeout 15000. Expect missing
  blocked mode/report behaviour to fail before implementing it.
- [ ] **Step 4: Implement the minimal cancellation and report logic.** Use Flue's
  explicit abort path and await settlement; stopping a read does not substitute.
  Keep the synthetic provider signal-aware. Report real-provider cancellation
  and actual worker cleanup as untested, even when the fake-provider tests pass.
  The watchdog kills an unresponsive probe child and records a failure rather
  than leaving execution running or claiming cleanup succeeded.
- [ ] **Step 5: Run final verification.** From the root run
  bun install --frozen-lockfile --ignore-scripts, then
  moon run probe:typecheck --force --no-actions and
  moon run probe:test --force --no-actions sequentially. Run probe:test twice to
  confirm evidence is rerun rather than restored. Also run git diff --check and
  confirm no nested lockfile or unplanned package exists. All claimed passing phases require recorded
  commands and exit codes; cap exhaustion or a missing phase means blocked.
- [ ] **Step 6: Write and review measured evidence.** Record OS/architecture,
  exact Moon/Bun/plugin identities, resolved dependency cohort and root lockfile
  digest, task commands and effective cache/retry/env-file options, test outcomes,
  elapsed effort, temporary-state cleanup and exclusions. Keep raw databases,
  credentials and transcripts out of Git. Add the report link to the README.
- [ ] **Step 7: Commit the final probe and evidence.** Stage only named source,
  tests and sanitised documentation; commit with message docs: record offline
  Bun Effect Flue compatibility evidence. Stop for owner review of the findings.

## Self Review And Coverage Boundary

The four tasks cover the ADR's narrow compatibility gate: a pure fixture, service
composition, the real Flue tool loop, file-backed same-host restart, cancellation
and evidence classification. Each Review Focus item has an owning test above.

This plan does not implement the production UpgradeRun aggregate, global budget
transactions, worker isolation, package migrations, browser evidence or publishing.
The ADR's broader verification checklist therefore remains open after this probe.
A successful probe permits proposing the next implementation slice; it does not
authorise that slice or qualify the complete service architecture.

The owner-required Moon/Bun workspace is included in Task 1, not an extra service
subsystem. Its setup and verification still count against the same proposed effort
cap. Do not create empty production workspaces to make the repository look larger.

If a package pin, public API, SQLite adapter or cancellation path fails under Bun,
capture the exact blocker and stop. No automatic runtime switch, custom Flue
adapter, patch-package fix, extra workflow engine or live model fallback.

## Evidence Used For Planning

- Local bun --version returned 1.4.2; bun --help confirmed --no-env-file and
  --no-install. No probe code was executed.
- Local moon --version returned 2.5.4; moon run --help confirmed --force and
  --no-actions. No Moon graph, setup, task or configuration was executed.
- Published metadata read on 2026-10-18: effect 4.0.5, @flue/runtime 2.3.0,
  @earendil-works/pi-ai 1.3.0, typescript 7.0.2 and bun-types 1.4.2.
- [Flue Agent API](https://flueframework.com/docs/reference/agent-api/): standalone
  bootstrap, explicit provider selection, receipts and distinct read/abort paths.
- [Flue Provider API](https://flueframework.com/docs/reference/provider-api/): faux
  providers can be registered for tests. Published Pi 1.3.0 declares its faux
  factory and scripted response helpers under providers/faux.
- [Flue database](https://flueframework.com/docs/guide/database/): the documented
  SQLite adapter is used without a custom persistence implementation.
- [Effect ManagedRuntime](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/ManagedRuntime.ts): a shared Layer-backed runtime has an explicit disposal lifetime.
- [Moon Bun handbook](https://moonrepo.dev/docs/guides/javascript/bun-handbook): Bun is configured alongside the JavaScript toolchain, with workspace support.
- [Moon task configuration](https://moonrepo.dev/docs/config/project): caching, task retries and environment-file loading are explicit task options. Validate the plan against Moon 2.5.4, not examples introduced in later v2 releases.
- [Moon toolchain configuration](https://moonrepo.dev/docs/config/toolchain): disable automatic dependency installation for qualification tasks.

## Approval And Execution

Review this plan and choose an execution method before implementation. For this
small, sequential, time-capped probe, native execution is recommended to minimise
handoff overhead; subagent-driven execution remains an option. Preserve explicit
separation between offline probe approval and later paid or container execution.
