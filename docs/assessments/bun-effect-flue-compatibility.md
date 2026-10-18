# Bun Effect Flue Compatibility

Measured on 2026-10-18. Verdict: **offline-compatible under the approved
source-typecheck policy**. This is a private synthetic-provider probe, not
production qualification or authority to implement/deploy the upgrade service.

## Qualified Combination

| Component                       | Exact identity                         |
| ------------------------------- | -------------------------------------- |
| Platform                        | Darwin 25.6.0, arm64                   |
| Moon                            | 2.5.4                                  |
| Moon plugins                    | Bun 1.0.4; JavaScript 1.3.1            |
| Proto used by Moon              | 0.60.2                                 |
| Bun                             | 1.4.2 (`744846f84`)                    |
| Effect                          | 4.0.5                                  |
| Flue runtime                    | 2.3.0                                  |
| Pi AI / agent-core              | 1.3.0 / 1.3.0, single shared AI cohort |
| Valibot / JSON-schema converter | 1.5.0 / 1.8.0                          |
| TypeScript / bun-types          | 7.0.2 / 1.4.2                          |

Original compatibility checkpoint `bun.lock` SHA-256 (before quality tooling):
`538f6783ab0a56e2df0681655929e878b3a19e4887dea6b867c76efe6453b266`.
Only one root lockfile and one private probe workspace exist. No production
packages were scaffolded. Direct versions are exact; transitives are locked.

At that checkpoint, explicit `moon setup` exited 0, reusing installed Proto and Bun; all four setup
actions were skipped. No new runtime download was reported. Moon resolves Bun to
`~/.proto/tools/bun/1.4.2/bun`; there is no Node application runtime fallback.
Dependency installation used `--ignore-scripts`. A final frozen install made no
changes and emitted no peer warning. No package patch or override was applied.

## Approved Corrections

The first install exposed an overly narrow Valibot 1.1.0 plan pin. Flue declares
`valibot ^1.1.0`, while its resolved converter 1.8.0 requires `^1.5.0`. The owner
approved 1.5.0; both ranges now resolve to one compatible Valibot version.

Once Flue was imported, full dependency-declaration checking exposed:

| Diagnostic | Published declaration                 | Cause                                               |
| ---------- | ------------------------------------- | --------------------------------------------------- |
| TS2846     | `@flue/runtime/types/index.d.ts:4`    | Value re-export directly from `../dist/index.d.mts` |
| TS2307     | `@google/genai/dist/genai.d.ts:1`     | Missing MCP SDK declaration import                  |
| TS2416     | `gaxios/build/esm/src/gaxios.d.ts:52` | Fetch declaration lacks Bun's `preconnect`          |

A one-line Flue import reproduces all three without our bridge implementation.
The owner approved probe-local `skipLibCheck: true`, matching
[Flue's own base configuration](https://github.com/withastro/flue/blob/main/tsconfig.base.json).
`strict: true` remains enabled for every probe source and test, including public
API usage. Canonical typechecking now passes. **Vendor declaration consistency
is not qualified**; disabling `skipLibCheck` still exposes these known errors.
This is not a claim that the published dependency declarations are clean.

## Evidence

Every test/typecheck target is launched with only PATH, HOME and TMPDIR inherited
through `env -i`. Bun receives `--no-env-file --no-install`; Flue receives `env: {}`
and an explicit faux-only provider list. This is environment hygiene, not a
hostile-code sandbox guarantee. Only synthetic ambient credentials are used by
the credential-resistance test, and restored in its finally block.

The original Moon graph contained only project `probe` with seven explicit tasks.
Every task has `cache: false`, `retryCount: 0`, `envFile: false`, and no raw state
or transcript outputs. Commands below run from the repository root, sequentially,
with `--force --no-actions`: no affected-only skip, cache replay, automatic retry,
dependency installation or workspace sync during qualification.

| Command                                                 | Exit | Observed result                                   |
| ------------------------------------------------------- | ---- | ------------------------------------------------- |
| `bun install --ignore-scripts` after correction         | 0    | Compatible pinned cohort                          |
| `bun install --frozen-lockfile --ignore-scripts`        | 0    | No changes or peer warning                        |
| `bun why valibot`                                       | 0    | One 1.5.0, satisfies both ranges                  |
| `bun why @earendil-works/pi-ai`                         | 0    | One shared 1.3.0                                  |
| `moon query projects`                                   | 0    | One probe, seven tasks, declared options accepted |
| `moon run probe:domain --force --no-actions` (repeated) | 0    | 7 tests, 13 assertions each run                   |
| `moon run probe:flue --force --no-actions`              | 0    | 7 tests, 33 assertions                            |
| `moon run probe:restart --force --no-actions`           | 0    | 2 tests, 13 assertions                            |
| `moon run probe:cancellation --force --no-actions`      | 0    | 3 tests, 9 assertions                             |
| `moon run probe:report --force --no-actions`            | 0    | 7 tests, 13 assertions                            |
| `moon run probe:typecheck --force --no-actions`         | 0    | Strict source/API checking; vendor policy above   |
| `moon run probe:test --force --no-actions` (twice)      | 0, 0 | 26 executed tests, 81 assertions each run         |
| `git diff --check`                                      | 0    | No whitespace errors                              |

The final repeated aggregate commands actually execute the tests, rather than
restore output. No skipped test is counted as passing evidence. Each task's
missing implementation was observed RED before implementation; startup error
sanitization additionally failed with a real invalid SQLite directory before
the exported wrapper caught/sanitized it. A missing-directory stimulus was
corrected because Flue legitimately creates directories recursively.

## Phase Results

| Phase             | Status | What was demonstrated                                                                                                                                           |
| ----------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain            | pass   | Generation first; phase/digest gates; rejected state identity; fixed limits retained                                                                            |
| Flue / Effect     | pass   | Real tool loop, two recordings through one Layer/runtime, observed tool errors, faux-only environment, fail-closed unknown provider, disposal and clean restart |
| Same-host restart | pass   | Writer completes receipt, persists app state, emits COMMITTED, receives SIGKILL; new process reads identical receipt/limits with zero provider calls            |
| Cancellation      | pass   | Local reader cancellation leaves work running; explicit abort reaches aborted settlement; completed late work cannot advance cancelled fixture                  |

App state uses its own `bun:sqlite` file and schema-validated checkpoint. Flue
uses its unmodified published SQLite adapter in a distinct file. No direct
queries of Flue tables, live-WAL copying, new dispatch on recovery, resetting
missing limits, or same-process reopening stands in for the kill test.

Cancellation children wait on a deterministic provider-entry barrier, not a
sleep. The faux provider observes the supplied AbortSignal. The read-only case
releases the barrier twice (idempotently) and reads the original receipt to
completion. Abort intent acknowledgement alone is insufficient: the child must
observe a distinct aborted read outcome. Cleanup is reported only after Flue
stops and the shared Effect runtime is disposed; acquisition/release counts are
checked. Parent watchdogs bound commit/read/abort/cleanup to five seconds and
kill/await a stuck child instead of reporting success.

The report validator requires exactly one evidenced pass for every phase.
Missing, failed, unrun or blank-evidence phases block compatibility; duplicate
and unknown identifiers throw. Caller mutation cannot erase captured evidence.
The validator classifies supplied evidence; it is not a production qualification
authority or a proof that arbitrary evidence strings are truthful.

## Cleanup And Limits

Each process test owns a fresh mode-0700 temporary directory, explicitly starts
the absolute current Bun binary with a minimal environment, and kills/awaits any
remaining child before removing that directory. Flue stops before Effect disposal.
The writer's SIGKILL deliberately bypasses graceful shutdown. No raw database,
transcript, credential, downloaded dependency or Moon cache is tracked in Git.
An additional host-wide process-table audit was unavailable (`pgrep` could not
access sysmond); cleanup claims refer to the test-owned children that were
explicitly awaited, not an independent scan of every host process.

Real-provider behavior/cancellation, Docker, actual worker cleanup, host-loss
recovery, active-job crash recovery, production budget transactions, consumer
migrations, browser evidence, GitHub publication and deployment remain **not_run**.
`productionQualification` is always false, even for four passing offline phases.
There were no real model requests, consumer repository changes, cloud resources,
GitHub writes or automatic runtime changes.

Execution began at 19:46:45 UTC. Verification/reporting reached this checkpoint
around 20:54 UTC; independent review and handoff documentation finished around
21:01 UTC, about 74 wall-clock minutes including owner-decision pauses, inside
the conservative two-hour cap. Work remains on
`codex/bun-effect-flue-probe`; `main` must remain unchanged until owner approval.

## Independent Review

A fresh-context reviewer inspected `6930126..f87db3d` and found no Critical,
Important or Minor issues. It independently reran all 26 tests (81 assertions),
the canonical source typecheck and whitespace check under the minimal environment,
verified the lockfile digest and confirmed both checkouts clean with main still
at `6930126`. It recommended the bounded offline probe as ready for owner-approved
integration, not production acceptance. No code fix or deferred minor remained.
That review applies to the original probe, not the later quality-tooling follow-up.

The reviewer did not independently replay historical installs, RED stages,
Moon invocations or timing measurements, or audit the whole host process table.
Those are session evidence, not independent reviewer proof.

## Quality Follow-Up

The separately approved Oxlint/oxfmt adoption adds schema codecs at JSON
boundaries, inferred recorder channels, explicit SQLite resource ownership and
Promise cleanup without changing the tested probe outcomes. Four new codec tests
brought the suite to 30 tests and 87 assertions. The subsequent approved SQLite
cleanup fix adds six failure/lifetime tests, bringing it to 36 tests and 104
assertions. The full ruleset and canonical source typecheck pass; the vendor
declaration policy and all production qualification exclusions above remain
unchanged.

The current graph has two Moon projects and ten tasks: the existing seven probe
tasks plus three uncached root quality targets. Node 24.15.0 is explicitly pinned
for root developer tooling only; probe tasks retain their Bun toolchain.
Current lockfile identity, gate results and review scope are recorded in
[Quality Tooling](code-quality-tooling.md). The historical table above is not a
claim that its old lock digest or project count describes the current worktree.

## Execution Decisions

This records the inline executor's decisions, including historical blocked
checkpoints, before its temporary planning workspace is removed:

1. Complete independent fixture/Moon setup while awaiting the pin decision, but
   do not run an unsupported Flue cohort. Cost if wrong: wasted setup effort.
2. Initially withhold faux-provider/credential/fetch safety claims until Task 2.
   Cost if wrong: unsafe runtime assumptions. These tests subsequently passed.
3. Initially withhold runtime lifetime/teardown claims. Cost if wrong: ownership
   leaks. These tests subsequently passed.
4. Initially withhold SIGKILL receipt/limit recovery claims. Cost if wrong:
   replay/reset risk. These tests subsequently passed.
5. Initially withhold read/abort/cleanup claims. Cost if wrong: continuing work.
   The bounded synthetic tests subsequently passed.
6. Initially retain only a blocked Markdown report until validation exists.
   Cost if wrong: false machine-readable qualification. Validator tests now pass.
7. Keep runtime input validation and production aggregate/budget/transaction
   guarantees outside the minimal fixture. Cost if wrong: mistaking it for a service.
8. Exclude real providers, Docker, actual worker cleanup, host loss, migrations
   and publication. Cost if wrong: unqualified production adoption.
9. Treat historical runs as session evidence, not independent replay. Cost if
   wrong: overstated independent provenance.
10. Save the failed-typecheck checkpoint pending explicit policy approval rather
    than completing Task 2. Cost if wrong: extra owner-decision overhead. Resolved
    by the approved probe-local policy, not a dependency patch.
11. Add one shared test-only child/watchdog helper for Tasks 3-4. Cost if wrong:
    one extra helper file; no production abstraction.
12. Final review retains the vendor-declaration exclusion. Cost if wrong:
    internal declaration inconsistencies escape this source gate.
13. Final review retains the real-provider/model and Docker/worker exclusions.
    Cost if wrong: unsafe external-runtime acceptance.
14. Final review excludes active-job crash and host-loss recovery. Cost if wrong:
    incorrect recovery assumptions beyond completed-receipt restart.
15. Final review excludes production transactions, migrations and service
    readiness. Cost if wrong: premature deployment or incorrect migrations.
16. Report validation classifies evidence strings, not their authenticity.
    Cost if wrong: a future untrusted caller could supply fabricated evidence.
17. Final review distinguishes recorded installs/RED/Moon/timing/host-cleanup
    evidence from its own test/typecheck reruns. Cost if wrong: overstated proof.

## Next Decision

A passing probe permits planning the production domain/port tracer, not starting
it. Review the dependency-declaration policy and this evidence before choosing
that slice. Real-provider and container qualification require separate approval.
