# Bun Effect Flue Compatibility

Measured on 2026-10-18. Verdict: **offline-compatible under the approved
source-typecheck policy**. This is a private synthetic-provider probe, not
production qualification or authority to implement/deploy the upgrade service.

## Qualified Combination

| Component | Exact identity |
| --- | --- |
| Platform | Darwin 25.6.0, arm64 |
| Moon | 2.5.4 |
| Moon plugins | Bun 1.0.4; JavaScript 1.3.1 |
| Proto used by Moon | 0.60.2 |
| Bun | 1.4.2 (`744846f84`) |
| Effect | 4.0.5 |
| Flue runtime | 2.3.0 |
| Pi AI / agent-core | 1.3.0 / 1.3.0, single shared AI cohort |
| Valibot / JSON-schema converter | 1.5.0 / 1.8.0 |
| TypeScript / bun-types | 7.0.2 / 1.4.2 |

Root `bun.lock` SHA-256:
`538f6783ab0a56e2df0681655929e878b3a19e4887dea6b867c76efe6453b266`.
Only one root lockfile and one private probe workspace exist. No production
packages were scaffolded. Direct versions are exact; transitives are locked.

Explicit `moon setup` exited 0, reusing installed Proto and Bun; all four setup
actions were skipped. No new runtime download was reported. Moon resolves Bun to
`~/.proto/tools/bun/1.4.2/bun`; there is no Node runtime/toolchain fallback.
Dependency installation used `--ignore-scripts`. A final frozen install made no
changes and emitted no peer warning. No package patch or override was applied.

## Approved Corrections

The first install exposed an overly narrow Valibot 1.1.0 plan pin. Flue declares
`valibot ^1.1.0`, while its resolved converter 1.8.0 requires `^1.5.0`. The owner
approved 1.5.0; both ranges now resolve to one compatible Valibot version.

Once Flue was imported, full dependency-declaration checking exposed:

| Diagnostic | Published declaration | Cause |
| --- | --- | --- |
| TS2846 | `@flue/runtime/types/index.d.ts:4` | Value re-export directly from `../dist/index.d.mts` |
| TS2307 | `@google/genai/dist/genai.d.ts:1` | Missing MCP SDK declaration import |
| TS2416 | `gaxios/build/esm/src/gaxios.d.ts:52` | Fetch declaration lacks Bun's `preconnect` |

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

Moon's resolved graph contains only project `probe` with seven explicit tasks.
Every task has `cache: false`, `retryCount: 0`, `envFile: false`, and no raw state
or transcript outputs. Commands below run from the repository root, sequentially,
with `--force --no-actions`: no affected-only skip, cache replay, automatic retry,
dependency installation or workspace sync during qualification.

| Command | Exit | Observed result |
| --- | --- | --- |
| `bun install --ignore-scripts` after correction | 0 | Compatible pinned cohort |
| `bun install --frozen-lockfile --ignore-scripts` | 0 | No changes or peer warning |
| `bun why valibot` | 0 | One 1.5.0, satisfies both ranges |
| `bun why @earendil-works/pi-ai` | 0 | One shared 1.3.0 |
| `moon query projects` | 0 | One probe, seven tasks, declared options accepted |
| `moon run probe:domain --force --no-actions` (repeated) | 0 | 7 tests, 13 assertions each run |
| `moon run probe:flue --force --no-actions` | 0 | 7 tests, 33 assertions |
| `moon run probe:restart --force --no-actions` | 0 | 2 tests, 13 assertions |
| `moon run probe:cancellation --force --no-actions` | 0 | 3 tests, 9 assertions |
| `moon run probe:report --force --no-actions` | 0 | 7 tests, 13 assertions |
| `moon run probe:typecheck --force --no-actions` | 0 | Strict source/API checking; vendor policy above |
| `moon run probe:test --force --no-actions` (twice) | 0, 0 | 26 executed tests, 81 assertions each run |
| `git diff --check` | 0 | No whitespace errors |

The final repeated aggregate commands actually execute the tests, rather than
restore output. No skipped test is counted as passing evidence. Each task's
missing implementation was observed RED before implementation; startup error
sanitization additionally failed with a real invalid SQLite directory before
the exported wrapper caught/sanitized it. A missing-directory stimulus was
corrected because Flue legitimately creates directories recursively.

## Phase Results

| Phase | Status | What was demonstrated |
| --- | --- | --- |
| Domain | pass | Generation first; phase/digest gates; rejected state identity; fixed limits retained |
| Flue / Effect | pass | Real tool loop, two recordings through one Layer/runtime, observed tool errors, faux-only environment, fail-closed unknown provider, disposal and clean restart |
| Same-host restart | pass | Writer completes receipt, persists app state, emits COMMITTED, receives SIGKILL; new process reads identical receipt/limits with zero provider calls |
| Cancellation | pass | Local reader cancellation leaves work running; explicit abort reaches aborted settlement; completed late work cannot advance cancelled fixture |

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
around 20:54 UTC, about 67 wall-clock minutes including owner-decision pauses,
inside the conservative two-hour cap. Independent whole-branch review follows;
its outcome and any fixes are recorded below before handoff. Work remains on
`codex/bun-effect-flue-probe`; `main` must remain unchanged until owner approval.

## Next Decision

A passing probe permits planning the production domain/port tracer, not starting
it. Review the dependency-declaration policy and this evidence before choosing
that slice. Real-provider and container qualification require separate approval.
