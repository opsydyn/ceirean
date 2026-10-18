# Bun Effect Flue Compatibility

Status: **blocked at dependency declaration checking**, 2026-10-18. The Valibot
cohort is corrected and the initial real Flue/Effect tests pass. Restart and
cancellation remain unrun; the whole probe is not yet qualified.

## Dependency Gate

The approved exact direct pins installed successfully with scripts disabled:
Effect 4.0.5, Flue runtime 2.3.0, Pi AI 1.3.0, Valibot 1.5.0, TypeScript 7.0.2
and bun-types 1.4.2. Frozen installation made no changes. Pi agent-core resolves
to 1.3.0 and shares a single Pi AI 1.3.0 cohort with Flue and the probe.

The original Valibot 1.1.0 pin caused a peer warning: Flue's converter dependency
resolved to `@valibot/to-json-schema 1.8.0`, which requires `valibot ^1.5.0`.
The owner approved changing Valibot to 1.5.0. Fresh normal/frozen installs exit 0
without the warning; `bun why valibot` confirms one compatible 1.5.0 cohort.

No overrides, transitive downgrades, package patches or runtime fallback were
applied. The root lockfile changed only the direct Valibot pin and resolved
Valibot package identity.

Root `bun.lock` SHA-256 at this checkpoint:
`538f6783ab0a56e2df0681655929e878b3a19e4887dea6b867c76efe6453b266`.

## Current Type Gate

Once Flue is imported, the unchanged strict compiler reports three errors inside
dependencies, with no remaining probe-source diagnostics:

| Diagnostic | Published declaration | Cause |
| --- | --- | --- |
| TS2846 | `@flue/runtime/types/index.d.ts:4` | Value re-export directly from `../dist/index.d.mts` |
| TS2307 | `@google/genai/dist/genai.d.ts:1` | Missing `@modelcontextprotocol/sdk/client/index.js` declaration |
| TS2416 | `gaxios/build/esm/src/gaxios.d.ts:52` | Fetch interface lacks Bun's `preconnect` property |

The same diagnostics reproduce with only `export { init } from '@flue/runtime'`
and the probe's strict compiler options. No bridge implementation is needed to
trigger them. The reproduction runs from the probe dependency context; a scratch
file outside that workspace initially could not resolve Flue and was relocated.

[Flue's own base tsconfig](https://github.com/withastro/flue/blob/main/tsconfig.base.json)
enables both `strict: true` and `skipLibCheck: true`. A diagnostic-only run using
`tsc --noEmit --project probes/bun-effect-flue/tsconfig.json --skipLibCheck`
exits 0. This checks our source/API usage, not dependency declaration internals.
The flag is **not persisted**; owner approval was requested before changing the
qualification policy. The canonical Moon typecheck still exits 1.

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
| `bun install --ignore-scripts` after pin correction | 0 | No peer warning |
| `bun install --frozen-lockfile --ignore-scripts` | 0 | No lockfile or install changes |
| `bun why @earendil-works/pi-ai` | 0 | One 1.3.0 cohort |
| `bun why valibot` | 0 | One compatible 1.5.0 cohort |
| `moon setup` | 0 | Pinned workspace configuration accepted |
| `moon query projects` | 0 | Only probe project; seven explicit targets |
| `moon run probe:domain --force --no-actions` (twice) | 0, 0 | Seven actual test executions each time, no cache replay |
| `moon run probe:flue --force --no-actions` | 0 | Six real Flue/Effect tests, 27 assertions |
| `moon run probe:test --force --no-actions` | 0 | 13 tests, 40 assertions |
| `moon run probe:typecheck --force --no-actions` | 1 | Three dependency declaration diagnostics above |
| Strict source check with CLI-only `--skipLibCheck` | 0 | Diagnostic only, not canonical qualification |

The direct TDD run first failed because `src/fixture.ts` did not exist. After
implementation, all seven tests passed (13 assertions): phase gating, digest
identity, stale generation, cancellation, rejected-state identity and fixed limits.
This fixture is deliberately not a production UpgradeRun aggregate.

Task 2 also followed missing-implementation RED, then exercised the published
Flue SQLite adapter and real tool loop with Pi's faux provider. Two submissions
recorded counts 1 then 2 through one Effect ManagedRuntime/Layer; acquisition and
release each occurred once. Other tests cover synthetic ambient credentials with
zero outbound fetches, an unknown provider failing closed without a fallback,
stop/restart of singleton ownership, observed tool failure, and rejection of a
callback after bridge disposal. No real provider was used.

The unknown-provider read returns an AgentRunError failed settlement. Flue emits
its provider diagnostic during shutdown; the test inspects that diagnostic only
after draining the runtime. Tool failure is confirmed by the actual tool-result
error reaching the next faux response, not by an invented success response.

Moon accepted the v2 plural toolchains configuration. Its resolved project
configuration records every target with `cache: false`, `retryCount: 0` and
`envFile: false`; tasks also pass Bun `--no-env-file --no-install`. No database or
transcript is a declared output. Qualified commands use `--force --no-actions`
to execute explicitly without dependency setup or affected-only skipping.

Only root `bun.lock` exists. There are no empty production packages. The general
`probe:test` target currently covers the fixture and initial runtime tests; its exit status must not
be treated as the four-phase compatibility verdict.

## Phase Results

| Phase | Status | Evidence or gap |
| --- | --- | --- |
| Domain | pass | Seven fixture tests executed twice through uncached Moon |
| Flue / Effect bridge | partial | Six runtime tests pass; canonical typecheck fails |
| Process-kill restart | not_run | Depends on Flue gate |
| Read cancellation and abort | not_run | Depends on Flue gate |

Verdict: **blocked**. Real providers, Docker, host-loss recovery, actual worker
cleanup and production qualification are **not run / not qualified**. No model
calls to real providers, real credentials, consumer repository access, GitHub
writes or cloud resources were used. Tests stopped Flue before disposing Effect
and removed their owned temporary Flue databases. No application ledger or
process-kill/recovery child was created. Blocked-provider mode and its controls
are deliberately unfinished pending Task 4 and must not be treated as usable.
Installed dependencies and Moon's ignored local cache remain for resumption.

## Resume

1. Resolve whether to mirror Flue's `skipLibCheck` policy or retain the strict
   dependency-declaration gate. Do not silently suppress the known diagnostics.
2. Rerun the canonical typecheck under the explicitly chosen policy.
3. Complete Task 2 of the approved plan, then the real process-kill and
   cancellation probes. Keep all remaining phases `not_run` until measured.

Execution began at 19:46:45 UTC; this checkpoint was recorded at approximately
20:39 UTC, within the two-hour engineering cap. This includes an owner-decision
pause between the first checkpoint and resumption at 20:31 UTC. The work is isolated on
`codex/bun-effect-flue-probe`; `main` is not merged or changed.
