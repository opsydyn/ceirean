# Hosted Executor Simulated Lifecycle

Status: **offline simulation only; hosted activation blocked**.
Date: 2026-10-24. Branch: `codex/hosted-executor-preflight`.

## Scope

Task 3A adds the private simulation protocol, validated driver boundary and
scope-owned executor controller. It does not install a Sandbox SDK, add a Worker
or Alchemy entrypoint, create an invocation route, or read deployment credentials.
Operational ingress and the existing native controller/ledger remain unchanged.

The private factory now takes trusted session configuration and a simulation
driver. Its `start` operation admits raw requests internally using Effect Clock.
This strengthens the plan's original handoff: caller-authored `Accepted` JSON
cannot become allocation authority. A reservation mutex protects start/close
without holding a lock during driver I/O. One owner fiber handles the deadline,
explicit stop and scope disposal. The session is retired, not reset, after cleanup.

## Meaning Of Evidence

- Start dispatch occurs at most once per process-local owner. Replay never
  creates a replacement. Lost acknowledgements trigger same-identity inspection.
- Validated replies bind session, operation, derived resource ID and expected
  action. Foreign identities cannot redirect cleanup.
- Physical absence is separate from settled mutation history. A future adapter
  must establish both; it cannot map an SDK liveness flag to fictitious history.
- Terminate and Destroy acknowledgements do not confirm cleanup without absent,
  quiescent readback. Surviving synthetic children and uncertain mutation history
  remain `CleanupUnconfirmed`.
- Local waits are one second per transport request, including each of the three
  sequential cleanup calls. Deadline races include startup, not only running jobs.
  Local interruption requests owned cleanup but cannot prove remote termination.
- Generated process IDs are fixture data. No Linux process tree, actual client
  disconnect, provider teardown, durable recovery or distributed admission is
  claimed. All results retain activation `Blocked`.

## Verification

Initial lifecycle tests: **0 pass / 10 fail** against explicit placeholders.
Independent reviewer Volta reproduced two ownership defects: separate controller
constructions could use the same driver/session, and a getter-backed request
could change its session between admission and dispatch. Both regressions were
observed failing before fixes and pass afterward. The driver now atomically
claims one non-releasable owner; the request is decoded and snapshotted once.
This is one trusted simulation-driver boundary, not a process-global registry
over separately constructed drivers or distributed admission. Trusted assembly
must supply one driver; actual durable ownership remains a real-adapter gate.

Complete probe: **69 pass / 0 fail, 901 assertions** across six named files.
The lifecycle portion is **22 pass / 0 fail, 72 assertions**.
This includes 300 new Effect-native lifecycle sequences (seeds 0/1/163, 100 each),
plus the prior 1200 generated probe cases. Added explicit coverage of late Start
completion after deadline/destruction, interruption during authorization/preflight,
startup scope disposal, foreign handles,
exit status, replay and close races. A late remote mutation remains a blocked,
unconfirmed cleanup requiring future operator recovery, not an automatic retry.
All 12 workspace typechecks and universal root lint/format checks pass; no
dependencies, timeout limits, lint exceptions or declaration exceptions changed.
Final full serial suite (`moon run :test --concurrency 1`): **12 completed, exit 0,
9m 7.797s**, with all final implementation and tests present before it started.
The unchanged 3000 native database refinement cases completed in 118401.25ms,
below their unchanged 180000ms bound. All 12 workspace typechecks reran after the
review fixes and expanded tests. Root lint/format and staged diff checks pass.
The read-only preparation CLI still exits 2 with `PreparationOnly`, activation
`Blocked` and all six unresolved blockers. Full test log:
`/private/tmp/ceirean-lifecycle-final-tests.log` (local, not a hosted artifact).

## Remaining Gates

Task 3B still requires exact pinned SDK integration, a reviewed private operator
transport and an approval-validating dry-run/runner. No hosted route exists to
accidentally enable. Final image digest, approved payloads, real platform safety
qualification and separate paid/hosted approvals remain unresolved. Alchemy
upgrade stays paused. No merge, push, deployment, image build/upload or activation
is part of this slice.
