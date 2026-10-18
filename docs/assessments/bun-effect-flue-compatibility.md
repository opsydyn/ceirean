# Bun Effect Flue Compatibility

Status: **blocked at dependency qualification**, 2026-10-18. This is a partial
probe, not evidence that Bun or Flue failed at runtime.

## Dependency Gate

The approved exact direct pins installed successfully with scripts disabled:
Effect 4.0.5, Flue runtime 2.3.0, Pi AI 1.3.0, Valibot 1.1.0, TypeScript 7.0.2
and bun-types 1.4.2. Frozen installation made no changes. Pi agent-core resolves
to 1.3.0 and shares a single Pi AI 1.3.0 cohort with Flue and the probe.

However, Flue's `@valibot/to-json-schema ^1.3.0` dependency resolved to 1.8.0.
That adapter declares peer `valibot ^1.5.0`; the approved 1.1.0 pin does not
satisfy it. Bun emitted `incorrect peer dependency "valibot@1.1.0"`.
`bun why valibot` confirms this exact dependency path. A successful install is
not a compatible peer cohort, so Flue has not been started.

No overrides, transitive downgrades, package patches or runtime fallback were
applied. Owner approval is requested to revise only Valibot to 1.5.0, regenerate
the root lockfile, and rerun installation qualification before Task 2.

Root `bun.lock` SHA-256 at this checkpoint:
`0fc09cdaba505325eb33c91b604a49d6d4af579d119ede9dc923751bf7e80c6e`.

## Verified Subset

Platform: Darwin 25.6.0, arm64. Bun 1.4.2 (`744846f84`), Moon 2.5.4.
Moon reports Bun plugin 1.0.4 and JavaScript plugin 1.3.1. Explicit `moon setup`
exited 0, reusing installed Proto 0.60.2 and Bun 1.4.2; all four setup actions
were skipped. No new runtime download was reported. Moon's Bun executable is
`~/.proto/tools/bun/1.4.2/bun`; no Node toolchain is configured.

Tests and typechecking ran with only PATH, HOME and TMPDIR inherited, using
`env -i`. This is environment hygiene, not hostile-code containment.

| Command | Exit | Observed outcome |
| --- | --- | --- |
| `bun install --ignore-scripts` | 0 | Peer warning above; 112 packages installed |
| `bun install --frozen-lockfile --ignore-scripts` | 0 | No lockfile or install changes |
| `bun why @earendil-works/pi-ai` | 0 | One 1.3.0 cohort |
| `bun why valibot` | 0 | Unsatisfied ^1.5.0 adapter peer |
| `moon setup` | 0 | Pinned workspace configuration accepted |
| `moon query projects` | 0 | Only probe project; seven explicit targets |
| `moon run probe:domain --force --no-actions` (twice) | 0, 0 | Seven actual test executions each time, no cache replay |
| `moon run probe:typecheck --force --no-actions` | 0 | Current fixture and tests only |

The direct TDD run first failed because `src/fixture.ts` did not exist. After
implementation, all seven tests passed (13 assertions): phase gating, digest
identity, stale generation, cancellation, rejected-state identity and fixed limits.
This fixture is deliberately not a production UpgradeRun aggregate.

Moon accepted the v2 plural toolchains configuration. Its resolved project
configuration records every target with `cache: false`, `retryCount: 0` and
`envFile: false`; tasks also pass Bun `--no-env-file --no-install`. No database or
transcript is a declared output. Qualified commands use `--force --no-actions`
to execute explicitly without dependency setup or affected-only skipping.

Only root `bun.lock` exists. There are no empty production packages. The general
`probe:test` target currently covers the fixture only; its exit status must not
be treated as the four-phase compatibility verdict.

## Phase Results

| Phase | Status | Evidence or gap |
| --- | --- | --- |
| Domain | pass | Seven fixture tests executed twice through uncached Moon |
| Flue / Effect bridge | not_run | Blocked on peer cohort decision |
| Process-kill restart | not_run | Depends on Flue gate |
| Read cancellation and abort | not_run | Depends on Flue gate |

Verdict: **blocked**. Real providers, Docker, host-loss recovery, actual worker
cleanup and production qualification are **not run / not qualified**. No model
calls, credentials, consumer repository access, GitHub writes or cloud resources
were used. No application/Flue database or child runtime process was created.
Installed dependencies and Moon's ignored local cache remain for resumption.

## Resume

1. Resolve the Valibot pin explicitly; do not silently override dependencies.
2. Repeat root install and frozen install with `--ignore-scripts`; inspect both
   Pi and Valibot dependency cohorts.
3. Continue Task 2 of the approved plan, then the real process-kill and
   cancellation probes. Keep all remaining phases `not_run` until measured.

Execution began at 19:46:45 UTC; this checkpoint was recorded at approximately
19:53 UTC, within the two-hour engineering cap. The work is isolated on
`codex/bun-effect-flue-probe`; `main` is not merged or changed.
