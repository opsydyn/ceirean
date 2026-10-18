# Quality Tooling

Measured on 2026-10-18 in the isolated `codex/bun-effect-flue-probe` worktree.
This is a separately approved quality follow-up to the completed compatibility
probe, not a production architecture migration or permission to merge/publish.

## Policy And Pins

| Tool                   | Exact version | Role                                                 |
| ---------------------- | ------------- | ---------------------------------------------------- |
| Oxlint                 | 1.88.0        | Standalone linter and JavaScript-plugin host         |
| oxfmt                  | 0.73.0        | Source, configuration and Markdown formatting        |
| @opsydyn/oxlint-effect | 2.0.1         | Complete Effect 4-applicable policy                  |
| Node                   | 24.15.0       | Root development tooling only                        |
| Bun / Moon             | 1.4.2 / 2.5.4 | Unchanged application runtime and task orchestration |

Installed plugin exports and the resolved configuration both contain 141 rules,
all at `error`; the recommended subset contains 121. Five registered legacy-only
rules are excluded by the package's Effect 4 preset, not disabled locally.
Version-sensitive rule options retain `effectVersion: 4`.

Native platform access, process environment reads and Effect execution use narrow
configured adapter paths and test boundaries. They are not file exclusions or
rule disables. Owned source and tests remain linted. Dependency, build, cache,
coverage and local-state directories are ignored; the generated lockfile is not
formatted. There are no inline lint suppressions. Type-aware engine extensions
are a separate opt-in and are not installed or claimed here.

Root scripts are `lint`, `lint:fix`, `format`, `format:check` and `check`.
Moon adds `workspace:lint`, `workspace:format-check` and `workspace:check` with
explicit inputs, caching off, zero retries and dotenv loading off. The root Moon
project is not another Bun package workspace.

Moon prepends Proto shims to PATH. The initial root task therefore selected an
unconfigured Node shim rather than the host Node. The repair is an explicit
`.prototools` Node pin and root Node toolchain, not a machine-specific PATH hack.
`moon setup` succeeds with five setup actions skipped/reused. The probe's seven
tasks continue to use only JavaScript/Bun toolchains. Node is not an application
fallback. See [Moon toolchain configuration](https://moonrepo.dev/docs/config/toolchain).

## Baseline And Repairs

The initial full-ruleset run reported 49 errors, zero warnings:

| Rule                            | Count |
| ------------------------------- | ----: |
| no-try-catch                    |    22 |
| no-naked-object-state-update    |     9 |
| no-node-platform-in-shared-code |     6 |
| no-process-env-direct-read      |     3 |
| no-manual-effect-channels       |     2 |
| no-return-in-arrow              |     2 |
| no-ternary                      |     1 |
| no-manual-resource-close        |     1 |
| no-string-sentinel-const        |     1 |
| no-call-tower                   |     1 |
| prefer-extracted-concept        |     1 |

The formatter initially identified 19 files. It now covers owned code and docs,
including pre-existing Markdown tables; formatting changes are mechanical.

Repairs introduce Effect Schema JSON codecs for checkpoint/restart/cancellation
payloads, infer the recorder service channels, and give the synchronous SQLite
adapter explicit Effect acquire/release ownership. Native Promise boundaries
keep native errors and cleanup semantics while using named operations and
`finally`/`catch` instead of inline `try` blocks. No dependency cohorts, provider
policy, phase transitions, fixed limits or cancellation outcomes were changed.

Four codec tests preserve exact payloads and reject malformed evidence. Existing
process-kill, receipt, cleanup, late-result and faux-provider tests still run.

## Verification

Current root `bun.lock` SHA-256:
`2c6a6314fe34785bf8e16fbba6cd556661b0501112a6027febbed274a1fc8c20`.

Checks use `env -i` with only PATH, HOME and TMPDIR inherited; stateful tests run
sequentially. Moon checks use `--force --no-actions`, so results are executed,
not cache replays or dependency installs.

| Check                                           | Observed result                                                 |
| ----------------------------------------------- | --------------------------------------------------------------- |
| Frozen install with `--ignore-scripts`          | Exit 0; no changes                                              |
| `bun run check`                                 | Exit 0; zero lint errors/warnings; formatting clean             |
| `moon run workspace:check --force --no-actions` | Exit 0; lint and formatting clean                               |
| `moon run probe:typecheck --force --no-actions` | Exit 0; strict owned source                                     |
| `moon run probe:test --force --no-actions`      | Exit 0; 36 tests, 104 assertions                                |
| Installed config audit                          | 141 Effect rules; no non-error entries; one plugin registration |
| Strict-only negative control                    | Exit 1; `no-unknown-public-error-channel` reported              |
| Inferred-channel clean control                  | Exit 0; no diagnostics                                          |

The temporary negative control exported a function with an unknown Effect error
channel. It proved a rule outside the recommended subset actually executed,
rather than merely appearing in the config map. Other applicable diagnostics
were also reported. Its inferred Effect constant counterpart passed. These
controls were outside the repository and are not shipped source.

## Review And Limits

A fresh read-only reviewer inspected the uncommitted change against `ac7f4ba`,
including the new config, codecs and tests, and found no actionable regressions
introduced by the change. It independently checked the 141-error-rule map,
checkpoint schema parity and cleanup ordering. It did not rerun stateful tests;
the command results above are executor evidence.

That review identified a pre-existing SQLite initialization leak and missing
cleanup-failure coverage. The separately approved follow-up below addresses
those adapter paths. Codec tests still primarily prove round trips, not an
independently maintained legacy-payload compatibility matrix.

## SQLite Cleanup Follow-Up

Initialization now executes inside the Effect that owns the acquired database.
If either PRAGMA or table creation throws, `onError` closes its scope before the
synchronous adapter throws to its caller. Successful initialization retains the
open scope until the returned handle is explicitly closed; repeat close remains
idempotent.

The boundary uses `runSyncExit` rather than `runSync` because squashing a combined
initialization/cleanup cause otherwise exposes only its first error. A single
native error retains object identity; multiple defects become an `AggregateError`
containing both original errors. A cleanup failure is never reported as success.

Six tests cover failures at each of the three initialization statements, normal
handle lifetime and idempotent close, explicit-close error visibility, and
combined initialization/cleanup failures. Fault injection patches only a native
statement or close method: real SQLite databases are acquired and closed. Tests
assert that the database cannot be queried after initialization failure, not just
that a mocked close method was called. Spies are restored in finalizers.

All three statement tests were observed RED against the old implementation:
`SELECT 1` still succeeded after failed initialization. The double-failure test
was separately observed RED with only the initialization error reported. The
focused suite is now six passes and 17 assertions; the aggregate is 36 passes
and 104 assertions. No dependency, lockfile, lint-policy or application API change
was required.

These tests demonstrate adapter ownership and error reporting under injected
faults. They do not guarantee that native SQLite can release a handle when its
own close operation fails before doing so; the close-failure fixture closes the
real database before throwing. They do not qualify production storage recovery.

A fresh read-only review of the follow-up against `78b0124` found no actionable
findings. It verified finalizer registration, scope closure semantics and error
preservation against installed Effect 4.0.5, and independently ran typecheck and
lint. It did not rerun stateful tests during executor verification. The focused
tests use in-memory databases, not disk-backed WAL failure fixtures; exact native
close call counts and aggregate ordering are not asserted.

The original review and compatibility qualification limits remain in
[Bun Effect Flue Compatibility](bun-effect-flue-compatibility.md). In particular,
probe-local `skipLibCheck` does not qualify vendor declaration consistency, and
synthetic provider tests do not qualify real providers, containers or deployment.
