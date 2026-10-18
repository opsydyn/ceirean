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
| `moon run probe:test --force --no-actions`      | Exit 0; 30 tests, 87 assertions                                 |
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

The pre-existing SQLite initialization failure path remains: if a PRAGMA or table
creation throws after opening the database, no ledger handle is returned to close
it. Scope ownership now covers the normal returned handle, not that failure path.
Cleanup-rejection paths also lack failure-injection tests. Codec tests primarily
prove round trips, not an independently maintained legacy-payload compatibility
matrix. These are explicit probe limitations to address before production adapter
work, not evidence of qualified resource recovery.

The original review and compatibility qualification limits remain in
[Bun Effect Flue Compatibility](bun-effect-flue-compatibility.md). In particular,
probe-local `skipLibCheck` does not qualify vendor declaration consistency, and
synthetic provider tests do not qualify real providers, containers or deployment.
