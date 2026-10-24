# Trusted Executor Preparation

Task 4A of the [hosted executor plan](../superpowers/plans/2026-10-24-hosted-executor.md),
2026-10-24. This delivers an offline recipe/contract harness, not a built image,
populated dependency cache, browser journey or hosted executor.

## Delivered Boundary

Private `probes/cloudflare-executor` workspace, using only already-pinned Effect
and platform-bun 4.0.5 dependencies. Alchemy remains beta.83; no SDK/runtime or
consumer dependency upgrades, lint exceptions or declaration-check exceptions.
The lockfile change adds only this workspace, with no package upgrades.

- Digest-pinned Linux amd64 image inputs, with Bun 1.3.11 retained from the
  historical consumer and fresh Node 22.23.4/Git 2.43.0/browser qualification pins.
- An unbuilt recipe with no network installers or consumer execution. Tool
  versions/locations are assertions to verify when an approved build runs, not
  observations of an executed image. Chromium sandbox viability remains unknown.
- Strict source/toolchain/command/journey manifest, trusted recipe hashing and
  explicit pending payloads. Runtime input cannot redefine `src/pins.ts`.
- Pure inventory validation for path traversal, special files, symlinks,
  collisions and known sensitive-name/key markers; exact registry HTTPS GET
  inventory validation. Neither function extracts, scans disk or performs fetches.
- Non-mutating `prepare --check`, exiting 2 with `PreparationOnly`, activation
  `Blocked`, both activation blockers and all four pending artifact groups.
  Unsupported commands exit 64; input failures exit 1 with sanitized diagnostics.

No credentials, root operational configuration, image builder, Colima profile,
GitHub permission, ingress listener, webhook or cloud resource was accessed or
activated by this probe. Public release/image metadata was read while selecting
pins; the only dependency installation used Bun's network-disabled cache mode
with lifecycle scripts disabled.

## Tests And Review

The initial positive contract tests failed against unimplemented behavior, and
CLI tests observed incorrect successful exits before implementation. Effect-native
path laws cover three deterministic seeds (0, 1, 163), 200 generated sequences
each, with explicit successful-run counts.

Independent code review identified two P2 findings, both fixed with fresh-process
regression tests observed red then green:

1. The runtime manifest had been used to derive its own expected recipe/images/
   commands/journeys. Expectations now live in reviewed code, independent of
   runtime JSON; a modified fixture cannot bless floating images or test skips.
2. The static JSON import parsed input before bounded loading and sanitized error
   handling. Production code no longer imports that JSON. Missing, malformed and
   oversized fixtures now fail structurally, and invalid argv still exits 64
   without depending on the manifest. Tests use isolated copies, not mutations
   of the checkout's input files.

The reviewer found no additional issue in source-path collisions, exact URL
checks, subprocess timeouts or the documented archive/browser limitations. No
independent hosted security review, image execution or provider qualification is
claimed. Post-review fixes are verified by regression tests, not a second review.

Verification in the isolated checkout:

- `bun --no-env-file run check`: lint and format pass, with no rule exceptions.
- `moon run :typecheck cloudflare-executor:test`: all 12 typechecks and the final
  23 probe tests pass; 80 assertions, including 600 generated path-law cases.
- `moon run :test --concurrency 1`: all 12 test tasks pass in 9m47.391s. Native
  storage ran all 3000 refinement cases in 128432.42ms, below its unchanged
  180000ms bound. This full run began before the two review fixes; after those
  probe-only changes, the complete probe tests and all typechecks were rerun as
  recorded above. Other workspace implementation/test files did not change.
- `bun --no-env-file install --offline --frozen-lockfile --ignore-scripts`:
  succeeds from cache with no dependency changes or network retrieval.
- Direct `prepare --check`: structured `PreparationOnly`, activation `Blocked`,
  exit 2, with private invocation/final image and four pending payload blockers.
- `git diff --check`: passes. No image was built, pulled or run.

Full-suite log: `/private/tmp/ceirean-executor-preparation-tests.log`. These are
local macOS ARM64 checks, not execution of the proposed Linux amd64 image.

## Remaining Gates

Task 2's admission/evidence collector is next; the runtime driver, browser cases
and actual prepared archives remain later tasks. This manifest does not confer
source-transfer authority or prove complete offline package coverage.

The proposed builder is a separately approved ephemeral GitHub-hosted
`ubuntu-24.04` Linux amd64 job with a 15-minute timeout. No job or workflow has
been created. A build must bind
the reviewed recipe, complete input/artifact hashes and builder identity before
producing the final executor digest. No build/upload is authorized here. Private
authenticated invocation and that final digest remain independent blockers
before hosted activation, with the cost/time/permission worksheet still required.
