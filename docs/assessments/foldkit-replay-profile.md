# Offline FoldKit Replay Profile Inspection

Measured locally on 2026-10-22 in an isolated Ceirean worktree. This implements
Plan A of the [approved plan](../superpowers/plans/2026-10-21-foldkit-replay-profile.md),
not native worker readiness or a migrated consumer repository.

## Observed Evidence

- Baseline: lint/format and seven workspace typechecks passed; 962 tests passed.
  Sandbox restrictions prevented existing ephemeral loopback tests from binding;
  the unchanged synthetic suite passed with local socket permission. No
  operational listener was started.
- Task 1: strict canonical Draft profile/decoder, six new tests, all seven
  workspace gates passed with 968 tests; commit `0475667`.
- Task 2: deterministic request comparison, detached reports and five properties,
  15000 primary generated cases (seeds 0/1/163, 1000 runs per seed/law), unchanged
  shrink/discard budgets. All seven workspace gates passed with 976 tests;
  commit `629f04e`.
- Replay focus: `moon run replay:test replay:typecheck --force --no-actions`
  passed 12 tests / 58 assertions and strict types. Includes actual subprocess
  invocation/import, sentinel `.env` and cwd controls, finite failure codes,
  unknown-field rejection, unreadable/directory/symlink cases, strict UTF-8,
  raw-byte hashing, exact size boundary, short reads and growth after stat.
- Root `bun --no-env-file --no-install apps/replay/src/main.ts inspect` exited 2,
  emitting one JSON report with all seven blockers and no stderr. Raw stdout
  SHA-256: `2d83cfab7cbc1b79da39d6084dd6c6d9a195b6512973c271f06264b2e614323f`.
  Its profile source digest was
  `d8cfeac7a7eb33d6fbc07675272dc9c3cc37daa0ff4122f911efda7975cc84ed`.
- Restored negative control: changed report construction to `canExecute: true`.
  The real CLI test failed (expected exit 2, received 1), because schema validation
  refused the unauthorized report. Restored false and all four CLI tests passed.
  Red log SHA-256: `8ebd2d4e9974680eaa07d35d16aacfd6f0657a3ad8ccd6fa54c56d62b32e4946`;
  restored log: `95bae54406b675646149d88d0001d7b0899ac53791a55c906ab3a25236760dc3`.

Task 3 full gates passed: root `bun --no-env-file run check`, all eight workspace
typechecks and all eight workspace test tasks (`moon run :typecheck --force
--no-actions` / `moon run :test --force --no-actions`). The complete suite passed
988 tests with zero failures. Final independent review and its fresh verification
are recorded after review; these task gates are not a native qualification.

Fallow's report-only scan with an empty inherited environment, temporary HOME,
both telemetry kill switches, no cache and no type-aware analysis exited 0.
It reported only the existing retained `@modelcontextprotocol/sdk` development
dependency in the admission compatibility probe, no new findings. This is not
permission to remove that compatibility/security dependency or a new security audit.

## Boundaries And Next Gates

The working-tree profile remains Draft and publication Disabled. Runtime
dependencies are only the existing pinned Effect/Bun platform and domain
workspace. No lint exceptions, dependency upgrades or future adapter stubs were
added. URL journey routes are distinct from normalized repository file paths.

The reader's 256 KiB input cap and 16 KiB report cap are actual application
bounds. Declared native CPU/memory/PID/storage/network/time limits are not tested
or enforced by this inspector. Final-component no-follow trusts the parent
directory. Valid schema data is not proof of reviewed Git provenance, command
success, installed-package compatibility, browser behavior or patch validity.

No consumer code, VM/container, migration worker, model, native migration ledger,
operational ingress or publication was executed. Existing synthetic workspace
tests use their own temporary fixtures and local loopback sockets.

Next: separately plan native journal/ownership/recovery (Plan B), preserving
existing actor authority. Colima/Docker readiness (Plan C) and prepared artifacts,
acceptance harness, Flue tools and paid/manual replay (Plan D) remain unimplemented
and require their own exact identities, limits and execution approvals.
