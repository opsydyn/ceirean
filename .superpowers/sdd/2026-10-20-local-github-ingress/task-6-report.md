# Task 6 Report

Status: DONE. Implementation and final local qualification complete.

## Source Identity

- Checkout: /private/tmp/leviathan-compatibility
- Branch: codex/local-github-ingress
- Base: bb2c3cd01fe355f76fbd327c79c64dc240f90937
- Frozen application tree: 712a7c1eaf007a39e2dfb4321ea69529c7b1393b
- Staged source root before report/evidence: 0493af59dfb94b6cc64fab87572e3aa65db6c929
- Commit identity is supplied in the handoff and Git history; the report cannot
  embed its own containing commit/tree without a self-reference.

## Implementation

Private apps/github-ingress provides schema-decoded init/start/status/configure,
explicit config/credential references, revision-checked stopped-owner configure,
contained database override, and the conventional default state root/database.
Config rejects unknown nested keys, malformed/duplicate flags, unsafe IDs,
empty/duplicate operator allowlists and invalid path references. Non-start
commands do not read credential files or acquire authority/start resources.

One exported composition boundary owns one ManagedRuntime and narrow Bun
FileSystem/Path/Stdio layers. Scoped storage and native authority are acquired
once through actual inferred resource factories and explicit Layers. The engine
driver and existing engine/adapter source remain unchanged. Public imports do
not start acquisition, a runtime, listener or server.

Only POST /webhook is served on loopback. Four retained request owners and a
60-start rolling minute precede expensive handling. Exactly expired starts are
removed. Request outcomes are bounded at eight seconds; real native cleanup is
retained rather than replaced by unbounded new work. Existing native authority
keeps its two-second attempt/six-second total budgets and four retained owners.
Public responses contain only finite dispositions/failures and opaque bounded
correlation IDs, never records, policy, evidence or native error messages.
Malformed/signature/media/size/conflict/operational statuses are preserved.
Verified ping/ignored events require no authority calls. Rejections are not
projected as accepted, and uncommitted previews are never acknowledged.

Main owns argv, signals, sanitized exit reporting and forced termination. On
signal, accepts stop, request owners abort/drain, listener transport completion
is awaited, then native authority disposal and storage close complete in order.
A stuck native finalizer keeps disposal pending. Main forces exit 1 at ten
seconds with FailedShutdown, never a false clean-close claim. Child tests
separately reopen the ledger after process death.

## Host Ruling

No additional JSON/environment host-context channel was added. HOME/TMPDIR use
Effect Config; effective UID/cwd are sampled with Effect.sync at native
infrastructure. Only a cwd with a .git marker is a declared current repository;
storage independently rejects repository ancestors. Conventional current-cwd
build directories and standard temporary/macOS sync roots are supplied once.
Typed test injection alone permits exact test-owned temporary storage. The
four-key CLI JSON cannot select that bypass.

The app README records the operator's local/non-synced invocation requirement
and its limits. Explicit custom roots remain admissible; the app does not claim
to discover arbitrary external build directories, sync software or network
mounts. No Task 7 runbook/recovery report was created.

## TDD And Focused Evidence

See task-6-evidence/tdd-progress.md for commands and actual RED/GREEN excerpts.
Behavioral RED preceded config/argv, listener limits, CLI state commands and
main implementation. Further RED regressions covered inherited argv properties,
recorded-rejection projection, synchronous listener failure, body ownership and
the native HOME/cwd exclusion bug. Qualification-only tests that passed on first
addition are identified as such, not falsely labelled RED cycles.

Tests use synthetic keys, injected fake HTTP, explicit deferred phases, Bun
controlled timers, ephemeral loopback and test-owned storage. There are no
arbitrary sleeps or increased Moon timeout/law budgets. The ten-second child
test uses the specified 30000ms workspace test budget; an early focused command
with Bun's 5000ms default timed out and is recorded, not hidden.

## Final Gates

The full block ran sequentially under
`env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR"`, with force/no-actions,
cache disabled, retryCount 0 and no env file. All gates exited 0:

1. `bun install --frozen-lockfile --ignore-scripts`
2. `bun run check`: zero lint warnings/errors and formatting passed.
3. Six Moon typechecks: domain, engine, probe, github-admission,
   github-adapter, github-ingress.
4. Six Moon suites in the same order: 211, 300, 36, 135, 196, 25 passing;
   903 total, zero failures. The app suite has 354 assertions and took 12.00s.
5. `git diff --check` and additionally `git diff --cached --check`.

Raw final logs are 01 through 16 in task-6-evidence/. All 28 raw console logs
(including superseded output and integrity/lock command logs) are committed
losslessly in raw-gate-logs.tar.gz; readable copies remain in the local checkout.
Archive SHA256: 7d9b86923cfc50b4115830ac81dce45afcd30bdabb0bf212da9142910a50f734.
Every archive member was extracted to stdout and byte-compared with its original:
28/28 matches. See 21-evidence-packaging.md for the Git-whitespace packaging fix.
Integrity output in
19-integrity.json independently extracts all six passing suite totals from the
logs, verifies all 141 Effect rules at error severity, one physical Effect
resolution across six workspaces, one ManagedRuntime owner, and absence of Node
imports/direct environment reads/Effect runners/manual Effect or Layer channels
in application source. New tsconfig keeps skipLibCheck false.

Lock delta (17-lock-delta.log) contains only the private workspace and links to
already-admitted dependencies. Root override remains platform-node-shared 4.0.5.
SHA256 values from 18-hashes.log:

- bun.lock: 8cb4d58bd88280daee28101e542cd9b7120ec7ee63dd5094daf59c2a45fddf59
- Flue patch: 07d115c8c98bea3c28011afe76e838a89a5126b2f401bad1091af678c008931a
- Gaxios patch: 7ea7b1f29d158ab1595b71f798b71c9c44249ae29567b12dcf6d5d7e35239e3e

Bun install required exact-command escalation after tempdir EPERM. Native
loopback tests used the previously demonstrated sandbox escalation. The final
app gate printed Moon's update-available notice; no tooling was updated.
The earlier attempt is retained in pre-host-fix/ and is not used as final-source
qualification. No pre-change baseline was rerun, and no failing suite was
retried into a green claim. Focused RED/development failures are recorded in
tdd-progress.md rather than omitted.

## Self-Review

Reviewed the actual source/diff and acquisition graph personally. Fixed recorded
rejection projection, inherited-property argv acceptance, synchronous listener
throws, body ownership lost through Request copying, and unconditional cwd
repository exclusion. Kept true cleanup pending rather than faking completion.
Final source/lock/lint/engine/adapter boundaries match the constraints. There is
no remaining known implementation issue from self-review; independent controller
review is still outstanding and was not impersonated by another agent.

## Changed Files

- apps/github-ingress: manifest, strict tsconfig, explicit Moon tasks, README;
  src/config.ts, cli.ts, composition.ts, listener.ts, responses.ts, main.ts;
  tests/config.test.ts, cli.test.ts, listener.test.ts, restart.test.ts,
  restart-child.ts and one shared fixtures.ts.
- .moon/workspace.yml: explicit github-ingress project.
- bun.lock: new private workspace and existing exact dependency links only.
- This task report and task-6-evidence/ only within SDD artifacts.

Root already admitted apps/*, so root package.json is unchanged. Lint config,
engine/adapter source, controller ledger and review artifacts are unchanged.
No agents/reviewers were dispatched; self-review only. Controller review remains
external to this implementer task.

## Limitations

Local synthetic qualification is not live GitHub/App/tunnel acceptance. No real
credentials/API, live CLI start, push or merge was used. Filesystem locality and
absence of arbitrary sync software remain operator declarations, not mechanical
proof. No Task 7 work or future release/publication work was started.
