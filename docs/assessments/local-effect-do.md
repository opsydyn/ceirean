# Local Effect / Durable Object Compatibility

Execution date: 2026-10-24. Local-only probe on `codex/local-effect-do`.
Base: `61addc5`; atomic boundary task: `2bbd47d`.

## Result

Effect business logic and the existing migration ledger policy execute inside a
SQLite-backed Durable Object using Alchemy's local workerd runtime. This is a
controller/storage compatibility result, not a production storage replacement,
hosted sandbox qualification or completed repository repair.

Exact cohort: Bun 1.4.2, Effect 4.0.5, Alchemy 2.0.0-beta.83, TypeScript 7.0.2.
Tested host: macOS ARM64. Linux/hosted execution is not qualified by this run.
Alchemy remains pinned; the paused upgrade was not resumed.

## Measured Coverage

- Six integration cases: registration; policy-equivalent run/worker transitions,
  duplicate registration and stale revisions; concurrent CAS; atomic rollback
  between snapshot and audit writes; malformed/excess/oversized inputs; corrupt
  stored-state rejection.
- Three generated-sequence cases: seeds 0, 1 and 163, 50 sequences per seed,
  one to twelve commands each. Replies, canonical snapshot and event history
  match the pure policy after every command. Effect reports shrunk failure
  diagnostics if a property fails.
- Separate Seed and Verify processes address the same object and retained local
  namespace. Seed commits cancellation without interpreting its response body.
  Verify recovers the snapshot, recovery state and events from disk, then retries
  cancellation and observes Conflict without another event.
- A compile-only negative case rejects non-local stack construction before
  assembling the Worker. It never invokes non-local deployment.
- Intentional pre-request startup and post-request assertion failures exit
  nonzero, as expected by the parent. The parent checks that recorded test-owned
  child PIDs are absent after every runtime generation, including both failures.
  Only an ESRCH response establishes process absence; permission failures do not.
  Both negative children must record that they reached their intended failure
  point. Process absence is polled for at most five seconds to allow OS reaping.

The acknowledgement test discards an actual HTTP response body. It does not
simulate packet loss, a hard-killed writer during commit, distributed failover or
external exactly-once side effects. Restart uses new child processes, not HMR.

## Isolation

`tests/run.test.ts` owns the temporary working directory and home. Each child has
an explicit credential-free environment, telemetry opt-out and no inherited
environment files. This is necessary because Alchemy also loads `.env` itself.
Only the Worker and its DO binding are assembled; localhost is explicitly bound.
There is no DNS, tunnel, remote binding, container, model request or GitHub call.

The Seed phase closes runtime scopes without destroying deployment metadata.
Deleting that metadata creates a new namespace and is not a restart test; the
initial failing recovery test caught this distinction. Verify destroys the local
deployment; the parent removes its owned temporary root after all tests finish.

`skipLibCheck: true` is owner-approved only in this private probe, matching the
existing infrastructure accommodation. Our source is strict, no lint rules were
disabled and other workspaces' declaration-check policy is unchanged.

## Verification

```sh
moon run cloudflare-ledger:test
moon run cloudflare-ledger:typecheck
bun --no-env-file run check
moon run :typecheck
moon run :test
```

The baseline passed all ten original workspace typecheck/test tasks. During the
implementation, all eleven workspace typechecks and all eleven test tasks passed;
the full test run took 4m25.992s. The native refinement law completed its 3000 cases
in 152333.86ms under the unchanged 180-second bound. The final probe was rerun
after adding the non-local guard. Lint and format verification is repeated after
the documentation closure. No cloud deployment or publication occurred.

A later parallel repeat overlapped additional focused probe runs and hit the
unchanged 180000ms native refinement timeout (138 passed, one timed out in that
workspace). No limit or property count was changed. A final full-suite run with
`moon run :test --concurrency 1` passed all eleven tasks in 10m0.852s. Native
refinement completed all 3000 cases in 121006.02ms, below the unchanged limit.
The local probe task passed in 18.135s during that final serial run.

Review is author self-review only: no independent reviewer tool was available.
The review added the fail-closed non-local construction guard and strengthened
the negative fixtures with explicit reached-failure markers. No further blocking
issues were found within the local-probe contract. This is not an independent
production-readiness review.

## Remaining Product Gate

Next is a separately approved, bounded hosted-executor feasibility test: the real
pinned repository toolchain, browser evidence, network restrictions, cancellation
and cleanup. This probe does not port Flue or Bun filesystem ownership semantics,
change XState orchestration, prove Cloudflare production durability, or authorize
enabling GitHub webhooks.
